import fs from "node:fs";
import path from "node:path";
import { LOGIN_FIX, checkAuth, checkClaude, friendlyError, runClaude, type Runner } from "../claude.js";
import { DEFAULT_COURSES } from "../courses.js";
import { SAMPLE_DIR, type Note } from "../notes.js";
import { DATA_DIR } from "../paths.js";
import type { Density } from "../study/cardgen.js";
import { Q_REJECT_LABEL, generateQuestionsForNote, hasLengthTell, longestIsRightShare, type GeneratedQuestion, type QKind, type QRejected, type QRejectReason } from "../study/quizgen.js";
import { pickEvalNotes } from "./cards.js";

export interface QuizNoteEval {
  note: string;
  ok: boolean;
  error?: string;
  accepted: GeneratedQuestion[];
  rejected: Partial<Record<QRejectReason, number>>;
  /** Each rejected question with the reason, so the report can be read. */
  rejectedItems: QRejected[];
  /** Questions that reached the second solve */
  checked: number;
  calls: number;
  seconds: number;
  costUsd: number;
}

export interface QuizEvalSummary {
  notes: number;
  failedNotes: number;
  kept: number;
  rejected: number;
  rejectedByReason: Partial<Record<QRejectReason, number>>;
  /** kept / (kept + every rejection except duplicates) */
  keepRate: number;
  /** Of the questions that passed the gate, the share the blind second solve confirmed. */
  secondSolveAgreement: number;
  perNote: number;
  byKind: Record<QKind, number>;
  /** How often the right answer sat in each position (single and multi-select only), A first. */
  answerPositions: number[];
  /** Share of single-answer questions whose right option is clearly the longest. */
  lengthTellRate: number;
  /** Share of single-answer questions whose right option is the longest (chance is 25%). */
  longestIsRight: number;
  calls: number;
  secondsPerNote: number;
  costUsd: number;
}

export function summarizeQuizEval(rows: QuizNoteEval[]): QuizEvalSummary {
  const ok = rows.filter((r) => r.ok);
  const rejectedByReason: Partial<Record<QRejectReason, number>> = {};
  for (const r of ok) for (const [k, v] of Object.entries(r.rejected)) rejectedByReason[k as QRejectReason] = (rejectedByReason[k as QRejectReason] ?? 0) + (v ?? 0);
  const questions = ok.flatMap((r) => r.accepted);
  const kept = questions.length;
  const rejected = Object.values(rejectedByReason).reduce((n, v) => n + (v ?? 0), 0);
  const considered = kept + rejected - (rejectedByReason.duplicate ?? 0);
  const checked = ok.reduce((n, r) => n + r.checked, 0);
  const byKind: Record<QKind, number> = { single: 0, multi: 0, tf: 0 };
  const positions = [0, 0, 0, 0, 0];
  for (const q of questions) {
    byKind[q.kind]++;
    if (q.kind !== "tf") for (const a of q.answer) positions[a]++;
  }
  const singles = questions.filter((q) => q.kind === "single");
  return {
    notes: rows.length,
    failedNotes: rows.length - ok.length,
    kept,
    rejected,
    rejectedByReason,
    keepRate: considered ? kept / considered : 0,
    secondSolveAgreement: checked ? kept / checked : 0,
    perNote: ok.length ? kept / ok.length : 0,
    byKind,
    answerPositions: positions,
    lengthTellRate: singles.length ? singles.filter(hasLengthTell).length / singles.length : 0,
    longestIsRight: longestIsRightShare(questions),
    calls: rows.reduce((n, r) => n + r.calls, 0),
    secondsPerNote: rows.length ? rows.reduce((n, r) => n + r.seconds, 0) / rows.length : 0,
    costUsd: rows.reduce((n, r) => n + r.costUsd, 0),
  };
}

