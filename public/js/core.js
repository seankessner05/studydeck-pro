import { icon } from "./icons.js";
// StudyDeck front end: plain JS, no build step.
export const $ = (id) => document.getElementById(id);
export const state = {
  course: "all", view: "chat", courses: [], profiles: [], editable: false, total: 0, source: "samples", demo: false, streak: 0, busy: false,
  notes: [], granola: { connected: false, syncing: false, last: null, msg: "", authUrl: "", detail: "" },
  aiPaused: false, usage: null,
  study: { sub: "today", gen: { open: false, plan: null, selected: new Set(), density: "normal", focus: "", job: null, polling: false, error: "" },
    qgen: { open: false, plan: null, selected: new Set(), density: "normal", focus: "", job: null, polling: false, error: "" },
    pgen: { open: false, plan: null, selected: new Set(), density: "normal", focus: "", job: null, polling: false, error: "" },
    quiz: { mode: "home", home: null, length: 10, error: "", runId: "", queue: [], idx: 0, picked: [], result: null, explain: null, asked: 0, correct: 0, t0: 0, qT0: 0, busy: false, summary: null },
    mode: "home", today: null, cards: [], badge: 0, queue: [], idx: 0, revealed: false, reviewed: 0, correct: 0, t0: 0, cardT0: 0, busy: false },
};

// Shortcuts into the shared state. They live here, next to state, so every module can use them as soon as it loads.
export const S = state.study;
export const Q = S.quiz;
export const G = state.granola;

// Course colors come from the registry (a palette name per course). Literal class names so Tailwind keeps them.
export const PALETTE_CLASSES = {
  indigo: { dot: "bg-indigo-500", tile: "bg-indigo-100 dark:bg-indigo-500/25", chip: "bg-indigo-500 text-white hover:bg-indigo-600", text: "text-indigo-700 dark:text-indigo-300", bar: "border-indigo-500" },
  sky: { dot: "bg-sky-500", tile: "bg-sky-100 dark:bg-sky-500/25", chip: "bg-sky-500 text-white hover:bg-sky-600", text: "text-sky-700 dark:text-sky-300", bar: "border-sky-500" },
  emerald: { dot: "bg-emerald-500", tile: "bg-emerald-100 dark:bg-emerald-500/25", chip: "bg-emerald-500 text-white hover:bg-emerald-600", text: "text-emerald-700 dark:text-emerald-300", bar: "border-emerald-500" },
  fuchsia: { dot: "bg-fuchsia-500", tile: "bg-fuchsia-100 dark:bg-fuchsia-500/25", chip: "bg-fuchsia-500 text-white hover:bg-fuchsia-600", text: "text-fuchsia-700 dark:text-fuchsia-300", bar: "border-fuchsia-500" },
  amber: { dot: "bg-amber-500", tile: "bg-amber-100 dark:bg-amber-500/25", chip: "bg-amber-500 text-white hover:bg-amber-600", text: "text-amber-700 dark:text-amber-300", bar: "border-amber-500" },
  teal: { dot: "bg-teal-500", tile: "bg-teal-100 dark:bg-teal-500/25", chip: "bg-teal-500 text-white hover:bg-teal-600", text: "text-teal-700 dark:text-teal-300", bar: "border-teal-500" },
  orange: { dot: "bg-orange-500", tile: "bg-orange-100 dark:bg-orange-500/25", chip: "bg-orange-500 text-white hover:bg-orange-600", text: "text-orange-700 dark:text-orange-300", bar: "border-orange-500" },
  rose: { dot: "bg-rose-500", tile: "bg-rose-100 dark:bg-rose-500/25", chip: "bg-rose-500 text-white hover:bg-rose-600", text: "text-rose-700 dark:text-rose-300", bar: "border-rose-500" },
  violet: { dot: "bg-violet-500", tile: "bg-violet-100 dark:bg-violet-500/25", chip: "bg-violet-500 text-white hover:bg-violet-600", text: "text-violet-700 dark:text-violet-300", bar: "border-violet-500" },
  lime: { dot: "bg-lime-500", tile: "bg-lime-100 dark:bg-lime-500/25", chip: "bg-lime-500 text-white hover:bg-lime-600", text: "text-lime-700 dark:text-lime-300", bar: "border-lime-500" },
  slate: { dot: "bg-slate-400", tile: "bg-slate-100 dark:bg-slate-500/25", chip: "bg-slate-500 text-white hover:bg-slate-600", text: "text-slate-600 dark:text-slate-300", bar: "border-slate-400" },
  all: { dot: "bg-gradient-to-br from-brand-500 to-fuchsia-500", tile: "bg-gradient-to-br from-brand-100 to-fuchsia-100 dark:from-brand-500/30 dark:to-fuchsia-500/30", chip: "bg-brand-500 text-white hover:bg-brand-600", text: "text-brand-700 dark:text-brand-300", bar: "border-brand-500" },
};

export const BAD_CHIP = "bg-red-500 text-white";
export const PROFILE_ICON = { "quant-econ": "trend", finance: "finance", accounting: "ledger", general: "book" };

