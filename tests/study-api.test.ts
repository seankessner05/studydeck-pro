import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { Server } from "node:http";
import { createApp } from "../src/server";
import { closeStudyDbs } from "../src/study/db";
import type { Runner } from "../src/claude";

let server: Server, base: string;
const runner: Runner = async (o) => {
  o.onText?.("ok");
  return { text: "Fine.", costUsd: 0.02 };
};

beforeAll(async () => {
  const notesDir = fs.mkdtempSync(path.join(os.tmpdir(), "sd-snotes-"));
  fs.mkdirSync(path.join(notesDir, "ECON301"));
  fs.writeFileSync(path.join(notesDir, "ECON301", "2026-10-13_a.md"), "---\ntitle: A\ncourse: ECON301\ndate: 2026-10-13\n---\nbody");
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "sd-sdata-"));
  const ok = (stdout: string) => ({ code: 0, stdout, stderr: "" });
  const doctorExec = async (cmd: string, args: string[]) =>
    args[0] === "auth" ? ok('{"loggedIn": true, "authMethod": "claude.ai", "subscriptionType": "pro"}') : ok(cmd === "claude" && args[0] === "mcp" ? "claude.ai Granola: x - ✔ Connected\n" : "1.0.0\n");
  const app = createApp({ runner, notesDir, sampleDir: path.resolve("sample-notes"), dataDir, doctorExec });
  await new Promise<void>((r) => (server = app.listen(0, () => r())));
  base = `http://127.0.0.1:${(server.address() as any).port}`;
});
afterAll(() => {
  server.close();
  closeStudyDbs();
});

const j = (url: string, method = "GET", body?: object) =>
  fetch(`${base}${url}`, { method, headers: { "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined });

describe("study API", () => {
  it("starts empty and rejects unknown classes", async () => {
    const t = await (await j("/api/study/today?course=ECON301")).json();
    expect(t.counts).toMatchObject({ total: 0, due: 0, newAvailable: 0 });
    expect(t.forecast).toHaveLength(7);
    expect(t.accuracy).toEqual({ reviews: 0, correct: 0, pct: null });
    expect((await j("/api/study/today?course=NOPE")).status).toBe(404);
    expect((await j("/api/study/session?course=NOPE")).status).toBe(404);
  });

  it("adds a card, serves it in a session with button previews, and records a review", async () => {
    const bad = await j("/api/study/cards", "POST", { course: "ECON301", front: "", back: "x" });
    expect(bad.status).toBe(400);
    expect((await j("/api/study/cards", "POST", { course: "all", front: "a", back: "b" })).status).toBe(400);
    const add = await j("/api/study/cards", "POST", { course: "ECON301", front: "What is MRTS?", back: "Slope of the isoquant", quote: "Slope = MPL/MPK", noteId: "ECON301/2026-10-13_a.md" });
    expect(add.status).toBe(200);
    const card = await add.json();
    expect(card).toMatchObject({ front: "What is MRTS?", state: 0, noteId: "ECON301/2026-10-13_a.md" });

    const t1 = await (await j("/api/study/today?course=ECON301")).json();
    expect(t1.counts).toMatchObject({ total: 1, newAvailable: 1 });
    const session = await (await j("/api/study/session?course=ECON301")).json();
    expect(session).toHaveLength(1);
    expect(session[0].previews.map((p: any) => p.grade)).toEqual([1, 2, 3, 4]);

    const rev = await (await j("/api/study/review", "POST", { cardId: card.id, grade: 3, msTaken: 3000 })).json();
    expect(rev.card).toMatchObject({ state: 2, reps: 1 });
    expect(rev.streak).toBe(1);
    expect(rev.previews).toHaveLength(4);
    const t2 = await (await j("/api/study/today?course=ECON301")).json();
    expect(t2.counts).toMatchObject({ total: 1, newAvailable: 0, due: 0 });
    expect(t2.accuracy).toEqual({ reviews: 1, correct: 1, pct: 100 });
    expect((await j("/api/study/review", "POST", { cardId: card.id, grade: 7 })).status).toBe(400);
    expect((await j("/api/study/review", "POST", { cardId: "nope", grade: 3 })).status).toBe(400);
    expect((await (await j("/api/state")).json()).streak).toBe(1);
  });

  it("lists and deletes cards", async () => {
    const list = await (await j("/api/study/cards?course=all")).json();
    expect(list).toHaveLength(1);
    expect((await (await j(`/api/study/cards/${list[0].id}`, "DELETE")).json()).ok).toBe(true);
    expect(await (await j("/api/study/cards?course=all")).json()).toEqual([]);
  });

  it("keeps demo-mode practice separate from real practice", async () => {
    await j("/api/settings", "POST", { demo: true });
    const t = await (await j("/api/study/today?course=ECON300")).json();
    expect(t.counts.total).toBe(0);
    const add = await j("/api/study/cards", "POST", { course: "ECON300", front: "demo q", back: "demo a" });
    expect(add.status).toBe(200);
    await j("/api/settings", "POST", { demo: false });
    expect((await (await j("/api/study/cards?course=all")).json())).toEqual([]);
    await j("/api/settings", "POST", { demo: true });
    expect((await (await j("/api/study/cards?course=all")).json())).toHaveLength(1);
    await j("/api/settings", "POST", { demo: false });
  });
});

describe("Pause AI and usage", () => {
  it("counts chat questions in the usage meter", async () => {
    expect((await (await j("/api/usage")).json())).toMatchObject({ paused: false, today: { calls: 0 } });
    const res = await j("/api/chat", "POST", { course: "ECON301", question: "hi" });
    await res.text();
    const u = await (await j("/api/usage")).json();
    expect(u.today).toEqual({ calls: 1, costUsd: 0.02 });
    expect(u.byKind).toEqual({ chat: 1 });
  });

  it("refuses questions while paused, keeps other settings, and resumes", async () => {
    const set = await (await j("/api/settings", "POST", { aiPaused: true })).json();
    expect(set).toMatchObject({ aiPaused: true, demo: false });
    expect((await (await j("/api/state")).json()).aiPaused).toBe(true);
    const blocked = await j("/api/chat", "POST", { course: "ECON301", question: "hi" });
    expect(blocked.status).toBe(409);
    expect((await blocked.json()).error).toContain("AI is paused");
    expect((await (await j("/api/usage")).json())).toMatchObject({ paused: true, today: { calls: 1 } });
    // studying cards still works: reviewing uses no AI
    expect((await j("/api/study/today?course=all")).status).toBe(200);
    await j("/api/settings", "POST", { aiPaused: false });
    const again = await j("/api/chat", "POST", { course: "ECON301", question: "hi" });
    expect(again.status).toBe(200);
    await again.text();
  });

  it("shows usage and pause state in the Doctor", async () => {
    const checks = await (await j("/api/doctor")).json();
    const usage = checks.find((c: any) => c.id === "usage");
    expect(usage.detail).toContain("calls to Claude today");
  });
});
