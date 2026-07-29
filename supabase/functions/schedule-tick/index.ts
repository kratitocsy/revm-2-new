// ===== Bundled for Supabase Dashboard deploy: schedule-tick =====
// Called every minute by an external scheduler (cron-job.org) hitting this
// endpoint's URL directly with an x-cron-secret header - NOT called by the
// extension, desktop app, or website directly. Runs as the service role,
// so it can touch every user's rows in one pass instead of needing each
// user's browser open at exactly the right minute.
//
// What it does, once per minute, per active schedule whose days_of_week
// includes today (Asia/Kolkata, since that's this product's timezone -
// see IST_OFFSET_MINUTES below):
//   1. Find the slot (if any) that "now" falls inside.
//   2. If that slot hasn't been started yet today (no focus_lock_schedule_
//      runs row for (slot_id, today)) and the user has no other active
//      session, start one from the slot's preset and record the run.
//   3. If that slot HAS already run today and its session is still
//      active but the slot's end_time has passed, end it.
//
// Idempotency matters here: if the person pays to unlock mid-slot, the
// run row already exists for today, so re-running this a minute later
// must NOT start a new session for the same slot/day. Only tomorrow (or
// the next slot) gets a fresh run row.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const IST_OFFSET_MINUTES = 5 * 60 + 30; // Asia/Kolkata is fixed UTC+5:30, no DST

function admin() {
  return createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  );
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

// Returns { dayOfWeek: 0-6 (0=Sun, matches JS Date#getDay()), hhmm: "HH:MM",
// dateStr: "YYYY-MM-DD" } all in IST, derived from the real UTC clock
// rather than trusting any client-supplied time.
function nowInIst(): { dayOfWeek: number; hhmm: string; dateStr: string } {
  const nowUtc = new Date();
  const ist = new Date(nowUtc.getTime() + IST_OFFSET_MINUTES * 60_000);
  const dayOfWeek = ist.getUTCDay();
  const hh = String(ist.getUTCHours()).padStart(2, "0");
  const mm = String(ist.getUTCMinutes()).padStart(2, "0");
  const dateStr = ist.toISOString().slice(0, 10);
  return { dayOfWeek, hhmm: `${hh}:${mm}`, dateStr };
}

// Converts an IST "HH:MM[:SS]" wall-clock time on dateStr into a UTC ISO
// timestamp, so ends_at on focus_lock_sessions lines up with the real
// slot end regardless of what timezone the reading server is in.
function istWallClockToUtcIso(dateStr: string, hhmmss: string): string {
  const [h, m, s] = hhmmss.split(":").map((n) => parseInt(n, 10));
  const utcMs =
    Date.parse(`${dateStr}T00:00:00.000Z`) +
    ((h || 0) * 60 + (m || 0)) * 60_000 +
    (s || 0) * 1000 -
    IST_OFFSET_MINUTES * 60_000;
  return new Date(utcMs).toISOString();
}

