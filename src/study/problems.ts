import { randomUUID } from "node:crypto";
import type { Db } from "../library/db.js";
import { tx } from "./db.js";
import { numbersClose, parseNumber, type Given, type GeneratedProblem, type Step } from "./problemgen.js";
import { QuizError } from "./questions.js";

const DAY = 86_400_000;
const startOfDay = (ms: number) => new Date(new Date(ms).setHours(0, 0, 0, 0)).getTime();
const scope = (course: string, col = "course") => (course === "all" ? { sql: "1=1", args: [] as string[] } : { sql: `${col} = ?`, args: [course] });

export interface ProblemRow {
  id: string;
  course: string;
  noteId: string | null;
  section: string | null;
  stem: string;
  givens: Given[];
  steps: Step[];
  unit: string;
  difficulty: 1 | 2 | 3;
  answer: number;
  quote: string | null;
  createdAt: number;
}

/** What the practice screen gets: the problem and the label of its first step as a hint, but no numbers from the solution. */
export interface PublicProblem {
  id: string;
  course: string;
  noteId: string | null;
  section: string | null;
  stem: string;
  unit: string;
  difficulty: 1 | 2 | 3;
  hint: { label: string; explain: string };
}

function toRow(r: any): ProblemRow {
  return {
    id: r.id, course: r.course, noteId: r.note_id, section: r.section, stem: r.stem, givens: JSON.parse(r.givens), steps: JSON.parse(r.steps),
    unit: r.unit, difficulty: r.difficulty, answer: r.answer, quote: r.quote, createdAt: r.created_at,
  };
}

const toPublic = (p: ProblemRow): PublicProblem => ({
  id: p.id, course: p.course, noteId: p.noteId, section: p.section, stem: p.stem, unit: p.unit, difficulty: p.difficulty,
  hint: { label: p.steps[0].label, explain: p.steps[0].explain },
});

// ---------- the bank ----------

export function existingProblemStems(db: Db, course: string): string[] {
  return (db.prepare("SELECT stem FROM problems WHERE course = ?").all(course) as { stem: string }[]).map((r) => r.stem);
}

