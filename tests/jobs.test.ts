import { describe, it, expect, afterAll } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { loadNotes } from "../src/notes";
import { DEFAULT_COURSES } from "../src/courses";
import type { Runner } from "../src/claude";
import { closeStudyDbs, studyDb } from "../src/study/db";
import { coverage, existingFronts, listCards } from "../src/study/cards";
import { CardGenerationJobs, type JobStatus } from "../src/study/jobs";
import { usageSummary } from "../src/study/usage";
import { noteVersion } from "../src/study/cardgen";

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "sd-jobs-"));
const sample = loadNotes("all", path.resolve("sample-notes"));
const econ301 = sample.filter((n) => n.course === "ECON301");
afterAll(() => closeStudyDbs());

/** A stand-in for Claude: reads the note out of the prompt and writes two cards whose quotes really are in it. */
function fakeClaude(opts: { delayMs?: number; fail?: (title: string) => Error | undefined; sameFronts?: boolean; onCall?: () => void } = {}): Runner {
  return async (o) => {
    opts.onCall?.();
    const title = o.prompt.match(/<note title="([^"]*)"/)![1];
    const err = opts.fail?.(title);
    if (opts.delayMs) await new Promise((r) => setTimeout(r, opts.delayMs));
    if (err) throw err;
    if (o.signal?.aborted) throw new Error("Cancelled");
    const body = o.prompt.split(/<note[^>]*>\n/)[1].split("\n</note>")[0];
    const words = body.split(/\s+/);
    const quote = (from: number) => words.slice(from, from + 7).join(" ");
    const cards = [0, 1].map((k) => ({
      front: opts.sameFronts
        ? ["Which relationship links the two central variables here?", "How is the worked numerical example solved step by step?"][k]
        : [`What is the central idea of ${title}?`, `Which formula or worked example appears in ${title}?`][k],
      back: "An answer taken from the note.",
      quote: quote(15 + k * 12),
      section: "Notes",
    }));
    return { text: JSON.stringify(cards), costUsd: 0.02 };
  };
}

async function finish(jobs: CardGenerationJobs): Promise<JobStatus> {
  for (let i = 0; i < 400 && jobs.isRunning(); i++) await new Promise((r) => setTimeout(r, 10));
  return jobs.status()!;
}

const startOpts = (db: ReturnType<typeof studyDb>, notes = econ301, extra = {}) => ({ db, notes, courses: DEFAULT_COURSES, course: "ECON301", density: "normal" as const, ...extra });