export async function evalQuizNote(note: Note, runner: Runner, density: Density = "normal"): Promise<QuizNoteEval> {
  const started = Date.now();
  const label = `${note.course} ${note.date} ${note.title}`;
  try {
    const r = await generateQuestionsForNote({ runner, note, courses: DEFAULT_COURSES, density, existingStems: [] });
    const rejected: Partial<Record<QRejectReason, number>> = {};
    for (const x of r.rejected) rejected[x.reason] = (rejected[x.reason] ?? 0) + 1;
    return { note: label, ok: true, accepted: r.accepted, rejected, rejectedItems: r.rejected, checked: r.checked, calls: r.calls, seconds: (Date.now() - started) / 1000, costUsd: r.costUsd };
  } catch (e) {
    return { note: label, ok: false, error: friendlyError(e), accepted: [], rejected: {}, rejectedItems: [], checked: 0, calls: 1, seconds: (Date.now() - started) / 1000, costUsd: 0 };
  }
}

export async function evalQuizAll(notes: Note[], runner: Runner, concurrency = 3, onDone?: (r: QuizNoteEval) => void): Promise<QuizNoteEval[]> {
  const out: QuizNoteEval[] = new Array(notes.length);
  let next = 0;
  const worker = async () => {
    while (next < notes.length) {
      const i = next++;
      out[i] = await evalQuizNote(notes[i], runner);
      onDone?.(out[i]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, notes.length) }, worker));
  return out;
}

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function main() {
  const c = checkClaude();
  if (!c.ok) {
    console.error(`\n✖ ${c.error}\n`);
    process.exit(1);
  }
  if (!checkAuth().loggedIn) {
    console.error(`\n✖ Claude Code isn't logged in. ${LOGIN_FIX}\n`);
    process.exit(2);
  }
  const notes = pickEvalNotes(SAMPLE_DIR, Number(arg("per-class") ?? 2));
  const min = Number(arg("min") ?? 0.6);
  console.log(`Writing and double-checking quiz questions for ${notes.length} sample lectures (3 at a time)…\n`);
  const rows = await evalQuizAll(notes, runClaude, 3, (r) => {
    const why = Object.entries(r.rejected).map(([k, v]) => `${v} ${k}`).join(", ");
    console.log(`${r.ok ? "✓" : "✗"} ${r.note.slice(0, 52).padEnd(52)} ${String(r.accepted.length).padStart(2)} kept of ${String(r.checked).padStart(2)} checked  ${r.seconds.toFixed(1).padStart(5)}s${why ? `  dropped: ${why}` : ""}${r.error ? `  ${r.error}` : ""}`);
  });
  const s = summarizeQuizEval(rows);
  const pct = (x: number) => `${(100 * x).toFixed(0)}%`;
  console.log(`\n${s.kept} questions kept, ${s.rejected} dropped · keep rate ${pct(s.keepRate)} · ${s.perNote.toFixed(1)} per lecture · ${s.secondsPerNote.toFixed(1)}s per lecture · ${s.calls} calls · ~$${s.costUsd.toFixed(2)}`);
  console.log(`  mix: ${s.byKind.single} single, ${s.byKind.multi} select-all, ${s.byKind.tf} true/false`);
  console.log(`  second solve agreed with the key on ${pct(s.secondSolveAgreement)} of the questions that reached it`);
  console.log(`  right answer by position A–E: ${s.answerPositions.join(" / ")}   ·   right option is the longest: ${pct(s.longestIsRight)} of single-answer questions (chance is 25%), clearly the longest: ${pct(s.lengthTellRate)}`);
  for (const [k, v] of Object.entries(s.rejectedByReason)) console.log(`  dropped for “${Q_REJECT_LABEL[k as QRejectReason]}”: ${v}`);
  if (s.failedNotes) console.log(`⚠ ${s.failedNotes} lecture(s) failed entirely`);
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const file = path.join(DATA_DIR, "quiz-eval-report.json");
  fs.writeFileSync(file, JSON.stringify({ at: new Date().toISOString(), summary: s, rows }, null, 2));
  console.log(`\nEvery kept question is in ${file} so you can read them.`);
  process.exit(s.keepRate >= min && !s.failedNotes ? 0 : 1);
}

if (process.argv[1] && path.resolve(process.argv[1]) === new URL(import.meta.url).pathname) main();
