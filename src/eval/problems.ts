import fs from "node:fs";
import path from "node:path";
import { LOGIN_FIX, checkAuth, checkClaude, friendlyError, runClaude, type Runner } from "../claude.js";
import { DEFAULT_COURSES } from "../courses.js";
import { SAMPLE_DIR, type Note } from "../notes.js";
import { DATA_DIR } from "../paths.js";
import { P_REJECT_LABEL, generateProblemsForNote, type GeneratedProblem, type PRejectReason, type PRejected } from "../study/problemgen.js";
import { pickEvalNotes } from "./cards.js";

export interface ProblemNoteEval {
  note: string;
  ok: boolean;
  error?: string;
  accepted: GeneratedProblem[];
  rejected: PRejected[];
  checked: number;
  calls: number;
  seconds: number;
  costUsd: number;
}

export interface ProblemEvalSummary {
  notes: number;
  failedNotes: number;
  kept: number;
  rejectedByReason: Partial<Record<PRejectReason, number>>;
  /** Of the problems that passed the gate, the share the blind second solve confirmed. */
  secondSolveAgreement: number;
  byDifficulty: Record<1 | 2 | 3, number>;
  calls: number;
  costUsd: number;
}

export function summarizeProblemEval(rows: ProblemNoteEval[]): ProblemEvalSummary {
  const ok = rows.filter((r) => r.ok);
  const rejectedByReason: Partial<Record<PRejectReason, number>> = {};
  for (const r of ok) for (const x of r.rejected) rejectedByReason[x.reason] = (rejectedByReason[x.reason] ?? 0) + 1;
  const kept = ok.flatMap((r) => r.accepted);
  const checked = ok.reduce((n, r) => n + r.checked, 0);
  const byDifficulty: Record<1 | 2 | 3, number> = { 1: 0, 2: 0, 3: 0 };
  for (const p of kept) byDifficulty[p.difficulty]++;
  return {
    notes: rows.length,
    failedNotes: rows.length - ok.length,
    kept: kept.length,
    rejectedByReason,
    secondSolveAgreement: checked ? kept.length / checked : 0,
    byDifficulty,
    calls: rows.reduce((n, r) => n + r.calls, 0),
    costUsd: rows.reduce((n, r) => n + r.costUsd, 0),
  };
}

export async function evalProblemNote(note: Note, runner: Runner): Promise<ProblemNoteEval> {
  const started = Date.now();
  const label = `${note.course} ${note.date} ${note.title}`;
  try {
    const r = await generateProblemsForNote({ runner, note, courses: DEFAULT_COURSES, density: "normal", existingStems: [] });
    return { note: label, ok: true, accepted: r.accepted, rejected: r.rejected, checked: r.checked, calls: r.calls, seconds: (Date.now() - started) / 1000, costUsd: r.costUsd };
  } catch (e) {
    return { note: label, ok: false, error: friendlyError(e), accepted: [], rejected: [], checked: 0, calls: 1, seconds: (Date.now() - started) / 1000, costUsd: 0 };
  }
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
  const notes = pickEvalNotes(SAMPLE_DIR, 2);
  console.log(`Writing, computing and double-checking problems for ${notes.length} sample lectures…\n`);
  const rows = await Promise.all(notes.map((n) => evalProblemNote(n, runClaude)));
  for (const r of rows) {
    const why = r.rejected.map((x) => x.reason).join(", ");
    console.log(`${r.ok ? "✓" : "✗"} ${r.note.slice(0, 52).padEnd(52)} ${r.accepted.length} kept of ${r.checked} checked  ${r.seconds.toFixed(1)}s${why ? `  dropped: ${why}` : ""}${r.error ? `  ${r.error}` : ""}`);
  }
  const s = summarizeProblemEval(rows);
  console.log(`\n${s.kept} problems kept · second solve agreed on ${(100 * s.secondSolveAgreement).toFixed(0)}% · difficulty 1/2/3: ${s.byDifficulty[1]}/${s.byDifficulty[2]}/${s.byDifficulty[3]} · ${s.calls} calls · ~$${s.costUsd.toFixed(2)}`);
  for (const [k, v] of Object.entries(s.rejectedByReason)) console.log(`  dropped for “${P_REJECT_LABEL[k as PRejectReason]}”: ${v}`);
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const file = path.join(DATA_DIR, "problems-eval-report.json");
  fs.writeFileSync(file, JSON.stringify({ at: new Date().toISOString(), summary: s, rows }, null, 2));
  console.log(`\nEvery kept and dropped problem is in ${file}.`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === new URL(import.meta.url).pathname) main();
