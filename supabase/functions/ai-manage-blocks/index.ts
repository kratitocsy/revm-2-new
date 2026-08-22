// ===== ai-manage-blocks =====
// Server-side proxy to Gemini for natural-language block/schedule management:
//   "create a chemistry-only block"
//   "delete my physics+maths block"
//   "make a schedule that keeps chemistry every day, alternating physics/maths"
//
// This does NOT execute anything itself — it returns a structured, validated
// action plan (create_preset / delete_preset / create_schedule /
// delete_schedule) that the client shows as a plain-English confirmation
// before the user approves it and blocks.html actually performs the writes.
// Nothing here ever touches the database directly.
//
// Deliberately scoped narrower than it could be:
//   - Sites are the only thing the AI can populate on a new preset. Apps and
//     YouTube channels are left empty — an LLM has no way to know what's
//     actually installed on a specific person's machine (app process names),
//     and a wrong/hallucinated YouTube channelId would silently block the
//     wrong channel or nothing at all. Both stay manual, real-data steps in
//     the existing pickers after a preset is created.
//   - delete_preset / delete_schedule targets are validated against the
//     exact id list the client actually sent — a model-hallucinated id is
//     rejected outright rather than trusted, so this can never touch a row
//     that wasn't explicitly shown to it as existing.

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

interface PresetIn {
  id: string;
  name: string;
  sites: string[];
  apps: string[];
  apps_mode: string;
}
interface ScheduleIn {
  id: string;
  name: string;
  days_of_week: number[];
  slot_count: number;
}

