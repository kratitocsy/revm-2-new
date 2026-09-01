import { useState, useEffect } from "react";

// ─── Types ────────────────────────────────────────────────
type Screen = "home" | "focus" | "rooms" | "library" | "recall" | "more";
type Priority = "HIGH" | "MEDIUM" | "LOW";
type TopicStatus = "NOT DUE YET" | "DUE TODAY" | "OVERDUE";

interface Topic {
  id: number;
  name: string;
  subject: string;
  retention: number;
  priority: Priority;
  status: TopicStatus;
  nextReview: string;
  addedAt: number; // timestamp
}

// ─── Subject / Badge Config ───────────────────────────────
const SUBJECTS = [
  "Biology", "Physics", "Chemistry", "Mathematics",
  "History", "Literature", "Computer Science", "Economics",
];

const SUBJECT_COLORS: Record<string, { bg: string; text: string }> = {
  Biology:          { bg: "rgba(245,158,11,0.18)",  text: "#f59e0b" },
  Physics:          { bg: "rgba(59,130,246,0.18)",   text: "#60a5fa" },
  Chemistry:        { bg: "rgba(16,185,129,0.18)",   text: "#34d399" },
  Mathematics:      { bg: "rgba(167,139,250,0.18)",  text: "#a78bfa" },
  History:          { bg: "rgba(249,115,22,0.18)",   text: "#fb923c" },
  Literature:       { bg: "rgba(244,114,182,0.18)",  text: "#f472b6" },
  "Computer Science": { bg: "rgba(34,211,238,0.18)", text: "#22d3ee" },
  Economics:        { bg: "rgba(163,230,53,0.18)",   text: "#a3e635" },
};

const PRIORITY_STYLES: Record<Priority, { bg: string; text: string }> = {
  HIGH:   { bg: "rgba(239,68,68,0.22)",   text: "#ef4444" },
  MEDIUM: { bg: "rgba(245,158,11,0.22)",  text: "#f59e0b" },
  LOW:    { bg: "rgba(16,185,129,0.22)",  text: "#34d399" },
};

const STATUS_STYLES: Record<TopicStatus, { bg: string; text: string; border: string }> = {
  "NOT DUE YET": { bg: "transparent",             text: "#0d9488", border: "rgba(13,148,136,0.5)" },
  "DUE TODAY":   { bg: "rgba(249,115,22,0.15)",   text: "#f97316", border: "rgba(249,115,22,0.5)"  },
  "OVERDUE":     { bg: "rgba(239,68,68,0.15)",    text: "#ef4444", border: "rgba(239,68,68,0.5)"   },
};

const INITIAL_TOPICS: Topic[] = [
  { id: 1, name: "Cell Cycle",  subject: "Biology", retention: 25, priority: "HIGH", status: "NOT DUE YET", nextReview: "+1D review · 31 Aug", addedAt: Date.now() - 86400000 },
  { id: 2, name: "Life Cycle",  subject: "Biology", retention: 25, priority: "HIGH", status: "NOT DUE YET", nextReview: "+1D review · 31 Aug", addedAt: Date.now() - 86400000 },
];

// ─── Custom Subject Color System ──────────────────────────
const CUSTOM_PALETTE = [
  { bg: "rgba(139,92,246,0.18)",  text: "#8b5cf6" },
  { bg: "rgba(236,72,153,0.18)",  text: "#ec4899" },
  { bg: "rgba(99,102,241,0.18)",  text: "#6366f1" },
  { bg: "rgba(20,184,166,0.18)",  text: "#14b8a6" },
  { bg: "rgba(234,179,8,0.18)",   text: "#eab308" },
  { bg: "rgba(239,68,68,0.18)",   text: "#ef4444" },
  { bg: "rgba(217,70,239,0.18)",  text: "#d946ef" },
  { bg: "rgba(251,146,60,0.18)",  text: "#fb923c" },
];

// Module-level cache so SubjectBadge can resolve colors without prop drilling
const subjectColorCache: Record<string, { bg: string; text: string }> = {};

function getSubjectColor(subject: string) {
  return SUBJECT_COLORS[subject] ?? subjectColorCache[subject] ?? { bg: "rgba(124,58,237,0.18)", text: "#a78bfa" };
}

// Spaced-repetition review intervals label
const NEXT_REVIEW_LABELS = ["5 min from now", "+12h review", "+1D review", "+2D review", "+4D review", "+7D review", "+15D review", "+30D review"];

// ─── Daily Focus Curve Config ─────────────────────────────
// Typical intraday cognitive retention curve [hour (24h), retention %]
const FOCUS_CURVE_PTS: [number, number][] = [
  [6, 54], [7, 66], [8, 80], [9, 88], [10, 85],
  [11, 78], [12, 67], [13, 54], [14, 46], [15, 52],
  [16, 60], [17, 65], [18, 61], [19, 53], [20, 45],
  [21, 38], [22, 30],
];
const FC_START = 6, FC_END = 22, FC_W = 300, FC_H = 72;

function fcHourToX(h: number) { return ((h - FC_START) / (FC_END - FC_START)) * FC_W; }
function fcRetToY(pct: number) { return FC_H - 4 - (pct / 100) * (FC_H - 8); }

function fcInterpolate(hour: number): { y: number; pct: number } {
  const clamped = Math.min(Math.max(hour, FC_START), FC_END);
  for (let i = 0; i < FOCUS_CURVE_PTS.length - 1; i++) {
    const [h0, r0] = FOCUS_CURVE_PTS[i];
    const [h1, r1] = FOCUS_CURVE_PTS[i + 1];
    if (clamped >= h0 && clamped <= h1) {
      const t = (clamped - h0) / (h1 - h0);
      const pct = Math.round(r0 + t * (r1 - r0));
      return { y: fcRetToY(pct), pct };
    }
  }
  const last = FOCUS_CURVE_PTS[FOCUS_CURVE_PTS.length - 1];
  return { y: fcRetToY(last[1]), pct: last[1] };
}

function fcSmoothPath(pts: [number, number][]): string {
  if (pts.length < 2) return "";
  let d = `M ${pts[0][0].toFixed(1)} ${pts[0][1].toFixed(1)}`;
  for (let i = 1; i < pts.length; i++) {
    const p0 = pts[Math.max(i - 2, 0)];
    const p1 = pts[i - 1];
    const p2 = pts[i];
    const p3 = pts[Math.min(i + 1, pts.length - 1)];
    const cp1x = p1[0] + (p2[0] - p0[0]) / 6;
    const cp1y = p1[1] + (p2[1] - p0[1]) / 6;
    const cp2x = p2[0] - (p3[0] - p1[0]) / 6;
    const cp2y = p2[1] - (p3[1] - p1[1]) / 6;
    d += ` C ${cp1x.toFixed(1)} ${cp1y.toFixed(1)}, ${cp2x.toFixed(1)} ${cp2y.toFixed(1)}, ${p2[0].toFixed(1)} ${p2[1].toFixed(1)}`;
  }
  return d;
}

// ─── Icons ────────────────────────────────────────────────
const Ic = {
  home: ({ s = 20 }: { s?: number }) => (
    <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" /><polyline points="9 22 9 12 15 12 15 22" />
    </svg>
  ),
  timer: ({ s = 20 }: { s?: number }) => (
    <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10" /><polyline points="12 6 12 12 16 14" />
    </svg>
  ),
  users: ({ s = 20 }: { s?: number }) => (
    <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" />
      <path d="M23 21v-2a4 4 0 0 0-3-3.87" /><path d="M16 3.13a4 4 0 0 1 0 7.75" />
    </svg>
  ),
  book: ({ s = 20 }: { s?: number }) => (
    <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z" /><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z" />
    </svg>
  ),
  brain: ({ s = 20 }: { s?: number }) => (
    <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <path d="M9.5 2A2.5 2.5 0 0 1 12 4.5v15a2.5 2.5 0 0 1-4.96-.46 2.5 2.5 0 0 1-2.96-3.08 3 3 0 0 1-.34-5.58 2.5 2.5 0 0 1 1.32-4.84A2.5 2.5 0 0 1 9.5 2" />
      <path d="M14.5 2A2.5 2.5 0 0 0 12 4.5v15a2.5 2.5 0 0 0 4.96-.46 2.5 2.5 0 0 0 2.96-3.08 3 3 0 0 0 .34-5.58 2.5 2.5 0 0 0-1.32-4.84A2.5 2.5 0 0 0 14.5 2" />
    </svg>
  ),
  more: ({ s = 20 }: { s?: number }) => (
    <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <circle cx="5" cy="12" r="1" /><circle cx="12" cy="12" r="1" /><circle cx="19" cy="12" r="1" />
    </svg>
  ),
  arrowLeft: ({ s = 20 }: { s?: number }) => (
    <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round">
      <line x1="19" y1="12" x2="5" y2="12" /><polyline points="12 19 5 12 12 5" />
    </svg>
  ),
  chevronRight: ({ s = 16 }: { s?: number }) => (
    <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round">
      <polyline points="9 18 15 12 9 6" />
    </svg>
  ),
  chevronDown: ({ s = 14 }: { s?: number }) => (
    <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round">
      <polyline points="6 9 12 15 18 9" />
    </svg>
  ),
  sparkles: ({ s = 16 }: { s?: number }) => (
    <svg width={s} height={s} viewBox="0 0 24 24" fill="currentColor">
      <path d="M12 2l2.4 7.4H22l-6.2 4.5 2.4 7.4L12 17l-6.2 4.3 2.4-7.4L2 9.4h7.6z" />
    </svg>
  ),
  play: ({ s = 16 }: { s?: number }) => (
    <svg width={s} height={s} viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3" /></svg>
  ),
  pause: ({ s = 16 }: { s?: number }) => (
    <svg width={s} height={s} viewBox="0 0 24 24" fill="currentColor">
      <rect x="6" y="4" width="4" height="16" rx="1" /><rect x="14" y="4" width="4" height="16" rx="1" />
    </svg>
  ),
  check: ({ s = 14 }: { s?: number }) => (
    <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={3} strokeLinecap="round" strokeLinejoin="round">
      <polyline points="20 6 9 17 4 12" />
    </svg>
  ),
  plus: ({ s = 16 }: { s?: number }) => (
    <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round">
      <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
    </svg>
  ),
  seat: ({ s = 18 }: { s?: number }) => (
    <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <path d="M20 12V22H4V12" /><path d="M22 7H2a2 2 0 0 0 0 4h20a2 2 0 0 0 0-4z" /><path d="M12 22V7" />
      <path d="M12 7H7.5a2.5 2.5 0 0 1 0-5C11 2 12 7 12 7z" /><path d="M12 7h4.5a2.5 2.5 0 0 0 0-5C13 2 12 7 12 7z" />
    </svg>
  ),
  settings: ({ s = 20 }: { s?: number }) => (
    <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </svg>
  ),
  bell: ({ s = 20 }: { s?: number }) => (
    <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" /><path d="M13.73 21a2 2 0 0 1-3.46 0" />
    </svg>
  ),
  trash: ({ s = 14 }: { s?: number }) => (
    <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <polyline points="3 6 5 6 21 6" /><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
      <path d="M10 11v6" /><path d="M14 11v6" /><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
    </svg>
  ),
};

