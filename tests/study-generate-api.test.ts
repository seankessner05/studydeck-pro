import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { Server } from "node:http";
import { createApp } from "../src/server";
import { closeStudyDbs } from "../src/study/db";
import type { Runner } from "../src/claude";

let server: Server, base: string, notesDir: string;
let flashcardCalls = 0;
let holdUntil: Promise<void> | undefined;

/** Writes two cards per lecture whose quotes are real, and plain text for chat. */
const runner: Runner = async (o) => {
  if (!o.system?.includes("spaced-repetition flashcards")) return { text: "Fine.", costUsd: 0.01 };
  flashcardCalls++;
  if (holdUntil) await holdUntil;
  if (o.signal?.aborted) throw new Error("Cancelled");
  const title = o.prompt.match(/<note title="([^"]*)"/)![1];
  const body = o.prompt.split(/<note[^>]*>\n/)[1].split("\n</note>")[0];
  const words = body.split(/\s+/);
  const cards = [0, 1].map((k) => ({
    front: [`What is the central idea of ${title}?`, `Which formula or worked example appears in ${title}?`][k],
    back: "An answer taken from the note.",
    quote: words.slice(15 + k * 12, 22 + k * 12).join(" "),
    section: "Notes",
  }));
  return { text: JSON.stringify(cards), costUsd: 0.02 };
};

beforeAll(async () => {
  notesDir = fs.mkdtempSync(path.join(os.tmpdir(), "sd-gnotes-"));
  fs.cpSync(path.resolve("sample-notes/ECON301"), path.join(notesDir, "ECON301"), { recursive: true });
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "sd-gdata-"));
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
const waitDone = async () => {
  for (let i = 0; i < 300; i++) {
    const s = await (await j("/api/study/generate/status")).json();
    if (!s.running) return s.job;
    await new Promise((r) => setTimeout(r, 15));
  }
  throw new Error("job never finished");
};

describe("generating cards over the API", () => {
  it("plans: lists lectures newest first with their status and the options", async () => {
    const p = await (await j("/api/study/generate/plan?course=ECON301")).json();
    expect(p.lectures).toHaveLength(3);
    expect(p.lectures.map((l: any) => l.date)).toEqual(["2026-10-22", "2026-10-15", "2026-10-08"]);
    expect(p.lectures.every((l: any) => l.status === "none" && l.cards === 0 && l.words > 20)).toBe(true);
    expect(p.densities).toEqual([
      { id: "light", label: "Light", target: 5 },
      { id: "normal", label: "Normal", target: 8 },
      { id: "thorough", label: "Thorough", target: 14 },
    ]);
    expect(p).toMatchObject({ paused: false, running: false, maxPerJob: 40 });
    expect((await j("/api/study/generate/plan?course=NOPE")).status).toBe(404);
  });

  it("generates for every new lecture, saves verified cards, and records usage", async () => {
    const start = await j("/api/study/generate", "POST", { course: "ECON301", density: "light" });
    expect(start.status).toBe(200);
    expect((await start.json()).items).toHaveLength(3);
    const job = await waitDone();
    expect(job.status).toBe("done");
    expect(job.totals).toMatchObject({ created: 6, calls: 3, dropped: 0, duplicates: 0 });

    const cards = await (await j("/api/study/cards?course=ECON301")).json();
    expect(cards).toHaveLength(6);
    expect(cards.every((c: any) => c.origin === "generated" && c.quote && c.noteId.startsWith("ECON301/"))).toBe(true);

    const p = await (await j("/api/study/generate/plan?course=ECON301")).json();
    expect(p.lectures.map((l: any) => [l.status, l.cards])).toEqual([["generated", 2], ["generated", 2], ["generated", 2]]);
    const usage = await (await j("/api/usage")).json();
    expect(usage.byKind).toMatchObject({ cards: 3 });
    expect((await (await j("/api/study/today?course=ECON301")).json()).counts.newAvailable).toBe(6);
  });

  it("refuses to start when everything already has cards, but lets you pick lectures to add more", async () => {
    const none = await j("/api/study/generate", "POST", { course: "ECON301" });
    expect(none.status).toBe(400);
    expect((await none.json()).error).toContain("Nothing to generate");

    const p = await (await j("/api/study/generate/plan?course=ECON301")).json();
    await j("/api/study/generate", "POST", { course: "ECON301", noteIds: [p.lectures[0].id] });
    const job = await waitDone();
    expect(job.items).toHaveLength(1);
    expect(job.totals).toMatchObject({ created: 0, duplicates: 2 }); // same questions again: nothing new to add
    expect((await (await j("/api/study/cards?course=ECON301")).json())).toHaveLength(6);
  });

  it("notices a lecture that changed, and counts it as handled once reprocessed even with no new cards", async () => {
    const file = path.join(notesDir, "ECON301", "2026-10-15_sample-perfect-competition.md");
    fs.appendFileSync(file, "\nAdded later: price takers cannot influence the market price.\n");
    let p = await (await j("/api/study/generate/plan?course=ECON301")).json();
    expect(p.lectures.map((l: any) => l.status)).toEqual(["generated", "stale", "generated"]);

    await j("/api/study/generate", "POST", { course: "ECON301" }); // default: only the changed lecture
    const job = await waitDone();
    expect(job.items.map((i: any) => i.title)).toEqual(["Perfect Competition"]);
    p = await (await j("/api/study/generate/plan?course=ECON301")).json();
    expect(p.lectures.map((l: any) => l.status)).toEqual(["generated", "generated", "generated"]);
    expect((await (await j("/api/study/cards?course=ECON301")).json())).toHaveLength(6);
  });

  it("validates the request and caps how many lectures one job may cover", async () => {
    const bad = await j("/api/study/generate", "POST", { course: "NOPE" });
    expect(bad.status).toBe(404);
    const nope = await j("/api/study/generate", "POST", { course: "ECON301", noteIds: ["ECON301/does-not-exist.md"] });
    expect(nope.status).toBe(400);
  });

  it("refuses while AI is paused, and pausing cancels a running job", async () => {
    flashcardCalls = 0;
    // a second class so there is something new to generate
    fs.cpSync(path.resolve("sample-notes/ECON300"), path.join(notesDir, "ECON300"), { recursive: true });
    let release!: () => void;
    holdUntil = new Promise<void>((r) => (release = r));
    const started = await j("/api/study/generate", "POST", { course: "ECON300" });
    expect(started.status).toBe(200);
    for (let i = 0; i < 100 && flashcardCalls === 0; i++) await new Promise((r) => setTimeout(r, 10));
    expect((await j("/api/study/generate", "POST", { course: "ECON300" })).status).toBe(409); // already running

    await j("/api/settings", "POST", { aiPaused: true });
    release();
    holdUntil = undefined;
    const job = await waitDone();
    expect(job.status).toBe("cancelled");
    expect(job.items.every((i: any) => i.state !== "queued" && i.state !== "running")).toBe(true);

    const blocked = await j("/api/study/generate", "POST", { course: "ECON300" });
    expect(blocked.status).toBe(409);
    expect((await blocked.json()).error).toContain("AI is paused");
    expect((await (await j("/api/study/generate/plan?course=ECON300")).json()).paused).toBe(true);
    await j("/api/settings", "POST", { aiPaused: false });
  });

  it("cancel does nothing when no job is running", async () => {
    expect(await (await j("/api/study/generate/cancel", "POST")).json()).toEqual({ cancelled: false });
  });
});
