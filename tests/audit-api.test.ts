import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { Server } from "node:http";
import { createApp } from "../src/server";
import { closeStudyDbs, studyDb } from "../src/study/db";
import { addGeneratedQuestions, listQuestions } from "../src/study/questions";
import { auditQuestion } from "../src/study/standalone";
import type { GeneratedQuestion } from "../src/study/quizgen";
import type { Runner } from "../src/claude";

let server: Server, base: string, dataDir: string;
const runner: Runner = async () => ({ text: "ok" });
const NOTE = "---\ntitle: Trade policy\ncourse: ECON301\ndate: 2026-10-27\n---\n# Trade\n\n## Tariffs\n- Government gains revenue (rectangle D); C and E become deadweight loss\n- Consumers lose (surplus shrinks from A+B+C+D+E to A)\n- Quotas: same consumer/producer effects, but no government revenue: entire distortion is deadweight loss\n";
const noteId = "ECON301/2026-10-27_trade.md";
const q = (over: Partial<GeneratedQuestion>): GeneratedQuestion => ({ kind: "single", stem: "?", options: ["a", "b", "c", "d"], answer: [0], explanation: "Because.", quote: "Government gains revenue (rectangle D)", section: "Tariffs", ...over });

beforeAll(async () => {
  const notesDir = fs.mkdtempSync(path.join(os.tmpdir(), "sd-aunotes-"));
  fs.mkdirSync(path.join(notesDir, "ECON301"));
  fs.writeFileSync(path.join(notesDir, "ECON301", "2026-10-27_trade.md"), NOTE);
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "sd-audata-"));
  const app = createApp({ runner, notesDir, sampleDir: path.resolve("sample-notes"), dataDir });
  await new Promise<void>((r) => (server = app.listen(0, () => r())));
  base = `http://127.0.0.1:${(server.address() as any).port}`;
  addGeneratedQuestions(studyDb(dataDir), { id: noteId, course: "ECON301" }, "v1", [
    // the question Sean flagged
    q({ stem: "Under a tariff, which area of the welfare graph represents government revenue?", options: ["Rectangle D", "Triangle C", "Area B", "Triangle E"] }),
    // a reworded sentence of the note
    q({ kind: "tf", stem: "Under a quota there are the same consumer and producer effects as a tariff, but no government revenue, so the entire distortion is deadweight loss.", options: ["True", "False"], quote: "same consumer/producer effects, but no government revenue: entire distortion is deadweight loss" }),
    // a good one: a new situation
    q({ stem: "A country can raise its domestic rice price either with a tariff or an import quota. Compared with the tariff, how does the quota affect welfare in the rice market?", options: ["Deadweight loss is larger because no revenue is collected", "Consumers lose less surplus", "Producers gain less surplus", "Imports rise"], quote: "same consumer/producer effects, but no government revenue" }),
  ]);
});
afterAll(() => {
  server.close();
  closeStudyDbs();
});
const j = (url: string, body: object) => fetch(`${base}${url}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

describe("checking saved questions against today's rules", () => {
  it("explains why each failing question fails", () => {
    expect(auditQuestion({ kind: "single", stem: "Which area is revenue?", options: ["Rectangle D", "b", "c", "d"], answer: [0], explanation: "", quote: null }, undefined)).toMatch(/doesn't show/);
    expect(auditQuestion({ kind: "single", stem: "A country taxes imported steel. Who gains?", options: ["Domestic producers", "b", "c", "d"], answer: [0], explanation: "", quote: null }, NOTE)).toBeUndefined();
  });

  it("lists failing questions without changing anything, then moves exactly those to the trash", async () => {
    const dry = await (await j("/api/study/quiz/audit", { course: "ECON301" })).json();
    expect(dry.count).toBe(2);
    expect(dry.lectures).toEqual([noteId]);
    expect(dry.examples.map((x: any) => x.why).join(" ")).toMatch(/doesn't show.*copies the notes|copies the notes.*doesn't show/);
    expect(listQuestions(studyDb(dataDir), "ECON301")).toHaveLength(3);

    const moved = await (await j("/api/study/quiz/audit", { course: "ECON301", dryRun: false })).json();
    expect(moved).toEqual({ moved: 2, lectures: [noteId] });
    expect(listQuestions(studyDb(dataDir), "ECON301").map((x) => x.stem)).toEqual([expect.stringContaining("rice price")]);
    const trash = await (await fetch(`${base}/api/study/trash?course=ECON301`)).json();
    expect(trash.items).toHaveLength(2);
    expect((await (await j("/api/study/quiz/audit", { course: "ECON301" })).json()).count).toBe(0);
  });
});
