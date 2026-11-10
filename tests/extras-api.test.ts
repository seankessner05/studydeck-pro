import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { Server } from "node:http";
import { createApp } from "../src/server";
import { closeStudyDbs } from "../src/study/db";
import type { Runner } from "../src/claude";

let server: Server, base: string, dataDir: string;
let tutorCalls = 0;
const bodyOf = (prompt: string) => (prompt.split(/<note[^>]*>\n/)[1] ?? "").split("\n</note>")[0];

const runner: Runner = async (o) => {
  const sys = o.system ?? "";
  if (sys.includes("spaced-repetition flashcards")) {
    const title = o.prompt.match(/<note title="([^"]*)"/)![1];
    const w = bodyOf(o.prompt).split(/\s+/);
    return { text: JSON.stringify([0, 1].map((k) => ({ front: [`What is the central idea of ${title}?`, `Which formula or worked example appears in ${title}?`][k], back: [`The main idea of ${title}, in short.`, `A worked example from ${title}.`][k], quote: w.slice(15 + k * 12, 22 + k * 12).join(" "), section: "Notes" }))), costUsd: 0.01 };
  }
  if (sys.includes("teach-back method")) {
    tutorCalls++;
    const body = bodyOf(o.prompt);
    const w = body.split(/\s+/);
    const answer = o.prompt.match(/STUDENT \(round \d of 3\): ([\s\S]*?)\n\nRespond now/)![1];
    const evidence = answer.split(/\s+/).slice(0, 4).join(" ");
    return { text: JSON.stringify({ ideas: [{ idea: "Idea one", quote: w.slice(15, 22).join(" "), covered: true, evidence }, { idea: "Idea two", quote: w.slice(30, 37).join(" "), covered: false, evidence: "" }], message: "Why does that hold in general?", done: false, next: "Re-read the second idea." }), costUsd: 0.02 };
  }
  return { text: "Fine.", costUsd: 0.01 };
};

beforeAll(async () => {
  const notesDir = fs.mkdtempSync(path.join(os.tmpdir(), "sd-xnotes-"));
  fs.cpSync(path.resolve("sample-notes/ECON301"), path.join(notesDir, "ECON301"), { recursive: true });
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "sd-xdata-"));
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

describe("export, match, backup and tutor over the API", () => {
  it("has nothing to export or match before there are cards", async () => {
    expect((await j("/api/study/export/anki?course=ECON301")).status).toBe(400);
    expect((await j("/api/study/export/anki?course=ECON301&what=questions")).status).toBe(400);
    const m = await j("/api/study/match?course=ECON301");
    expect(m.status).toBe(400);
    expect((await m.json()).error).toMatch(/at least 3/);
    expect((await j("/api/study/export/anki?course=NOPE")).status).toBe(404);
  });

  it("makes cards, then exports them for Anki as a download and offers match pairs", async () => {
    await j("/api/study/generate", "POST", { course: "ECON301" });
    for (let i = 0; i < 300; i++) { if (!(await (await j("/api/study/generate/status")).json()).running) break; await new Promise((r) => setTimeout(r, 15)); }
    const r = await j("/api/study/export/anki?course=ECON301");
    expect(r.status).toBe(200);
    expect(r.headers.get("content-disposition")).toBe('attachment; filename="studydeck-cards-ECON301.txt"');
    expect(r.headers.get("x-studydeck-count")).toBe("6");
    const text = await r.text();
    expect(text.startsWith("#separator:tab\n#html:true\n#tags column:3\n")).toBe(true);
    expect(text.trimEnd().split("\n")).toHaveLength(9);
    const pairs = await (await j("/api/study/match?course=ECON301&count=4")).json();
    expect(pairs).toHaveLength(4);
    expect(pairs[0]).toMatchObject({ definition: expect.any(String), term: expect.any(String) });
  });

  it("backs up your study data on request and lists the copies; demo mode refuses", async () => {
    const b = await (await j("/api/study/backup", "POST")).json();
    expect(b.file).toMatch(/^studydeck-\d{8}-\d{6}\.db$/);
    expect(fs.existsSync(path.join(dataDir, "backups", b.file))).toBe(true);
    expect((await (await j("/api/study/backups")).json())[0].file).toBe(b.file);
    await j("/api/settings", "POST", { demo: true });
    expect((await j("/api/study/backup", "POST")).status).toBe(400);
    await j("/api/settings", "POST", { demo: false });
  });

  let session: any;
  it("lists topics and starts a tutor session with a fixed opening and no AI call", async () => {
    const notes = (await (await j("/api/notes?course=ECON301")).json()) as any[];
    const noteId = notes[0].id;
    const topics = await (await j(`/api/study/tutor/topics?noteId=${encodeURIComponent(noteId)}`)).json();
    expect(topics[0].section).toBeNull();
    tutorCalls = 0;
    session = await (await j("/api/study/tutor/start", "POST", { noteId, topic: topics[0].topic })).json();
    expect(session.transcript[0].text).toMatch(/in your own words/);
    expect(tutorCalls).toBe(0);
    expect((await j("/api/study/tutor/start", "POST", { noteId: "ECON301/nope.md" })).status).toBe(404);
  });

  it("answers a turn with one question, reports progress without revealing ideas, and notes usage", async () => {
    const r = await (await j(`/api/study/tutor/${session.id}/turn`, "POST", { text: "It is about how firms decide how much to produce given costs." })).json();
    expect(r).toMatchObject({ done: false, round: 1, progress: { covered: 1, total: 2 }, message: "Why does that hold in general?" });
    expect(JSON.stringify(r)).not.toMatch(/Idea two|Re-read the second/);
    expect((await (await j("/api/usage")).json()).byKind).toMatchObject({ tutor: 1 });
    expect((await j(`/api/study/tutor/${session.id}/turn`, "POST", { text: "idk" })).status).toBe(400);
    const saved = await (await j(`/api/study/tutor/${session.id}`)).json();
    expect(saved.transcript).toHaveLength(3);
  });

  it("finishes after the last round with a score, shows history, and is blocked while AI is paused", async () => {
    await j("/api/settings", "POST", { aiPaused: true });
    expect((await j(`/api/study/tutor/${session.id}/turn`, "POST", { text: "Another attempt at explaining the idea." })).status).toBe(409);
    await j("/api/settings", "POST", { aiPaused: false });
    await j(`/api/study/tutor/${session.id}/turn`, "POST", { text: "Marginal cost rising makes firms stop at some output level." });
    const last = await (await j(`/api/study/tutor/${session.id}/turn`, "POST", { text: "And that is why price equals marginal cost for them." })).json();
    expect(last).toMatchObject({ done: true, round: 3, score: 0.5 });
    expect(last.summary.gaps[0].idea).toBe("Idea two");
    const hist = await (await j("/api/study/tutor/history?course=ECON301")).json();
    expect(hist[0]).toMatchObject({ id: session.id, score: 0.5, gaps: 1 });
    expect((await j(`/api/study/tutor/${session.id}/turn`, "POST", { text: "One more try at this please." })).status).toBe(400);
  });
});
