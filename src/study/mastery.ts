import type { Db } from "../library/db.js";
import { daysUntil, inScope, type Exam } from "./exams.js";

const DAY = 86_400_000;
const startOfDay = (ms: number) => new Date(new Date(ms).setHours(0, 0, 0, 0)).getTime();

/** An answer from 14 days ago counts half as much as one from today. */
const HALF_LIFE_DAYS = 14;
/** How many "average" answers of doubt a topic starts with, so one lucky answer doesn't read as mastery. */
const PRIOR_WEIGHT = 1.5;
const PRIOR = 0.5;
/** Below this much (recency-weighted) evidence we say "not practiced enough to tell". */
const MIN_EVIDENCE = 0.75;
export const WEAK_BELOW = 0.55;
export const SOLID_FROM = 0.75;

export type Source = "card" | "quiz" | "problem" | "tutor";

export interface Evidence {
  course: string;
  noteId: string | null;
  section: string | null;
  /** 0 to 1 */
  score: number;
  /** How much this answer counts (problems more than a card flip) */
  weight: number;
  at: number;
  source: Source;
}

const SOURCE_WEIGHT: Record<Source, number> = { card: 1, quiz: 1, problem: 1.5, tutor: 0.75 };
/** Card ratings: Again 0, Hard half, Good and Easy full. */
const CARD_SCORE: Record<number, number> = { 1: 0, 2: 0.5, 3: 1, 4: 1 };

/**
 * Everything you actually answered, as evidence about a topic. First tries only for quizzes and problems (a miss you
 * fixed a minute later is still a miss), and a problem solved after opening the hint counts as half a success.
 */
export function collectEvidence(db: Db, course: string): Evidence[] {
  const where = (col: string) => (course === "all" ? { sql: "1=1", args: [] as string[] } : { sql: `${col} = ?`, args: [course] });
  const out: Evidence[] = [];
  const c = where("c.course");
  for (const r of db.prepare(`SELECT r.grade, r.reviewed_at at, c.course, c.note_id, c.section FROM reviews r JOIN cards c ON c.id = r.card_id WHERE ${c.sql}`).all(...c.args) as any[]) {
    out.push({ course: r.course, noteId: r.note_id, section: r.section, score: CARD_SCORE[r.grade] ?? 0, weight: SOURCE_WEIGHT.card, at: r.at, source: "card" });
  }
  const q = where("q.course");
  for (const r of db.prepare(`SELECT a.correct, a.answered_at at, q.course, q.note_id, q.section FROM quiz_answers a JOIN questions q ON q.id = a.question_id WHERE a.attempt = 1 AND ${q.sql}`).all(...q.args) as any[]) {
    out.push({ course: r.course, noteId: r.note_id, section: r.section, score: r.correct ? 1 : 0, weight: SOURCE_WEIGHT.quiz, at: r.at, source: "quiz" });
  }
  const p = where("p.course");
  for (const r of db.prepare(`SELECT a.correct, a.hinted, a.answered_at at, p.course, p.note_id, p.section FROM problem_attempts a JOIN problems p ON p.id = a.problem_id WHERE a.attempt = 1 AND ${p.sql}`).all(...p.args) as any[]) {
    out.push({ course: r.course, noteId: r.note_id, section: r.section, score: r.correct ? (r.hinted ? 0.5 : 1) : 0, weight: SOURCE_WEIGHT.problem, at: r.at, source: "problem" });
  }
  // Teach-back sessions, when the tutor has been used
  const hasTutor = db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'tutor_sessions'").get();
  if (hasTutor) {
    const t = where("course");
    for (const r of db.prepare(`SELECT course, note_id, section, score, finished_at at FROM tutor_sessions WHERE finished_at IS NOT NULL AND score IS NOT NULL AND ${t.sql}`).all(...t.args) as any[]) {
      out.push({ course: r.course, noteId: r.note_id, section: r.section, score: r.score, weight: SOURCE_WEIGHT.tutor, at: r.at, source: "tutor" });
    }
  }
  return out;
}

export type Level = "unknown" | "weak" | "shaky" | "solid";

export interface Mastery {
  /** 0 to 1, or null when there isn't enough evidence to say */
  score: number | null;
  /** Recency-weighted amount of evidence */
  evidence: number;
  /** Raw number of answers */
  answers: number;
  level: Level;
}

