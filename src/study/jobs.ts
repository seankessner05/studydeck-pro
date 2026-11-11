import type { Runner } from "../claude.js";
import { describeClaudeError } from "../claude.js";
import type { Course } from "../courses.js";
import type { Db } from "../library/db.js";
import type { Note } from "../notes.js";
import { normalize } from "../citations.js";
import { addGeneratedCards, existingFronts, logGeneration } from "./cards.js";
import { REJECT_LABEL, generateCardsForNote, jaccard, noteVersion, type Density } from "./cardgen.js";
import { DoubleCheckError, Q_REJECT_LABEL, generateQuestionsForNote } from "./quizgen.js";
import { addGeneratedQuestions, existingStems, logQuestionGeneration } from "./questions.js";
import { ProblemCheckError, P_REJECT_LABEL, generateProblemsForNote } from "./problemgen.js";
import { addGeneratedProblems, existingProblemStems, logProblemGeneration } from "./problems.js";
import { keepAwake } from "./awake.js";
import { recordUsage } from "./usage.js";

export type ItemState = "queued" | "running" | "done" | "error" | "skipped";

export interface JobItem {
  noteId: string;
  title: string;
  date: string;
  course: string;
  state: ItemState;
  /** ms epoch when Claude started on this lecture, and when it finished */
  startedAt?: number;
  finishedAt?: number;
  created: number;
  duplicates: number;
  dropped: { front: string; why: string }[];
  error?: string;
}

export interface JobStatus {
  id: string;
  course: string;
  density: Density;
  /** "interrupted": StudyDeck was closed or restarted while the job was running. */
  status: "running" | "done" | "cancelled" | "interrupted";
  startedAt: number;
  finishedAt?: number;
  items: JobItem[];
  totals: { created: number; duplicates: number; dropped: number; calls: number; costUsd: number };
  /** Set when the job gave up early (usage limit, not signed in): the remaining lectures were skipped, not tried. */
  stoppedBecause?: string;
}

export interface StartOptions {
  db: Db;
  notes: Note[];
  courses: Course[];
  course: string;
  density: Density;
  focus?: string;
  /** How many lectures to work on at once. */
  concurrency?: number;
}

/** Failures where asking again for the next lecture cannot work: not signed in, CLI missing, or the plan's usage limit. */
const STOPS_THE_JOB = new Set(["login", "missing", "limit"]);

export type JobKind = "cards" | "quiz" | "problems";

/** How many finished job reports to keep per kind. */
const KEEP_JOBS = 20;

export const INTERRUPTED_MESSAGE =
  "StudyDeck was closed or restarted while this was running. Every lecture marked done was saved; the ones marked skipped were not finished.";

/** Write the job report to the database, so it outlives the server. Never allowed to break the job itself. */
function saveJob(db: Db, kind: JobKind, job: JobStatus) {
  try {
    db.prepare("INSERT INTO gen_jobs (id, kind, status, started_at, updated_at, state) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT (id) DO UPDATE SET status = excluded.status, updated_at = excluded.updated_at, state = excluded.state")
      .run(job.id, kind, job.status, job.startedAt, Date.now(), JSON.stringify(job));
  } catch {
    // e.g. the database was just replaced by a restore: the job carries on in memory
  }
}

/**
 * The most recent saved job of this kind. A job still marked "running" with no live job behind it was cut off
 * by a restart: it is closed off as "interrupted", with its unfinished lectures marked skipped.
 */
export function lastSavedJob(db: Db, kind: JobKind): JobStatus | undefined {
  let row: { state: string } | undefined;
  try {
    row = db.prepare("SELECT state FROM gen_jobs WHERE kind = ? ORDER BY started_at DESC LIMIT 1").get(kind) as { state: string } | undefined;
  } catch {
    return undefined;
  }
  if (!row) return undefined;
  let job: JobStatus;
  try {
    job = JSON.parse(row.state);
  } catch {
    return undefined;
  }
  if (job.status === "running") {
    job.status = "interrupted";
    job.finishedAt = Date.now();
    job.stoppedBecause = INTERRUPTED_MESSAGE;
    for (const item of job.items) if (item.state === "queued" || item.state === "running") item.state = "skipped";
    saveJob(db, kind, job);
  }
  return job;
}

/** What processing one lecture produced. */
export interface Outcome {
  created: number;
  duplicates: number;
  dropped: { front: string; why: string }[];
  calls: number;
  costUsd: number;
}

/**
 * Works through a set of lectures in the background, one job at a time. Progress is polled via status().
 * Each lecture is saved as soon as it finishes, so cancelling (or a crash) loses nothing already done.
 * Subclasses decide what "processing a lecture" means (flashcards, quiz questions).
 */