// ─── Constants ────────────────────────────────────────────
const GRAD = "linear-gradient(135deg, #7c3aed, #06b6d4)";
const CARD_BG = "#0d0d1e";
const CARD_BORDER = "#1a1a35";

// ─── Utility ─────────────────────────────────────────────
function retentionColor(r: number) {
  return r >= 70 ? "#34d399" : r >= 40 ? "#f59e0b" : "#ef4444";
}
function calcPriority(retention: number): Priority {
  return retention < 40 ? "HIGH" : retention < 70 ? "MEDIUM" : "LOW";
}

// ─── Shared Primitives ────────────────────────────────────

function GradBtn({ children, onClick, size = "md", className = "" }: {
  children: React.ReactNode; onClick?: () => void; size?: "sm" | "md"; className?: string;
}) {
  return (
    <button
      onClick={onClick}
      className={`flex items-center justify-center gap-2 font-semibold text-white rounded-xl w-full active:scale-[0.98] transition-transform select-none ${size === "sm" ? "py-2.5 text-[13px]" : "py-3.5 text-[14px]"} ${className}`}
      style={{ background: GRAD }}
    >
      {children}
    </button>
  );
}

function GhostBtn({ children, onClick, className = "" }: {
  children: React.ReactNode; onClick?: () => void; className?: string;
}) {
  return (
    <button
      onClick={onClick}
      className={`flex items-center justify-center gap-2 font-semibold text-[#a78bfa] text-[13px] rounded-xl py-2.5 w-full border border-[#7c3aed]/35 active:scale-[0.98] transition-transform select-none ${className}`}
      style={{ background: "rgba(124,58,237,0.08)" }}
    >
      {children}
    </button>
  );
}

function Lbl({ children }: { children: React.ReactNode }) {
  return <p className="text-[10px] font-bold tracking-[0.18em] text-[#4a5980] uppercase mb-2">{children}</p>;
}

// ─── Badge Components ─────────────────────────────────────

function SubjectBadge({ subject }: { subject: string }) {
  const c = getSubjectColor(subject);
  return (
    <span className="inline-block text-[9px] font-black tracking-[0.12em] px-2 py-0.5 rounded-sm uppercase" style={{ background: c.bg, color: c.text }}>
      {subject}
    </span>
  );
}

function PriorityBadge({ priority }: { priority: Priority }) {
  const s = PRIORITY_STYLES[priority];
  return (
    <span className="text-[9px] font-black tracking-wide px-2 py-0.5 rounded" style={{ background: s.bg, color: s.text }}>
      {priority}
    </span>
  );
}

function StatusBadge({ status }: { status: TopicStatus }) {
  const s = STATUS_STYLES[status];
  return (
    <span className="text-[9px] font-bold tracking-wide px-2 py-0.5 rounded border" style={{ background: s.bg, color: s.text, borderColor: s.border }}>
      {status}
    </span>
  );
}

function RetentionRing({ value }: { value: number }) {
  const r = 14;
  const circ = 2 * Math.PI * r;
  const fill = (value / 100) * circ;
  const color = retentionColor(value);
  return (
    <div className="relative flex items-center justify-center" style={{ width: 36, height: 36 }}>
      <svg width="36" height="36" viewBox="0 0 36 36" style={{ position: "absolute", top: 0, left: 0 }}>
        <circle cx="18" cy="18" r={r} fill="none" stroke="#1a1a35" strokeWidth="3" />
        <circle
          cx="18" cy="18" r={r} fill="none" stroke={color} strokeWidth="3"
          strokeDasharray={`${fill} ${circ}`}
          strokeLinecap="round"
          transform="rotate(-90 18 18)"
        />
      </svg>
      <span className="text-[9px] font-black" style={{ color }}>{value}%</span>
    </div>
  );
}

function TopicItemRow({
  topic, onRemove, onMarkReviewed,
}: {
  topic: Topic;
  onRemove?: (id: number) => void;
  onMarkReviewed?: (id: number) => void;
}) {
  const [flash, setFlash] = useState<"idle" | "done">("idle");
  const alreadyReviewed = topic.retention >= 85 && topic.nextReview.includes("2D");

  const handleReview = () => {
    if (flash !== "idle") return;
    setFlash("done");
    setTimeout(() => {
      onMarkReviewed?.(topic.id);
      setFlash("idle");
    }, 700);
  };

  return (
    <div className="flex items-start gap-3 py-3 border-b last:border-0 group" style={{ borderColor: CARD_BORDER }}>
      <RetentionRing value={topic.retention} />

      <div className="flex-1 min-w-0">
        <p className="text-[14px] font-bold text-white leading-tight mb-1">{topic.name}</p>
        <div className="flex flex-wrap items-center gap-1.5 mb-1">
          <SubjectBadge subject={topic.subject} />
          <PriorityBadge priority={topic.priority} />
          <StatusBadge status={topic.status} />
        </div>
        <p className="text-[10px] text-[#4a5980]">Next: {topic.nextReview}</p>
      </div>

      {/* Mark as Reviewed button */}
      {onMarkReviewed && (
        <button
          onClick={handleReview}
          title="Mark as reviewed"
          className="flex-shrink-0 flex flex-col items-center gap-0.5 transition-all active:scale-90"
        >
          <div
            className="w-8 h-8 rounded-full flex items-center justify-center transition-all duration-300"
            style={{
              background: flash === "done" ? "#10b981" : alreadyReviewed ? "rgba(16,185,129,0.25)" : "rgba(16,185,129,0.12)",
              border: `1.5px solid ${alreadyReviewed || flash === "done" ? "rgba(16,185,129,0.6)" : "rgba(16,185,129,0.25)"}`,
              transform: flash === "done" ? "scale(1.15)" : "scale(1)",
              boxShadow: flash === "done" ? "0 0 12px rgba(16,185,129,0.5)" : "none",
            }}
          >
            <Ic.check s={12} />
          </div>
          <span className="text-[8px] font-semibold" style={{ color: alreadyReviewed ? "#34d399" : "#2a4a3a" }}>
            {alreadyReviewed ? "Done" : "Review"}
          </span>
        </button>
      )}

      {/* Remove button — hover only */}
      {onRemove && (
        <button
          onClick={() => onRemove(topic.id)}
          className="opacity-0 group-hover:opacity-100 flex-shrink-0 text-[#3a4a6a] hover:text-[#ef4444] transition-all p-1 rounded self-start mt-0.5"
        >
          <Ic.trash s={13} />
        </button>
      )}
    </div>
  );
}

// ─── NEW: Add Study Topic Card ────────────────────────────