describe("card generation job", () => {
  it("saves verified cards per lecture in date order, remembers the note version, and records usage", async () => {
    const db = studyDb(tmp());
    const jobs = new CardGenerationJobs(fakeClaude());
    jobs.start(startOpts(db));
    const job = await finish(jobs);
    expect(job.status).toBe("done");
    expect(job.items.map((i) => i.date)).toEqual([...econ301.map((n) => n.date)].sort());
    expect(job.items.every((i) => i.state === "done" && i.created === 2)).toBe(true);
    expect(job.totals).toMatchObject({ created: 6, calls: 3, duplicates: 0, dropped: 0 });
    expect(job.totals.costUsd).toBeCloseTo(0.06, 5);

    const cards = listCards(db, "ECON301");
    expect(cards).toHaveLength(6);
    expect(cards.every((c) => c.origin === "generated" && c.state === 0 && c.quote && c.noteId)).toBe(true);

    const cov = coverage(db);
    for (const n of econ301) expect(cov.get(n.id)).toEqual({ cards: 2, versions: [noteVersion(n)] });
    expect(usageSummary(db).byKind).toEqual({ cards: 3 });
  });

  it("works on at most two lectures at once", async () => {
    const db = studyDb(tmp());
    let inFlight = 0;
    let peak = 0;
    const base = fakeClaude({ delayMs: 25 });
    const runner: Runner = async (o) => {
      inFlight++;
      peak = Math.max(peak, inFlight);
      try {
        return await base(o);
      } finally {
        inFlight--;
      }
    };
    const jobs = new CardGenerationJobs(runner);
    jobs.start(startOpts(db, sample.filter((n) => ["ECON300", "ECON301"].includes(n.course))));
    await finish(jobs);
    expect(peak).toBe(2);
  });

  it("keeps going when one lecture fails, and says which and why", async () => {
    const db = studyDb(tmp());
    const bad = econ301[1].title;
    const jobs = new CardGenerationJobs(fakeClaude({ fail: (t) => (t === bad ? new Error("rate_limit_error") : undefined) }));
    jobs.start(startOpts(db));
    const job = await finish(jobs);
    expect(job.status).toBe("done");
    expect(job.items.filter((i) => i.state === "done")).toHaveLength(2);
    const failed = job.items.find((i) => i.state === "error")!;
    expect(failed.title).toBe(bad);
    expect(failed.error).toMatch(/usage limit/);
    expect(job.totals.created).toBe(4);
  });

  it("stops asking Claude once it's clear you're signed out", async () => {
    const db = studyDb(tmp());
    let calls = 0;
    const jobs = new CardGenerationJobs(fakeClaude({ onCall: () => calls++, fail: () => new Error("Failed to authenticate: OAuth session expired") }));
    jobs.start(startOpts(db, sample.filter((n) => n.course === "ECON300"), { concurrency: 1 }));
    const job = await finish(jobs);
    expect(calls).toBe(1);
    expect(job.items.map((i) => i.state)).toEqual(["error", "skipped", "skipped"]);
    expect(job.items[0].error).toContain("claude auth login");
  });

  it("can be cancelled; lectures already finished stay saved", async () => {
    const db = studyDb(tmp());
    const jobs = new CardGenerationJobs(fakeClaude({ delayMs: 60 }));
    jobs.start(startOpts(db, sample.filter((n) => n.course === "ECON300" || n.course === "ECON301"), { concurrency: 1 }));
    await new Promise((r) => setTimeout(r, 90));
    expect(jobs.cancel()).toBe(true);
    const job = await finish(jobs);
    expect(job.status).toBe("cancelled");
    expect(job.items.filter((i) => i.state === "done").length).toBeGreaterThanOrEqual(1);
    expect(job.items.some((i) => i.state === "skipped")).toBe(true);
    expect(listCards(db, "all").length).toBe(job.totals.created);
    expect(jobs.cancel()).toBe(false);
  });

  it("never asks the same question twice, even across jobs", async () => {
    const db = studyDb(tmp());
    const first = new CardGenerationJobs(fakeClaude());
    first.start(startOpts(db));
    await finish(first);
    const second = new CardGenerationJobs(fakeClaude());
    second.start(startOpts(db));
    const job = await finish(second);
    expect(job.totals.created).toBe(0);
    expect(job.totals.duplicates).toBe(6);
    expect(listCards(db, "ECON301")).toHaveLength(6);
  });

  it("catches duplicates between lectures that are generated at the same time", async () => {
    const db = studyDb(tmp());
    const jobs = new CardGenerationJobs(fakeClaude({ sameFronts: true, delayMs: 20 }));
    jobs.start(startOpts(db));
    const job = await finish(jobs);
    expect(existingFronts(db, "ECON301")).toHaveLength(2);
    expect(job.totals.created).toBe(2);
    expect(job.totals.duplicates).toBe(4);
  });

  it("allows one job at a time and reports dropped cards with reasons", async () => {
    const db = studyDb(tmp());
    const liar: Runner = async () => ({ text: JSON.stringify([{ front: "Invented?", back: "Yes.", quote: "This sentence is nowhere in the note at all." }]), costUsd: 0.01 });
    const jobs = new CardGenerationJobs(liar);
    jobs.start(startOpts(db, econ301.slice(0, 1)));
    expect(() => jobs.start(startOpts(db))).toThrow(/already running/);
    const job = await finish(jobs);
    expect(job.totals).toMatchObject({ created: 0, dropped: 1 });
    expect(job.items[0].dropped[0].why).toContain("receipt quote isn't in the note");
    expect(listCards(db, "all")).toHaveLength(0);
  });
});