// Ends a schedule-driven study_sessions row the same way rpc_stop_study_session
// does (total_seconds = elapsed - accumulated pause time). Only ever called
// on rows this function itself started (schedule_slot_id is set), never a
// manually-started one - see migration 0047.
async function endStudySession(db: ReturnType<typeof createClient>, row: any) {
  const now = new Date();
  let extraPause = 0;
  if (row.paused_at) {
    extraPause = Math.max(0, Math.floor((now.getTime() - new Date(row.paused_at).getTime()) / 1000));
  }
  const accumPaused = (row.accumulated_paused_seconds || 0) + extraPause;
  const totalSeconds = Math.max(
    0,
    Math.floor((now.getTime() - new Date(row.started_at).getTime()) / 1000) - accumPaused
  );
  await db
    .from("study_sessions")
    .update({
      ended_at: now.toISOString(),
      paused_at: null,
      accumulated_paused_seconds: accumPaused,
      total_seconds: totalSeconds,
    })
    .eq("id", row.id);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null);

  // Auth: previously this function relied entirely on Supabase's platform
  // JWT check, called only by pg_net with the service role key as Bearer.
  // To let an external scheduler (cron-job.org) trigger this on Supabase's
  // free tier instead of pg_cron, we need something that service is
  // allowed to hold - NOT the service role key itself, which has full
  // unrestricted database access and shouldn't leave Supabase.
  // CRON_SECRET is a narrow, single-purpose secret: it can only ever
  // trigger this one tick, nothing else. Set it with:
  //   supabase secrets set CRON_SECRET=<a long random string>
  // (or via Dashboard -> Edge Functions -> schedule-tick -> Secrets), and
  // in the Dashboard's function Settings, turn OFF "Enforce JWT
  // Verification" for schedule-tick so a plain header can reach this code
  // at all - the check below is what actually protects it after that.
  const cronSecret = Deno.env.get("CRON_SECRET");
  if (cronSecret) {
    const provided = req.headers.get("x-cron-secret");
    if (provided !== cronSecret) {
      return json({ error: "unauthorized" }, 401);
    }
  }
  // If CRON_SECRET isn't set at all, this falls through to relying on
  // platform JWT verification alone (the original pg_net-only setup) -
  // so nothing breaks for anyone who hasn't migrated yet.

  const db = admin();
  const { dayOfWeek, hhmm, dateStr } = nowInIst();

  const { data: schedules, error: schedErr } = await db
    .from("focus_lock_schedules")
    .select("id, user_id, days_of_week")
    .eq("active", true)
    .contains("days_of_week", [dayOfWeek]);

  if (schedErr) return json({ error: schedErr.message }, 500);
  if (!schedules?.length) return json({ ok: true, checked: 0 });

  let started = 0;
  let ended = 0;
  const errors: string[] = [];

  for (const schedule of schedules) {
    try {
      const { data: slots, error: slotErr } = await db
        .from("focus_lock_schedule_slots")
        .select("id, slot_order, preset_id, start_time, end_time, subject")
        .eq("schedule_id", schedule.id)
        .order("slot_order", { ascending: true });
      if (slotErr || !slots?.length) continue;

      // "now" as HH:MM compares fine lexicographically against the time
      // columns cast to text (both zero-padded "HH:MM:SS").
      const currentSlot = slots.find(
        (s: any) => hhmm >= s.start_time.slice(0, 5) && hhmm < s.end_time.slice(0, 5)
      );

      // ── End any slot whose window just closed ──
      for (const slot of slots) {
        if (currentSlot && slot.id === currentSlot.id) continue;
        if (hhmm < slot.end_time.slice(0, 5)) continue; // not over yet
        const { data: run } = await db
          .from("focus_lock_schedule_runs")
          .select("id, session_id, ended_at")
          .eq("slot_id", slot.id)
          .eq("run_date", dateStr)
          .maybeSingle();
        if (!run || run.ended_at || !run.session_id) continue;
        const { data: session } = await db
          .from("focus_lock_sessions")
          .select("id, active")
          .eq("id", run.session_id)
          .maybeSingle();
        if (session?.active) {
          await db
            .from("focus_lock_sessions")
            .update({ active: false, verified: true })
            .eq("id", session.id);
          ended++;
        }
        await db
          .from("focus_lock_schedule_runs")
          .update({ ended_at: new Date().toISOString() })
          .eq("id", run.id);

        // Stop the study-timer session this slot itself started, if any -
        // never touches a manually-started one (schedule_slot_id would be
        // null for those). Covers both "slot ends into a break" and
        // "slot ends, a differently-subjected slot starts" - the latter
        // also gets a belt-and-suspenders check below in case timing
        // lines up so the next slot is processed in the same tick.
        const { data: linkedStudySession } = await db
          .from("study_sessions")
          .select("id, started_at, paused_at, accumulated_paused_seconds")
          .eq("schedule_slot_id", slot.id)
          .is("ended_at", null)
          .maybeSingle();
        if (linkedStudySession) await endStudySession(db, linkedStudySession);
      }

      if (!currentSlot) continue;

      // ── Start the current slot, unless already run today ──
      const { data: existingRun } = await db
        .from("focus_lock_schedule_runs")
        .select("id")
        .eq("slot_id", currentSlot.id)
        .eq("run_date", dateStr)
        .maybeSingle();
      if (existingRun) continue; // already handled today, incl. paid-unlock case

      // Don't stomp on a block the person started themselves (manual or a
      // different schedule) - schedules only fill in when nothing's running.
      const { data: activeSession } = await db
        .from("focus_lock_sessions")
        .select("id")
        .eq("user_id", schedule.user_id)
        .eq("active", true)
        .maybeSingle();
      if (activeSession) continue;

      const { data: preset } = await db
        .from("focus_lock_presets")
        .select("*")
        .eq("id", currentSlot.preset_id)
        .maybeSingle();
      if (!preset) continue;

      const endsAtIso = istWallClockToUtcIso(dateStr, currentSlot.end_time);
      const { data: newSession, error: insertErr } = await db
        .from("focus_lock_sessions")
        .insert({
          user_id: schedule.user_id,
          block_name: currentSlot.subject || preset.name,
          sites: preset.sites,
          mode: preset.mode === "whitelist" ? "whitelist" : "blacklist",
          youtube_rules: preset.youtube_rules || null,
          apps: preset.apps || [],
          apps_mode: preset.apps_mode === "whitelist" ? "whitelist" : "blacklist",
          no_early_unlock: !!preset.no_early_unlock,
          ends_at: endsAtIso,
          unlimited: false,
          source: "schedule",
          schedule_id: schedule.id,
          schedule_slot_id: currentSlot.id,
        })
        .select("id")
        .single();
      if (insertErr) {
        errors.push(`schedule ${schedule.id}: ${insertErr.message}`);
        continue;
      }

      await db.from("focus_lock_schedule_runs").insert({
        schedule_id: schedule.id,
        slot_id: currentSlot.id,
        run_date: dateStr,
        session_id: newSession.id,
        started_at: new Date().toISOString(),
      });
      started++;

      // ── Auto-start the study timer too, if this slot's subject is one
      // of the person's actual onboarded subjects (not just any free text
      // typed into the slot) ──
      if (currentSlot.subject) {
        const { data: profile } = await db
          .from("user_profiles")
          .select("subjects")
          .eq("id", schedule.user_id)
          .maybeSingle();
        const known = (profile?.subjects || []).some(
          (s: string) => s.trim().toLowerCase() === currentSlot.subject.trim().toLowerCase()
        );
        if (known) {
          const { data: activeStudySession } = await db
            .from("study_sessions")
            .select("id, started_at, paused_at, accumulated_paused_seconds, schedule_slot_id")
            .eq("user_id", schedule.user_id)
            .is("ended_at", null)
            .maybeSingle();
          if (activeStudySession && activeStudySession.schedule_slot_id) {
            // Leftover from a slot that ended and started in the same tick,
            // or a stale schedule-driven row - safe to swap out.
            await endStudySession(db, activeStudySession);
          }
          if (!activeStudySession || activeStudySession.schedule_slot_id) {
            await db.from("study_sessions").insert({
              user_id: schedule.user_id,
              group_id: null,
              subject: currentSlot.subject,
              started_at: new Date().toISOString(),
              schedule_slot_id: currentSlot.id,
            });
          }
          // else: an active row exists with schedule_slot_id null - the
          // person started it manually, so leave it running untouched.
        }
      }
    } catch (e) {
      errors.push(`schedule ${schedule.id}: ${String((e as Error)?.message || e)}`);
    }
  }

  return json({ ok: true, checked: schedules.length, started, ended, errors });
});