export function addGeneratedProblems(db: Db, note: { id: string; course: string }, version: string, problems: GeneratedProblem[], now = new Date()): number {
  tx(db, () => {
    const insert = db.prepare(
      `INSERT INTO problems (id, course, note_id, section, stem, givens, steps, unit, difficulty, answer, quote, note_version, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    problems.forEach((p, i) =>
      insert.run(randomUUID(), note.course, note.id, p.section, p.stem, JSON.stringify(p.givens), JSON.stringify(p.steps), p.unit, p.difficulty, p.answer, p.quote, version, now.getTime() + i),
    );
  });
  return problems.length;
}

export function getProblem(db: Db, id: string): ProblemRow | undefined {
  const r = db.prepare("SELECT * FROM problems WHERE id = ?").get(id);
  return r ? toRow(r) : undefined;
}

export interface ProblemWithStats extends ProblemRow {
  asked: number;
  right: number;
}

export function listProblems(db: Db, course: string, limit = 200): ProblemWithStats[] {
  const sc = scope(course, "p.course");
  return (
    db
      .prepare(
        `SELECT p.*, COUNT(a.id) asked, COALESCE(SUM(a.correct), 0) n_right
         FROM problems p LEFT JOIN problem_attempts a ON a.problem_id = p.id AND a.attempt = 1
         WHERE ${sc.sql} GROUP BY p.id ORDER BY p.course, p.note_id, p.created_at LIMIT ?`,
      )
      .all(...sc.args, limit) as any[]
  ).map((r) => ({ ...toRow(r), asked: Number(r.asked), right: Number(r.n_right) }));
}

export function deleteProblem(db: Db, id: string): boolean {
  return db.prepare("DELETE FROM problems WHERE id = ?").run(id).changes > 0;
}

export function logProblemGeneration(db: Db, noteId: string, version: string, created: number, calls: number, now = new Date()) {
  db.prepare("INSERT OR REPLACE INTO problem_gen_log (note_id, note_version, at, created, calls) VALUES (?, ?, ?, ?, ?)").run(noteId, version, now.getTime(), created, calls);
}

export function problemCoverage(db: Db): Map<string, { problems: number; versions: string[] }> {
  const out = new Map<string, { problems: number; versions: string[] }>();
  const get = (id: string) => out.get(id) ?? out.set(id, { problems: 0, versions: [] }).get(id)!;
  const add = (c: { versions: string[] }, v: string | null) => {
    if (v && !c.versions.includes(v)) c.versions.push(v);
  };
  for (const r of db.prepare("SELECT note_id, note_version, COUNT(*) n FROM problems WHERE note_id IS NOT NULL GROUP BY note_id, note_version").all() as { note_id: string; note_version: string | null; n: number }[]) {
    const c = get(r.note_id);
    c.problems += Number(r.n);
    add(c, r.note_version);
  }
  for (const r of db.prepare("SELECT note_id, note_version FROM problem_gen_log").all() as { note_id: string; note_version: string }[]) add(get(r.note_id), r.note_version);
  return out;
}

// ---------- a practice session ----------

/** Pick problems: never-seen first, then last-missed, then the rest, each group shuffled, optionally limited to some lectures. */
export function startPractice(db: Db, o: { course: string; noteIds?: string[]; length?: number }, now = new Date(), rand: () => number = Math.random): { runId: string; problems: PublicProblem[] } {
  const length = Math.max(1, Math.min(30, Math.floor(o.length ?? 5)));
  const sc = scope(o.course, "p.course");
  const rows = db
    .prepare(
      `SELECT p.*,
              (SELECT COUNT(*) FROM problem_attempts a WHERE a.problem_id = p.id) seen,
              (SELECT a.correct FROM problem_attempts a WHERE a.problem_id = p.id ORDER BY a.answered_at DESC, a.id DESC LIMIT 1) last_correct
       FROM problems p WHERE ${sc.sql}`,
    )
    .all(...sc.args) as any[];
  const pool = rows.filter((r) => !o.noteIds || o.noteIds.includes(r.note_id));
  if (!pool.length) throw new QuizError(o.noteIds?.length ? "None of those lectures have practice problems yet." : "No practice problems yet. Make some from your lectures first.");
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
  const problems = shuffle(picked).map((r) => toPublic(toRow(r)));
  const runId = randomUUID();
  db.prepare("INSERT INTO quiz_runs (id, course, started_at, total) VALUES (?, ?, ?, ?)").run(runId, o.course, now.getTime(), problems.length);
  return { runId, problems };
}

export interface ProblemResult {
  correct: boolean;
  attempt: number;
  answer: number;
  unit: string;
  steps: Step[];
  quote: string | null;
  noteId: string | null;
  /** How far off, as a share of the right answer, when wrong and a number was given. */
  off: number | null;
}

/** Check a numeric answer, record it, and only now reveal the worked solution. `submitted: null` means the student gave up. */
export function answerProblem(db: Db, o: { runId: string; problemId: string; submitted: unknown; hinted?: boolean; gaveUp?: boolean; msTaken?: number }, now = new Date()): ProblemResult {
  const run = db.prepare("SELECT id FROM quiz_runs WHERE id = ?").get(o.runId);
  if (!run) throw new QuizError("That practice session isn't running any more. Start a new one.");
  const p = getProblem(db, o.problemId);
  if (!p) throw new QuizError("That problem was deleted.");
  let submitted: number | null = null;
  if (!o.gaveUp) {
    const n = parseNumber(o.submitted);
    if (n === undefined) throw new QuizError("Type a number, like 250 or 12.5 (a $ or % sign is fine).");
    submitted = n;
  }
  const correct = submitted !== null && numbersClose(submitted, p.answer);
  const prior = Number((db.prepare("SELECT COUNT(*) n FROM problem_attempts WHERE run_id = ? AND problem_id = ?").get(o.runId, p.id) as { n: number }).n);
  db.prepare("INSERT INTO problem_attempts (problem_id, run_id, course, section, submitted, correct, hinted, attempt, answered_at, ms_taken) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").run(
    p.id, o.runId, p.course, p.section, submitted, correct ? 1 : 0, o.hinted ? 1 : 0, prior + 1, now.getTime(), Number.isFinite(o.msTaken) ? Math.round(o.msTaken!) : null,
  );
  const off = submitted !== null && !correct && p.answer !== 0 ? Math.abs(submitted - p.answer) / Math.abs(p.answer) : null;
  return { correct, attempt: prior + 1, answer: p.answer, unit: p.unit, steps: p.steps, quote: p.quote, noteId: p.noteId, off };
}

export interface PracticeSummary {
  runId: string;
  total: number;
  correct: number;
  pct: number | null;
  /** Solved on the first try without opening the hint */
  unaided: number;
  missed: { id: string; stem: string }[];
  recovered: number;
  seconds: number;
}

export function finishPractice(db: Db, runId: string, now = new Date()): PracticeSummary {
  const run = db.prepare("SELECT * FROM quiz_runs WHERE id = ?").get(runId) as { id: string; started_at: number; finished_at: number | null } | undefined;
  if (!run) throw new QuizError("That practice session isn't running any more.");
  const first = db
    .prepare("SELECT a.problem_id, a.correct, a.hinted, p.stem FROM problem_attempts a JOIN problems p ON p.id = a.problem_id WHERE a.run_id = ? AND a.attempt = 1 ORDER BY a.id")
    .all(runId) as { problem_id: string; correct: number; hinted: number; stem: string }[];
  const missed = first.filter((r) => !r.correct);
  const recovered = missed.filter((m) => db.prepare("SELECT 1 FROM problem_attempts WHERE run_id = ? AND problem_id = ? AND attempt > 1 AND correct = 1").get(runId, m.problem_id)).length;
  const finishedAt = run.finished_at ?? now.getTime();
  if (!run.finished_at) db.prepare("UPDATE quiz_runs SET finished_at = ? WHERE id = ?").run(finishedAt, runId);
  const correct = first.length - missed.length;
  return {
    runId, total: first.length, correct, pct: first.length ? Math.round((100 * correct) / first.length) : null,
    unaided: first.filter((r) => r.correct && !r.hinted).length,
    missed: missed.map((m) => ({ id: m.problem_id, stem: m.stem })), recovered,
    seconds: Math.max(1, Math.round((finishedAt - run.started_at) / 1000)),
  };
}

export function problemCounts(db: Db, course: string): { total: number; seen: number } {
  const sc = scope(course, "p.course");
  const r = db
    .prepare(`SELECT COUNT(*) total, SUM(CASE WHEN EXISTS (SELECT 1 FROM problem_attempts a WHERE a.problem_id = p.id) THEN 1 ELSE 0 END) seen FROM problems p WHERE ${sc.sql}`)
    .get(...sc.args) as { total: number; seen: number | null };
  return { total: Number(r.total), seen: Number(r.seen ?? 0) };
}

export function problemAccuracy(db: Db, course: string, now = new Date(), days = 7): { answers: number; correct: number; pct: number | null } {
  const sc = scope(course);
  const r = db
    .prepare(`SELECT COUNT(*) n, SUM(correct) ok FROM problem_attempts WHERE ${sc.sql} AND attempt = 1 AND answered_at >= ?`)
    .get(...sc.args, startOfDay(now.getTime()) - (days - 1) * DAY) as { n: number; ok: number | null };
  const answers = Number(r.n);
  const correct = Number(r.ok ?? 0);
  return { answers, correct, pct: answers ? Math.round((100 * correct) / answers) : null };
}
