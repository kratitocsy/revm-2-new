// ===== ai-generate-schedule =====
// Server-side proxy to Google Gemini for AI-powered schedule generation.
// Keeps the Gemini API key secret (never exposed to the client).
//
// Two modes:
//   "text"  — user describes goals in natural language → AI builds a schedule
//   "stats" — AI analyses the user's study_sessions, subjects, exam date
//             and generates an optimal schedule from their patterns
//
// The generated schedule is returned as JSON for the client to preview in
// the normal schedule builder — the user always reviews before saving.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...CORS },
  });
}

const SYSTEM_PROMPT = `You are a study-schedule expert. You create realistic, balanced weekly study schedules for students.

Generate a schedule as JSON with this exact shape — no markdown, no commentary, raw JSON only:
{
  "name": "short catchy schedule name (max 40 chars)",
  "days_of_week": [1,2,3,4,5],
  "slots": [
    {
      "start_time": "HH:MM",
      "end_time": "HH:MM",
      "subject": "Subject or activity label",
      "is_sleep": false,
      "break_after_minutes": 15
    }
  ]
}

Rules:
- days_of_week: 0=Sun 1=Mon … 6=Sat. Pick sensible days.
- Times: 24-hour "HH:MM" format. Slots ordered chronologically. No overlaps.
- Include 10-20 min breaks between study slots.
- Include exactly ONE sleep slot (is_sleep:true, subject:"Sleep") for 7-9 hours.
- Total study time (non-sleep) between 2-8 hours depending on goals.
- subject: short label (Physics, Chemistry, Math, Revision, Practice, etc.)
- Distribute harder subjects during likely peak hours, lighter ones otherwise.
- Return ONLY valid JSON. No markdown fences. No explanation.`;

