import { randomUUID } from "node:crypto";
import type { Db } from "../library/db.js";
import { tx } from "./db.js";
import { numbersClose, parseNumber, type Step } from "./problemgen.js";
import { QuizError } from "./questions.js";
import type { QKind } from "./quizgen.js";
import type { GradeInput, RubricPoint, WrittenGrade, WrittenQuestion } from "./written.js";

export type Preset = "quick" | "standard" | "full";
export const PRESETS: Record<Preset, { label: string; mcq: number; problems: number; written: number }> = {
  quick: { label: "Quick check", mcq: 6, problems: 1, written: 0 },
  standard: { label: "Standard", mcq: 12, problems: 3, written: 2 },
  full: { label: "Full length", mcq: 20, problems: 4, written: 3 },
};
const MCQ_MINUTES = 1.2;
const PROBLEM_MINUTES = 6;
const WRITTEN_MINUTES = 8;
const PROBLEM_POINTS = 3;

interface McqItem { id: string; type: "mcq"; refId: string; kind: QKind; stem: string; options: string[]; answer: number[]; explanation: string; quote: string | null; noteId: string | null; section: string | null; points: number }
interface ProblemItem { id: string; type: "problem"; refId: string; stem: string; unit: string; answer: number; steps: Step[]; quote: string | null; noteId: string | null; section: string | null; points: number }
interface WrittenItem { id: string; type: "written"; prompt: string; rubric: RubricPoint[]; noteId: string | null; section: string | null; points: number }
export type Item = McqItem | ProblemItem | WrittenItem;

/** What the exam page gets: the questions only. Keys, steps, rubrics and explanations stay on the server until you submit. */
export type PublicItem =
  | { id: string; type: "mcq"; kind: QKind; stem: string; options: string[]; points: number; noteId: string | null; section: string | null }
  | { id: string; type: "problem"; stem: string; unit: string; points: number; noteId: string | null; section: string | null }
  | { id: string; type: "written"; prompt: string; points: number; noteId: string | null; section: string | null };

export function toPublicItem(it: Item): PublicItem {
  if (it.type === "mcq") return { id: it.id, type: "mcq", kind: it.kind, stem: it.stem, options: it.options, points: it.points, noteId: it.noteId, section: it.section };
  if (it.type === "problem") return { id: it.id, type: "problem", stem: it.stem, unit: it.unit, points: it.points, noteId: it.noteId, section: it.section };
  return { id: it.id, type: "written", prompt: it.prompt, points: it.points, noteId: it.noteId, section: it.section };
}

export interface ItemResult {
  id: string;
  type: Item["type"];
  answered: boolean;
  earned: number;
  max: number;
  /** MCQ and problems */
  correct?: boolean;
  /** MCQ: the right option indexes; problem: the right number */
  answer?: number[] | number;
  explanation?: string;
  quote?: string | null;
  steps?: Step[];
  unit?: string;
  picked?: number[];
  submitted?: number | null;
  /** Written */
  graded?: boolean;
  text?: string;
  points?: { id: string; text: string; met: boolean; evidence: string; check: string; note?: string }[];
  remark?: string;
  remarkUsed?: boolean;
}

// ---------- building an exam ----------

/** Take `n` rows spread evenly across lectures: one from each in turn, in random order within each. */
export function pickSpread<T extends { note_id: string | null }>(rows: T[], n: number, rand: () => number): T[] {
  const shuffle = <U,>(a: U[]): U[] => {
    const x = [...a];
    for (let i = x.length - 1; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1));
      [x[i], x[j]] = [x[j], x[i]];
    }
    return x;
  };
  const groups = new Map<string, T[]>();
  for (const r of rows) (groups.get(r.note_id ?? "") ?? groups.set(r.note_id ?? "", []).get(r.note_id ?? "")!).push(r);
  const queues = shuffle([...groups.values()]).map(shuffle);
  const out: T[] = [];
  while (out.length < n && queues.some((q) => q.length)) {
    for (const q of queues) {
      const next = q.shift();
      if (next) out.push(next);
      if (out.length >= n) break;
    }
  }
  return out;
}

export interface NewSitting {
  course: string;
  name: string;
  examId?: string | null;
  /** The lectures the exam covers */
  noteIds: string[];
  preset: Preset;
  written: WrittenQuestion[];
}

export interface CreatedSitting {
  id: string;
  name: string;
  preset: Preset;
  durationMin: number;
  startedAt: number;
  deadlineAt: number;
  items: PublicItem[];
  /** Asked for more than the bank has */
  shortfall: { mcq: number; problems: number; written: number };
}