const SYSTEM_PROMPT = `You manage study-app "focus block" presets and weekly schedules for a student. You turn one natural-language request into a structured action plan — you never execute anything yourself, you only propose it.

Return JSON with this exact shape — no markdown, no commentary, raw JSON only:
{
  "summary": "one short plain-English paragraph describing exactly what this plan will do, written for the student to read before approving it",
  "actions": [ ...zero or more action objects, see types below... ]
}

Action types (an action object has "type" plus the fields listed):

1. create_preset: { "type":"create_preset", "name":"...", "sites":["domain.com", ...], "reason":"one line on why these sites" }
   - name: short, descriptive, must NOT exactly duplicate an existing preset name given to you.
   - sites: CRITICAL — do not invent obscure or exam-platform domains from memory. Prefer copying sites verbatim from the EXISTING PRESETS you were given, when an existing preset's name relates to the same subject/topic (e.g. reuse a "physics+chemistry" preset's full site list when asked for a chemistry-focused block, since it's not safe to guess which of its sites are physics-only vs chemistry-only). You may only add brand-new domains from this small safe list of universally-known sites if directly relevant: youtube.com, instagram.com, facebook.com, twitter.com, x.com, reddit.com, tiktok.com, netflix.com, whatsapp.com. Never invent a coaching platform, PDF portal, or niche exam-prep domain that wasn't already shown to you.

2. delete_preset: { "type":"delete_preset", "id":"...", "name":"..." }
   - id MUST be copied exactly from the EXISTING PRESETS list you were given. Never invent an id. Include the matching name for the confirmation UI.

3. create_schedule: { "type":"create_schedule", "name":"...", "days_of_week":[0-6,...], "slots":[ { "start_time":"HH:MM", "end_time":"HH:MM", "preset_name":"...", "subject":"...", "is_sleep":false } ] }
   - preset_name must exactly match either an existing preset's name (from EXISTING PRESETS) or a "name" used in a create_preset action earlier in this same actions array — never a name that appears nowhere in either place.
   - Same time-format and non-overlap rules as a normal schedule: HH:MM 24-hour, end_time strictly after start_time (no overnight wraparound), one sleep slot (is_sleep:true, subject:"Sleep", no preset_name needed), 10-20 min breaks between study slots, days_of_week 0=Sun..6=Sat.

4. delete_schedule: { "type":"delete_schedule", "id":"...", "name":"..." }
   - id MUST be copied exactly from the EXISTING SCHEDULES list you were given.

Rules:
- If the request is ambiguous about which existing preset/schedule to delete, do not guess — return an empty actions array and explain the ambiguity in "summary" instead (e.g. "You have two schedules with similar names — which one: X or Y?").
- If the request only needs one or two actions, only return those — do not add unrelated actions.
- Return ONLY valid JSON. No markdown fences. No explanation outside the JSON.`;

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
        maxOutputTokens: 8192,
        responseMimeType: "application/json",
      },
      safetySettings: [
        { category: "HARM_CATEGORY_HARASSMENT", threshold: "BLOCK_NONE" },
        { category: "HARM_CATEGORY_HATE_SPEECH", threshold: "BLOCK_NONE" },
        { category: "HARM_CATEGORY_SEXUALLY_EXPLICIT", threshold: "BLOCK_NONE" },
        { category: "HARM_CATEGORY_DANGEROUS_CONTENT", threshold: "BLOCK_NONE" },
      ],
    }),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Gemini API ${res.status}: ${errText}`);
  }
  const data = await res.json();
  const text: string = data?.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
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

// Validates the plan against what was actually sent — every id must be a
// real id we gave it, every preset_name must resolve to something real or
// something the plan itself is creating. A plan that fails this is
// rejected outright rather than partially trusted.
function validatePlan(
  plan: Record<string, unknown>,
  existingPresets: PresetIn[],
  existingSchedules: ScheduleIn[],
): string | null {
  if (typeof plan.summary !== "string" || !plan.summary.trim()) {
    return "Missing summary";
  }
  if (!Array.isArray(plan.actions)) return "Missing actions array";

  const presetIds = new Set(existingPresets.map((p) => p.id));
  const scheduleIds = new Set(existingSchedules.map((s) => s.id));
  const knownPresetNames = new Set(
    existingPresets.map((p) => p.name.toLowerCase()),
  );

  for (const action of plan.actions as Record<string, unknown>[]) {
    if (typeof action.type !== "string") return "Action missing type";

    switch (action.type) {
      case "create_preset": {
        if (typeof action.name !== "string" || !action.name.trim()) {
          return "create_preset missing name";
        }
        if (!Array.isArray(action.sites) || action.sites.length === 0) {
          return `create_preset "${action.name}" has no sites`;
        }
        knownPresetNames.add((action.name as string).toLowerCase());
        break;
      }
      case "delete_preset": {
        if (typeof action.id !== "string" || !presetIds.has(action.id)) {
          return `delete_preset references an id that wasn't in the existing presets list: ${action.id}`;
        }
        break;
      }
      case "delete_schedule": {
        if (typeof action.id !== "string" || !scheduleIds.has(action.id)) {
          return `delete_schedule references an id that wasn't in the existing schedules list: ${action.id}`;
        }
        break;
      }
      case "create_schedule": {
        if (typeof action.name !== "string" || !action.name.trim()) {
          return "create_schedule missing name";
        }
        if (
          !Array.isArray(action.days_of_week) ||
          action.days_of_week.length === 0
        ) return `create_schedule "${action.name}" has no days_of_week`;
        if (!Array.isArray(action.slots) || action.slots.length < 2) {
          return `create_schedule "${action.name}" needs at least 2 slots`;
        }
        for (const slot of action.slots as Record<string, unknown>[]) {
          if (
            typeof slot.start_time !== "string" ||
            !/^\d{2}:\d{2}$/.test(slot.start_time)
          ) return `Bad start_time in "${action.name}": ${slot.start_time}`;
          if (
            typeof slot.end_time !== "string" ||
            !/^\d{2}:\d{2}$/.test(slot.end_time)
          ) return `Bad end_time in "${action.name}": ${slot.end_time}`;
          if ((slot.end_time as string) <= (slot.start_time as string)) {
            return `end_time must be after start_time in "${action.name}"`;
          }
          if (!slot.is_sleep) {
            if (!slot.preset_name || typeof slot.preset_name !== "string") {
              return `Slot in "${action.name}" is missing preset_name`;
            }
            if (!knownPresetNames.has((slot.preset_name as string).toLowerCase())) {
              return `Slot in "${action.name}" references an unknown preset: ${slot.preset_name}`;
            }
          }
        }
        break;
      }
      default:
        return `Unknown action type: ${action.type}`;
    }
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

    const { command, presets, schedules } = await req.json();
    if (!command || typeof command !== "string" || !command.trim()) {
      return json({ error: "command is required" }, 400);
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      { global: { headers: { Authorization: authHeader } } },
    );
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) return json({ error: "Invalid auth token" }, 401);

    const apiKey = Deno.env.get("GEMINI_API_KEY");
    if (!apiKey) return json({ error: "AI not configured" }, 500);
    const model = Deno.env.get("GEMINI_MODEL") || "gemini-3.5-flash";

    const existingPresets: PresetIn[] = presets || [];
    const existingSchedules: ScheduleIn[] = schedules || [];

    const userPrompt = `STUDENT REQUEST: ${command}

EXISTING PRESETS (each is a "block" — a set of sites/apps enforced during a session):
${
      existingPresets.length
        ? existingPresets.map((p) =>
          `- id:${p.id} name:"${p.name}" sites:[${p.sites.join(", ")}] apps:[${
            p.apps.join(", ")
          }] mode:${p.apps_mode}`
        ).join("\n")
        : "(none saved yet)"
    }

EXISTING SCHEDULES:
${
      existingSchedules.length
        ? existingSchedules.map((s) =>
          `- id:${s.id} name:"${s.name}" days:[${
            s.days_of_week.join(",")
          }] slot_count:${s.slot_count}`
        ).join("\n")
        : "(none saved yet)"
    }

Turn the student's request into an action plan following your system instructions.`;

    const rawText = await callGemini(userPrompt, apiKey, model);

    let plan: unknown;
    try {
      plan = extractJson(rawText);
    } catch (parseErr) {
      console.error(
        "ai-manage-blocks: failed to parse Gemini output.",
        "Raw text (first 500 chars):",
        rawText.slice(0, 500),
        "Parse error:",
        parseErr instanceof Error ? parseErr.message : parseErr,
      );
      return json({
        error:
          "The AI's response got cut off or was malformed. Try a shorter/simpler request, or try again.",
      }, 500);
    }

    const err = validatePlan(
      plan as Record<string, unknown>,
      existingPresets,
      existingSchedules,
    );
    if (err) return json({ error: `AI returned an invalid plan: ${err}` }, 500);

    return json({ success: true, plan });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Unknown error";
    console.error("ai-manage-blocks error:", msg);
    return json({ error: msg }, 500);
  }
});
