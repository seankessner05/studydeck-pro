import { describe, it, expect, afterAll } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { loadNotes } from "../src/notes";
import { DEFAULT_COURSES } from "../src/courses";
import type { Runner } from "../src/claude";
import { closeStudyDbs, studyDb } from "../src/study/db";
import { QuestionGenerationJobs, type JobStatus } from "../src/study/jobs";
import { existingStems, listQuestions, questionCoverage } from "../src/study/questions";
import { noteVersion } from "../src/study/cardgen";
import { usageSummary } from "../src/study/usage";

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "sd-qjobs-"));
const econ301 = loadNotes("all", path.resolve("sample-notes")).filter((n) => n.course === "ECON301");
afterAll(() => closeStudyDbs());

/**
 * A stand-in for Claude. As the writer it makes two questions per lecture whose quotes really are in the note; as the
 * blind solver it finds the option called RIGHT (or deliberately picks the wrong one, or answers gibberish).
 */
function fakeClaude(opts: { solver?: "right" | "wrong" | "gibberish"; onCall?: (kind: "write" | "solve") => void } = {}): Runner {
  return async (o) => {
    const isSolver = !!o.system?.includes("You have not seen any answer key");
    opts.onCall?.(isSolver ? "solve" : "write");
    if (o.signal?.aborted) throw new Error("Cancelled");
    if (isSolver) {
      if (opts.solver === "gibberish") return { text: "They all look fine to me.", costUsd: 0.01 };
      const blocks = o.prompt.split(/\n(?=Q\d+ )/).filter((b) => /^Q\d+ /.test(b));
      const answers = blocks.map((b) => {
        const n = Number(b.match(/^Q(\d+)/)![1]);
        const right = b.match(/^([A-D])\. RIGHT$/m)![1];
        return { n, answer: [opts.solver === "wrong" ? (right === "A" ? "B" : "A") : right] };
      });
      return { text: JSON.stringify(answers), costUsd: 0.01 };
    }
    const title = o.prompt.match(/<note title="([^"]*)"/)![1];
    const body = o.prompt.split(/<note[^>]*>\n/)[1].split("\n</note>")[0];
    const words = body.split(/\s+/);
    const questions = [0, 1].map((k) => ({
      kind: "single",
      stem: [`Which idea is central to ${title}?`, `What does a worked example in ${title} illustrate?`][k],
      options: ["RIGHT", "wrong one", "wrong two", "wrong three"],
      answer: ["A"],
      explanation: "Because it is what the note says.",
      quote: words.slice(15 + k * 12, 22 + k * 12).join(" "),
      section: "Notes",
    }));
    return { text: JSON.stringify(questions), costUsd: 0.02 };
  };
}

async function finish(jobs: QuestionGenerationJobs): Promise<JobStatus> {
  for (let i = 0; i < 400 && jobs.isRunning(); i++) await new Promise((r) => setTimeout(r, 10));
  return jobs.status()!;
}
const startOpts = (db: ReturnType<typeof studyDb>, extra = {}) => ({ db, notes: econ301, courses: DEFAULT_COURSES, course: "ECON301", density: "normal" as const, ...extra });

describe("quiz question generation job", () => {
  it("writes, double-checks and saves questions per lecture, remembers the version, and records usage", async () => {
    const db = studyDb(tmp());
    const calls: string[] = [];
    const jobs = new QuestionGenerationJobs(fakeClaude({ onCall: (k) => calls.push(k) }), () => () => {});
    jobs.start(startOpts(db));
    const job = await finish(jobs);
    expect(job.status).toBe("done");
    expect(job.items.every((i) => i.state === "done" && i.created === 2)).toBe(true);
    expect(job.totals).toMatchObject({ created: 6, calls: 6, dropped: 0 }); // a write and a solve for each of 3 lectures
    expect(calls.filter((c) => c === "write")).toHaveLength(3);
    expect(calls.filter((c) => c === "solve")).toHaveLength(3);

    const qs = listQuestions(db, "ECON301");
    expect(qs).toHaveLength(6);
    for (const q of qs) expect(q.options[q.answer[0]]).toBe("RIGHT"); // the key still points at the right option after shuffling
    const cov = questionCoverage(db);
    for (const n of econ301) expect(cov.get(n.id)).toEqual({ questions: 2, versions: [noteVersion(n)] });
    expect(usageSummary(db).byKind.quiz).toBe(6);
  });

  it("saves nothing from a lecture when the second solver disagrees with every key", async () => {
    const db = studyDb(tmp());
    const jobs = new QuestionGenerationJobs(fakeClaude({ solver: "wrong" }), () => () => {});
    jobs.start(startOpts(db));
    const job = await finish(jobs);
    expect(job.status).toBe("done");
    expect(job.totals).toMatchObject({ created: 0, dropped: 6 });
    expect(job.items[0].dropped[0].why).toMatch(/blind second solve/);
    expect(listQuestions(db, "ECON301")).toEqual([]);
    // the lecture is still marked as processed, so it isn't offered again as "new"
    expect(questionCoverage(db).get(econ301[0].id)?.versions).toEqual([noteVersion(econ301[0])]);
  });

  it("fails the lecture, saves nothing, and still counts the calls when the double-check can't be read", async () => {
    const db = studyDb(tmp());
    const jobs = new QuestionGenerationJobs(fakeClaude({ solver: "gibberish" }), () => () => {});
    jobs.start(startOpts(db, { notes: econ301.slice(0, 1) }));
    const job = await finish(jobs);
    expect(job.items[0].state).toBe("error");
    expect(job.items[0].error).toMatch(/couldn't be double-checked/);
    expect(listQuestions(db, "ECON301")).toEqual([]);
    expect(questionCoverage(db).size).toBe(0); // not processed: it can be retried
    expect(usageSummary(db).byKind.quiz).toBe(3); // one write and two attempts at the solve
  });

  it("does not run two jobs at once, and cancel keeps what was finished", async () => {
    const db = studyDb(tmp());
    let writes = 0;
    const slow: Runner = async (o) => {
      const inner = fakeClaude({ onCall: (k) => k === "write" && writes++ });
      await new Promise((r) => setTimeout(r, 40));
      return inner(o);
    };
    const jobs = new QuestionGenerationJobs(slow, () => () => {});
    jobs.start(startOpts(db, { concurrency: 1 }));
    expect(() => jobs.start(startOpts(db))).toThrow(/already running/);
    await new Promise((r) => setTimeout(r, 120));
    expect(jobs.cancel()).toBe(true);
    const job = await finish(jobs);
    expect(job.status).toBe("cancelled");
    const saved = listQuestions(db, "ECON301").length;
    expect(saved).toBe(job.totals.created);
    expect(saved).toBeLessThan(6);
    expect(existingStems(db, "ECON301")).toHaveLength(saved);
  });
});