export function masteryOf(items: Evidence[], now: Date): Mastery {
  let wsum = 0;
  let sum = 0;
  for (const e of items) {
    const age = Math.max(0, now.getTime() - e.at) / DAY;
    const w = e.weight * Math.pow(0.5, age / HALF_LIFE_DAYS);
    wsum += w;
    sum += w * e.score;
  }
  const score = (sum + PRIOR * PRIOR_WEIGHT) / (wsum + PRIOR_WEIGHT);
  const enough = wsum >= MIN_EVIDENCE;
  return {
    score: enough ? Math.round(score * 100) / 100 : null,
    evidence: Math.round(wsum * 100) / 100,
    answers: items.length,
    level: !enough ? "unknown" : score < WEAK_BELOW ? "weak" : score < SOLID_FROM ? "shaky" : "solid",
  };
}

// ---------- per-lecture progress ----------

export interface NoteRef {
  id: string;
  course: string;
  title: string;
  date: string;
}

export interface LectureProgress extends NoteRef {
  mastery: Mastery;
  material: { cards: number; questions: number; problems: number };
  sections: { name: string; mastery: Mastery }[];
}

export interface WeakSpot {
  noteId: string;
  course: string;
  title: string;
  date: string;
  section: string | null;
  mastery: Mastery;
}

export interface Insight {
  kind: "idle" | "missed" | "untried" | "nomaterial" | "streak" | "tip";
  text: string;
}

function materialCounts(db: Db): Map<string, { cards: number; questions: number; problems: number }> {
  const out = new Map<string, { cards: number; questions: number; problems: number }>();
  const get = (id: string) => out.get(id) ?? out.set(id, { cards: 0, questions: 0, problems: 0 }).get(id)!;
  for (const r of db.prepare("SELECT note_id, COUNT(*) n FROM cards WHERE note_id IS NOT NULL AND suspended = 0 GROUP BY note_id").all() as any[]) get(r.note_id).cards = Number(r.n);
  for (const r of db.prepare("SELECT note_id, COUNT(*) n FROM questions WHERE note_id IS NOT NULL GROUP BY note_id").all() as any[]) get(r.note_id).questions = Number(r.n);
  for (const r of db.prepare("SELECT note_id, COUNT(*) n FROM problems WHERE note_id IS NOT NULL GROUP BY note_id").all() as any[]) get(r.note_id).problems = Number(r.n);
  return out;
}

export function lectureProgress(db: Db, notes: NoteRef[], now = new Date()): LectureProgress[] {
  const evidence = collectEvidence(db, "all");
  const byNote = new Map<string, Evidence[]>();
  for (const e of evidence) if (e.noteId) (byNote.get(e.noteId) ?? byNote.set(e.noteId, []).get(e.noteId)!).push(e);
  const material = materialCounts(db);
  return notes.map((n) => {
    const items = byNote.get(n.id) ?? [];
    const bySection = new Map<string, Evidence[]>();
    for (const e of items) (bySection.get(e.section ?? "General") ?? bySection.set(e.section ?? "General", []).get(e.section ?? "General")!).push(e);
    const sections = [...bySection.entries()]
      .map(([name, list]) => ({ name, mastery: masteryOf(list, now) }))
      .sort((a, b) => (a.mastery.score ?? 2) - (b.mastery.score ?? 2) || b.mastery.answers - a.mastery.answers);
    return { ...n, mastery: masteryOf(items, now), material: material.get(n.id) ?? { cards: 0, questions: 0, problems: 0 }, sections };
  });
}

/** The topics that need work most: shaky or weak, with real evidence, worst first. Sections, falling back to whole lectures. */
export function weakSpots(lectures: LectureProgress[], limit = 8): WeakSpot[] {
  const spots: WeakSpot[] = [];
  for (const l of lectures) {
    for (const s of l.sections) {
      if (s.mastery.level === "weak" || (s.mastery.level === "shaky" && s.mastery.score! < 0.65)) {
        if (s.mastery.answers >= 2) spots.push({ noteId: l.id, course: l.course, title: l.title, date: l.date, section: s.name, mastery: s.mastery });
      }
    }
  }
  return spots.sort((a, b) => a.mastery.score! - b.mastery.score! || b.mastery.answers - a.mastery.answers).slice(0, limit);
}