abstract class LectureJobs {
  private job?: JobStatus;
  private abort?: AbortController;
  /** The database of the job in memory, for saving its report as it goes. */
  private db?: Db;
  /** True until every worker has stopped, even after a cancel, so a new job can't overlap a winding-down one. */
  private active = false;

  constructor(
    protected readonly runner: Runner,
    /** Called when a job starts; returns the function that lets the Mac sleep again. Replaced in tests. */
    private readonly awake: () => () => void = keepAwake,
  ) {}

  /** Which bank this job fills; also the label its report is saved under. */
  protected abstract readonly kind: JobKind;
  /** Shown when a second job is started: "A card generation job is already running." */
  protected abstract readonly busyMessage: string;
  protected abstract process(note: Note, o: StartOptions, signal: AbortSignal): Promise<Outcome>;

  /**
   * The job running now, or the last one. After a restart nothing is in memory, so pass the database to get the
   * saved report back (an unfinished one comes back as "interrupted").
   */
  status(db?: Db): JobStatus | undefined {
    if (this.job) return this.job;
    return db ? lastSavedJob(db, this.kind) : undefined;
  }

  isRunning(): boolean {
    return this.active;
  }

  cancel(): boolean {
    if (!this.active || this.job?.status !== "running") return false;
    this.job.status = "cancelled";
    this.abort?.abort();
    if (this.db) saveJob(this.db, this.kind, this.job);
    return true;
  }

