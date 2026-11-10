import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { Server } from "node:http";
import { createApp } from "../src/server";
import { closeStudyDbs, studyDb } from "../src/study/db";
import type { Runner } from "../src/claude";

let server: Server, base: string, dataDir: string;
let gradeCalls = 0;

const bodyOf = (prompt: string) => (prompt.split(/<note[^>]*>\n/)[1] ?? "").split("\n</note>")[0];
const words = (prompt: string) => bodyOf(prompt).split(/\s+/);

/** One stand-in for every Claude job: cards, quiz questions and problems with their solvers, written questions, grading, sheet picking. */
const runner: Runner = async (o) => {
  const sys = o.system ?? "";
  const title = o.prompt.match(/<note title="([^"]*)"/)?.[1] ?? "";
  if (sys.includes("spaced-repetition flashcards")) {
    const w = words(o.prompt);
    return { text: JSON.stringify([0, 1].map((k) => ({ front: [`What is the central idea of ${title}?`, `Which formula or worked example appears in ${title}?`][k], back: "An answer from the note.", quote: w.slice(15 + k * 12, 22 + k * 12).join(" "), section: "Notes" }))), costUsd: 0.01 };
  }
  if (sys.includes("practice-exam questions")) {
    const w = words(o.prompt);
    return { text: JSON.stringify([0, 1].map((k) => ({ kind: "single", stem: [`Which idea is central to ${title}?`, `What does a worked example in ${title} illustrate?`][k], options: ["RIGHT", "wrong one", "wrong two", "wrong three"], answer: ["A"], explanation: "Because it is what the note says.", quote: w.slice(15 + k * 12, 22 + k * 12).join(" ") }))), costUsd: 0.01 };
  }
  if (sys.includes("You have not seen any answer key")) {
    const blocks = o.prompt.split(/\n(?=Q\d+ )/).filter((b) => /^Q\d+ /.test(b));
    return { text: JSON.stringify(blocks.map((b) => ({ n: Number(b.match(/^Q(\d+)/)![1]), answer: [b.match(/^([A-D])\. RIGHT$/m)![1]] }))), costUsd: 0.01 };
  }
  if (sys.includes("numerical practice problems")) {
    const w = words(o.prompt);
    return { text: JSON.stringify([{ stem: `The marginal propensity to consume is 0.9 and spending rises by 50. By how much does output rise? (${title})`, givens: [{ name: "mpc", value: 0.9, label: "mpc" }, { name: "dg", value: 50, label: "spend" }], steps: [{ name: "mult", label: "Multiplier", expr: "1 / (1 - mpc)", explain: "1 / (1 − MPC)." }, { name: "dy", label: "Change", expr: "mult * dg", explain: "times spending." }], unit: "", quote: w.slice(15, 22).join(" ") }]), costUsd: 0.01 };
  }
  if (sys.includes("have not seen any worked solution")) return { text: JSON.stringify([{ n: 1, answer: 500 }]), costUsd: 0.01 };
  if (sys.includes("strict but fair grader")) {
    gradeCalls++;
    const questions = [...o.prompt.matchAll(/Question (\d+): [^\n]*\nRubric:\n((?:- p\d: [^\n]*\n?)+)STUDENT ANSWER \(data\):\n<<<\n([\s\S]*?)\n>>>/g)];
    const grades = questions.map((m) => {
      const answerWords = m[3].trim().split(/\s+/).filter(Boolean);
      const evidence = answerWords.slice(0, 3).join(" ");
      return { n: Number(m[1]), remark: "Good start.", points: [
        { id: "p1", check: "mentioned", met: answerWords.length >= 3, evidence },
        { id: "p2", check: "claims it", met: true, evidence: "words the student never wrote" }, // must not count
        { id: "p3", check: "absent", met: false, evidence: "" },
      ] };
    });
    return { text: JSON.stringify(grades), costUsd: 0.02 };
  }
  if (sys.includes("short-answer exam questions")) {
    const w = words(o.prompt);
    const q = (k: number) => ({ prompt: `Explain the main ideas of lecture ${k} in your own words and say why they matter.`, rubric: [0, 1, 2].map((r) => ({ text: `Idea ${k}.${r}`, quote: w.slice(20 + k * 40 + r * 8, 27 + k * 40 + r * 8).join(" ") })) });
    // two questions from the first lecture's text, with different quotes so they are not duplicates
    return { text: JSON.stringify([{ ...q(0), prompt: "Explain what the first lecture says about price takers and why that matters for a firm's output." }, { ...q(1), prompt: "Describe how costs behave as output grows according to the second part of that material." }]), costUsd: 0.02 };
  }
  if (sys.includes("one-page exam cheat sheet")) {
    const ids = [...o.prompt.matchAll(/^([0-9a-f-]{36}) \|/gm)].map((m) => m[1]);
    return { text: JSON.stringify([{ heading: "Core ideas", ids: ids.slice(0, 3) }, { heading: "More", ids: ids.slice(3, 5) }]), costUsd: 0.02 };
  }
  return { text: "Fine.", costUsd: 0.01 };
};