export interface Readiness {
  /** Average mastery over the lectures in scope (lectures with no evidence count as 0.5, an honest "don't know") */
  score: number;
  /** Lectures with enough evidence to say anything */
  practiced: number;
  lectures: number;
  /** Total answers behind the number */
  answers: number;
  confidence: "low" | "medium" | "high";
}

export function readiness(lectures: LectureProgress[]): Readiness {
  if (!lectures.length) return { score: 0, practiced: 0, lectures: 0, answers: 0, confidence: "low" };
  const practiced = lectures.filter((l) => l.mastery.level !== "unknown").length;
  const score = lectures.reduce((n, l) => n + (l.mastery.score ?? 0.5), 0) / lectures.length;
  const answers = lectures.reduce((n, l) => n + l.mastery.answers, 0);
  const share = practiced / lectures.length;
  return { score: Math.round(score * 100) / 100, practiced, lectures: lectures.length, answers, confidence: share >= 0.8 && answers >= 40 ? "high" : share >= 0.5 && answers >= 15 ? "medium" : "low" };
}

// ---------- insights ----------

/** The things worth telling you, in plain words. No AI involved: every line is computed from your answers. */
export function insights(db: Db, lectures: LectureProgress[], studyDays: string[], now = new Date()): Insight[] {
  const out: Insight[] = [];
  const today = startOfDay(now.getTime());
  const last = studyDays.length ? studyDays[studyDays.length - 1] : undefined;
  if (last) {
    const [y, m, d] = last.split("-").map(Number);
    const idle = Math.round((today - new Date(y, m - 1, d).getTime()) / DAY);
    if (idle >= 2) out.push({ kind: "idle", text: `You haven't studied in ${idle} days. A short session today keeps cards from piling up.` });
  } else out.push({ kind: "tip", text: "You haven't answered anything yet. A first session starts your progress chart." });

  // questions and problems you keep missing
  const stuck = [
    ...(db.prepare(`SELECT q.stem stem, COUNT(*) n, SUM(a.correct) ok FROM quiz_answers a JOIN questions q ON q.id = a.question_id WHERE a.attempt = 1 GROUP BY q.id HAVING n >= 2 AND ok = 0 ORDER BY n DESC LIMIT 3`).all() as any[]),
    ...(db.prepare(`SELECT p.stem stem, COUNT(*) n, SUM(a.correct) ok FROM problem_attempts a JOIN problems p ON p.id = a.problem_id WHERE a.attempt = 1 GROUP BY p.id HAVING n >= 2 AND ok = 0 ORDER BY n DESC LIMIT 3`).all() as any[]),
  ].slice(0, 3);
  for (const s of stuck) out.push({ kind: "missed", text: `You've missed this ${s.n} times in a row: “${String(s.stem).slice(0, 110)}${String(s.stem).length > 110 ? "…" : ""}”` });

  const unpracticed = lectures.filter((l) => l.mastery.level === "unknown" && (l.material.questions || l.material.problems || l.material.cards));
  if (unpracticed.length) out.push({ kind: "untried", text: `${unpracticed.length} ${unpracticed.length === 1 ? "lecture has" : "lectures have"} study material you haven't tried yet: ${unpracticed.slice(0, 3).map((l) => l.title).join("; ")}${unpracticed.length > 3 ? "…" : ""}.` });
  const bare = lectures.filter((l) => !l.material.cards && !l.material.questions && !l.material.problems);
  if (bare.length) out.push({ kind: "nomaterial", text: `${bare.length} ${bare.length === 1 ? "lecture has" : "lectures have"} no cards, questions or problems yet.` });
  return out;
}

// ---------- the daily plan ----------

export type PlanKind = "generate" | "cards" | "quiz" | "problems" | "tutor" | "exam";

export interface PlanItem {
  kind: PlanKind;
  title: string;
  detail: string;
  minutes: number;
  course: string;
  examId?: string;
  noteIds?: string[];
}

