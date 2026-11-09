import fs from "node:fs";
import path from "node:path";
import { LOGIN_FIX, checkAuth, checkClaude, friendlyError, runClaude, type Runner } from "../claude.js";
import { DEFAULT_COURSES } from "../courses.js";
import { SAMPLE_DIR, loadNotes, type Note } from "../notes.js";
import { DATA_DIR } from "../paths.js";
import { REJECT_LABEL, generateCardsForNote, type CardGenResult, type Density, type RejectReason } from "../study/cardgen.js";

/** A small fixed set of sample lectures (two each from the quantitative classes), so runs are comparable over time. */
export function pickEvalNotes(dir = SAMPLE_DIR, perClass = 2): Note[] {
  return ["ECON300", "ECON301", "ECON196"].flatMap((course) => loadNotes(course, dir).slice(0, perClass));
}

export interface NoteEval {
  note: string;
  ok: boolean;
  error?: string;
  accepted: number;
  rejected: Partial<Record<RejectReason, number>>;
  calls: number;
  seconds: number;
  costUsd: number;
}

export interface CardsEvalSummary {
  notes: number;
  failedNotes: number;
  cardsAccepted: number;
  cardsRejected: number;
  /** accepted / (accepted + rejected for a reason other than "duplicate") */
  acceptanceRate: number;
  rejectedByReason: Partial<Record<RejectReason, number>>;
  cardsPerNote: number;
  calls: number;
  secondsPerNote: number;
  costUsd: number;
}

export function summarizeCardsEval(rows: NoteEval[]): CardsEvalSummary {
  const ok = rows.filter((r) => r.ok);
  const rejectedByReason: Partial<Record<RejectReason, number>> = {};
  for (const r of ok) for (const [k, v] of Object.entries(r.rejected)) rejectedByReason[k as RejectReason] = (rejectedByReason[k as RejectReason] ?? 0) + (v ?? 0);
  const accepted = ok.reduce((n, r) => n + r.accepted, 0);
  const rejected = Object.values(rejectedByReason).reduce((n, v) => n + (v ?? 0), 0);
  const considered = accepted + rejected - (rejectedByReason.duplicate ?? 0);
  return {
    notes: rows.length,
    failedNotes: rows.length - ok.length,
    cardsAccepted: accepted,
    cardsRejected: rejected,
    acceptanceRate: considered ? accepted / considered : 0,
    rejectedByReason,
    cardsPerNote: ok.length ? accepted / ok.length : 0,
    calls: rows.reduce((n, r) => n + r.calls, 0),
    secondsPerNote: rows.length ? rows.reduce((n, r) => n + r.seconds, 0) / rows.length : 0,
    costUsd: rows.reduce((n, r) => n + r.costUsd, 0),
  };
}

export async function evalNote(note: Note, runner: Runner, density: Density = "normal"): Promise<NoteEval> {
  const started = Date.now();
  const label = `${note.course} ${note.date} ${note.title}`;
  try {
    const r: CardGenResult = await generateCardsForNote({ runner, note, courses: DEFAULT_COURSES, density, existingFronts: [] });
    const rejected: Partial<Record<RejectReason, number>> = {};
    for (const x of r.rejected) rejected[x.reason] = (rejected[x.reason] ?? 0) + 1;
    return { note: label, ok: true, accepted: r.accepted.length, rejected, calls: r.calls, seconds: (Date.now() - started) / 1000, costUsd: r.costUsd };
  } catch (e) {
    return { note: label, ok: false, error: friendlyError(e), accepted: 0, rejected: {}, calls: 1, seconds: (Date.now() - started) / 1000, costUsd: 0 };
  }
}

export async function evalAll(notes: Note[], runner: Runner, concurrency = 3, onDone?: (r: NoteEval) => void): Promise<NoteEval[]> {
  const out: NoteEval[] = new Array(notes.length);
  let next = 0;
  const worker = async () => {
    while (next < notes.length) {
      const i = next++;
      out[i] = await evalNote(notes[i], runner);
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
  console.log(`Generating cards for ${notes.length} sample lectures (3 at a time)…\n`);
  const rows = await evalAll(notes, runClaude, 3, (r) => {
    const why = Object.entries(r.rejected).map(([k, v]) => `${v} ${k}`).join(", ");
    console.log(`${r.ok ? "✓" : "✗"} ${r.note.slice(0, 52).padEnd(52)} ${String(r.accepted).padStart(2)} cards  ${r.seconds.toFixed(1).padStart(5)}s${why ? `  dropped: ${why}` : ""}${r.error ? `  ${r.error}` : ""}`);
  });
  const s = summarizeCardsEval(rows);
  console.log(`\n${s.cardsAccepted} cards kept, ${s.cardsRejected} dropped · acceptance ${(100 * s.acceptanceRate).toFixed(0)}% · ${s.cardsPerNote.toFixed(1)} cards per lecture · ${s.secondsPerNote.toFixed(1)}s per lecture · ${s.calls} calls · ~$${s.costUsd.toFixed(2)}`);
  for (const [k, v] of Object.entries(s.rejectedByReason)) console.log(`  dropped for “${REJECT_LABEL[k as RejectReason]}”: ${v}`);
  if (s.failedNotes) console.log(`⚠ ${s.failedNotes} lecture(s) failed entirely`);
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(path.join(DATA_DIR, "cards-eval-report.json"), JSON.stringify({ at: new Date().toISOString(), summary: s, rows }, null, 2));
  process.exit(s.acceptanceRate >= min && !s.failedNotes ? 0 : 1);
}

if (process.argv[1] && path.resolve(process.argv[1]) === new URL(import.meta.url).pathname) main();
