import type { Runner } from "../claude.js";
import { friendlyError } from "../claude.js";
import type { Course } from "../courses.js";
import type { Db } from "../library/db.js";
import type { Note } from "../notes.js";
import { normalize } from "../citations.js";
import { addGeneratedCards, existingFronts, logGeneration } from "./cards.js";
import { REJECT_LABEL, generateCardsForNote, jaccard, noteVersion, type Density } from "./cardgen.js";
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
  status: "running" | "done" | "cancelled";
  startedAt: number;
  finishedAt?: number;
  items: JobItem[];
  totals: { created: number; duplicates: number; dropped: number; calls: number; costUsd: number };
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

const LOGIN_PROBLEM = /isn't logged in|session expired|claude.+not found|on your path/i;

/**
 * Generates flashcards for a set of lectures in the background, one job at a time. Progress is polled via status().
 * Each lecture is saved as soon as it finishes, so cancelling (or a crash) loses nothing already done.
 */
export class CardGenerationJobs {
  private job?: JobStatus;
  private abort?: AbortController;
  /** True until every worker has stopped, even after a cancel, so a new job can't overlap a winding-down one. */
  private active = false;

  constructor(
    private readonly runner: Runner,
    /** Called when a job starts; returns the function that lets the Mac sleep again. Replaced in tests. */
    private readonly awake: () => () => void = keepAwake,
  ) {}

  status(): JobStatus | undefined {
    return this.job;
  }

  isRunning(): boolean {
    return this.active;
  }

  cancel(): boolean {
    if (!this.active || this.job?.status !== "running") return false;
    this.job.status = "cancelled";
    this.abort?.abort();
    return true;
  }

  start(o: StartOptions): JobStatus {
    if (this.isRunning()) throw new Error("A card generation job is already running.");
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
    this.active = true;
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
        try {
          const r = await generateCardsForNote({
            runner: this.runner, note, courses: o.courses, density: o.density, focus: o.focus,
            existingFronts: existingFronts(o.db, note.course), signal,
          });
          job.totals.calls += r.calls;
          job.totals.costUsd += r.costUsd;
          recordUsage(o.db, "cards", r.calls, r.costUsd);

          // Another lecture in this job may have just saved a similar question: check again right before saving.
          const fresh = existingFronts(o.db, note.course);
          const keep = r.accepted.filter((c) => !fresh.some((f) => normalize(f) === normalize(c.front) || jaccard(f, c.front) >= 0.8));
          const late = r.accepted.length - keep.length;
          item.created = await addGeneratedCards(o.db, note, noteVersion(note), keep);
          logGeneration(o.db, note.id, noteVersion(note), item.created, r.calls);
          item.duplicates = r.rejected.filter((x) => x.reason === "duplicate").length + late;
          item.dropped = r.rejected.filter((x) => x.reason !== "duplicate").map((x) => ({ front: x.front, why: REJECT_LABEL[x.reason] + (x.detail ? ` (${x.detail})` : "") }));
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
          const message = friendlyError(e);
          item.finishedAt = Date.now();
          item.state = "error";
          item.error = message;
          // No point asking again if Claude isn't signed in.
          if (LOGIN_PROBLEM.test(message)) stopAll = true;
        }
      }
    };
    await Promise.all(Array.from({ length: Math.max(1, Math.min(o.concurrency ?? 2, notes.length)) }, worker));
    for (const item of job.items) if (item.state === "queued" || item.state === "running") item.state = "skipped";
    if (job.status === "running") job.status = "done";
    job.finishedAt = Date.now();
    this.active = false;
  }
}