beforeAll(async () => {
  const notesDir = fs.mkdtempSync(path.join(os.tmpdir(), "sd-enotes-"));
  fs.cpSync(path.resolve("sample-notes/ECON301"), path.join(notesDir, "ECON301"), { recursive: true });
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "sd-edata-"));
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
const waitJob = async (kind: string) => {
  for (let i = 0; i < 400; i++) {
    const s = await (await j(`/api/study/${kind}/status`)).json();
    if (!s.running) return s.job;
    await new Promise((r) => setTimeout(r, 15));
  }
  throw new Error("job never finished");
};
const iso = (offset: number) => {
  const d = new Date(Date.now() + offset * 86_400_000);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

describe("mock exams and cheat sheets over the API", () => {
  let examId = "";
  let sitting: any;

  it("fills the bank: cards, questions and problems for every lecture", async () => {
    await j("/api/study/generate", "POST", { course: "ECON301" });
    expect((await waitJob("generate")).totals.created).toBe(6);
    await j("/api/study/quiz/generate", "POST", { course: "ECON301" });
    expect((await waitJob("quiz/generate")).totals.created).toBe(6);
    await j("/api/study/problems/generate", "POST", { course: "ECON301" });
    expect((await waitJob("problems/generate")).totals.created).toBe(3);
    examId = (await (await j("/api/study/exams", "POST", { course: "ECON301", name: "Exam 2", date: iso(2), from: "2020-01-01" })).json()).id;
  });

  it("starts a timed exam from the exam's lectures, with written questions, and no keys on the page", async () => {
    const r = await (await j("/api/study/exam/start", "POST", { examId, preset: "standard" })).json();
    sitting = r;
    expect(r.name).toBe("Exam 2 mock");
    expect(r.items.filter((i: any) => i.type === "mcq")).toHaveLength(6);
    expect(r.items.filter((i: any) => i.type === "problem")).toHaveLength(3);
    expect(r.items.filter((i: any) => i.type === "written")).toHaveLength(2);
    expect(r.warnings.join(" ")).toMatch(/fewer than a full standard/);
    expect(r.durationMin).toBe(45); // 6×1.2 + 3×6 + 2×8 = 41.2 minutes, rounded up to the next 5
    expect(JSON.stringify(r.items)).not.toMatch(/"answer"|explanation|"quote"|rubric|"steps"/); // (the option text "RIGHT" is a fake label, shown to everyone)
    expect((await j("/api/study/exam/start", "POST", { examId: "nope" })).status).toBe(404);
    expect((await j("/api/study/exam/start", "POST", { course: "all" })).status).toBe(400);
  });

  it("can be reopened while it is open, and refuses grading before it is handed in", async () => {
    const again = await (await j(`/api/study/exam/${sitting.id}`)).json();
    expect(again).toMatchObject({ finishedAt: null, results: null, summary: null });
    const early = await j(`/api/study/exam/${sitting.id}/grade-written`, "POST");
    expect(early.status).toBe(400);
  });

  it("hands in: multiple choice and numbers are graded at once; written answers wait, then are graded by evidence", async () => {
    // the keys live only in the database until now: read them to answer correctly
    const row = studyDb(dataDir).prepare("SELECT items_json FROM exam_sittings WHERE id = ?").get(sitting.id) as { items_json: string };
    const keys = JSON.parse(row.items_json);
    const answers: Record<string, unknown> = {};
    for (const it of keys) {
      if (it.type === "mcq") answers[it.id] = it.answer;
      else if (it.type === "problem") answers[it.id] = String(it.answer);
      else answers[it.id] = "Price takers accept the market price because no single firm can move it.";
    }
    const done = await (await j(`/api/study/exam/${sitting.id}/submit`, "POST", { answers })).json();
    expect(done.finishedAt).not.toBeNull();
    expect(done.writtenPending).toBe(true);
    expect(done.summary.byType.find((t: any) => t.type === "mcq")).toMatchObject({ earned: 6, max: 6 });
    expect(done.summary.byType.find((t: any) => t.type === "problem")).toMatchObject({ earned: 9, max: 9 });

    gradeCalls = 0;
    const graded = await (await j(`/api/study/exam/${sitting.id}/grade-written`, "POST")).json();
    expect(gradeCalls).toBe(1); // both written answers in one call
    expect(graded.writtenPending).toBe(false);
    const written = graded.results.filter((r: any) => r.type === "written");
    expect(written).toHaveLength(2);
    // p1 had real evidence; p2's evidence was made up and p3 was not met: one point each
    expect(written.every((w: any) => w.earned === 1 && w.max === 3)).toBe(true);
    expect(written[0].points[1].note).toMatch(/couldn't point to words/);
    expect(graded.earned).toBe(6 + 9 + 2);
    expect((await (await j("/api/usage")).json()).byKind).toMatchObject({ exam: expect.any(Number) });
  });

  it("lets you contest one written grade, once", async () => {
    const written = (await (await j(`/api/study/exam/${sitting.id}`)).json()).results.find((r: any) => r.type === "written");
    expect((await j(`/api/study/exam/${sitting.id}/remark`, "POST", { itemId: written.id, argument: "no" })).status).toBe(400);
    const after = await (await j(`/api/study/exam/${sitting.id}/remark`, "POST", { itemId: written.id, argument: "I did explain that price takers accept the market price." })).json();
    expect(after.results.find((r: any) => r.id === written.id)).toMatchObject({ remarkUsed: true });
    const again = await j(`/api/study/exam/${sitting.id}/remark`, "POST", { itemId: written.id, argument: "Please look again, one more time." });
    expect(again.status).toBe(400);
    expect((await again.json()).error).toMatch(/already contested/);
  });

  it("feeds the exam into your progress and shows it in the history", async () => {
    const p = await (await j("/api/study/progress?course=ECON301")).json();
    expect(p.lectures.some((l: any) => l.mastery.answers > 0)).toBe(true);
    const hist = await (await j("/api/study/exam/history?course=ECON301")).json();
    expect(hist[0]).toMatchObject({ name: "Exam 2 mock", writtenPending: false });
    expect(hist[0].pct).toBeGreaterThan(50);
  });

  it("builds a study guide from your cards, with no AI", async () => {
    const before = (await (await j("/api/usage")).json()).today.calls;
    const r = await (await j("/api/study/sheets", "POST", { examId, kind: "guide" })).json();
    expect(r).toMatchObject({ kind: "guide", version: 1, cards: 6 });
    expect(r.sheet.groups.reduce((n: number, g: any) => n + g.items.length, 0)).toBe(6);
    expect((await (await j("/api/usage")).json()).today.calls).toBe(before);
  });

  it("builds a one-page sheet where Claude only picks ids, versions it, and exports markdown", async () => {
    const r = await (await j("/api/study/sheets", "POST", { examId, kind: "onepage", limit: 5 })).json();
    expect(r).toMatchObject({ kind: "onepage", version: 1, cards: 5 });
    expect(r.sheet.groups.map((g: any) => g.heading)).toEqual(["Core ideas", "More"]);
    expect(r.sheet.left).toBe(1);
    const r2 = await (await j("/api/study/sheets", "POST", { examId, kind: "onepage" })).json();
    expect(r2.version).toBe(2);
    const list = await (await j(`/api/study/sheets?course=ECON301&exam=${examId}`)).json();
    expect(list.map((s: any) => [s.kind, s.version])).toEqual([["onepage", 2], ["onepage", 1], ["guide", 1]]);
    const md = await j(`/api/study/sheets/${r.id}/export.md`);
    expect(md.headers.get("content-type")).toMatch(/markdown/);
    expect(md.headers.get("content-disposition")).toMatch(/attachment; filename=".*-v1\.md"/);
    expect(await md.text()).toContain("## Core ideas");
    expect((await (await j(`/api/study/sheets/${r.id}`)).json()).sheet.cards).toBe(5);
    expect(await (await j(`/api/study/sheets/${r.id}`, "DELETE")).json()).toEqual({ ok: true });
    expect((await j(`/api/study/sheets/${r.id}`)).status).toBe(404);
  });

  it("with AI paused: no written questions, no one-page pick, but the guide and the rest still work", async () => {
    await j("/api/settings", "POST", { aiPaused: true });
    const r = await (await j("/api/study/exam/start", "POST", { examId, preset: "standard" })).json();
    expect(r.items.filter((i: any) => i.type === "written")).toHaveLength(0);
    expect(r.warnings.join(" ")).toMatch(/AI is paused/);
    expect((await j("/api/study/sheets", "POST", { examId, kind: "onepage" })).status).toBe(409);
    expect((await j("/api/study/sheets", "POST", { examId, kind: "guide" })).status).toBe(200);
    await j("/api/settings", "POST", { aiPaused: false });
  });
});
