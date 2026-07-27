// ===== Bundled for Supabase Dashboard deploy: session-pause =====
// Inlined from _shared/auth.ts and _shared/revoke.ts (same pattern as
// session-end-early / session-end / emergency-unlock-webhook).

import { createClient, SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

export const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, content-type",
  "Access-Control-Allow-Methods": "GET, POST, PATCH, OPTIONS",
};

let _admin: SupabaseClient | null = null;
function admin(): SupabaseClient {
  if (_admin) return _admin;
  _admin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  );
  return _admin;
}

async function sha256Hex(input: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

export type ResolvedAuth = { userId: string; admin: SupabaseClient };

async function resolveUser(req: Request): Promise<ResolvedAuth | null> {
  const header = req.headers.get("Authorization") || "";
  const token = header.replace(/^Bearer\s+/i, "").trim();
  if (!token) return null;

  const hash = await sha256Hex(token);
  const db = admin();
  const { data, error } = await db
    .from("extension_sync_tokens")
    .select("user_id")
    .eq("token_hash", hash)
    .maybeSingle();

  if (error || !data) return null;

  db.from("extension_sync_tokens")
    .update({ last_seen_at: new Date().toISOString() })
    .eq("token_hash", hash)
    .then(() => {}, () => {});

  return { userId: data.user_id, admin: db };
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...CORS_HEADERS },
  });
}

function unauthorized(): Response {
  return json({ error: "invalid_or_missing_token" }, 401);
}

// ===== session-pause/index.ts body =====

// POST /functions/v1/session-pause
// Called by blocked/unlock.js's confirmUnlock() once the 150-char code
// is typed correctly. Unlike session-end-early (which this route used to
// call and which finishes the session outright), this is only a
// temporary breather: the session row stays active=true the whole time,
// this just marks it unverified and stamps paused_until so blocks.html
// can show "Paused - resumes at X" instead of a normal running timer.
// The extension re-applies the actual block locally once PAUSE_MINUTES
// is up (background.js's RELOCK_ALARM) - this call doesn't need to be
// repeated or reversed for that to happen.
// Body: { minutes } (defaults to 20 if omitted/invalid).

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS_HEADERS });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  const auth = await resolveUser(req);
  if (!auth) return unauthorized();

  const body = await req.json().catch(() => ({}));
  const minutes = Number.isFinite(body.minutes) && body.minutes > 0 ? body.minutes : 20;

  const { data: session, error: findErr } = await auth.admin
    .from("focus_lock_sessions")
    .select("id")
    .eq("user_id", auth.userId)
    .eq("active", true)
    .maybeSingle();

  if (findErr) return json({ error: findErr.message }, 500);
  if (!session) return json({ ok: true, no_active_session: true });

  const pausedUntil = new Date(Date.now() + minutes * 60_000).toISOString();

  const { error } = await auth.admin
    .from("focus_lock_sessions")
    .update({
      verified: false, // never trust this path - same rule as session-end-early
      used_code_unlock: true,
      paused_until: pausedUntil,
    })
    .eq("id", session.id);

  if (error) return json({ error: error.message }, 500);

  return json({ ok: true, paused_until: pausedUntil });
});