function AddStudyTopicCard({
  onAdd, allSubjects = [], onAddCustomSubject,
}: {
  onAdd: (subject: string, topic: string) => void;
  allSubjects?: string[];
  onAddCustomSubject: (name: string) => void;
}) {
  const safeSubjects = allSubjects.length > 0 ? allSubjects : ["Biology"];
  const [subject, setSubject] = useState(safeSubjects[0]);
  const [topic, setTopic] = useState("");
  const [flash, setFlash] = useState(false);

  // Custom subject flow
  const [showCustomInput, setShowCustomInput] = useState(false);
  const [customName, setCustomName] = useState("");
  const [customError, setCustomError] = useState("");

  const handleSubjectChange = (val: string) => {
    if (val === "__custom__") {
      setShowCustomInput(true);
    } else {
      setSubject(val);
      setShowCustomInput(false);
    }
  };

  const confirmCustomSubject = () => {
    const trimmed = customName.trim();
    if (!trimmed) { setCustomError("Enter a subject name"); return; }
    if (safeSubjects.includes(trimmed)) { setCustomError("Subject already exists"); return; }
    onAddCustomSubject(trimmed);
    setSubject(trimmed);
    setShowCustomInput(false);
    setCustomName("");
    setCustomError("");
  };

  const cancelCustom = () => {
    setShowCustomInput(false);
    setCustomName("");
    setCustomError("");
  };

  const handleAdd = () => {
    if (!topic.trim()) return;
    onAdd(subject, topic.trim());
    setTopic("");
    setFlash(true);
    setTimeout(() => setFlash(false), 1800);
  };

  // Keep selected subject in sync when new custom subjects arrive
  const effectiveSubject = safeSubjects.includes(subject) ? subject : safeSubjects[0];

  return (
    <div
      className="rounded-2xl p-4 border"
      style={{ background: CARD_BG, borderColor: "rgba(124,58,237,0.35)", boxShadow: "0 0 24px rgba(124,58,237,0.08)" }}
    >
      <p className="text-[11px] font-black tracking-[0.15em] uppercase mb-0.5" style={{ color: "#7c3aed" }}>
        What did you study today?
      </p>
      <p className="text-[12px] text-[#4a5980] mb-3 leading-relaxed">
        Add it once — {"we'll"} remind you exactly when to revise it
      </p>

      {/* Subject selector row */}
      <div className="flex gap-2 mb-2.5">
        {/* Dropdown */}
        <div className="relative flex-shrink-0" style={{ minWidth: 118 }}>
          <select
            value={showCustomInput ? "__custom__" : effectiveSubject}
            onChange={(e) => handleSubjectChange(e.target.value)}
            className="w-full text-[12px] font-semibold text-white rounded-xl pl-3 pr-7 py-2.5 border outline-none appearance-none cursor-pointer"
            style={{ background: "#080816", borderColor: showCustomInput ? "rgba(124,58,237,0.5)" : CARD_BORDER }}
          >
            {safeSubjects.map((s) => (
              <option key={s} value={s} style={{ background: "#0d0d1e" }}>{s}</option>
            ))}
            <option disabled style={{ background: "#0d0d1e", color: "#3a4a6a" }}>──────────</option>
            <option value="__custom__" style={{ background: "#0d0d1e", color: "#a78bfa" }}>＋ Add Custom…</option>
          </select>
          <div className="absolute right-2 top-1/2 -translate-y-1/2 pointer-events-none text-[#4a5980]">
            <Ic.chevronDown s={13} />
          </div>
        </div>

        {/* Topic input */}
        <input
          value={topic}
          onChange={(e) => setTopic(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && !showCustomInput && handleAdd()}
          placeholder="Topic (e.g. Cell Cycle)"
          className="flex-1 text-[12px] text-white rounded-xl px-3 py-2.5 border outline-none"
          style={{ background: "#080816", borderColor: topic ? "rgba(124,58,237,0.5)" : CARD_BORDER }}
        />
      </div>

      {/* Custom subject inline input — slides in when "Add Custom…" selected */}
      {showCustomInput && (
        <div
          className="mb-2.5 p-3 rounded-xl border"
          style={{ background: "#080816", borderColor: "rgba(124,58,237,0.4)" }}
        >
          <p className="text-[10px] font-bold text-[#a78bfa] tracking-wider uppercase mb-2">New Subject</p>
          <div className="flex gap-2">
            <input
              autoFocus
              value={customName}
              onChange={(e) => { setCustomName(e.target.value); setCustomError(""); }}
              onKeyDown={(e) => { if (e.key === "Enter") confirmCustomSubject(); if (e.key === "Escape") cancelCustom(); }}
              placeholder="e.g. Sanskrit, Data Science…"
              className="flex-1 text-[12px] text-white rounded-lg px-3 py-2 border outline-none"
              style={{ background: "#0a0a1a", borderColor: customError ? "#ef4444" : "rgba(124,58,237,0.4)" }}
            />
            {/* Confirm */}
            <button
              onClick={confirmCustomSubject}
              className="px-3 py-2 rounded-lg text-[12px] font-bold text-white flex-shrink-0"
              style={{ background: GRAD }}
            >
              Add
            </button>
            {/* Cancel */}
            <button
              onClick={cancelCustom}
              className="px-2.5 py-2 rounded-lg text-[12px] font-semibold text-[#4a5980] flex-shrink-0 border"
              style={{ background: "#0a0a1a", borderColor: CARD_BORDER }}
            >
              ✕
            </button>
          </div>
          {customError && <p className="text-[10px] text-[#ef4444] mt-1.5">{customError}</p>}
          {/* Color preview */}
          {customName.trim() && !customError && (
            <div className="flex items-center gap-2 mt-2">
              <span className="text-[10px] text-[#4a5980]">Color assigned:</span>
              <span
                className="text-[10px] font-bold px-2 py-0.5 rounded-sm uppercase"
                style={(() => {
                  const idx = Object.keys(subjectColorCache).length % CUSTOM_PALETTE.length;
                  const c = CUSTOM_PALETTE[idx];
                  return { background: c.bg, color: c.text };
                })()}
              >
                {customName.trim()}
              </span>
            </div>
          )}
        </div>
      )}

      {/* Active subject chip + ADD button */}
      <div className="flex items-center gap-2">
        {!showCustomInput && (
          <div className="flex-shrink-0">
            <SubjectBadge subject={effectiveSubject} />
          </div>
        )}
        <GradBtn size="sm" onClick={handleAdd} className={showCustomInput ? "opacity-50 pointer-events-none" : ""}>
          {flash ? <><Ic.check s={14} /> Added!</> : <><Ic.plus s={14} /> ADD</>}
        </GradBtn>
      </div>

      <p className="text-[10px] text-[#3a4a6a] mt-2.5 leading-relaxed">
        First review: 5 min from now · Then 12h, Day 1, 2, 4, 7, 15, 30 — spaced repetition schedule
      </p>
    </div>
  );
}

// ─── NEW: Today's Recall Card ─────────────────────────────

function TodaysRecallCard({ topics, onRemove, onMarkReviewed, onNav }: {
  topics: Topic[];
  onRemove: (id: number) => void;
  onMarkReviewed: (id: number) => void;
  onNav: (s: Screen) => void;
}) {
  const fadingCount = topics.filter((t) => t.retention < 50).length;
  const reviewedToday = topics.filter((t) => t.retention >= 85 && t.nextReview.includes("2D")).length;

  return (
    <div className="rounded-2xl p-4 border" style={{ background: CARD_BG, borderColor: CARD_BORDER }}>
      <div className="flex items-center justify-between mb-1">
        <Lbl>{"Today's Recall"}</Lbl>
        {topics.length > 0 && (
          <div className="flex items-center gap-3">
            {reviewedToday > 0 && (
              <span className="text-[10px] font-semibold text-[#34d399]">
                ✓ {reviewedToday} reviewed
              </span>
            )}
            <button onClick={() => onNav("recall")} className="text-[11px] text-[#a78bfa] hover:text-[#c4b5fd] transition-colors">
              See all →
            </button>
          </div>
        )}
      </div>

      {topics.length === 0 ? (
        <div className="py-6 text-center">
          <p className="text-[28px] mb-2">📖</p>
          <p className="text-[13px] text-[#3a4a6a]">No topics yet — add one above</p>
          <p className="text-[11px] text-[#2a3a52] mt-1">{"WYNKO will track your recall curve automatically"}</p>
        </div>
      ) : (
        <>
          <p className="text-[13px] text-[#8892b0] -mt-1 mb-3">
            {fadingCount > 0
              ? `${fadingCount} topic${fadingCount > 1 ? "s" : ""} fading — tap ✓ after reviewing`
              : `${topics.length} topic${topics.length > 1 ? "s" : ""} being tracked`}
          </p>
          <div>
            {topics.map((t) => (
              <TopicItemRow key={t.id} topic={t} onRemove={onRemove} onMarkReviewed={onMarkReviewed} />
            ))}
          </div>
          {topics.some((t) => t.status === "DUE TODAY" || t.status === "OVERDUE") && (
            <div className="mt-3">
              <GradBtn size="sm" onClick={() => onNav("recall")}>REVIEW NOW</GradBtn>
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ─── NEW: Recall Curve Card ───────────────────────────────

function RecallCurveCard() {
  // Exponential decay: y ≈ 100·e^(-t/10), threshold at 30%
  // Mapped to SVG: viewBox 0 0 280 80, y=0 is top (100%), y=80 is bottom
  const pts: [number, number][] = [
    [0, 4], [20, 10], [45, 20], [75, 35], [105, 50],
    [135, 60], [165, 67], [200, 72], [245, 76], [280, 79],
  ];
  const pathD = pts.map((p, i) => (i === 0 ? `M ${p[0]} ${p[1]}` : `L ${p[0]} ${p[1]}`)).join(" ");
  const fillD = pathD + ` L 280 80 L 0 80 Z`;

  // Threshold at y=56 ≈ 30% retention
  const thresholdY = 56;

  return (
    <div className="rounded-2xl p-4 border" style={{ background: CARD_BG, borderColor: "rgba(124,58,237,0.2)" }}>
      <Lbl>Recall Curve</Lbl>
      <p className="text-[12px] text-[#8892b0] -mt-1 mb-3">Review before you cross the forget threshold</p>

      <div className="relative">
        <svg viewBox="0 0 280 80" width="100%" height="80" className="overflow-visible">
          <defs>
            <linearGradient id="lineGrad" x1="0%" y1="0%" x2="100%" y2="0%">
              <stop offset="0%" stopColor="#7c3aed" />
              <stop offset="100%" stopColor="#06b6d4" />
            </linearGradient>
            <linearGradient id="areaGrad" x1="0%" y1="0%" x2="0%" y2="100%">
              <stop offset="0%" stopColor="#7c3aed" stopOpacity="0.18" />
              <stop offset="100%" stopColor="#7c3aed" stopOpacity="0.01" />
            </linearGradient>
          </defs>

          {/* Grid lines */}
          {[20, 40, 60].map((y) => (
            <line key={y} x1="0" y1={y} x2="280" y2={y} stroke="#1a1a35" strokeWidth="1" />
          ))}

          {/* Forget threshold */}
          <line x1="0" y1={thresholdY} x2="280" y2={thresholdY} stroke="#f97316" strokeDasharray="5 4" strokeWidth="1.2" opacity="0.7" />
          <text x="172" y={thresholdY - 3} fill="#f97316" fontSize="7" opacity="0.85">forget threshold</text>

          {/* Area fill */}
          <path d={fillD} fill="url(#areaGrad)" />

          {/* Curve line */}
          <path d={pathD} fill="none" stroke="url(#lineGrad)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />

          {/* "Now" dot */}
          <circle cx="0" cy="4" r="4" fill="#7c3aed" />
          <circle cx="0" cy="4" r="7" fill="rgba(124,58,237,0.25)" />

          {/* X-axis labels */}
          {[
            [0, "Now"], [45, "1d"], [105, "4d"], [165, "7d"], [245, "15d"], [280, "30d"],
          ].map(([x, lbl]) => (
            <text key={String(lbl)} x={Number(x)} y="78" fill="#3a4a6a" fontSize="7" textAnchor="middle">{lbl}</text>
          ))}

          {/* Y-axis labels */}
          <text x="2" y="9" fill="#4a5980" fontSize="6.5">100%</text>
          <text x="2" y="38" fill="#4a5980" fontSize="6.5">50%</text>
          <text x="2" y="62" fill="#f97316" fontSize="6.5">30%</text>
        </svg>
      </div>

      <p className="text-[10px] text-[#3a4a6a] mt-2">
        Spaced repetition: 5min → 12h → 1d → 2d → 4d → 7d → 15d → 30d
      </p>
    </div>
  );
}

// ─── Daily Focus Curve Card ───────────────────────────────

function DailyFocusCurveCard({ topics }: { topics: Topic[] }) {
  const now = new Date();
  const currentHour = now.getHours() + now.getMinutes() / 60;
  const clampedHour = Math.min(Math.max(currentHour, FC_START), FC_END);

  // Build smooth SVG path from hourly data
  const svgPts: [number, number][] = FOCUS_CURVE_PTS.map(([h, r]) => [fcHourToX(h), fcRetToY(r)]);
  const pathD = fcSmoothPath(svgPts);
  const fillD = pathD + ` L ${FC_W} ${FC_H + 4} L 0 ${FC_H + 4} Z`;

  const nowX = fcHourToX(clampedHour);
  const nowData = fcInterpolate(clampedHour);
  const projData = fcInterpolate(21); // 9 PM
  const projX = fcHourToX(21);

  const reviewsDue = topics.filter((t) => t.status === "DUE TODAY" || t.status === "OVERDUE").length;
  const fadingCount = topics.filter((t) => t.retention < 60).length;

  const xLabels: [number, string][] = [[6, "6AM"], [9, "9AM"], [12, "12PM"], [15, "3PM"], [18, "6PM"], [21, "9PM"]];

  return (
    <div
      className="rounded-2xl p-4 border"
      style={{ background: CARD_BG, borderColor: "rgba(6,182,212,0.28)", boxShadow: "0 0 28px rgba(6,182,212,0.07)" }}
    >
      {/* Header */}
      <div className="flex items-start justify-between mb-1">
        <div>
          <p className="text-[10px] font-black tracking-[0.15em] uppercase mb-0.5" style={{ color: "#06b6d4" }}>
            [ Today's Focus ]
          </p>
          <p className="text-[14px] font-bold text-white leading-tight">
            {fadingCount > 0
              ? `${fadingCount} topic${fadingCount !== 1 ? "s" : ""} fading before tonight`
              : "All topics holding strong"}
          </p>
        </div>
      </div>

      {/* Stats row */}
      <div className="flex items-center gap-3 mt-3 mb-4">
        <div className="flex-1 min-w-0">
          <p className="text-[22px] font-black leading-none" style={{ color: "#22d3ee" }}>{nowData.pct}%</p>
          <p className="text-[9px] font-bold tracking-wider uppercase mt-0.5" style={{ color: "#3a5570" }}>Retention Now</p>
        </div>
        <div className="w-px self-stretch" style={{ background: "#1a1a35" }} />
        <div className="flex-1 min-w-0">
          <p className="text-[22px] font-black leading-none" style={{ color: "#f59e0b" }}>{projData.pct}%</p>
          <p className="text-[9px] font-bold tracking-wider uppercase mt-0.5" style={{ color: "#3a5570" }}>Projected · 9 PM</p>
        </div>
        <div className="w-px self-stretch" style={{ background: "#1a1a35" }} />
        <div className="flex-1 min-w-0">
          <p className="text-[22px] font-black leading-none text-white">{reviewsDue}</p>
          <p className="text-[9px] font-bold tracking-wider uppercase mt-0.5" style={{ color: "#3a5570" }}>Reviews Due</p>
        </div>
      </div>

      {/* SVG curve */}
      <div className="-mx-1">
        <svg viewBox={`0 0 ${FC_W} ${FC_H + 18}`} width="100%" style={{ overflow: "visible" }}>
          <defs>
            <linearGradient id="fcLineGrad" x1="0%" y1="0%" x2="100%" y2="0%">
              <stop offset="0%" stopColor="#7c3aed" />
              <stop offset="100%" stopColor="#06b6d4" />
            </linearGradient>
            <linearGradient id="fcAreaGrad" x1="0%" y1="0%" x2="0%" y2="100%">
              <stop offset="0%" stopColor="#06b6d4" stopOpacity="0.18" />
              <stop offset="80%" stopColor="#7c3aed" stopOpacity="0.06" />
              <stop offset="100%" stopColor="#7c3aed" stopOpacity="0" />
            </linearGradient>
            <filter id="fcGlow" x="-20%" y="-20%" width="140%" height="140%">
              <feGaussianBlur stdDeviation="2.5" result="blur" />
              <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
            </filter>
            <filter id="fcDotGlow" x="-100%" y="-100%" width="300%" height="300%">
              <feGaussianBlur stdDeviation="3.5" result="blur" />
              <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
            </filter>
            <clipPath id="fcClip"><rect x="0" y="0" width={FC_W} height={FC_H + 4} /></clipPath>
          </defs>

          {/* Subtle horizontal grid */}
          {[20, 40, 60].map((y) => (
            <line key={y} x1="0" y1={fcRetToY(y)} x2={FC_W} y2={fcRetToY(y)} stroke="#161630" strokeWidth="1" />
          ))}

          {/* Area fill */}
          <path d={fillD} fill="url(#fcAreaGrad)" clipPath="url(#fcClip)" />

          {/* Glow halo under line */}
          <path d={pathD} fill="none" stroke="#06b6d4" strokeWidth="8" strokeOpacity="0.12" strokeLinecap="round" clipPath="url(#fcClip)" />

          {/* Main curve */}
          <path
            d={pathD}
            fill="none"
            stroke="url(#fcLineGrad)"
            strokeWidth="2.2"
            strokeLinecap="round"
            strokeLinejoin="round"
            filter="url(#fcGlow)"
            clipPath="url(#fcClip)"
          />

          {/* Projected dot (amber) */}
          <circle cx={projX} cy={projData.y} r="6" fill="rgba(245,158,11,0.25)" />
          <circle cx={projX} cy={projData.y} r="3.5" fill="#f59e0b" />

          {/* Now dot (cyan) */}
          <circle cx={nowX} cy={nowData.y} r="9" fill="rgba(34,211,238,0.18)" />
          <circle cx={nowX} cy={nowData.y} r="5" fill="#22d3ee" filter="url(#fcDotGlow)" />

          {/* X-axis time labels */}
          {xLabels.map(([h, lbl]) => (
            <text key={h} x={fcHourToX(h)} y={FC_H + 15} fill="#2a3a55" fontSize="7.5" textAnchor="middle">{lbl}</text>
          ))}
        </svg>
      </div>
    </div>
  );
}

// ─── OTHER SHARED CARDS ───────────────────────────────────

function TodaysFocusCard({ onNav, desktop = false }: { onNav: (s: Screen) => void; desktop?: boolean }) {
  const pct = 75;
  return (
    <div className="p-px rounded-[20px]" style={{ background: "linear-gradient(135deg, rgba(124,58,237,0.7), rgba(6,182,212,0.5))" }}>
      <div className="rounded-[19px] p-5" style={{ background: CARD_BG, boxShadow: "0 8px 40px rgba(124,58,237,0.18)" }}>
        <Lbl>{"Today's Focus"}</Lbl>
        <div className={`flex ${desktop ? "items-center gap-6" : "flex-col"}`}>
          <div className={desktop ? "flex-1" : ""}>
            <div className="flex items-baseline gap-2 mb-3">
              <span className="text-[32px] font-black text-white leading-none tabular-nums">2h 15m</span>
              <span className="text-[13px] text-[#4a5980]">/ 3h goal</span>
            </div>
            <div className="mb-1">
              <div className="h-[7px] bg-[#191932] rounded-full overflow-hidden">
                <div className="h-full rounded-full relative" style={{ width: `${pct}%`, background: GRAD }}>
                  <div className="absolute right-0 top-1/2 -translate-y-1/2 w-3 h-3 rounded-full" style={{ background: "#22d3ee", boxShadow: "0 0 8px 3px rgba(34,211,238,0.7)" }} />
                </div>
              </div>
              <div className="flex justify-between mt-1.5">
                <span className="text-[11px] text-[#4a5980]">{pct}% complete</span>
                <span className="text-[11px] text-[#4a5980]">45m remaining</span>
              </div>
            </div>
            <div className="flex items-center gap-2 mt-3 mb-4 px-3 py-2.5 rounded-xl border" style={{ background: "#080816", borderColor: CARD_BORDER }}>
              <div className="w-1.5 h-1.5 rounded-full bg-[#22d3ee] flex-shrink-0 pulse-dot" />
              <span className="text-[12px] text-[#4a5980]">Next up:</span>
              <span className="text-[13px] font-semibold text-white">Revise Cell Cycle</span>
            </div>
          </div>
          {desktop && (
            <div className="flex-shrink-0 w-44 space-y-1.5">
              {["Revise Cell Cycle", "Photosynthesis", "DNA Replication"].map((item, i) => (
                <div key={item} className="flex items-center gap-2.5 py-2 px-3 rounded-lg" style={{ background: i === 0 ? "rgba(124,58,237,0.12)" : "#080816", border: `1px solid ${i === 0 ? "rgba(124,58,237,0.3)" : CARD_BORDER}` }}>
                  <div className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ background: i === 0 ? "#a78bfa" : "#2e3d5a" }} />
                  <span className="text-[11px]" style={{ color: i === 0 ? "#c4b5fd" : "#4a5980" }}>{item}</span>
                </div>
              ))}
            </div>
          )}
        </div>
        <div className={desktop ? "flex gap-3 mt-4" : ""}>
          <GradBtn onClick={() => onNav("focus")} className={desktop ? "flex-1" : ""}>
            <Ic.play s={14} />
            START FOCUS
          </GradBtn>
          <button className={`text-[12px] text-[#4a5980] hover:text-[#a78bfa] transition-colors ${desktop ? "flex-shrink-0 whitespace-nowrap" : "w-full text-center mt-2.5"}`}>
            View {"today's"} plan →
          </button>
        </div>
      </div>
    </div>
  );
}

function ContinueStudyingCard({ onNav }: { onNav: (s: Screen) => void }) {
  return (
    <div className="flex items-center gap-3 rounded-2xl p-4 border" style={{ background: CARD_BG, borderColor: CARD_BORDER }}>
      <div className="w-11 h-11 rounded-xl flex items-center justify-center flex-shrink-0 text-xl" style={{ background: "rgba(16,185,129,0.12)" }}>🧬</div>
      <div className="flex-1 min-w-0">
        <Lbl>Continue Studying</Lbl>
        <p className="text-[15px] font-bold text-white -mt-1 truncate">Cell Cycle</p>
        <p className="text-[11px] text-[#4a5980]">Biology · Last studied 18 min ago</p>
      </div>
      <button onClick={() => onNav("focus")} className="flex items-center gap-1 text-[#a78bfa] text-[12px] font-semibold px-3 py-2 rounded-xl flex-shrink-0 border active:scale-95 transition-transform" style={{ background: "rgba(124,58,237,0.12)", borderColor: "rgba(124,58,237,0.3)" }}>
        Continue <Ic.chevronRight s={13} />
      </button>
    </div>
  );
}

function QuickActionsGrid({ onNav, cols = 3 }: { onNav: (s: Screen) => void; cols?: number }) {
  const actions = [
    { icon: <Ic.timer s={22} />, label: "Focus",      screen: "focus"   as Screen, color: "#a78bfa", bg: "rgba(124,58,237,0.14)" },
    { icon: <Ic.users s={22} />, label: "Study Room", screen: "rooms"   as Screen, color: "#22d3ee", bg: "rgba(6,182,212,0.14)"   },
    { icon: <Ic.book  s={22} />, label: "Library",    screen: "library" as Screen, color: "#34d399", bg: "rgba(16,185,129,0.14)"  },
  ];
  return (
    <div>
      <Lbl>Quick Start</Lbl>
      <div className="grid gap-2" style={{ gridTemplateColumns: `repeat(${cols}, 1fr)` }}>
        {actions.map((a) => (
          <button key={a.label} onClick={() => onNav(a.screen)} className="flex flex-col items-center gap-2.5 rounded-xl py-4 border active:scale-95 transition-transform" style={{ background: CARD_BG, borderColor: CARD_BORDER }}>
            <div className="w-11 h-11 rounded-xl flex items-center justify-center" style={{ background: a.bg, color: a.color }}>{a.icon}</div>
            <span className="text-[12px] font-semibold text-[#c8d4f0]">{a.label}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

const AVATARS = [{ init: "S", color: "#7c3aed" }, { init: "M", color: "#06b6d4" }, { init: "R", color: "#10b981" }, { init: "K", color: "#f59e0b" }];

function StudyTogetherCard({ onNav }: { onNav: (s: Screen) => void }) {
  return (
    <div className="rounded-2xl p-4 border" style={{ background: CARD_BG, borderColor: CARD_BORDER }}>
      <div className="flex items-center justify-between mb-3">
        <div>
          <Lbl>Study Together</Lbl>
          <div className="flex items-center gap-2 -mt-1">
            <span className="w-2 h-2 rounded-full bg-[#10b981] flex-shrink-0 pulse-dot" />
            <span className="text-[13px] text-[#c8d4f0] font-medium">12 students studying now</span>
          </div>
        </div>
        <div className="flex -space-x-2.5">
          {AVATARS.map((av, i) => (
            <div key={i} className="w-7 h-7 rounded-full border-2 border-[#0d0d1e] flex items-center justify-center text-[10px] font-bold text-white flex-shrink-0" style={{ background: av.color }}>{av.init}</div>
          ))}
          <div className="w-7 h-7 rounded-full border-2 border-[#0d0d1e] flex items-center justify-center text-[9px] font-bold text-[#8892b0] flex-shrink-0" style={{ background: "#1a1a35" }}>+8</div>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <GradBtn size="sm" onClick={() => onNav("rooms")}>Join Room</GradBtn>
        <GhostBtn onClick={() => onNav("library")}>Library</GhostBtn>
      </div>
    </div>
  );
}

function WeeklyProgressCard({ horizontal = false }: { horizontal?: boolean }) {
  const stats = [
    { val: "2h 40m", label: "Focused",  emoji: "⏱" },
    { val: "18",     label: "Reviews",  emoji: "🔄" },
    { val: "7",      label: "Sessions", emoji: "📖" },
    { val: "4 days", label: "Streak",   emoji: "🔥" },
  ];
  return (
    <div>
      {!horizontal && <Lbl>This Week</Lbl>}
      <div className={horizontal ? "flex gap-3" : "grid grid-cols-4 gap-2"}>
        {stats.map((s) => (
          <div key={s.label} className={`rounded-xl border ${horizontal ? "flex-1 p-4" : "p-3 text-center"}`} style={{ background: CARD_BG, borderColor: CARD_BORDER }}>
            {horizontal ? (
              <div className="flex items-center gap-3">
                <span className="text-2xl leading-none">{s.emoji}</span>
                <div>
                  <div className="text-[18px] font-black text-white leading-none">{s.val}</div>
                  <div className="text-[11px] text-[#4a5980] mt-0.5">{s.label}</div>
                </div>
              </div>
            ) : (
              <>
                <div className="text-base mb-1 leading-none">{s.emoji}</div>
                <div className="text-[13px] font-black text-white leading-tight">{s.val}</div>
                <div className="text-[9px] text-[#4a5980] mt-0.5">{s.label}</div>
              </>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function ReviewQueueCard({ topics, onNav }: { topics: Topic[]; onNav: (s: Screen) => void }) {
  const due = topics.filter((t) => t.status === "DUE TODAY" || t.status === "OVERDUE");
  const notDue = topics.filter((t) => t.status === "NOT DUE YET").slice(0, 2);
  const shown = due.length > 0 ? due : notDue;

  return (
    <div className="rounded-2xl p-4 border" style={{ background: CARD_BG, borderColor: CARD_BORDER }}>
      <div className="flex items-center justify-between mb-1">
        <Lbl>Review Queue</Lbl>
        <div className="w-6 h-6 rounded-full flex items-center justify-center" style={{ background: "rgba(249,115,22,0.18)" }}>
          <span className="text-[11px] font-bold text-[#f97316]">{topics.length}</span>
        </div>
      </div>
      <p className="text-[13px] text-[#c8d4f0] -mt-1 mb-3">
        {topics.length === 0 ? "No topics tracked yet" : `${topics.length} topic${topics.length > 1 ? "s" : ""} due for revision`}
      </p>

      {shown.length > 0 && (
        <div className="space-y-2 mb-3">
          {shown.map((item) => {
            const sc = SUBJECT_COLORS[item.subject] ?? { bg: "rgba(124,58,237,0.18)", text: "#a78bfa" };
            return (
              <div key={item.id} className="flex items-center gap-3 rounded-xl p-3 border-l-[3px]" style={{ background: "#08081a", borderLeftColor: STATUS_STYLES[item.status].text }}>
                <div className="flex-1 min-w-0">
                  <p className="text-[13px] font-semibold text-white">{item.name}</p>
                  <SubjectBadge subject={item.subject} />
                </div>
                <div className="flex flex-col items-end gap-1">
                  <PriorityBadge priority={item.priority} />
                  <StatusBadge status={item.status} />
                </div>
              </div>
            );
          })}
        </div>
      )}
      <GradBtn size="sm" onClick={() => onNav("recall")}>REVIEW NOW</GradBtn>
    </div>
  );
}

function WynkoSuggestsCard({ onNav, topics }: { onNav: (s: Screen) => void; topics?: Topic[] }) {
  const worst = topics?.sort((a, b) => a.retention - b.retention)[0];
  return (
    <div className="rounded-2xl p-4 border" style={{ background: CARD_BG, borderColor: "rgba(124,58,237,0.25)", boxShadow: "inset 0 0 30px rgba(124,58,237,0.06)" }}>
      <div className="flex items-center gap-2 mb-2">
        <span className="text-[#a78bfa]"><Ic.sparkles s={14} /></span>
        <Lbl>WYNKO Suggests</Lbl>
      </div>
      {worst ? (
        <p className="text-[13px] text-[#9baac8] leading-relaxed mb-3">
          {"You've been forgetting "}
          <span className="text-[#a78bfa] font-semibold">{worst.name}</span>
          {` (${worst.retention}% retention). A quick review now locks it in.`}
        </p>
      ) : (
        <p className="text-[13px] text-[#9baac8] leading-relaxed mb-3">
          Add topics you studied today — {"WYNKO will handle the revision schedule for you."}
        </p>
      )}
      <GradBtn size="sm" onClick={() => onNav("recall")}>REVIEW NOW</GradBtn>
    </div>
  );
}

function AchievementsCard({ horizontal = false }: { horizontal?: boolean }) {
  const ach = [
    { emoji: "🔥", label: "4 day streak",       sub: "Keep it going!" },
    { emoji: "🎯", label: "10 focus sessions",  sub: "Focus champion" },
    { emoji: "📚", label: "25 topics reviewed", sub: "Knowledge builder" },
  ];
  return (
    <div className="rounded-2xl p-4 border" style={{ background: CARD_BG, borderColor: CARD_BORDER }}>
      <Lbl>Achievements</Lbl>
      <div className={horizontal ? "flex gap-4" : "space-y-2.5"}>
        {ach.map((a) => (
          <div key={a.label} className="flex items-center gap-3">
            <span className={`${horizontal ? "text-2xl" : "text-lg"} leading-none`}>{a.emoji}</span>
            <div>
              <p className="text-[12px] font-semibold text-white leading-tight">{a.label}</p>
              {!horizontal && <p className="text-[10px] text-[#4a5980]">{a.sub}</p>}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── MOBILE HEADER ────────────────────────────────────────

function MobileHeader({ streak }: { streak: number }) {
  return (
    <div className="px-5 pt-12 pb-5" style={{ background: "radial-gradient(ellipse 90% 40% at 50% 0%, rgba(124,58,237,0.18) 0%, transparent 70%)" }}>
      <div className="flex items-start justify-between mb-3">
        {/* Brand */}
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 rounded-lg flex items-center justify-center font-black text-white text-sm" style={{ background: GRAD }}>W</div>
          <span className="text-[15px] font-black tracking-[0.12em]" style={{ background: GRAD, WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent" }}>WYNKO</span>
        </div>
        {/* Top-right badges */}
        <div className="flex items-center gap-2">
          <button className="text-[10px] font-bold tracking-wide px-3 py-1.5 rounded-full border" style={{ background: "rgba(124,58,237,0.15)", borderColor: "rgba(124,58,237,0.4)", color: "#a78bfa" }}>
            CUSTOM TRACK
          </button>
          <div className="flex items-center gap-1 px-3 py-1.5 rounded-full" style={{ background: "#2a1a00", border: "1px solid rgba(245,158,11,0.4)" }}>
            <span className="text-xs">🔥</span>
            <span className="text-[11px] font-bold text-[#f59e0b]">{streak} DAY STREAK</span>
          </div>
        </div>
      </div>

      <p className="text-[23px] font-bold text-white leading-tight">Evening, Insaan.</p>
      <p className="text-[13px] text-[#4a5980] mt-0.5">
        {"2 topics need attention before tonight. Let's lock them in."}
      </p>
    </div>
  );
}

// ─── MOBILE HOME SCREEN ───────────────────────────────────

function MobileHomeScreen({ onNav, topics, allSubjects, onAddTopic, onRemoveTopic, onMarkReviewed, onAddCustomSubject }: {
  onNav: (s: Screen) => void;
  topics: Topic[];
  allSubjects: string[];
  onAddTopic: (subject: string, topic: string) => void;
  onRemoveTopic: (id: number) => void;
  onMarkReviewed: (id: number) => void;
  onAddCustomSubject: (name: string) => void;
}) {
  return (
    <div className="flex-1 overflow-y-auto overflow-x-hidden scrollbar-hide">
      <MobileHeader streak={4} />

      <div className="px-4 space-y-3 pb-6">
        {/* 1. Add Study Topic — first action */}
        <AddStudyTopicCard onAdd={onAddTopic} allSubjects={allSubjects} onAddCustomSubject={onAddCustomSubject} />

        {/* 2. Today's Focus hero */}
        <TodaysFocusCard onNav={onNav} />

        {/* 3. Daily Focus Curve — intraday retention */}
        <DailyFocusCurveCard topics={topics} />

        {/* 4. Today's Recall — tracked topics with badges */}
        <TodaysRecallCard topics={topics} onRemove={onRemoveTopic} onMarkReviewed={onMarkReviewed} onNav={onNav} />

        {/* 4. Recall Curve */}
        <RecallCurveCard />

        {/* 5. Continue Studying */}
        <ContinueStudyingCard onNav={onNav} />

        {/* 6. Quick Actions */}
        <QuickActionsGrid onNav={onNav} />

        {/* 7. Study Together */}
        <StudyTogetherCard onNav={onNav} />

        {/* 8. Weekly Progress */}
        <div>
          <Lbl>This Week</Lbl>
          <WeeklyProgressCard />
        </div>

        {/* 9. Review Queue with topic data */}
        <ReviewQueueCard topics={topics} onNav={onNav} />

        {/* 10. WYNKO Suggests */}
        <WynkoSuggestsCard onNav={onNav} topics={topics} />

        {/* 11. Achievements */}
        <AchievementsCard />
      </div>
    </div>
  );
}

// ─── MOBILE SECONDARY SCREENS ─────────────────────────────

function SecondaryHeader({ title, onBack }: { title: string; onBack: () => void }) {
  return (
    <div className="flex items-center gap-3 px-5 pt-12 pb-5">
      <button onClick={onBack} className="w-9 h-9 rounded-xl flex items-center justify-center text-[#8892b0] border active:scale-95 transition-transform" style={{ background: CARD_BG, borderColor: CARD_BORDER }}>
        <Ic.arrowLeft s={18} />
      </button>
      <h1 className="text-[18px] font-bold text-white">{title}</h1>
    </div>
  );
}

function MobileFocusScreen({ onBack }: { onBack: () => void }) {
  const [running, setRunning] = useState(false);
  const [seconds, setSeconds] = useState(25 * 60);
  useEffect(() => {
    if (!running) return;
    const id = setInterval(() => setSeconds((s) => Math.max(0, s - 1)), 1000);
    return () => clearInterval(id);
  }, [running]);
  const mm = String(Math.floor(seconds / 60)).padStart(2, "0");
  const ss = String(seconds % 60).padStart(2, "0");
  return (
    <div className="flex-1 overflow-y-auto scrollbar-hide">
      <SecondaryHeader title="Focus Lock" onBack={onBack} />
      <div className="px-4 space-y-3">
        <div className="p-px rounded-[20px]" style={{ background: "linear-gradient(135deg, rgba(124,58,237,0.7), rgba(6,182,212,0.5))" }}>
          <div className="rounded-[19px] p-8 text-center" style={{ background: CARD_BG, boxShadow: "0 8px 40px rgba(124,58,237,0.2)" }}>
            <p className="text-[11px] font-bold tracking-[0.18em] text-[#4a5980] uppercase mb-1">Pomodoro · Cell Cycle</p>
            <p className="text-[11px] text-[#a78bfa] mb-5">Biology</p>
            <div className="text-[60px] font-black text-white leading-none mb-8 tabular-nums">{mm}:{ss}</div>
            <button onClick={() => setRunning((r) => !r)} className="w-16 h-16 rounded-full flex items-center justify-center mx-auto text-white active:scale-95 transition-transform" style={{ background: GRAD, boxShadow: running ? "0 0 24px rgba(124,58,237,0.6)" : undefined }}>
              {running ? <Ic.pause s={20} /> : <Ic.play s={20} />}
            </button>
            <p className="text-[12px] text-[#4a5980] mt-4">{running ? "Stay focused — you've got this!" : "Tap to start"}</p>
          </div>
        </div>
        <div className="rounded-2xl p-4 border" style={{ background: CARD_BG, borderColor: CARD_BORDER }}>
          <Lbl>{"Today's Plan"}</Lbl>
          {["Revise Cell Cycle", "Practice Photosynthesis", "Review DNA Replication"].map((item, i) => (
            <div key={item} className="flex items-center gap-3 py-2.5 border-b last:border-0" style={{ borderColor: CARD_BORDER }}>
              <div className="w-5 h-5 rounded-full border-2 flex items-center justify-center flex-shrink-0" style={{ borderColor: i === 0 ? "#7c3aed" : CARD_BORDER, background: i === 0 ? "rgba(124,58,237,0.18)" : "transparent", color: i === 0 ? "#a78bfa" : "transparent" }}>
                {i === 0 && <Ic.check s={10} />}
              </div>
              <span className="text-[13px]" style={{ color: i === 0 ? "#fff" : "#4a5980", fontWeight: i === 0 ? 600 : 400 }}>{item}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function MobileRoomsScreen({ onBack }: { onBack: () => void }) {
  const rooms = [
    { name: "Biology Grind", students: 5, subject: "Biology", color: "#10b981" },
    { name: "Chem Focus Room", students: 3, subject: "Chemistry", color: "#f59e0b" },
    { name: "Math Warriors", students: 8, subject: "Mathematics", color: "#a78bfa" },
  ];
  return (
    <div className="flex-1 overflow-y-auto scrollbar-hide">
      <SecondaryHeader title="Study Rooms" onBack={onBack} />
      <div className="px-4 space-y-3">
        <div className="flex items-center gap-2 rounded-xl px-3 py-2.5 border" style={{ background: "rgba(16,185,129,0.08)", borderColor: "rgba(16,185,129,0.2)" }}>
          <span className="w-2 h-2 rounded-full bg-[#10b981] flex-shrink-0 pulse-dot" />
          <span className="text-[13px] text-[#8892b0]">12 students studying right now</span>
        </div>
        {rooms.map((r) => (
          <div key={r.name} className="rounded-2xl p-4 border" style={{ background: CARD_BG, borderColor: CARD_BORDER }}>
            <div className="flex items-start justify-between mb-3">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl flex items-center justify-center" style={{ background: `${r.color}18` }}>
                  <span style={{ color: r.color }}><Ic.users s={18} /></span>
                </div>
                <div>
                  <p className="text-[14px] font-bold text-white">{r.name}</p>
                  <p className="text-[11px] text-[#4a5980]">{r.subject}</p>
                </div>
              </div>
              <span className="text-[10px] font-bold px-2 py-0.5 rounded-full" style={{ background: `${r.color}18`, color: r.color }}>LIVE</span>
            </div>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-1.5 text-[#4a5980]">
                <Ic.users s={12} /><span className="text-[12px]">{r.students} students</span>
              </div>
              <button className="text-[12px] font-semibold px-4 py-1.5 rounded-lg" style={{ background: `${r.color}18`, color: r.color, border: `1px solid ${r.color}40` }}>Join Room</button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function MobileLibraryScreen({ onBack }: { onBack: () => void }) {
  const grid = [[false, true, false, false, true], [false, false, true, false, false], [true, false, false, true, false], [false, false, false, false, true]];
  const free = grid.flat().filter((s) => !s).length;
  return (
    <div className="flex-1 overflow-y-auto scrollbar-hide">
      <SecondaryHeader title="Library" onBack={onBack} />
      <div className="px-4 space-y-3">
        <div className="rounded-2xl p-4 border" style={{ background: CARD_BG, borderColor: CARD_BORDER }}>
          <div className="flex items-center justify-between mb-4">
            <div><Lbl>Study Floor</Lbl><p className="text-[20px] font-black text-white -mt-1">{free} seats available</p></div>
            <div className="space-y-1.5">
              <div className="flex items-center gap-2"><div className="w-3 h-3 rounded-sm" style={{ background: "rgba(52,211,153,0.4)", border: "1px solid #34d399" }} /><span className="text-[11px] text-[#4a5980]">Free</span></div>
              <div className="flex items-center gap-2"><div className="w-3 h-3 rounded-sm" style={{ background: "rgba(248,113,113,0.4)", border: "1px solid #f87171" }} /><span className="text-[11px] text-[#4a5980]">Taken</span></div>
            </div>
          </div>
          <div className="rounded-xl p-4" style={{ background: "#07070f" }}>
            {[0, 1, 2, 3].map((row) => (
              <div key={row} className="flex gap-1.5 justify-center mb-1.5">
                {[0, 1].map((col) => (<div key={col} className="w-10 h-10 rounded-lg flex items-center justify-center border" style={{ background: grid[row][col] ? "rgba(248,113,113,0.12)" : "rgba(52,211,153,0.12)", borderColor: grid[row][col] ? "rgba(248,113,113,0.4)" : "rgba(52,211,153,0.4)", color: grid[row][col] ? "#f87171" : "#34d399" }}><Ic.seat s={14} /></div>))}
                <div className="w-8 h-10 rounded-md" style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.06)" }} />
                {[2, 3, 4].map((col) => (<div key={col} className="w-10 h-10 rounded-lg flex items-center justify-center border" style={{ background: grid[row][col] ? "rgba(248,113,113,0.12)" : "rgba(52,211,153,0.12)", borderColor: grid[row][col] ? "rgba(248,113,113,0.4)" : "rgba(52,211,153,0.4)", color: grid[row][col] ? "#f87171" : "#34d399" }}><Ic.seat s={14} /></div>))}
              </div>
            ))}
          </div>
        </div>
        <GradBtn>FIND A SEAT</GradBtn>
      </div>
    </div>
  );
}

function MobileRecallScreen({ onBack, topics, onRemove, onMarkReviewed }: {
  onBack: () => void;
  topics: Topic[];
  onRemove: (id: number) => void;
  onMarkReviewed: (id: number) => void;
}) {
  return (
    <div className="flex-1 overflow-y-auto scrollbar-hide">
      <SecondaryHeader title="Review Queue" onBack={onBack} />
      <div className="px-4 space-y-3 pb-6">
        <div className="flex items-center justify-between rounded-xl px-4 py-3 border" style={{ background: CARD_BG, borderColor: CARD_BORDER }}>
          <span className="text-[13px] text-[#8892b0]">{topics.length} items tracked</span>
          <span className="text-[12px] font-semibold text-[#a78bfa]">Start all →</span>
        </div>
        <RecallCurveCard />
        {topics.length === 0 ? (
          <div className="py-8 text-center">
            <p className="text-[28px] mb-2">📖</p>
            <p className="text-[14px] text-[#3a4a6a]">No topics yet</p>
            <p className="text-[12px] text-[#2a3a52] mt-1">Go to Home and add what you studied today</p>
          </div>
        ) : (
          <div className="rounded-2xl p-4 border" style={{ background: CARD_BG, borderColor: CARD_BORDER }}>
            <p className="text-[11px] text-[#4a5980] mb-1">Tap ✓ after reviewing each topic</p>
            {topics.map((t) => <TopicItemRow key={t.id} topic={t} onRemove={onRemove} onMarkReviewed={onMarkReviewed} />)}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── BOTTOM NAV ───────────────────────────────────────────

const NAV_ITEMS = [
  { id: "home"   as Screen, label: "Home",   Icon: Ic.home  },
  { id: "focus"  as Screen, label: "Focus",  Icon: Ic.timer },
  { id: "rooms"  as Screen, label: "Rooms",  Icon: Ic.users },
  { id: "recall" as Screen, label: "Recall", Icon: Ic.brain },
  { id: "more"   as Screen, label: "More",   Icon: Ic.more  },
];

function BottomNav({ active, onNav }: { active: Screen; onNav: (s: Screen) => void }) {
  return (
    <nav className="flex-shrink-0 border-t" style={{ background: "rgba(7,7,15,0.96)", borderColor: "rgba(255,255,255,0.05)", backdropFilter: "blur(20px)" }}>
      <div className="flex items-center justify-around px-2 py-3 pb-5">
        {NAV_ITEMS.map(({ id, label, Icon }) => {
          const on = id === active;
          return (
            <button key={id} onClick={() => onNav(id)} className="flex flex-col items-center gap-1 px-3 py-1 rounded-xl active:scale-95 transition-transform min-w-[52px]">
              <div style={{ color: on ? "#a78bfa" : "#2e3d5a" }}><Icon s={20} /></div>
              <span className="text-[10px] font-semibold" style={{ color: on ? "#a78bfa" : "#2e3d5a" }}>{label}</span>
              {on && <div className="w-4 h-[3px] rounded-full" style={{ background: GRAD }} />}
            </button>
          );
        })}
      </div>
    </nav>
  );
}

// ─── DESKTOP SIDEBAR ──────────────────────────────────────

const SIDEBAR_NAV = [
  { id: "home"    as Screen, label: "Home",        Icon: Ic.home  },
  { id: "focus"   as Screen, label: "Focus",       Icon: Ic.timer },
  { id: "rooms"   as Screen, label: "Study Rooms", Icon: Ic.users },
  { id: "recall"  as Screen, label: "Recall",      Icon: Ic.brain },
  { id: "library" as Screen, label: "Library",     Icon: Ic.book  },
  { id: "more"    as Screen, label: "More",        Icon: Ic.more  },
];

function Sidebar({ active, onNav }: { active: Screen; onNav: (s: Screen) => void }) {
  return (
    <aside className="w-[220px] flex-shrink-0 flex flex-col h-full border-r" style={{ background: "#080812", borderColor: "rgba(255,255,255,0.05)" }}>
      <div className="px-5 pt-7 pb-5 border-b" style={{ borderColor: "rgba(255,255,255,0.05)" }}>
        <div className="flex items-center gap-2.5 mb-1">
          <div className="w-8 h-8 rounded-xl flex items-center justify-center font-black text-white text-sm" style={{ background: GRAD }}>W</div>
          <span className="text-[18px] font-black tracking-[0.1em]" style={{ background: GRAD, WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent" }}>WYNKO</span>
        </div>
        <p className="text-[9px] text-[#2a3a52] tracking-wider mt-1">FOCUS · STUDY · TOGETHER</p>
      </div>

      <div className="mx-3 mt-3 mb-2 p-3 rounded-xl border" style={{ background: "rgba(124,58,237,0.08)", borderColor: "rgba(124,58,237,0.2)" }}>
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-full flex items-center justify-center font-bold text-white text-sm flex-shrink-0" style={{ background: GRAD }}>A</div>
          <div className="min-w-0">
            <p className="text-[13px] font-semibold text-white truncate">Alex Johnson</p>
            <div className="flex items-center gap-1"><span className="text-xs">🔥</span><span className="text-[11px] text-[#c084fc]">4 day streak</span></div>
          </div>
        </div>
      </div>

      <nav className="flex-1 px-3 py-2 space-y-0.5 overflow-y-auto scrollbar-hide">
        <p className="text-[9px] font-bold tracking-[0.2em] text-[#2e3d5a] uppercase px-3 pt-2 pb-1">Navigation</p>
        {SIDEBAR_NAV.map(({ id, label, Icon }) => {
          const on = id === active;
          return (
            <button key={id} onClick={() => onNav(id)} className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-left transition-all active:scale-[0.98]" style={{ background: on ? "rgba(124,58,237,0.18)" : "transparent", color: on ? "#c4b5fd" : "#3a4a6a" }}>
              <span style={{ color: on ? "#a78bfa" : "#3a4a6a" }}><Icon s={17} /></span>
              <span className="text-[13px] font-semibold">{label}</span>
              {on && <div className="ml-auto w-1 h-5 rounded-full" style={{ background: GRAD }} />}
            </button>
          );
        })}
      </nav>

      <div className="px-3 pb-5 pt-3 border-t space-y-0.5" style={{ borderColor: "rgba(255,255,255,0.05)" }}>
        <button className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-[#3a4a6a] hover:text-[#6b7ba8] transition-colors">
          <Ic.bell s={17} /><span className="text-[13px] font-semibold">Notifications</span>
        </button>
        <button className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-[#3a4a6a] hover:text-[#6b7ba8] transition-colors">
          <Ic.settings s={17} /><span className="text-[13px] font-semibold">Settings</span>
        </button>
      </div>
    </aside>
  );
}

// ─── DESKTOP HOME CONTENT ─────────────────────────────────

function DesktopHeader({ topics }: { topics: Topic[] }) {
  const fadingCount = topics.filter((t) => t.retention < 50).length;
  return (
    <div className="flex items-center justify-between px-8 py-6 border-b flex-shrink-0" style={{ borderColor: "rgba(255,255,255,0.05)", background: "radial-gradient(ellipse 60% 80% at 30% 50%, rgba(124,58,237,0.1) 0%, transparent 70%)" }}>
      <div>
        <p className="text-[26px] font-bold text-white leading-tight">Evening, Insaan. 👋</p>
        <p className="text-[13px] text-[#4a5980] mt-0.5">
          {fadingCount > 0 ? `${fadingCount} topic${fadingCount > 1 ? "s" : ""} need attention before tonight.` : "You're on track — keep the streak going."}
          {" "}{"You're 75% through your daily goal."}
        </p>
      </div>
      <div className="flex items-center gap-3">
        {[
          { val: "2h 15m", label: "Today",    color: "#a78bfa" },
          { val: "4 days", label: "Streak 🔥", color: "#f59e0b" },
          { val: String(topics.length), label: "Topics",  color: "#22d3ee" },
        ].map((s) => (
          <div key={s.label} className="text-center px-4 py-3 rounded-xl border" style={{ background: CARD_BG, borderColor: CARD_BORDER }}>
            <p className="text-[18px] font-black" style={{ color: s.color }}>{s.val}</p>
            <p className="text-[11px] text-[#4a5980]">{s.label}</p>
          </div>
        ))}
        <button className="text-[10px] font-bold tracking-wide px-4 py-2 rounded-full border" style={{ background: "rgba(124,58,237,0.15)", borderColor: "rgba(124,58,237,0.4)", color: "#a78bfa" }}>
          CUSTOM TRACK
        </button>
        <button className="w-10 h-10 rounded-xl flex items-center justify-center border text-[#4a5980] hover:text-[#a78bfa] transition-colors" style={{ background: CARD_BG, borderColor: CARD_BORDER }}>
          <Ic.bell s={18} />
        </button>
      </div>
    </div>
  );
}

function DesktopHomeContent({ onNav, topics, allSubjects, onAddTopic, onRemoveTopic, onMarkReviewed, onAddCustomSubject }: {
  onNav: (s: Screen) => void;
  topics: Topic[];
  allSubjects: string[];
  onAddTopic: (subject: string, topic: string) => void;
  onRemoveTopic: (id: number) => void;
  onMarkReviewed: (id: number) => void;
  onAddCustomSubject: (name: string) => void;
}) {
  return (
    <div className="flex flex-col h-full overflow-hidden">
      <DesktopHeader topics={topics} />

      <div className="flex-1 overflow-y-auto scrollbar-hide p-6">
        {/* Row 1: Focus hero (left) + right panel */}
        <div className="grid gap-4 mb-4" style={{ gridTemplateColumns: "1fr 340px" }}>
          <TodaysFocusCard onNav={onNav} desktop />
          <div className="space-y-3">
            <ContinueStudyingCard onNav={onNav} />
            <QuickActionsGrid onNav={onNav} />
            <StudyTogetherCard onNav={onNav} />
          </div>
        </div>

        {/* Row 2: Daily Focus Curve (left) + Add Study Topic (right) */}
        <div className="grid gap-4 mb-4" style={{ gridTemplateColumns: "1fr 340px" }}>
          <DailyFocusCurveCard topics={topics} />
          <div className="space-y-3">
            <AddStudyTopicCard onAdd={onAddTopic} allSubjects={allSubjects} onAddCustomSubject={onAddCustomSubject} />
            <RecallCurveCard />
          </div>
        </div>

        {/* Row 3: Today's Recall (left) + WYNKO Suggests + Achievements (right) */}
        <div className="grid gap-4 mb-4" style={{ gridTemplateColumns: "1fr 340px" }}>
          <TodaysRecallCard topics={topics} onRemove={onRemoveTopic} onMarkReviewed={onMarkReviewed} onNav={onNav} />
          <div className="space-y-3">
            <WynkoSuggestsCard onNav={onNav} topics={topics} />
            <AchievementsCard />
          </div>
        </div>

        {/* Row 4: Weekly Progress (full width) */}
        <div className="mb-4">
          <Lbl>This Week</Lbl>
          <WeeklyProgressCard horizontal />
        </div>

        {/* Row 5: Review Queue (left) — no right content needed */}
        <ReviewQueueCard topics={topics} onNav={onNav} />
      </div>
    </div>
  );
}

// ─── DESKTOP SECONDARY SCREENS ────────────────────────────

function DesktopFocusContent({ onNav }: { onNav: (s: Screen) => void }) {
  const [running, setRunning] = useState(false);
  const [seconds, setSeconds] = useState(25 * 60);
  useEffect(() => {
    if (!running) return;
    const id = setInterval(() => setSeconds((s) => Math.max(0, s - 1)), 1000);
    return () => clearInterval(id);
  }, [running]);
  const mm = String(Math.floor(seconds / 60)).padStart(2, "0");
  const ss = String(seconds % 60).padStart(2, "0");
  return (
    <div className="flex flex-col h-full overflow-y-auto scrollbar-hide">
      <div className="px-8 py-6 border-b flex items-center gap-3 flex-shrink-0" style={{ borderColor: "rgba(255,255,255,0.05)" }}>
        <h1 className="text-[22px] font-bold text-white">Focus Lock</h1>
        <span className="text-[12px] font-semibold px-3 py-1 rounded-full" style={{ background: "rgba(124,58,237,0.18)", color: "#a78bfa" }}>Pomodoro Mode</span>
      </div>
      <div className="flex-1 p-6 grid gap-4" style={{ gridTemplateColumns: "1fr 340px" }}>
        <div className="p-px rounded-[20px]" style={{ background: "linear-gradient(135deg, rgba(124,58,237,0.7), rgba(6,182,212,0.5))" }}>
          <div className="rounded-[19px] p-10 text-center flex flex-col items-center justify-center h-full" style={{ background: CARD_BG }}>
            <p className="text-[12px] font-bold tracking-[0.18em] text-[#4a5980] uppercase mb-1">Biology · Cell Cycle</p>
            <div className="text-[88px] font-black text-white leading-none my-8 tabular-nums">{mm}:{ss}</div>
            <button onClick={() => setRunning((r) => !r)} className="w-20 h-20 rounded-full flex items-center justify-center text-white active:scale-95 transition-transform mb-4" style={{ background: GRAD, boxShadow: running ? "0 0 32px rgba(124,58,237,0.6)" : undefined }}>
              {running ? <Ic.pause s={28} /> : <Ic.play s={28} />}
            </button>
            <p className="text-[14px] text-[#4a5980]">{running ? "Stay focused — you've got this!" : "Click to start your session"}</p>
          </div>
        </div>
        <div className="space-y-3">
          <div className="rounded-2xl p-4 border" style={{ background: CARD_BG, borderColor: CARD_BORDER }}>
            <Lbl>{"Today's Plan"}</Lbl>
            {["Revise Cell Cycle", "Practice Photosynthesis", "Review DNA Replication"].map((item, i) => (
              <div key={item} className="flex items-center gap-3 py-3 border-b last:border-0" style={{ borderColor: CARD_BORDER }}>
                <div className="w-5 h-5 rounded-full border-2 flex items-center justify-center flex-shrink-0" style={{ borderColor: i === 0 ? "#7c3aed" : CARD_BORDER, background: i === 0 ? "rgba(124,58,237,0.18)" : "transparent", color: i === 0 ? "#a78bfa" : "transparent" }}>
                  {i === 0 && <Ic.check s={10} />}
                </div>
                <span className="text-[13px]" style={{ color: i === 0 ? "#fff" : "#4a5980", fontWeight: i === 0 ? 600 : 400 }}>{item}</span>
              </div>
            ))}
          </div>
          <WynkoSuggestsCard onNav={onNav} />
          <RecallCurveCard />
        </div>
      </div>
    </div>
  );
}

function DesktopRoomsContent() {
  const rooms = [
    { name: "Biology Grind", students: 5, subject: "Biology", color: "#10b981", desc: "Active review on cell biology" },
    { name: "Chem Focus Room", students: 3, subject: "Chemistry", color: "#f59e0b", desc: "Organic chemistry deep dive" },
    { name: "Math Warriors", students: 8, subject: "Mathematics", color: "#a78bfa", desc: "Calculus problem-solving" },
    { name: "Physics Deep Dive", students: 2, subject: "Physics", color: "#22d3ee", desc: "Quantum mechanics" },
    { name: "History Circle", students: 6, subject: "History", color: "#f87171", desc: "World War II revision" },
    { name: "Literature Hub", students: 4, subject: "Literature", color: "#34d399", desc: "Shakespeare analysis" },
  ];
  return (
    <div className="flex flex-col h-full overflow-y-auto scrollbar-hide">
      <div className="px-8 py-6 border-b flex items-center justify-between flex-shrink-0" style={{ borderColor: "rgba(255,255,255,0.05)" }}>
        <div>
          <h1 className="text-[22px] font-bold text-white">Study Rooms</h1>
          <div className="flex items-center gap-2 mt-0.5">
            <span className="w-2 h-2 rounded-full bg-[#10b981] pulse-dot" />
            <span className="text-[13px] text-[#4a5980]">12 students studying right now</span>
          </div>
        </div>
        <GradBtn className="w-auto px-6">+ Create Room</GradBtn>
      </div>
      <div className="flex-1 p-6">
        <div className="grid grid-cols-3 gap-3">
          {rooms.map((r) => (
            <div key={r.name} className="rounded-2xl p-4 border" style={{ background: CARD_BG, borderColor: CARD_BORDER }}>
              <div className="flex items-start justify-between mb-2">
                <div className="w-10 h-10 rounded-xl flex items-center justify-center" style={{ background: `${r.color}18` }}>
                  <span style={{ color: r.color }}><Ic.users s={18} /></span>
                </div>
                <span className="text-[10px] font-bold px-2 py-0.5 rounded-full" style={{ background: `${r.color}18`, color: r.color }}>LIVE</span>
              </div>
              <p className="text-[14px] font-bold text-white mt-2">{r.name}</p>
              <p className="text-[11px] text-[#4a5980] mb-1">{r.subject}</p>
              <p className="text-[11px] text-[#3a4a6a] mb-3">{r.desc}</p>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-1 text-[#4a5980]"><Ic.users s={12} /><span className="text-[11px]">{r.students}</span></div>
                <button className="text-[12px] font-semibold px-3 py-1.5 rounded-lg" style={{ background: `${r.color}18`, color: r.color, border: `1px solid ${r.color}40` }}>Join</button>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function DesktopLibraryContent() {
  const grid = [[false, true, false, false, true, false], [false, false, true, false, false, false], [true, false, false, true, false, true], [false, false, false, false, true, false], [false, true, false, false, false, false]];
  const free = grid.flat().filter((s) => !s).length;
  return (
    <div className="flex flex-col h-full overflow-y-auto scrollbar-hide">
      <div className="px-8 py-6 border-b flex items-center justify-between flex-shrink-0" style={{ borderColor: "rgba(255,255,255,0.05)" }}>
        <div>
          <h1 className="text-[22px] font-bold text-white">Library</h1>
          <p className="text-[13px] text-[#4a5980] mt-0.5">{free} of {grid.flat().length} seats available</p>
        </div>
        <GradBtn className="w-auto px-6">Find a Seat</GradBtn>
      </div>
      <div className="flex-1 p-6 grid gap-4" style={{ gridTemplateColumns: "1fr 300px" }}>
        <div className="rounded-2xl p-6 border" style={{ background: CARD_BG, borderColor: CARD_BORDER }}>
          <Lbl>Study Floor — Level 1</Lbl>
          <div className="rounded-xl p-6 space-y-3" style={{ background: "#07070f" }}>
            {grid.map((row, ri) => (
              <div key={ri} className="flex gap-2 justify-center">
                {row.slice(0, 3).map((taken, ci) => (
                  <div key={ci} className="w-14 h-14 rounded-xl flex flex-col items-center justify-center gap-1 border" style={{ background: taken ? "rgba(248,113,113,0.1)" : "rgba(52,211,153,0.1)", borderColor: taken ? "rgba(248,113,113,0.35)" : "rgba(52,211,153,0.35)", color: taken ? "#f87171" : "#34d399" }}>
                    <Ic.seat s={18} /><span className="text-[9px] font-semibold">{taken ? "Taken" : "Free"}</span>
                  </div>
                ))}
                <div className="w-12 mx-2 rounded-lg" style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.05)" }} />
                {row.slice(3).map((taken, ci) => (
                  <div key={ci} className="w-14 h-14 rounded-xl flex flex-col items-center justify-center gap-1 border" style={{ background: taken ? "rgba(248,113,113,0.1)" : "rgba(52,211,153,0.1)", borderColor: taken ? "rgba(248,113,113,0.35)" : "rgba(52,211,153,0.35)", color: taken ? "#f87171" : "#34d399" }}>
                    <Ic.seat s={18} /><span className="text-[9px] font-semibold">{taken ? "Taken" : "Free"}</span>
                  </div>
                ))}
              </div>
            ))}
          </div>
        </div>
        <div className="space-y-3">
          <div className="rounded-2xl p-4 border" style={{ background: CARD_BG, borderColor: CARD_BORDER }}>
            <Lbl>Availability</Lbl>
            {[{ label: "Available", count: free, color: "#34d399" }, { label: "Taken", count: grid.flat().length - free, color: "#f87171" }, { label: "Total", count: grid.flat().length, color: "#4a5980" }].map((s) => (
              <div key={s.label} className="flex items-center justify-between py-2 border-b last:border-0" style={{ borderColor: CARD_BORDER }}>
                <span className="text-[13px] text-[#8892b0]">{s.label}</span>
                <span className="text-[15px] font-bold" style={{ color: s.color }}>{s.count}</span>
              </div>
            ))}
          </div>
          <StudyTogetherCard onNav={() => {}} />
        </div>
      </div>
    </div>
  );
}

function DesktopRecallContent({ onNav, topics, onRemove, onMarkReviewed }: {
  onNav: (s: Screen) => void;
  topics: Topic[];
  onRemove: (id: number) => void;
  onMarkReviewed: (id: number) => void;
}) {
  const reviewedCount = topics.filter((t) => t.retention >= 85 && t.nextReview.includes("2D")).length;
  return (
    <div className="flex flex-col h-full overflow-y-auto scrollbar-hide">
      <div className="px-8 py-6 border-b flex items-center justify-between flex-shrink-0" style={{ borderColor: "rgba(255,255,255,0.05)" }}>
        <div>
          <h1 className="text-[22px] font-bold text-white">Review Queue</h1>
          <p className="text-[13px] text-[#4a5980] mt-0.5">
            {topics.length} topics tracked
            {reviewedCount > 0 && <span className="text-[#34d399] ml-2">· {reviewedCount} reviewed today ✓</span>}
          </p>
        </div>
        <GradBtn className="w-auto px-6" onClick={() => {}}>Start All Reviews</GradBtn>
      </div>
      <div className="flex-1 p-6 grid gap-4" style={{ gridTemplateColumns: "1fr 340px" }}>
        <div className="space-y-3">
          <RecallCurveCard />
          {topics.length === 0 ? (
            <div className="rounded-2xl p-8 text-center border" style={{ background: CARD_BG, borderColor: CARD_BORDER }}>
              <p className="text-[28px] mb-3">📖</p>
              <p className="text-[15px] text-[#3a4a6a]">No topics tracked yet</p>
              <p className="text-[12px] text-[#2a3a52] mt-1">Add topics from the Home page to get started</p>
            </div>
          ) : (
            <div className="rounded-2xl p-4 border" style={{ background: CARD_BG, borderColor: CARD_BORDER }}>
              <div className="flex items-center justify-between mb-2">
                <Lbl>All Topics</Lbl>
                <span className="text-[10px] text-[#4a5980]">Tap ✓ after reviewing</span>
              </div>
              {topics.map((t) => <TopicItemRow key={t.id} topic={t} onRemove={onRemove} onMarkReviewed={onMarkReviewed} />)}
            </div>
          )}
        </div>
        <div className="space-y-3">
          <WynkoSuggestsCard onNav={onNav} topics={topics} />
          <AchievementsCard />
        </div>
      </div>
    </div>
  );
}

// ─── ROOT APP ─────────────────────────────────────────────

export default function MobileHome() {
  const [screen, setScreen] = useState<Screen>("home");
  const [topics, setTopics] = useState<Topic[]>(INITIAL_TOPICS);
  const [customSubjects, setCustomSubjects] = useState<string[]>([]);

  const goTo = (s: Screen) => setScreen(s);
  const goHome = () => setScreen("home");

  // All subjects available in the dropdown
  const allSubjects = [...SUBJECTS, ...customSubjects];

  const addTopic = (subject: string, topicName: string) => {
    const newTopic: Topic = {
      id: Date.now(),
      name: topicName,
      subject,
      retention: 100,
      priority: "LOW",
      status: "NOT DUE YET",
      nextReview: NEXT_REVIEW_LABELS[0],
      addedAt: Date.now(),
    };
    setTopics((prev) => [newTopic, ...prev]);
  };

  const removeTopic = (id: number) => {
    setTopics((prev) => prev.filter((t) => t.id !== id));
  };

  const addCustomSubject = (name: string) => {
    // Assign the next rotating color and cache it so SubjectBadge resolves it
    const idx = Object.keys(subjectColorCache).length % CUSTOM_PALETTE.length;
    subjectColorCache[name] = CUSTOM_PALETTE[idx];
    setCustomSubjects((prev) => [...prev, name]);
  };

  const markAsReviewed = (id: number) => {
    setTopics((prev) =>
      prev.map((t) => {
        if (t.id !== id) return t;
        // Big retention boost after active review; cap at 100
        const newRetention = Math.min(100, t.retention + 60);
        return {
          ...t,
          retention: newRetention,
          priority: calcPriority(newRetention),
          status: "NOT DUE YET" as TopicStatus,
          nextReview: "+2D review",
        };
      })
    );
  };

  const sharedProps = { topics, allSubjects, onAddTopic: addTopic, onRemoveTopic: removeTopic, onMarkReviewed: markAsReviewed, onAddCustomSubject: addCustomSubject };

  return (
    <div className="min-h-screen" style={{ background: "#030309", fontFamily: "'Inter', sans-serif" }}>

      {/* ── DESKTOP (lg+) ────────────────────────────────── */}
      <div className="hidden lg:flex h-screen overflow-hidden" style={{ background: "#07070f" }}>
        <Sidebar active={screen} onNav={goTo} />
        <main className="flex-1 overflow-hidden">
          {screen === "home"    && <DesktopHomeContent   onNav={goTo} {...sharedProps} />}
          {screen === "focus"   && <DesktopFocusContent  onNav={goTo} />}
          {screen === "rooms"   && <DesktopRoomsContent  />}
          {screen === "library" && <DesktopLibraryContent />}
          {screen === "recall"  && <DesktopRecallContent onNav={goTo} topics={topics} onRemove={removeTopic} onMarkReviewed={markAsReviewed} />}
          {screen === "more"    && (
            <div className="p-6 grid grid-cols-3 gap-4">
              <AchievementsCard horizontal />
              <WynkoSuggestsCard onNav={goTo} topics={topics} />
              <StudyTogetherCard onNav={goTo} />
            </div>
          )}
        </main>
      </div>

      {/* ── MOBILE (<lg) ─────────────────────────────────── */}
      <div className="lg:hidden w-full max-w-[430px] mx-auto h-screen flex flex-col overflow-hidden" style={{ background: "#07070f" }}>
        {screen === "home"    && <MobileHomeScreen   onNav={goTo} {...sharedProps} />}
        {screen === "focus"   && <MobileFocusScreen   onBack={goHome} />}
        {screen === "rooms"   && <MobileRoomsScreen   onBack={goHome} />}
        {screen === "library" && <MobileLibraryScreen onBack={goHome} />}
        {screen === "recall"  && <MobileRecallScreen  onBack={goHome} topics={topics} onRemove={removeTopic} onMarkReviewed={markAsReviewed} />}
        {screen === "more"    && (
          <div className="flex-1 overflow-y-auto scrollbar-hide">
            <SecondaryHeader title="More" onBack={goHome} />
            <div className="px-4 space-y-3 pb-6">
              <WynkoSuggestsCard onNav={goTo} topics={topics} />
              <AchievementsCard />
              <StudyTogetherCard onNav={goTo} />
            </div>
          </div>
        )}
        <BottomNav active={screen} onNav={goTo} />
      </div>
    </div>
  );
}
