import type { Priority, Topic, TopicStatus } from '../MobileHome';
import { calcPriority, NEXT_REVIEW_LABELS } from '../MobileHome';

/* ============================================================
   This mirrors tracker.html's data model exactly, on purpose:
   `user_profiles.tracker_data` is a JSON array of these rows,
   ALREADY read/written by tracker.html, timer.html and home.html
   (see src/features/tracker/tracker-sync.js). We're adding a new
   reader/writer of the same column, not inventing a new one.

   IMPORTANT — this is a day-indexed model, not a topic list:
   tracker.html's buildRows() creates exactly one row per calendar
   day from the user's exam start_date to end_date (see tracker.html
   ~line 782), each with an empty `topic` until the user fills it
   in for that day. There is currently no "add another topic for
   today" — one row per day is a real constraint of the existing
   schema, not something this file invents.

   That matters for how `addTopic` below behaves: it fills in
   *today's* row rather than pushing a new one, to avoid breaking
   that invariant (things like the 30-day heatmap and
   computeAvgStrengthOnDate in tracker.html assume rows.length
   matches the day range). If you want "log more than one topic
   per day" as real mobile-app behavior, the row schema needs a
   deliberate change (e.g. topics as their own table) — flagging
   that rather than quietly reinterpreting it here.
   ============================================================ */

export interface TrackerRow {
  no: number;
  date: string; // 'YYYY-MM-DD'
  topic: string;
  subject: string;
  r0: boolean; r1: boolean; r2: boolean; r3: boolean;
  r4: boolean; r5: boolean; r6: boolean; r7: boolean;
}

const INTERVAL_KEYS = ['r0', 'r1', 'r2', 'r3', 'r4', 'r5', 'r6', 'r7'] as const;
type IntervalKey = (typeof INTERVAL_KEYS)[number];
// Same days-offsets as tracker.html's INTERVALS (src/lib/utils.js).
const INTERVAL_DAYS = [0, 0.5, 1, 2, 4, 7, 15, 30];

function todayStr(): string {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.toISOString().split('T')[0];
}

/** Ebbinghaus-style strength estimate — ported verbatim from
 *  tracker.html's computeTopicStrength() so retention numbers match
 *  what the rest of the app already shows for the same row. */
function computeStrength(row: TrackerRow, asOf: Date): { strength: number; overdueDays: number; nextDue: Date | null } {
  const doneCount = INTERVAL_KEYS.filter((k) => row[k]).length;
  const baseline = (doneCount / INTERVAL_KEYS.length) * 100;
  if (doneCount >= INTERVAL_KEYS.length) return { strength: 100, overdueDays: 0, nextDue: null };
  const rd = new Date(row.date + 'T00:00:00');
  const nextDue = new Date(rd.getTime() + INTERVAL_DAYS[doneCount] * 86400000);
  const overdueDays = Math.max(0, (asOf.getTime() - nextDue.getTime()) / 86400000);
  const strength = overdueDays > 0 ? baseline * Math.exp(-overdueDays / 6) : baseline;
  return { strength, overdueDays, nextDue };
}

function statusFor(overdueDays: number, nextDue: Date | null, asOf: Date): TopicStatus {
  if (nextDue === null) return 'NOT DUE YET'; // fully reviewed
  if (overdueDays > 0) return 'OVERDUE';
  const dueStr = nextDue.toISOString().split('T')[0];
  const asOfStr = asOf.toISOString().split('T')[0];
  return dueStr <= asOfStr ? 'DUE TODAY' : 'NOT DUE YET';
}

/** Converts one tracker_data row into the Topic shape MobileHome.tsx
 *  renders. Returns null for template rows with no topic filled in
 *  yet (nothing to show on the homepage for those). */
export function rowToTopic(row: TrackerRow, asOf: Date = new Date()): Topic | null {
  if (!row.topic) return null;
  const { strength, overdueDays, nextDue } = computeStrength(row, asOf);
  const doneCount = INTERVAL_KEYS.filter((k) => row[k]).length;
  return {
    id: row.no,
    name: row.topic,
    subject: row.subject,
    retention: Math.round(strength),
    priority: calcPriority(strength) as Priority,
    status: statusFor(overdueDays, nextDue, asOf),
    nextReview: doneCount >= INTERVAL_KEYS.length ? 'Fully reviewed' : NEXT_REVIEW_LABELS[doneCount],
    addedAt: new Date(row.date + 'T00:00:00').getTime(),
  };
}

export function rowsToTopics(rows: TrackerRow[], asOf: Date = new Date()): Topic[] {
  return rows
    .map((r) => rowToTopic(r, asOf))
    .filter((t): t is Topic => t !== null)
    .sort((a, b) => b.addedAt - a.addedAt);
}

/** Fill in today's row with a new topic/subject. If today's row
 *  already has a topic in it, this overwrites it — see the note at
 *  the top of this file about the one-row-per-day constraint. */
export function applyAddTopic(rows: TrackerRow[], subject: string, topicName: string): TrackerRow[] {
  const today = todayStr();
  const idx = rows.findIndex((r) => r.date === today);
  if (idx === -1) {
    // No row for today — the user's exam date range (start_date/end_date)
    // doesn't cover today. Nothing to safely write to.
    return rows;
  }
  const next = [...rows];
  next[idx] = { ...next[idx], topic: topicName, subject };
  return next;
}

/** Clears a row's topic (id === row.no) rather than deleting the row,
 *  preserving the one-row-per-day invariant tracker.html relies on. */
export function applyRemoveTopic(rows: TrackerRow[], id: number): TrackerRow[] {
  return rows.map((r) =>
    r.no === id ? { ...r, topic: '', r0: false, r1: false, r2: false, r3: false, r4: false, r5: false, r6: false, r7: false } : r
  );
}

/** Marks the next not-yet-done interval complete for a row, same
 *  effect as checking the next box in tracker.html's table. */
export function applyMarkReviewed(rows: TrackerRow[], id: number): TrackerRow[] {
  return rows.map((r) => {
    if (r.no !== id) return r;
    const nextKey = INTERVAL_KEYS.find((k) => !r[k]);
    if (!nextKey) return r; // already fully reviewed
    return { ...r, [nextKey]: true };
  });
}
