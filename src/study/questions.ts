import { randomUUID } from "node:crypto";
import type { Db } from "../library/db.js";
import { tx } from "./db.js";
import type { GeneratedQuestion, QKind } from "./quizgen.js";

const DAY = 86_400_000;
const startOfDay = (ms: number) => new Date(new Date(ms).setHours(0, 0, 0, 0)).getTime();

export class QuizError extends Error {}

/** Scope clause: one class, or every class when course is "all". */
const scope = (course: string, col = "course") => (course === "all" ? { sql: "1=1", args: [] as string[] } : { sql: `${col} = ?`, args: [course] });

export interface QuestionRow {
  id: string;
  course: string;
  noteId: string | null;
  section: string | null;
  kind: QKind;
  stem: string;
  options: string[];
  answer: number[];
  explanation: string;
  quote: string | null;
  createdAt: number;
}

/** A question as the quiz player sees it: no key, no explanation, no quote until it has been answered. */
export interface PublicQuestion {
  id: string;
  course: string;
  noteId: string | null;
  section: string | null;
  kind: QKind;
  stem: string;
  options: string[];
}

function toRow(r: any): QuestionRow {
  return {
    id: r.id, course: r.course, noteId: r.note_id, section: r.section, kind: r.kind, stem: r.stem,
    options: JSON.parse(r.options), answer: JSON.parse(r.answer), explanation: r.explanation, quote: r.quote, createdAt: r.created_at,
  };
}

const toPublic = (q: QuestionRow): PublicQuestion => ({ id: q.id, course: q.course, noteId: q.noteId, section: q.section, kind: q.kind, stem: q.stem, options: q.options });

// ---------- the bank ----------

/** Stems of every question in a class, so a new batch can skip questions you already have. */
export function existingStems(db: Db, course: string): string[] {
  return (db.prepare("SELECT stem FROM questions WHERE course = ?").all(course) as { stem: string }[]).map((r) => r.stem);
}