  start(o: StartOptions): JobStatus {
    if (this.isRunning()) throw new Error(this.busyMessage);
    const notes = [...o.notes].sort((a, b) => a.date.localeCompare(b.date) || a.title.localeCompare(b.title));
    const job: JobStatus = {
      id: `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
      course: o.course,
      density: o.density,
      status: "running",
      startedAt: Date.now(),
      items: notes.map((n) => ({ noteId: n.id, title: n.title, date: n.date, course: n.course, state: "queued", created: 0, duplicates: 0, dropped: [] })),
      totals: { created: 0, duplicates: 0, dropped: 0, calls: 0, costUsd: 0 },
    };
    this.job = job;
    this.db = o.db;
    this.active = true;
    saveJob(o.db, this.kind, job);
    try {
      o.db.prepare("DELETE FROM gen_jobs WHERE kind = ? AND id NOT IN (SELECT id FROM gen_jobs WHERE kind = ? ORDER BY started_at DESC LIMIT ?)").run(this.kind, this.kind, KEEP_JOBS);
    } catch {
      // tidying old reports is optional
    }
    const release = this.awake();
    this.abort = new AbortController();
    void this.run(job, notes, o, this.abort.signal).finally(release);
    return job;
  }

  private async run(job: JobStatus, notes: Note[], o: StartOptions, signal: AbortSignal) {
    let next = 0;
    let stopAll = false;
    const worker = async () => {
      while (!stopAll && !signal.aborted) {
        const i = next++;
        if (i >= notes.length) return;
        const note = notes[i];
        const item = job.items[i];
        item.state = "running";
        item.startedAt = Date.now();
        saveJob(o.db, this.kind, job);
        try {
          const out = await this.process(note, o, signal);
          item.created = out.created;
          item.duplicates = out.duplicates;
          item.dropped = out.dropped;
          job.totals.calls += out.calls;
          job.totals.costUsd += out.costUsd;
          job.totals.created += item.created;
          job.totals.duplicates += item.duplicates;
          job.totals.dropped += item.dropped.length;
          item.state = "done";
          item.finishedAt = Date.now();
        } catch (e) {
          if (signal.aborted) {
            item.state = "skipped";
            return;
          }
          const problem = describeClaudeError(e);
          item.finishedAt = Date.now();
          item.state = "error";
          item.error = problem.message;
          // No point asking again if Claude isn't signed in or the usage limit is reached: the rest are skipped, not failed.
          if (STOPS_THE_JOB.has(problem.kind)) {
            stopAll = true;
            job.stoppedBecause = problem.message;
          }
        }
        saveJob(o.db, this.kind, job);
      }
    };
    await Promise.all(Array.from({ length: Math.max(1, Math.min(o.concurrency ?? 2, notes.length)) }, worker));
    for (const item of job.items) if (item.state === "queued" || item.state === "running") item.state = "skipped";
    if (job.status === "running") job.status = "done";
    job.finishedAt = Date.now();
    saveJob(o.db, this.kind, job);
    this.active = false;
  }
}

/** Flashcards from lectures. */
export class CardGenerationJobs extends LectureJobs {
  protected readonly kind = "cards" as const;
  protected readonly busyMessage = "A card generation job is already running.";

  protected async process(note: Note, o: StartOptions, signal: AbortSignal): Promise<Outcome> {
    const r = await generateCardsForNote({
      runner: this.runner, note, courses: o.courses, density: o.density, focus: o.focus,
      existingFronts: existingFronts(o.db, note.course), signal,
    });
    recordUsage(o.db, "cards", r.calls, r.costUsd);

    // Another lecture in this job may have just saved a similar question: check again right before saving.
    const fresh = existingFronts(o.db, note.course);
    const keep = r.accepted.filter((c) => !fresh.some((f) => normalize(f) === normalize(c.front) || jaccard(f, c.front) >= 0.8));
    const late = r.accepted.length - keep.length;
    const created = await addGeneratedCards(o.db, note, noteVersion(note), keep);
    logGeneration(o.db, note.id, noteVersion(note), created, r.calls);
    return {
      created,
      duplicates: r.rejected.filter((x) => x.reason === "duplicate").length + late,
      dropped: r.rejected.filter((x) => x.reason !== "duplicate").map((x) => ({ front: x.front, why: REJECT_LABEL[x.reason] + (x.detail ? ` (${x.detail})` : "") })),
      calls: r.calls,
      costUsd: r.costUsd,
    };
  }
}

/** Quiz questions from lectures: written, then double-checked by a blind second solve, then saved. */
export class QuestionGenerationJobs extends LectureJobs {
  protected readonly kind = "quiz" as const;
  protected readonly busyMessage = "A quiz-question generation job is already running.";

  protected async process(note: Note, o: StartOptions, signal: AbortSignal): Promise<Outcome> {
    let r;
    try {
      r = await generateQuestionsForNote({ runner: this.runner, note, courses: o.courses, density: o.density, focus: o.focus, existingStems: existingStems(o.db, note.course), signal });
    } catch (e) {
      // Claude was asked even though nothing could be kept, so those calls still count against the allowance.
      if (e instanceof DoubleCheckError) recordUsage(o.db, "quiz", e.calls, e.costUsd);
      throw e;
    }
    recordUsage(o.db, "quiz", r.calls, r.costUsd);

    const fresh = existingStems(o.db, note.course);
    const keep = r.accepted.filter((c) => !fresh.some((f) => normalize(f) === normalize(c.stem) || jaccard(f, c.stem) >= 0.8));
    const late = r.accepted.length - keep.length;
    const created = addGeneratedQuestions(o.db, note, noteVersion(note), keep);
    logQuestionGeneration(o.db, note.id, noteVersion(note), created, r.calls);
    return {
      created,
      duplicates: r.rejected.filter((x) => x.reason === "duplicate").length + late,
      dropped: r.rejected.filter((x) => x.reason !== "duplicate").map((x) => ({ front: x.stem, why: Q_REJECT_LABEL[x.reason] + (x.detail ? ` (${x.detail})` : "") })),
      calls: r.calls,
      costUsd: r.costUsd,
    };
  }
}

/** Numerical practice problems: written as small programs, computed by the app, then solved blind by a second Claude call. */
export class ProblemGenerationJobs extends LectureJobs {
  protected readonly kind = "problems" as const;
  protected readonly busyMessage = "A practice-problem generation job is already running.";

  protected async process(note: Note, o: StartOptions, signal: AbortSignal): Promise<Outcome> {
    let r;
    try {
      r = await generateProblemsForNote({ runner: this.runner, note, courses: o.courses, density: o.density, focus: o.focus, existingStems: existingProblemStems(o.db, note.course), signal });
    } catch (e) {
      if (e instanceof ProblemCheckError) recordUsage(o.db, "problems", e.calls, e.costUsd);
      throw e;
    }
    recordUsage(o.db, "problems", r.calls, r.costUsd);
    const fresh = existingProblemStems(o.db, note.course);
    const keep = r.accepted.filter((c) => !fresh.some((f) => normalize(f) === normalize(c.stem) || jaccard(f, c.stem) >= 0.8));
    const late = r.accepted.length - keep.length;
    const created = addGeneratedProblems(o.db, note, noteVersion(note), keep);
    logProblemGeneration(o.db, note.id, noteVersion(note), created, r.calls);
    return {
      created,
      duplicates: r.rejected.filter((x) => x.reason === "duplicate").length + late,
      dropped: r.rejected.filter((x) => x.reason !== "duplicate").map((x) => ({ front: x.stem, why: P_REJECT_LABEL[x.reason] + (x.detail ? ` (${x.detail})` : "") })),
      calls: r.calls,
      costUsd: r.costUsd,
    };
  }
}
