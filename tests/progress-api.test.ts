import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { Server } from "node:http";
import { createApp } from "../src/server";
import { closeStudyDbs } from "../src/study/db";
import type { Runner } from "../src/claude";

let server: Server, base: string;
const runner: Runner = async () => ({ text: "Fine.", costUsd: 0 });

beforeAll(async () => {
  const notesDir = fs.mkdtempSync(path.join(os.tmpdir(), "sd-prnotes-"));
  fs.cpSync(path.resolve("sample-notes/ECON301"), path.join(notesDir, "ECON301"), { recursive: true });
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "sd-prdata-"));
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
const iso = (offsetDays: number) => {
  const d = new Date(Date.now() + offsetDays * 86_400_000);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

describe("exams, progress and the plan over the API", () => {
  let examId = "";

  it("creates an exam, validates input, and reports how many lectures it covers", async () => {
    expect((await j("/api/study/exams", "POST", { course: "ECON301", name: "", date: iso(3), from: "2026-01-01" })).status).toBe(400);
    expect((await j("/api/study/exams", "POST", { course: "NOPE", name: "x", date: iso(3), from: "2026-01-01" })).status).toBe(404);
    const made = await (await j("/api/study/exams", "POST", { course: "ECON301", name: "Exam 2", date: iso(3), from: "2020-01-01" })).json();
    examId = made.id;
    const list = await (await j("/api/study/exams?course=ECON301")).json();
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ name: "Exam 2", daysLeft: 3, lectures: 3 });
    expect((await (await j("/api/study/exams?course=ECON300")).json())).toEqual([]);
  });

  it("shows progress per lecture with nothing practiced yet, honestly", async () => {
    const p = await (await j("/api/study/progress?course=ECON301")).json();
    expect(p.lectures).toHaveLength(3);
    expect(p.lectures.every((l: any) => l.mastery.level === "unknown" && l.material.cards === 0)).toBe(true);
    expect(p.weakSpots).toEqual([]);
    expect(p.readiness).toMatchObject({ lectures: 3, practiced: 0, confidence: "low" });
    expect(p.exams[0]).toMatchObject({ name: "Exam 2", daysLeft: 3, lectures: 3 });
    expect(p.insights.map((i: any) => i.kind)).toContain("nomaterial");
    expect((await j("/api/study/progress?course=NOPE")).status).toBe(404);
  });

  it("plans the day: make material first, because there is none, and a mock exam is near", async () => {
    const plan = await (await j("/api/study/plan?course=all&minutes=60")).json();
    expect(plan.items[0]).toMatchObject({ kind: "generate", course: "ECON301" });
    expect(plan.items[0].noteIds).toHaveLength(3);
    expect(plan.plans[0]).toMatchObject({ daysLeft: 3, inScope: 3 });
    expect(plan.budget).toBe(60);
    expect(plan.totalMinutes).toBeLessThanOrEqual(60);
  });

  it("deletes the exam", async () => {
    expect(await (await j(`/api/study/exams/${examId}`, "DELETE")).json()).toEqual({ ok: true });
    expect((await (await j("/api/study/plan?course=all")).json()).items).toEqual([]);
  });
});