/** Save verified questions for one lecture. Existing questions (and their answer history) are never touched. */
export function addGeneratedQuestions(db: Db, note: { id: string; course: string }, version: string, questions: GeneratedQuestion[], now = new Date()): number {
  tx(db, () => {
    const insert = db.prepare(
      `INSERT INTO questions (id, course, note_id, section, kind, stem, options, answer, explanation, quote, note_version, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    // Increasing timestamps keep a lecture's questions in the order they were written.
    questions.forEach((q, i) =>
      insert.run(randomUUID(), note.course, note.id, q.section, q.kind, q.stem, JSON.stringify(q.options), JSON.stringify(q.answer), q.explanation, q.quote, version, now.getTime() + i),
    );
  });
  return questions.length;
}

export function getQuestion(db: Db, id: string): QuestionRow | undefined {
  const r = db.prepare("SELECT * FROM questions WHERE id = ?").get(id);
  return r ? toRow(r) : undefined;
}

export interface QuestionWithStats extends QuestionRow {
  /** First-try results only. */
  asked: number;
  right: number;
}

export function listQuestions(db: Db, course: string, limit = 200): QuestionWithStats[] {
  const sc = scope(course, "q.course");
  return (
    db
      .prepare(
        `SELECT q.*, COUNT(a.id) asked, COALESCE(SUM(a.correct), 0) n_right
         FROM questions q LEFT JOIN quiz_answers a ON a.question_id = q.id AND a.attempt = 1
         WHERE ${sc.sql} GROUP BY q.id ORDER BY q.course, q.note_id, q.created_at LIMIT ?`,
      )
      .all(...sc.args, limit) as any[]
  ).map((r) => ({ ...toRow(r), asked: Number(r.asked), right: Number(r.n_right) }));
}

export function deleteQuestion(db: Db, id: string): boolean {
  return db.prepare("DELETE FROM questions WHERE id = ?").run(id).changes > 0;
}

export interface QuestionCoverage {
  questions: number;
  /** Every version of the note that has been processed into questions */
  versions: string[];
}

/** Record that this version of a lecture has been processed (even if every new question was a duplicate or was dropped). */
export function logQuestionGeneration(db: Db, noteId: string, version: string, created: number, calls: number, now = new Date()) {
  db.prepare("INSERT OR REPLACE INTO question_gen_log (note_id, note_version, at, created, calls) VALUES (?, ?, ?, ?, ?)").run(noteId, version, now.getTime(), created, calls);
}

/** For each lecture that has been processed: how many questions it has, and which versions of the note were used. */
export function questionCoverage(db: Db): Map<string, QuestionCoverage> {
  const out = new Map<string, QuestionCoverage>();
  const get = (id: string) => out.get(id) ?? out.set(id, { questions: 0, versions: [] }).get(id)!;
  const add = (c: QuestionCoverage, v: string | null) => {
    if (v && !c.versions.includes(v)) c.versions.push(v);
  };
  for (const r of db.prepare("SELECT note_id, note_version, COUNT(*) n FROM questions WHERE note_id IS NOT NULL GROUP BY note_id, note_version").all() as { note_id: string; note_version: string | null; n: number }[]) {
    const c = get(r.note_id);
    c.questions += Number(r.n);
    add(c, r.note_version);
  }
  for (const r of db.prepare("SELECT note_id, note_version FROM question_gen_log").all() as { note_id: string; note_version: string }[]) add(get(r.note_id), r.note_version);
  return out;
}

// ---------- a quiz sitting ----------

export interface QuizStart {
  runId: string;
  questions: PublicQuestion[];
}

/**
 * Pick questions for a quiz: ones you have never seen first, then ones you last got wrong, then the rest, each group in
 * random order. Optionally limited to some lectures.
 */
export function startQuiz(
  db: Db,
  o: { course: string; noteIds?: string[]; length?: number },
  now = new Date(),
  rand: () => number = Math.random,
): QuizStart {
  const length = Math.max(1, Math.min(50, Math.floor(o.length ?? 10)));
  const sc = scope(o.course, "q.course");
  const rows = db
    .prepare(
      `SELECT q.*,
              (SELECT COUNT(*) FROM quiz_answers a WHERE a.question_id = q.id) seen,
              (SELECT a.correct FROM quiz_answers a WHERE a.question_id = q.id ORDER BY a.answered_at DESC, a.id DESC LIMIT 1) last_correct
       FROM questions q WHERE ${sc.sql}`,
    )
    .all(...sc.args) as any[];
  const pool = rows.filter((r) => !o.noteIds || o.noteIds.includes(r.note_id));
  if (!pool.length) throw new QuizError(o.noteIds?.length ? "None of those lectures have quiz questions yet." : "No quiz questions yet. Make some from your lectures first.");

  const shuffle = <T>(a: T[]): T[] => {
    const x = [...a];
    for (let i = x.length - 1; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1));
      [x[i], x[j]] = [x[j], x[i]];
    }
    return x;
  };
  const unseen = shuffle(pool.filter((r) => Number(r.seen) === 0));
  const missed = shuffle(pool.filter((r) => Number(r.seen) > 0 && r.last_correct === 0));
  const rest = shuffle(pool.filter((r) => Number(r.seen) > 0 && r.last_correct !== 0));
  const picked = [...unseen, ...missed, ...rest].slice(0, length);
  // Mix the order so the quiz isn't "all new, then all old".
  const questions = shuffle(picked).map((r) => toPublic(toRow(r)));

  const runId = randomUUID();
  db.prepare("INSERT INTO quiz_runs (id, course, started_at, total) VALUES (?, ?, ?, ?)").run(runId, o.course, now.getTime(), questions.length);
  return { runId, questions };
}

export interface AnswerResult {
  correct: boolean;
  /** 1 on the first time this question comes up in the run; 2+ when it is asked again after a miss. */
  attempt: number;
  answer: number[];
  explanation: string;
  quote: string | null;
  noteId: string | null;
}

/** Check an answer, record it, and only now reveal the key, the explanation and the receipt. */
export function answerQuestion(db: Db, o: { runId: string; questionId: string; picked: unknown; msTaken?: number }, now = new Date()): AnswerResult {
  const run = db.prepare("SELECT id, course FROM quiz_runs WHERE id = ?").get(o.runId) as { id: string; course: string } | undefined;
  if (!run) throw new QuizError("That quiz isn't running any more. Start a new one.");
  const q = getQuestion(db, o.questionId);
  if (!q) throw new QuizError("That question was deleted.");
  if (!Array.isArray(o.picked) || !o.picked.length || !o.picked.every((n) => Number.isInteger(n) && n >= 0 && n < q.options.length)) throw new QuizError("Pick an answer first.");
  const picked = [...new Set(o.picked as number[])].sort((a, b) => a - b);
  if (q.kind !== "multi" && picked.length !== 1) throw new QuizError("Pick one answer.");
  const correct = picked.length === q.answer.length && picked.every((v, i) => v === q.answer[i]);
  const prior = Number((db.prepare("SELECT COUNT(*) n FROM quiz_answers WHERE run_id = ? AND question_id = ?").get(o.runId, q.id) as { n: number }).n);
  db.prepare("INSERT INTO quiz_answers (run_id, question_id, course, section, picked, correct, attempt, answered_at, ms_taken) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)").run(
    o.runId, q.id, q.course, q.section, JSON.stringify(picked), correct ? 1 : 0, prior + 1, now.getTime(), Number.isFinite(o.msTaken) ? Math.round(o.msTaken!) : null,
  );
  return { correct, attempt: prior + 1, answer: q.answer, explanation: q.explanation, quote: q.quote, noteId: q.noteId };
}

export interface QuizSummary {
  runId: string;
  /** Questions answered at least once (first tries). */
  total: number;
  correct: number;
  pct: number | null;
  bySection: { section: string; course: string; asked: number; right: number }[];
  missed: { id: string; stem: string }[];
  /** Missed questions that were answered correctly when asked again in the same run. */
  recovered: number;
  seconds: number;
}

/** Score a quiz by first tries only, and mark it finished. Safe to call more than once. */
export function finishQuiz(db: Db, runId: string, now = new Date()): QuizSummary {
  const run = db.prepare("SELECT * FROM quiz_runs WHERE id = ?").get(runId) as { id: string; started_at: number; finished_at: number | null } | undefined;
  if (!run) throw new QuizError("That quiz isn't running any more.");
  const first = db
    .prepare("SELECT a.question_id, a.correct, a.section, a.course, q.stem FROM quiz_answers a JOIN questions q ON q.id = a.question_id WHERE a.run_id = ? AND a.attempt = 1 ORDER BY a.id")
    .all(runId) as { question_id: string; correct: number; section: string | null; course: string; stem: string }[];
  const missed = first.filter((r) => !r.correct);
  const recovered = missed.filter((m) => db.prepare("SELECT 1 FROM quiz_answers WHERE run_id = ? AND question_id = ? AND attempt > 1 AND correct = 1").get(runId, m.question_id)).length;
  const sections = new Map<string, { section: string; course: string; asked: number; right: number }>();
  for (const r of first) {
    const key = `${r.course}|${r.section ?? ""}`;
    const s = sections.get(key) ?? sections.set(key, { section: r.section ?? "General", course: r.course, asked: 0, right: 0 }).get(key)!;
    s.asked++;
    s.right += r.correct;
  }
  const finishedAt = run.finished_at ?? now.getTime();
  if (!run.finished_at) db.prepare("UPDATE quiz_runs SET finished_at = ? WHERE id = ?").run(finishedAt, runId);
  const correct = first.length - missed.length;
  return {
    runId,
    total: first.length,
    correct,
    pct: first.length ? Math.round((100 * correct) / first.length) : null,
    bySection: [...sections.values()].sort((a, b) => a.right / a.asked - b.right / b.asked || b.asked - a.asked),
    missed: missed.map((m) => ({ id: m.question_id, stem: m.stem })),
    recovered,
    seconds: Math.max(1, Math.round((finishedAt - run.started_at) / 1000)),
  };
}

// ---------- stats for the dashboard ----------

export interface QuizCounts {
  total: number;
  /** Questions answered at least once */
  seen: number;
}

export function quizCounts(db: Db, course: string): QuizCounts {
  const sc = scope(course, "q.course");
  const r = db
    .prepare(`SELECT COUNT(*) total, SUM(CASE WHEN EXISTS (SELECT 1 FROM quiz_answers a WHERE a.question_id = q.id) THEN 1 ELSE 0 END) seen FROM questions q WHERE ${sc.sql}`)
    .get(...sc.args) as { total: number; seen: number | null };
  return { total: Number(r.total), seen: Number(r.seen ?? 0) };
}

/** First-try accuracy over the last `days` days. */
export function quizAccuracy(db: Db, course: string, now = new Date(), days = 7): { answers: number; correct: number; pct: number | null } {
  const sc = scope(course);
  const r = db
    .prepare(`SELECT COUNT(*) n, SUM(correct) ok FROM quiz_answers WHERE ${sc.sql} AND attempt = 1 AND answered_at >= ?`)
    .get(...sc.args, startOfDay(now.getTime()) - (days - 1) * DAY) as { n: number; ok: number | null };
  const answers = Number(r.n);
  const correct = Number(r.ok ?? 0);
  return { answers, correct, pct: answers ? Math.round((100 * correct) / answers) : null };
}