// Curated questions for the built-in sample notes (the last one is deliberately not covered, to show "Not in your notes").
export const SAMPLE_QUESTIONS = [
  { course: "ECON300", q: "How does a tax rate change the spending multiplier?" },
  { course: "ECON196", q: "Compare FIFO and LIFO when prices are rising." },
  { course: "ECON301", q: "Why does a monopoly create deadweight loss?" },
  { course: "all", q: "What do I have coming up this week across classes and clubs?" },
  { course: "ECON300", q: "What did we learn about the Solow growth model?" },
];

export const EMPTY_LINES = [
  "Your notes are ready. Your brain might need coffee. ☕",
  "Ask me anything. If it's not in your notes, I'll say so. No bluffing.",
  "Study mode: on. Let's turn your notes into answers. 🚀",
  "No hallucinations here, just your notes and receipts. 🧾",
];

// Escapes both kinds of quote, so the result is safe in text and inside either style of attribute.
export const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
/** The reverse of esc(), for text that was escaped as part of a larger string and is needed raw again. */
export const unesc = (s) => String(s).replace(/&(amp|lt|gt|quot|#39);/g, (_, e) => ({ amp: "&", lt: "<", gt: ">", quot: '"', "#39": "'" })[e]);
export const inline = (s) => s.replace(/\*\*(.+?)\*\*/g, "<b>$1</b>").replace(/`(.+?)`/g, "<code>$1</code>");
export const courseOf = (id) => state.courses.find((c) => c.id === id);
export const palette = (id) => PALETTE_CLASSES[id === "all" ? "all" : courseOf(id)?.color ?? "slate"] ?? PALETTE_CLASSES.slate;
export const courseName = (id) => (id === "all" ? "Everything" : id === "unsorted" ? "Inbox" : courseOf(id)?.name ?? id);
/** A class's tile icon, as HTML. */
export const iconFor = (id, cls = "h-[1.15em] w-[1.15em]") => icon(id === "all" ? "sparkles" : id === "unsorted" ? "inbox" : PROFILE_ICON[courseOf(id)?.profile] ?? "book", cls);
export const fmtDate = (iso) => (iso ? new Date(iso + "T12:00").toLocaleDateString(undefined, { month: "short", day: "numeric" }) : "");
export const ago = (iso) => {
  const m = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  return m < 1 ? "just now" : m < 60 ? `${m} min ago` : m < 1440 ? `${Math.round(m / 60)} h ago` : `${Math.round(m / 1440)} d ago`;
};
export const plural = (n, w, many) => `${n} ${n === 1 ? w : many || w + "s"}`;// ---- Study tab, part 2: practice problems, teach-back tutor, mock exams and cheat sheets, progress, Match game ----
// Loaded after app.js and shares its globals ($, esc, state, S, statTile, plural, palette, courseName, fmtDate, openSource, ...).

export async function api(url, method = "GET", body) {
  try {
    const res = await fetch(url, { method, headers: body ? { "content-type": "application/json" } : undefined, body: body ? JSON.stringify(body) : undefined });
    const data = await res.json().catch(() => ({}));
    return { ok: res.ok, status: res.status, data };
  } catch {
    return { ok: false, status: 0, data: { error: "Couldn't reach the StudyDeck server." } };
  }
}
export const toneOf = (pct) => (pct >= 75 ? "text-emerald-600 dark:text-emerald-300" : pct >= 55 ? "text-amber-600 dark:text-sun" : "text-red-600 dark:text-red-400");
export const barOf = (pct) => (pct >= 75 ? "bg-emerald-500" : pct >= 55 ? "bg-amber-500" : "bg-red-500");
export const loadingHtml = `<div class="py-20 text-center text-slate-400"><span class="dots"><span></span><span></span><span></span></span></div>`;
export const panelCls = "rounded-2xl bg-white p-5 shadow-card ring-1 ring-slate-200/70 dark:bg-ink-800 dark:ring-ink-600";
export const btnPrimary = "rounded-xl bg-brand-500 px-5 py-2.5 text-sm font-extrabold text-white shadow-card transition hover:bg-brand-600 active:scale-95 disabled:opacity-50";
export const btnGhost = "rounded-xl border border-slate-200 px-4 py-2 text-sm font-bold hover:bg-slate-50 dark:border-ink-600 dark:hover:bg-ink-700";
export const fmtNum = (v) => (Number.isFinite(v) ? Number(Number(v).toPrecision(8)).toLocaleString(undefined, { maximumFractionDigits: 6 }) : "–");
export const fmtUnit = (v, unit) => (unit === "$" ? `${v < 0 ? "−" : ""}$${fmtNum(Math.abs(v))}` : unit === "%" ? `${fmtNum(v)}%` : unit ? `${fmtNum(v)} ${unit}` : fmtNum(v));
export const mmss = (ms) => { const s = Math.max(0, Math.ceil(ms / 1000)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`; };
export const noteTitleOf = (id) => (state.notes.find((n) => n.id === id) || {}).title || "";