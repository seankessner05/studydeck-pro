import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { Server } from "node:http";
import { createApp } from "../src/server";
import { closeStudyDbs } from "../src/study/db";
import type { Runner } from "../src/claude";

let server: Server, base: string, notesDir: string;
let holdUntil: Promise<void> | undefined;
let writes = 0;
let explainPrompt = "";

/**
 * A stand-in for Claude with four jobs: write flashcards, write quiz questions, solve them blind, explain an answer.
 * Quiz questions have an option called RIGHT, and the blind solver finds it.
 */
const runner: Runner = async (o) => {
  const sys = o.system ?? "";
  if (sys.includes("patient tutor")) {
    explainPrompt = o.prompt;
    return { text: "  You mixed up the two ideas. Remember: price takers accept the price.  ", costUsd: 0.01 };
  }
  if (sys.includes("You have not seen any answer key")) {
    const blocks = o.prompt.split(/\n(?=Q\d+ )/).filter((b) => /^Q\d+ /.test(b));
    return { text: JSON.stringify(blocks.map((b) => ({ n: Number(b.match(/^Q(\d+)/)![1]), answer: [b.match(/^([A-D])\. RIGHT$/m)![1]] }))), costUsd: 0.01 };
  }
  if (sys.includes("practice-exam questions")) {
    writes++;
    if (holdUntil) await holdUntil;
    if (o.signal?.aborted) throw new Error("Cancelled");
    const title = o.prompt.match(/<note title="([^"]*)"/)![1];
    const body = o.prompt.split(/<note[^>]*>\n/)[1].split("\n</note>")[0];
    const words = body.split(/\s+/);
    const qs = [0, 1, 2].map((k) => ({
      kind: "single",
      stem: [`Which idea is central to ${title}?`, `What does a worked example in ${title} illustrate?`, `Why does the lecture on ${title} matter for the midterm?`][k],
      options: ["RIGHT", "wrong one", "wrong two", "wrong three"],
      answer: ["A"],
      explanation: "Because it is what the note says.",
      quote: words.slice(15 + k * 12, 22 + k * 12).join(" "),
    }));
    return { text: JSON.stringify(qs), costUsd: 0.03 };
  }
  return { text: "Fine.", costUsd: 0.01 };
};

beforeAll(async () => {
  notesDir = fs.mkdtempSync(path.join(os.tmpdir(), "sd-qnotes-"));
  fs.cpSync(path.resolve("sample-notes/ECON301"), path.join(notesDir, "ECON301"), { recursive: true });
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "sd-qdata-"));
  const app = createApp({ runner, notesDir, sampleDir: path.resolve("sample-notes"), dataDir });
  await new Promise<void>((r) => (server = app.listen(0, () => r())));
  base = `http://127.0.0.1:${(server.address() as any).port}`;
});
afterAll(() => {
  server.close();
  closeStudyDbs();
});