export interface ExamPlan {
  exam: Exam;
  daysLeft: number;
  readiness: Readiness;
  /** What would raise readiness the most, in one sentence */
  next: string;
  inScope: number;
  items: PlanItem[];
}

export interface PlanInput {
  db: Db;
  exams: Exam[];
  notes: NoteRef[];
  minutes?: number;
  now?: Date;
  /** Cards due now per class */
  dueCards: (course: string) => number;
  /** New cards you may still learn today per class (after the daily limit) */
  newCards?: (course: string) => number;
}

/** Order what to do today for one exam: material first if there is none, then due cards, then the weakest topics, then untried ones. */
function examItems(exam: Exam, lectures: LectureProgress[], due: number, daysLeft: number, fresh = 0): PlanItem[] {
  const items: PlanItem[] = [];
  const course = exam.course;
  const noMaterial = lectures.filter((l) => !l.material.cards && !l.material.questions && !l.material.problems);
  if (noMaterial.length) {
    items.push({ kind: "generate", title: `Make study material for ${noMaterial.length} ${noMaterial.length === 1 ? "lecture" : "lectures"}`, detail: `${noMaterial.slice(0, 3).map((l) => l.title).join("; ")}${noMaterial.length > 3 ? "…" : ""} have no cards, questions or problems yet.`, minutes: 5, course, examId: exam.id, noteIds: noMaterial.map((l) => l.id) });
  }
  if (due > 0 || fresh > 0) {
    const n = due + fresh;
    items.push({
      kind: "cards",
      title: due && fresh ? `Study ${n} cards` : due ? `Review ${due} due ${due === 1 ? "card" : "cards"}` : `Learn ${fresh} new ${fresh === 1 ? "card" : "cards"}`,
      detail: due && fresh ? `${due} due now, ${fresh} new. Spaced repetition: due cards first, later is harder.` : due ? "Spaced repetition: these are due now, and later is harder." : "New cards from your lectures, introduced a few at a time so they stick.",
      minutes: Math.min(20, Math.max(3, Math.ceil(due * 0.4 + fresh * 0.6))), course, examId: exam.id,
    });
  }
  const weak = weakSpots(lectures, 4);
  const seen = new Set<string>();
  for (const w of weak) {
    if (seen.has(w.noteId)) continue;
    seen.add(w.noteId);
    const l = lectures.find((x) => x.id === w.noteId)!;
    const pct = Math.round((w.mastery.score ?? 0) * 100);
    if (l.material.questions) items.push({ kind: "quiz", title: `Quiz: ${l.title}`, detail: `Your weakest area (${pct}% on “${w.section}”, ${w.mastery.answers} answers).`, minutes: 8, course, examId: exam.id, noteIds: [l.id] });
    if (l.material.problems && items.filter((i) => i.kind === "problems").length < 2) items.push({ kind: "problems", title: `Practice problems: ${l.title}`, detail: "Calculations stick when you do them, not when you read them.", minutes: 12, course, examId: exam.id, noteIds: [l.id] });
  }
  const untried = lectures.filter((l) => l.mastery.level === "unknown" && l.material.questions && !seen.has(l.id)).sort((a, b) => a.date.localeCompare(b.date));
  for (const l of untried.slice(0, 3)) items.push({ kind: "quiz", title: `Quiz: ${l.title}`, detail: "You haven't been tested on this lecture yet.", minutes: 8, course, examId: exam.id, noteIds: [l.id] });
  const weakest = weak[0];
  if (weakest) items.push({ kind: "tutor", title: `Teach it back: ${weakest.title}`, detail: "Explain it in your own words and find the gap.", minutes: 10, course, examId: exam.id, noteIds: [weakest.noteId] });
  if (daysLeft <= 3 && lectures.some((l) => l.material.questions || l.material.problems)) items.push({ kind: "exam", title: "Take a timed mock exam", detail: daysLeft <= 1 ? "Last run-through: do it under real conditions." : "Find out what's still shaky while there's time.", minutes: 30, course, examId: exam.id });
  return items;
}

/** Cram mode: an exam within this many days changes the plan. */
export const CRAM_DAYS = 3;

export interface Cram {
  examId: string;
  course: string;
  name: string;
  daysLeft: number;
}

