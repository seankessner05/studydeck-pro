import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { Server } from "node:http";
import { createApp } from "../src/server";
import { closeStudyDbs, studyDb } from "../src/study/db";
import { addCard } from "../src/study/cards";
import type { Runner } from "../src/claude";

let server: Server, base: string, dataDir: string;
const runner: Runner = async () => ({ text: "ok" });
const iso = (offsetDays: number) => {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

beforeAll(async () => {
  const notesDir = fs.mkdtempSync(path.join(os.tmpdir(), "sd-cramnotes-"));
  for (const c of ["ECON300", "ECON301"]) {
    fs.mkdirSync(path.join(notesDir, c));
    fs.writeFileSync(path.join(notesDir, c, `${iso(-5)}_a.md`), `---\ntitle: Lecture\ncourse: ${c}\ndate: ${iso(-5)}\n---\nbody`);
  }
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "sd-cramdata-"));
  for (const course of ["ECON300", "ECON301"]) for (let i = 0; i < 70; i++) await addCard(studyDb(dataDir), { course, front: `${course} card ${i}`, back: "x" });
  const app = createApp({ runner, notesDir, sampleDir: path.resolve("sample-notes"), dataDir });
  await new Promise<void>((r) => (server = app.listen(0, () => r())));
  base = `http://127.0.0.1:${(server.address() as any).port}`;
});
afterAll(() => {
  server.close();
  closeStudyDbs();
});
const j = (url: string, method = "GET", body?: object) => fetch(`${base}${url}`, { method, headers: body ? { "content-type": "application/json" } : undefined, body: body ? JSON.stringify(body) : undefined });

describe("cram mode through the API", () => {
  it("raises the new-card limit only for the class whose exam is days away", async () => {
    await j("/api/settings", "POST", { newPerDay: 20 });
    expect((await (await j("/api/study/today?course=ECON300")).json())).toMatchObject({ cram: null, counts: { newAvailable: 20 } });
    await j("/api/study/exams", "POST", { course: "ECON300", name: "Exam 2", date: iso(2), from: iso(-30) });
    const today = await (await j("/api/study/today?course=ECON300")).json();
    expect(today.cram).toMatchObject({ course: "ECON300", name: "Exam 2", daysLeft: 2, newPerDay: 50 });
    expect(today.counts.newAvailable).toBe(50);
    expect((await (await j("/api/study/today?course=ECON301")).json()).counts.newAvailable).toBe(20);
    expect((await (await j("/api/study/today?course=all")).json()).counts.newAvailable).toBe(70);
    expect(await (await j("/api/study/session?course=ECON300&limit=120")).json()).toHaveLength(50);
    // a higher setting of your own still wins
    await j("/api/settings", "POST", { newPerDay: 60 });
    expect((await (await j("/api/study/today?course=ECON300")).json()).counts.newAvailable).toBe(60);
  });

  it("returns a plan that says it's in cram mode, with a readiness hint per exam", async () => {
    const plan = await (await j("/api/study/plan?course=all&minutes=60")).json();
    expect(plan.cram).toMatchObject({ course: "ECON300", daysLeft: 2 });
    expect(plan.items.some((i: any) => i.kind === "generate")).toBe(false);
    expect(typeof plan.plans[0].next).toBe("string");
  });
});