const j = (url: string, method = "GET", body?: object) =>
  fetch(`${base}${url}`, { method, headers: { "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
const waitDone = async (kind = "quiz/generate") => {
  for (let i = 0; i < 300; i++) {
    const s = await (await j(`/api/study/${kind}/status`)).json();
    if (!s.running) return s.job;
    await new Promise((r) => setTimeout(r, 15));
  }
  throw new Error("job never finished");
};

describe("making quiz questions over the API", () => {
  it("plans with quiz-sized options", async () => {
    const p = await (await j("/api/study/quiz/generate/plan?course=ECON301")).json();
    expect(p.lectures).toHaveLength(3);
    expect(p.lectures.every((l: any) => l.status === "none")).toBe(true);
    expect(p.densities).toEqual([
      { id: "light", label: "Few", target: 4 },
      { id: "normal", label: "Normal", target: 6 },
      { id: "thorough", label: "Many", target: 10 },
    ]);
    expect((await j("/api/study/quiz/generate/plan?course=NOPE")).status).toBe(404);
  });

  it("generates, double-checks and saves questions for every lecture", async () => {
    const start = await j("/api/study/quiz/generate", "POST", { course: "ECON301" });
    expect(start.status).toBe(200);
    const job = await waitDone();
    expect(job.status).toBe("done");
    expect(job.totals).toMatchObject({ created: 9, calls: 6, dropped: 0 });
    const p = await (await j("/api/study/quiz/generate/plan?course=ECON301")).json();
    expect(p.lectures.map((l: any) => [l.status, l.cards])).toEqual([["generated", 3], ["generated", 3], ["generated", 3]]);
    expect((await (await j("/api/usage")).json()).byKind).toMatchObject({ quiz: 6 });
    // flashcard planning is separate: no cards exist yet
    const cp = await (await j("/api/study/generate/plan?course=ECON301")).json();
    expect(cp.lectures.every((l: any) => l.status === "none")).toBe(true);
  });

  it("won't run a quiz job and a card job at the same time", async () => {
    writes = 0;
    let release!: () => void;
    holdUntil = new Promise<void>((r) => (release = r));
    const p = await (await j("/api/study/quiz/generate/plan?course=ECON301")).json();
    expect((await j("/api/study/quiz/generate", "POST", { course: "ECON301", noteIds: [p.lectures[0].id] })).status).toBe(200);
    for (let i = 0; i < 100 && writes === 0; i++) await new Promise((r) => setTimeout(r, 10));
    const clash = await j("/api/study/generate", "POST", { course: "ECON301" });
    expect(clash.status).toBe(409);
    expect((await clash.json()).error).toMatch(/Another generation job/);
    release();
    holdUntil = undefined;
    await waitDone();
  });
});

describe("taking a quiz over the API", () => {
  let runId = "";
  let questions: any[] = [];

  it("shows the home screen data", async () => {
    const h = await (await j("/api/study/quiz/home?course=ECON301")).json();
    expect(h.counts).toEqual({ total: 9, seen: 0 });
    expect(h.accuracy).toEqual({ answers: 0, correct: 0, pct: null });
    expect(h.questions).toHaveLength(9);
    expect(h.questions[0]).toMatchObject({ asked: 0, right: 0, kind: "single" });
    expect(JSON.stringify(h)).not.toMatch(/"answer"|"explanation"|"quote"|"options"/); // the list must not carry the key
    expect((await j("/api/study/quiz/home?course=NOPE")).status).toBe(404);
  });

  it("starts a quiz without giving the answers away", async () => {
    const r = await (await j("/api/study/quiz/start", "POST", { course: "ECON301", length: 4 })).json();
    runId = r.runId;
    questions = r.questions;
    expect(questions).toHaveLength(4);
    expect(JSON.stringify(questions)).not.toMatch(/explanation|quote|answer/);
    const empty = await j("/api/study/quiz/start", "POST", { course: "ECON300" }); // a real class, but no questions yet
    expect(empty.status).toBe(400);
    expect((await empty.json()).error).toMatch(/No quiz questions yet/);
    expect((await j("/api/study/quiz/start", "POST", { course: "NOPE" })).status).toBe(404);
  });

  it("checks answers, reveals the key and the receipt, and counts a miss", async () => {
    const right = (q: any) => q.options.indexOf("RIGHT");
    const ok = await (await j("/api/study/quiz/answer", "POST", { runId, questionId: questions[0].id, picked: [right(questions[0])], msTaken: 4200 })).json();
    expect(ok).toMatchObject({ correct: true, attempt: 1, answer: [right(questions[0])], explanation: "Because it is what the note says." });
    expect(ok.quote.length).toBeGreaterThan(10);
    const wrongPick = [(right(questions[1]) + 1) % 4];
    const bad = await (await j("/api/study/quiz/answer", "POST", { runId, questionId: questions[1].id, picked: wrongPick })).json();
    expect(bad).toMatchObject({ correct: false, attempt: 1 });
    // asked again after the miss, and right this time
    const again = await (await j("/api/study/quiz/answer", "POST", { runId, questionId: questions[1].id, picked: [right(questions[1])] })).json();
    expect(again).toMatchObject({ correct: true, attempt: 2 });
    for (const q of questions.slice(2)) await j("/api/study/quiz/answer", "POST", { runId, questionId: q.id, picked: [right(q)] });
  });

  it("rejects an empty or invalid answer with a clear message", async () => {
    const r = await j("/api/study/quiz/answer", "POST", { runId, questionId: questions[0].id, picked: [] });
    expect(r.status).toBe(400);
    expect((await r.json()).error).toMatch(/Pick an answer/);
    expect((await j("/api/study/quiz/answer", "POST", { runId: "gone", questionId: questions[0].id, picked: [0] })).status).toBe(400);
  });

  it("scores first tries, lists what was missed, and counts the day for the streak", async () => {
    const s = await (await j("/api/study/quiz/finish", "POST", { runId })).json();
    expect(s).toMatchObject({ total: 4, correct: 3, pct: 75, recovered: 1 });
    expect(s.missed).toHaveLength(1);
    expect(s.missed[0].stem).toBe(questions[1].stem);
    expect(s.streak).toBeGreaterThanOrEqual(1);
    const h = await (await j("/api/study/quiz/home?course=ECON301")).json();
    expect(h.counts).toEqual({ total: 9, seen: 4 });
    expect(h.accuracy).toEqual({ answers: 4, correct: 3, pct: 75 });
  });

  it("explains a miss from the note, trimmed, and notes the usage", async () => {
    const r = await (await j("/api/study/quiz/explain", "POST", { questionId: questions[1].id, picked: [0] })).json();
    expect(r.text).toBe("You mixed up the two ideas. Remember: price takers accept the price.");
    expect(explainPrompt).toContain(questions[1].stem);
    expect(explainPrompt).toContain("Correct answer: \"RIGHT\"");
    expect(explainPrompt).toContain("<note title=");
    expect((await j("/api/study/quiz/explain", "POST", { questionId: "nope" })).status).toBe(404);
    expect((await (await j("/api/usage")).json()).byKind.quiz).toBe(8); // 6 for the first job, 1 for the repeat (all duplicates, so no second solve), 1 for this explanation
  });

  it("deletes a question", async () => {
    expect(await (await j(`/api/study/quiz/questions/${questions[3].id}`, "DELETE")).json()).toMatchObject({ ok: true });
    expect((await (await j("/api/study/quiz/home?course=ECON301")).json()).counts.total).toBe(8);
  });

  it("refuses to generate or explain while AI is paused, but still lets you take quizzes", async () => {
    await j("/api/settings", "POST", { aiPaused: true });
    const gen = await j("/api/study/quiz/generate", "POST", { course: "ECON301", noteIds: [questions[0].noteId] });
    expect(gen.status).toBe(409);
    expect((await j("/api/study/quiz/explain", "POST", { questionId: questions[1].id, picked: [0] })).status).toBe(409);
    expect((await j("/api/study/quiz/start", "POST", { course: "ECON301", length: 2 })).status).toBe(200);
    await j("/api/settings", "POST", { aiPaused: false });
  });
});