/** The exam to cram for: the soonest one within CRAM_DAYS days (today counts), if any. */
export function cramFor(exams: Exam[], now = new Date()): Cram | undefined {
  const soon = [...exams].map((e) => ({ e, d: daysUntil(e, now) })).filter((x) => x.d >= 0 && x.d <= CRAM_DAYS).sort((a, b) => a.d - b.d)[0];
  return soon ? { examId: soon.e.id, course: soon.e.course, name: soon.e.name, daysLeft: soon.d } : undefined;
}

/** One plain sentence on what would raise readiness the most, from the lectures in scope. */
export function readinessNext(lectures: LectureProgress[]): string {
  const untried = lectures.filter((l) => l.mastery.level === "unknown");
  const withMaterial = untried.filter((l) => l.material.questions || l.material.problems || l.material.cards);
  if (withMaterial.length) return `Test yourself on the ${withMaterial.length === 1 ? "lecture" : `${withMaterial.length} lectures`} you haven't practiced yet (${withMaterial.slice(0, 2).map((l) => `“${l.title}”`).join(", ")}${withMaterial.length > 2 ? "…" : ""}): until then the estimate is a guess.`;
  if (untried.length) return `${untried.length} ${untried.length === 1 ? "lecture has" : "lectures have"} no cards or questions yet, so there's nothing to practice them with.`;
  const weak = weakSpots(lectures, 1)[0];
  if (weak) return `Your weakest area is “${weak.section}” in “${weak.title}” (${Math.round((weak.mastery.score ?? 0) * 100)}%): that's where practice moves the number most.`;
  return "Everything in scope is solid. A timed mock exam is the best check now.";
}

export function buildPlan(input: PlanInput): { plans: ExamPlan[]; items: PlanItem[]; totalMinutes: number; budget: number; cram: Cram | null; optional: PlanItem[] } {
  const now = input.now ?? new Date();
  const budget = input.minutes ?? 45;
  const plans: ExamPlan[] = [];
  for (const exam of [...input.exams].sort((a, b) => a.dateMs - b.dateMs)) {
    const scope = inScope(exam, input.notes);
    const lectures = lectureProgress(input.db, scope, now);
    const daysLeft = daysUntil(exam, now);
    plans.push({ exam, daysLeft, readiness: readiness(lectures), next: readinessNext(lectures), inScope: scope.length, items: examItems(exam, lectures, input.dueCards(exam.course), daysLeft, input.newCards?.(exam.course) ?? 0) });
  }
  // Cram mode: the exam that's days away comes first, weakest topics before due cards, card sessions kept short, and
  // nothing that spends Claude usage (making material) unless you ask for it yourself.
  const cram = cramFor(input.exams, now);
  /** Offered but not part of the run: in cram mode, making material (it spends Claude usage, so it's your call). */
  const optional: PlanItem[] = [];
  if (cram) {
    plans.sort((a, b) => (a.exam.id === cram.examId ? -1 : b.exam.id === cram.examId ? 1 : 0));
    const p = plans[0];
    const rank = (it: PlanItem) => ({ quiz: 0, problems: 1, cards: 2, tutor: 3, exam: 4, generate: 5 })[it.kind] ?? 6;
    optional.push(...p.items.filter((it) => it.kind === "generate").map((it) => ({ ...it, detail: `${it.detail} Making material uses Claude, so it's up to you.` })));
    p.items = p.items
      .filter((it) => it.kind !== "generate")
      .map((it) => (it.kind === "cards" ? { ...it, minutes: Math.min(it.minutes, 15), detail: `Cram mode: ${it.detail}` } : it))
      .sort((a, b) => rank(a) - rank(b) || 0);
  }
  // One list for the day, soonest exam first, trimmed to the time you have (but never empty if there is anything to do).
  const items: PlanItem[] = [];
  const dueTaken = new Set<string>();
  let total = 0;
  for (const p of plans) {
    for (const it of p.items) {
      if (it.kind === "cards") {
        if (dueTaken.has(it.course)) continue; // two exams in one class share the same due cards
        dueTaken.add(it.course);
      }
      if (items.length && total + it.minutes > budget) continue;
      items.push(it);
      total += it.minutes;
    }
  }
  return { plans, items, totalMinutes: total, budget, cram: cram ?? null, optional };
}
