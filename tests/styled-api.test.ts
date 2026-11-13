import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { Server } from "node:http";
import { createApp } from "../src/server";
import { closeStudyDbs } from "../src/study/db";
import type { Runner } from "../src/claude";

let server: Server, base: string, dataDir: string;
let examId = "";

const NOTE = "---\ntitle: Goods market\ncourse: ECON300\ndate: 2026-11-05\n---\n# Goods market\n\n## Multiplier\n- Households save part of a tax cut, so the tax multiplier is smaller\n- A rise in government purchases shifts the IS curve to the right\n";
const blueprint = {
  course: "ECON300", name: "Test format", minutes: 30, instructions: "Answer everything.",
  sections: [{ title: "Section 1: Problems", points: 6, questions: [{ points: 6, shape: "calc then explain", parts: [{ points: 4, kinds: ["number"] }, { points: 2, kinds: ["written"] }] }] }],
  style: ["Parts build on each other."], examples: "A past exam about something else entirely.",
};
const question = {
  section: 1, number: 1, setup: "In Norland, autonomous spending is 600 and the MPC is 0.8.",
  givens: [{ name: "auto", value: 600, label: "autonomous spending" }, { name: "mpc", value: 0.8, label: "MPC" }],
  parts: [
    { label: "a", kind: "number", points: 4, prompt: "Find equilibrium output.", unit: "", steps: [{ name: "y", label: "Output", expr: "auto / (1 - mpc)", explain: "Divide by 1 - MPC." }] },
    { label: "b", kind: "written", points: 2, prompt: "Why would an equal tax cut raise output by less?", rubric: [{ text: "Part of a tax cut is saved", quote: "Households save part of a tax cut", noteId: "ECON300/2026-11-05_goods.md" }], model: "Some is saved." },
  ],
};
let writes = 0;
const runner: Runner = async (o) => {
  const sys = o.system ?? "";
  if (sys.includes("strict but fair grader")) {
    return { text: JSON.stringify([{ n: 1, points: [{ id: "p1", check: "says people save", met: true, evidence: "people save some" }], remark: "Good." }]), costUsd: 0.01 };
  }
  if (sys.includes("You have not seen any answer key")) return { text: JSON.stringify([{ id: "1.1.a", answer: 3000 }, { id: "1.1.b", unanswerable: false }]), costUsd: 0.01 };
  if (sys.includes("brand-new practice exam")) {
    writes++;
    return { text: JSON.stringify([question]), costUsd: 0.05 };
  }
  return { text: "ok" };
};

beforeAll(async () => {
  const notesDir = fs.mkdtempSync(path.join(os.tmpdir(), "sd-rxnotes-"));
  fs.mkdirSync(path.join(notesDir, "ECON300"));
  fs.writeFileSync(path.join(notesDir, "ECON300", "2026-11-05_goods.md"), NOTE);
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "sd-rxdata-"));
  fs.mkdirSync(path.join(dataDir, "blueprints"));
  fs.writeFileSync(path.join(dataDir, "blueprints", "ECON300.json"), JSON.stringify(blueprint));
  const app = createApp({ runner, notesDir, sampleDir: path.resolve("sample-notes"), dataDir });
  await new Promise<void>((r) => (server = app.listen(0, () => r())));
  base = `http://127.0.0.1:${(server.address() as any).port}`;
  const exam = await (await j("/api/study/exams", "POST", { course: "ECON300", name: "Exam 2", date: "2030-01-01", from: "2026-10-01" })).json();
  examId = exam.id;
});
afterAll(() => {
  server.close();
  closeStudyDbs();
});
const j = (url: string, method = "GET", body?: object) => fetch(`${base}${url}`, { method, headers: body ? { "content-type": "application/json" } : undefined, body: body ? JSON.stringify(body) : undefined });

async function buildOne(): Promise<string> {
  const { jobId } = await (await j("/api/study/styled/build", "POST", { examId })).json();
  for (let i = 0; i < 100; i++) {
    const s = await (await j(`/api/study/styled/build/${jobId}`)).json();
    if (s.state === "done") return s.sittingId;
    if (s.state === "error") throw new Error(s.error);
    await new Promise((r) => setTimeout(r, 20));
  }
  throw new Error("build never finished");
}

describe("mock exams in the professor's format, through the API", () => {
  it("says which classes have a format", async () => {
    expect(await (await j("/api/study/styled/blueprint?course=ECON300")).json()).toMatchObject({ name: "Test format", minutes: 30, points: 6 });
    expect(await (await j("/api/study/styled/blueprint?course=ECON301")).json()).toBeNull();
  });

  it("writes an exam in the background, then serves it without any keys", async () => {
    const id = await buildOne();
    expect(writes).toBe(1);
    const sitting = await (await j(`/api/study/styled/${id}`)).json();
    const text = JSON.stringify(sitting);
    expect(sitting.exam.questions[0].parts.map((p: any) => p.id)).toEqual(["1.1.a", "1.1.b"]);
    for (const secret of ['"steps"', '"rubric"', '"model"', '"answer"', "Households save part"]) expect(text).not.toContain(secret);
  });

  it("hands in, grades the number at once and the written answer by evidence, and lists it", async () => {
    const id = await buildOne();
    const done = await (await j(`/api/study/styled/${id}/submit`, "POST", { answers: { "1.1.a": "3,000", "1.1.b": "Because people save some of it." } })).json();
    expect(done.totals).toMatchObject({ earned: 4, max: 6 });
    expect(done.pendingWritten).toBe(true);
    expect(done.exam.questions[0].parts[0].steps[0].value).toBe(3000); // keys only after hand-in
    const graded = await (await j(`/api/study/styled/${id}/grade-written`, "POST")).json();
    expect(graded.totals).toMatchObject({ earned: 6, max: 6 });
    expect((await j(`/api/study/styled/${id}/submit`, "POST", { answers: {} })).status).toBe(400);
    const list = await (await j("/api/study/styled?course=ECON300")).json();
    expect(list.find((x: any) => x.id === id)).toMatchObject({ earned: 6, max: 6, examId });
  });

  it("refuses to write an exam while AI is paused, or for a class with no format", async () => {
    await j("/api/settings", "POST", { aiPaused: true });
    expect((await j("/api/study/styled/build", "POST", { examId })).status).toBe(409);
    await j("/api/settings", "POST", { aiPaused: false });
    const other = await (await j("/api/study/exams", "POST", { course: "ECON301", name: "Final", date: "2030-01-01", from: "2026-10-01" })).json();
    expect((await j("/api/study/styled/build", "POST", { examId: other.id })).status).toBe(400);
    expect((await j("/api/study/styled/build", "POST", { examId: "nope" })).status).toBe(404);
  });
});