async function callGemini(
  userPrompt: string,
  apiKey: string,
  model: string,
): Promise<string> {
  const url =
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      system_instruction: { parts: [{ text: SYSTEM_PROMPT }] },
      contents: [{ parts: [{ text: userPrompt }] }],
      generationConfig: {
        temperature: 0.8,
        maxOutputTokens: 2048,
        responseMimeType: "application/json",
      },
      safetySettings: [
        {
          category: "HARM_CATEGORY_HARASSMENT",
          threshold: "BLOCK_NONE",
        },
        {
          category: "HARM_CATEGORY_HATE_SPEECH",
          threshold: "BLOCK_NONE",
        },
        {
          category: "HARM_CATEGORY_SEXUALLY_EXPLICIT",
          threshold: "BLOCK_NONE",
        },
        {
          category: "HARM_CATEGORY_DANGEROUS_CONTENT",
          threshold: "BLOCK_NONE",
        },
      ],
    }),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Gemini API ${res.status}: ${errText}`);
  }

  const data = await res.json();
  const text: string =
    data?.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
  if (!text) throw new Error("Empty response from Gemini");
  return text;
}

function extractJson(text: string): unknown {
  let cleaned = text.trim();
  const fence = cleaned.match(/```(?:json)?\s*\n?([\s\S]*?)```/);
  if (fence) cleaned = fence[1].trim();
  if (cleaned.startsWith("{")) {
    const end = cleaned.lastIndexOf("}");
    if (end >= 0) cleaned = cleaned.slice(0, end + 1);
  }
  return JSON.parse(cleaned);
}

function validateSchedule(sched: Record<string, unknown>): string | null {
  if (!sched.name || typeof sched.name !== "string")
    return "Missing schedule name";
  if (
    !Array.isArray(sched.days_of_week) || sched.days_of_week.length === 0
  ) return "No days selected";
  for (const d of sched.days_of_week) {
    if (typeof d !== "number" || d < 0 || d > 6)
      return `Invalid day: ${d}`;
  }
  if (!Array.isArray(sched.slots) || sched.slots.length < 2)
    return "Need at least 2 slots";
  for (const slot of sched.slots) {
    if (typeof slot.start_time !== "string" || !/^\d{2}:\d{2}$/.test(slot.start_time))
      return `Bad start_time: ${slot.start_time}`;
    if (typeof slot.end_time !== "string" || !/^\d{2}:\d{2}$/.test(slot.end_time))
      return `Bad end_time: ${slot.end_time}`;
    if (slot.end_time <= slot.start_time)
      return `end_time must be after start_time: ${slot.start_time}-${slot.end_time}`;
    if (!slot.is_sleep && !slot.subject)
      return "Non-sleep slot needs a subject";
  }
  return null;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CORS });
  }
  if (req.method !== "POST") return json({ error: "POST only" }, 405);

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json({ error: "Not authenticated" }, 401);

    const { mode, goal_text, presets, subjects } = await req.json();
    if (!mode) return json({ error: "mode is required" }, 400);

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      { global: { headers: { Authorization: authHeader } } },
    );

    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();
    if (authError || !user) {
      return json({ error: "Invalid auth token" }, 401);
    }

    const apiKey = Deno.env.get("GEMINI_API_KEY");
    if (!apiKey) return json({ error: "AI not configured" }, 500);
    const model = Deno.env.get("GEMINI_MODEL") || "gemini-2.5-flash";

    let userPrompt: string;
    const presetList = (presets || []).map(
      (p: { name: string }) => p.name,
    );
    const subjectList = subjects || [];

    if (mode === "stats") {
      // Fetch user's study data for AI analysis
      const { data: sessions } = await supabase
        .from("study_sessions")
        .select("subject, started_at, total_seconds, accumulated_paused_seconds")
        .eq("user_id", user.id)
        .gte("started_at", new Date(Date.now() - 30 * 86400000).toISOString())
        .order("started_at", { ascending: false })
        .limit(200);

      const { data: profile } = await supabase
        .from("user_profiles")
        .select("subjects, exam_date")
        .eq("user_id", user.id)
        .maybeSingle();

      // Build study analytics summary
      const subjectStats: Record<
        string,
        { total_seconds: number; session_count: number; avg_hour: number[] }
      > = {};
      for (const s of sessions || []) {
        const subj = s.subject || "General";
        if (!subjectStats[subj]) {
          subjectStats[subj] = {
            total_seconds: 0,
            session_count: 0,
            avg_hour: [],
          };
        }
        subjectStats[subj].total_seconds += s.total_seconds || 0;
        subjectStats[subj].session_count++;
        if (s.started_at) {
          subjectStats[subj].avg_hour.push(
            new Date(s.started_at).getHours(),
          );
        }
      }

      const subjectSummary = Object.entries(subjectStats).map(
        ([subj, stats]) => {
          const hours = Math.round(stats.total_seconds / 3600 * 10) / 10;
          const avgHr = stats.avg_hour.length
            ? Math.round(
              stats.avg_hour.reduce((a: number, b: number) => a + b, 0) /
                stats.avg_hour.length,
            )
            : null;
          return `${subj}: ${hours}h total, ${stats.session_count} sessions${
            avgHr !== null ? `, avg start hour: ${avgHr}:00` : ""
          }`;
        },
      );

      const totalStudyHours = Math.round(
        (sessions || []).reduce(
          (sum: number, s: { total_seconds?: number }) =>
            sum + (s.total_seconds || 0),
          0,
        ) / 3600 * 10,
      ) / 10;

      // Find weakest subjects (least time) and strongest (most time)
      const sorted = Object.entries(subjectStats).sort(
        (a, b) => a[1].total_seconds - b[1].total_seconds,
      );
      const weakest = sorted.slice(0, 3).map(([s]) => s);
      const strongest = sorted.slice(-3).reverse().map(([s]) => s);

      userPrompt =
        `Generate an optimized study schedule based on this student's data:

STUDY DATA (last 30 days):
- Total study time: ${totalStudyHours} hours across ${(sessions || []).length} sessions
- Per subject: ${subjectSummary.join("\n  ")}
- Weakest areas (least study time): ${weakest.join(", ") || "N/A"}
- Strongest areas (most study time): ${strongest.join(", ") || "N/A"}

STUDENT PROFILE:
- Subjects: ${(profile?.subjects || subjectList || []).join(", ")}
- Exam date: ${profile?.exam_date || "not specified"}

AVAILABLE BLOCK PRESETS: ${presetList.join(", ") || "none specified"}

REQUIREMENTS:
- Give MORE time to weaker subjects
- Schedule study sessions around the student's natural peak hours
- Include adequate breaks
- Be realistic — don't schedule 12 hours if they currently average 3
- Create a schedule name that motivates`;
    } else {
      // Text goals mode
      userPrompt =
        `Generate a study schedule based on this student's goals:

GOALS: ${goal_text || "Not provided"}

AVAILABLE BLOCK PRESETS: ${presetList.join(", ") || "none specified"}
SUBJECTS: ${subjectList.join(", ") || "none specified"}

Create a balanced, realistic schedule that addresses these goals.`;
    }

    const rawText = await callGemini(userPrompt, apiKey, model);
    const schedule = extractJson(rawText);

    const err = validateSchedule(
      schedule as Record<string, unknown>,
    );
    if (err) return json({ error: `AI returned invalid schedule: ${err}` }, 500);

    return json({ success: true, schedule });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Unknown error";
    console.error("ai-generate-schedule error:", msg);
    return json({ error: msg }, 500);
  }
});