export function createSitting(db: Db, o: NewSitting, now = new Date(), rand: () => number = Math.random): CreatedSitting {
  const want = PRESETS[o.preset];
  const inScope = (col: string) => (o.noteIds.length ? `AND ${col} IN (${o.noteIds.map(() => "?").join(",")})` : "AND 0");
  const qRows = db.prepare(`SELECT * FROM questions WHERE course = ? ${inScope("note_id")}`).all(o.course, ...o.noteIds) as any[];
  const pRows = db.prepare(`SELECT * FROM problems WHERE course = ? ${inScope("note_id")}`).all(o.course, ...o.noteIds) as any[];
  const mcq = pickSpread(qRows, want.mcq, rand);
  const problems = pickSpread(pRows, want.problems, rand);
  const written = o.written.slice(0, want.written);

  const items: Item[] = [
    ...mcq.map((r): McqItem => ({ id: randomUUID(), type: "mcq", refId: r.id, kind: r.kind, stem: r.stem, options: JSON.parse(r.options), answer: JSON.parse(r.answer), explanation: r.explanation, quote: r.quote, noteId: r.note_id, section: r.section, points: 1 })),
    ...problems.map((r): ProblemItem => ({ id: randomUUID(), type: "problem", refId: r.id, stem: r.stem, unit: r.unit, answer: r.answer, steps: JSON.parse(r.steps), quote: r.quote, noteId: r.note_id, section: r.section, points: PROBLEM_POINTS })),
    ...written.map((w): WrittenItem => ({ id: randomUUID(), type: "written", prompt: w.prompt, rubric: w.rubric, noteId: w.noteId, section: w.section, points: w.rubric.length })),
  ];
  if (!items.length) throw new QuizError("There are no quiz questions or practice problems for these lectures yet. Make some first, then take the exam.");

  const minutes = mcq.length * MCQ_MINUTES + problems.length * PROBLEM_MINUTES + written.length * WRITTEN_MINUTES;
  const durationMin = Math.max(5, Math.ceil(minutes / 5) * 5);
  const id = randomUUID();
  const max = items.reduce((n, it) => n + it.points, 0);
  tx(db, () => {
    // A run row lets the answers count as evidence in your progress, like any other quiz.
    db.prepare("INSERT INTO quiz_runs (id, course, started_at, total) VALUES (?, ?, ?, ?)").run(id, o.course, now.getTime(), mcq.length + problems.length);
    db.prepare(
      "INSERT INTO exam_sittings (id, exam_id, course, name, preset, started_at, deadline_at, duration_min, items_json, max) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    ).run(id, o.examId ?? null, o.course, o.name, o.preset, now.getTime(), now.getTime() + durationMin * 60_000, durationMin, JSON.stringify(items), max);
  });
  return {
    id, name: o.name, preset: o.preset, durationMin, startedAt: now.getTime(), deadlineAt: now.getTime() + durationMin * 60_000,
    items: items.map(toPublicItem),
    shortfall: { mcq: Math.max(0, want.mcq - mcq.length), problems: Math.max(0, want.problems - problems.length), written: Math.max(0, want.written - written.length) },
  };
}

// ---------- reading, submitting, grading ----------

interface SittingRow {
  id: string;
  exam_id: string | null;
  course: string;
  name: string;
  preset: Preset;
  started_at: number;
  deadline_at: number;
  duration_min: number;
  finished_at: number | null;
  items_json: string;
  answers_json: string | null;
  results_json: string | null;
  earned: number | null;
  max: number;
  written_pending: number;
}

const loadRow = (db: Db, id: string): SittingRow => {
  const r = db.prepare("SELECT * FROM exam_sittings WHERE id = ?").get(id) as SittingRow | undefined;
  if (!r) throw new QuizError("That exam isn't there any more.");
  return r;
};

export interface Sitting {
  id: string;
  examId: string | null;
  course: string;
  name: string;
  preset: Preset;
  startedAt: number;
  deadlineAt: number;
  durationMin: number;
  finishedAt: number | null;
  items: PublicItem[];
  results: ItemResult[] | null;
  earned: number | null;
  max: number;
  writtenPending: boolean;
  overtime: boolean;
}

export function getSitting(db: Db, id: string): Sitting {
  const r = loadRow(db, id);
  const items = JSON.parse(r.items_json) as Item[];
  return {
    id: r.id, examId: r.exam_id, course: r.course, name: r.name, preset: r.preset, startedAt: r.started_at, deadlineAt: r.deadline_at, durationMin: r.duration_min,
    finishedAt: r.finished_at, items: items.map(toPublicItem), results: r.results_json ? JSON.parse(r.results_json) : null, earned: r.earned, max: r.max,
    writtenPending: !!r.written_pending, overtime: r.finished_at !== null && r.finished_at > r.deadline_at + 30_000,
  };
}

/** Grade everything the app can grade itself, record the answers as evidence, and leave written answers waiting for Claude. */
export function submitSitting(db: Db, id: string, answers: Record<string, unknown>, now = new Date()): Sitting {
  const r = loadRow(db, id);
  if (r.finished_at) return getSitting(db, id); // already handed in
  const items = JSON.parse(r.items_json) as Item[];
  const results: ItemResult[] = [];
  tx(db, () => {
    for (const it of items) {
      const a = answers[it.id];
      if (it.type === "mcq") {
        const picked = Array.isArray(a) ? [...new Set(a.filter((n): n is number => Number.isInteger(n) && n >= 0 && n < it.options.length))].sort((x, y) => x - y) : [];
        const answered = picked.length > 0 && (it.kind === "multi" || picked.length === 1);
        const correct = answered && picked.length === it.answer.length && picked.every((v, i) => v === it.answer[i]);
        results.push({ id: it.id, type: "mcq", answered, earned: correct ? it.points : 0, max: it.points, correct, answer: it.answer, explanation: it.explanation, quote: it.quote, picked: answered ? picked : [] });
        if (answered && db.prepare("SELECT 1 FROM questions WHERE id = ?").get(it.refId)) {
          db.prepare("INSERT INTO quiz_answers (run_id, question_id, course, section, picked, correct, attempt, answered_at) VALUES (?, ?, ?, ?, ?, ?, 1, ?)").run(id, it.refId, r.course, it.section, JSON.stringify(picked), correct ? 1 : 0, now.getTime());
        }
      } else if (it.type === "problem") {
        const n = parseNumber(a);
        const correct = n !== undefined && numbersClose(n, it.answer);
        results.push({ id: it.id, type: "problem", answered: n !== undefined, earned: correct ? it.points : 0, max: it.points, correct, answer: it.answer, unit: it.unit, steps: it.steps, quote: it.quote, submitted: n ?? null });
        if (n !== undefined && db.prepare("SELECT 1 FROM problems WHERE id = ?").get(it.refId)) {
          db.prepare("INSERT INTO problem_attempts (problem_id, run_id, course, section, submitted, correct, hinted, attempt, answered_at) VALUES (?, ?, ?, ?, ?, ?, 0, 1, ?)").run(it.refId, id, r.course, it.section, n, correct ? 1 : 0, now.getTime());
        }
      } else {
        const text = typeof a === "string" ? a.trim().slice(0, 4000) : "";
        const blank = text.length === 0;
        results.push({
          id: it.id, type: "written", answered: !blank, earned: 0, max: it.points, graded: blank, text,
          points: blank ? it.rubric.map((p) => ({ id: p.id, text: p.text, met: false, evidence: "", check: "No answer was given." })) : undefined,
        });
      }
    }
    const pending = results.some((x) => x.type === "written" && !x.graded);
    db.prepare("UPDATE exam_sittings SET finished_at = ?, answers_json = ?, results_json = ?, earned = ?, written_pending = ? WHERE id = ?").run(
      now.getTime(), JSON.stringify(answers), JSON.stringify(results), results.reduce((n, x) => n + x.earned, 0), pending ? 1 : 0, id,
    );
  });
  return getSitting(db, id);
}

/** The written answers still waiting for a grade, in the shape the grader takes. `n` numbers the written questions 1, 2, 3 in order. */
export function pendingWritten(db: Db, id: string): GradeInput[] {
  const r = loadRow(db, id);
  if (!r.finished_at) throw new QuizError("Hand in the exam first.");
  const items = JSON.parse(r.items_json) as Item[];
  const results = JSON.parse(r.results_json ?? "[]") as ItemResult[];
  const out: GradeInput[] = [];
  let n = 0;
  for (const it of items) {
    if (it.type !== "written") continue;
    n++;
    const res = results.find((x) => x.id === it.id);
    if (res && !res.graded) out.push({ n, prompt: it.prompt, rubric: it.rubric.map((p) => ({ id: p.id, text: p.text })), answer: res.text ?? "" });
  }
  return out;
}

const writtenNumber = (items: Item[], itemId: string) => {
  let n = 0;
  for (const it of items) {
    if (it.type !== "written") continue;
    n++;
    if (it.id === itemId) return n;
  }
  return 0;
};

/** Save grades from Claude. Only the questions that came back graded change; the rest stay pending and can be retried. */
export function applyWrittenGrades(db: Db, id: string, grades: Map<number, WrittenGrade>): Sitting {
  const r = loadRow(db, id);
  const items = JSON.parse(r.items_json) as Item[];
  const results = JSON.parse(r.results_json ?? "[]") as ItemResult[];
  for (const res of results) {
    if (res.type !== "written" || res.graded) continue;
    const g = grades.get(writtenNumber(items, res.id));
    if (!g) continue;
    res.graded = true;
    res.points = g.points;
    res.earned = g.earned;
    res.max = g.max;
    res.remark = g.remark;
  }
  const pending = results.some((x) => x.type === "written" && !x.graded);
  db.prepare("UPDATE exam_sittings SET results_json = ?, earned = ?, written_pending = ? WHERE id = ?").run(JSON.stringify(results), results.reduce((n, x) => n + x.earned, 0), pending ? 1 : 0, id);
  return getSitting(db, id);
}

/** What the grader needs to look at one graded written answer again after the student contests it. */
export function remarkInput(db: Db, id: string, itemId: string): GradeInput {
  const r = loadRow(db, id);
  const items = JSON.parse(r.items_json) as Item[];
  const results = JSON.parse(r.results_json ?? "[]") as ItemResult[];
  const it = items.find((x) => x.id === itemId);
  const res = results.find((x) => x.id === itemId);
  if (!it || it.type !== "written" || !res || !res.graded) throw new QuizError("Only a graded written answer can be contested.");
  if (res.remarkUsed) throw new QuizError("You've already contested this one. A second look is all you get.");
  if (!res.text) throw new QuizError("There's no written answer to look at again.");
  return { n: writtenNumber(items, itemId), prompt: it.prompt, rubric: it.rubric.map((p) => ({ id: p.id, text: p.text })), answer: res.text };
}

export function applyRemark(db: Db, id: string, itemId: string, grade: WrittenGrade): Sitting {
  const r = loadRow(db, id);
  const results = JSON.parse(r.results_json ?? "[]") as ItemResult[];
  const res = results.find((x) => x.id === itemId);
  if (!res) throw new QuizError("That question isn't in this exam.");
  res.points = grade.points;
  res.earned = grade.earned;
  res.max = grade.max;
  res.remark = grade.remark;
  res.remarkUsed = true;
  db.prepare("UPDATE exam_sittings SET results_json = ?, earned = ? WHERE id = ?").run(JSON.stringify(results), results.reduce((n, x) => n + x.earned, 0), id);
  return getSitting(db, id);
}

// ---------- summaries ----------

export interface SittingSummary {
  earned: number;
  max: number;
  pct: number | null;
  byType: { type: Item["type"]; earned: number; max: number }[];
  byLecture: { noteId: string | null; title: string; earned: number; max: number }[];
}

/** Score by question type and by lecture, so the review says where the points went. */
export function summarize(db: Db, id: string, titleOf: (noteId: string) => string | undefined): SittingSummary {
  const r = loadRow(db, id);
  const items = JSON.parse(r.items_json) as Item[];
  const results = JSON.parse(r.results_json ?? "[]") as ItemResult[];
  const byType = new Map<Item["type"], { earned: number; max: number }>();
  const byNote = new Map<string, { earned: number; max: number }>();
  for (const res of results) {
    const it = items.find((x) => x.id === res.id)!;
    const t = byType.get(res.type) ?? byType.set(res.type, { earned: 0, max: 0 }).get(res.type)!;
    t.earned += res.earned;
    t.max += res.max;
    const k = it.noteId ?? "";
    const n = byNote.get(k) ?? byNote.set(k, { earned: 0, max: 0 }).get(k)!;
    n.earned += res.earned;
    n.max += res.max;
  }
  const earned = results.reduce((n, x) => n + x.earned, 0);
  return {
    earned, max: r.max, pct: r.max ? Math.round((100 * earned) / r.max) : null,
    byType: [...byType.entries()].map(([type, v]) => ({ type, ...v })),
    byLecture: [...byNote.entries()].map(([noteId, v]) => ({ noteId: noteId || null, title: (noteId && titleOf(noteId)) || "Other", ...v })).sort((a, b) => a.earned / a.max - b.earned / b.max),
  };
}

export function listSittings(db: Db, course: string, limit = 20): { id: string; name: string; course: string; startedAt: number; finishedAt: number | null; earned: number | null; max: number; pct: number | null; writtenPending: boolean }[] {
  const rows = db
    .prepare(`SELECT * FROM exam_sittings WHERE ${course === "all" ? "1=1" : "course = ?"} ORDER BY started_at DESC LIMIT ?`)
    .all(...(course === "all" ? [] : [course]), limit) as unknown as SittingRow[];
  return rows.map((r) => ({ id: r.id, name: r.name, course: r.course, startedAt: r.started_at, finishedAt: r.finished_at, earned: r.earned, max: r.max, pct: r.earned !== null && r.max ? Math.round((100 * r.earned) / r.max) : null, writtenPending: !!r.written_pending }));
}
