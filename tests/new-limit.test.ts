import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { Server } from "node:http";
import { createApp } from "../src/server";
import { DEFAULT_NEW_PER_DAY, MAX_NEW_PER_DAY, MIN_NEW_PER_DAY, loadSettings, saveSettings, validNewPerDay } from "../src/settings";
import { closeStudyDbs, studyDb } from "../src/study/db";
import { addCard, buildSession, counts } from "../src/study/cards";
import type { Runner } from "../src/claude";

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "sd-limit-"));
let server: Server, base: string, dataDir: string;
const runner: Runner = async () => ({ text: "Fine.", costUsd: 0 });

beforeAll(async () => {
  const notesDir = tmp();
  fs.cpSync(path.resolve("sample-notes/ECON301"), path.join(notesDir, "ECON301"), { recursive: true });
  dataDir = tmp();
  const app = createApp({ runner, notesDir, sampleDir: path.resolve("sample-notes"), dataDir });
  await new Promise<void>((r) => (server = app.listen(0, () => r())));
  base = `http://127.0.0.1:${(server.address() as any).port}`;
});
afterAll(() => {
  server.close();
  closeStudyDbs();
});
const j = (url: string, method = "GET", body?: object) => fetch(`${base}${url}`, { method, headers: { "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined });

describe("the new-cards-per-day setting", () => {
  it("accepts whole numbers in range and nothing else", () => {
    expect([5, 20, 100, "30", " 45 "].map(validNewPerDay)).toEqual([5, 20, 100, 30, 45]);
    expect([4, 101, 20.5, "abc", "", null, undefined, NaN, -3, true].map(validNewPerDay)).toEqual(Array(10).fill(undefined));
  });

  it("defaults to 20, keeps a saved value, and ignores a bad value in the file", () => {
    const dir = tmp();
    expect(loadSettings(dir).newPerDay).toBe(DEFAULT_NEW_PER_DAY);
    saveSettings(dir, { newPerDay: 40 });
    expect(loadSettings(dir).newPerDay).toBe(40);
    fs.writeFileSync(path.join(dir, "settings.json"), JSON.stringify({ demo: false, aiPaused: false, newPerDay: 9999 }));
    expect(loadSettings(dir).newPerDay).toBe(DEFAULT_NEW_PER_DAY);
    fs.writeFileSync(path.join(dir, "settings.json"), "not json");
    expect(loadSettings(dir).newPerDay).toBe(DEFAULT_NEW_PER_DAY);
    // an older settings file without the field still loads
    fs.writeFileSync(path.join(dir, "settings.json"), JSON.stringify({ demo: true, aiPaused: true }));
    expect(loadSettings(dir)).toMatchObject({ demo: true, aiPaused: true, newPerDay: DEFAULT_NEW_PER_DAY });
  });

  it("changes how many new cards a session offers, and counts them back as you study", async () => {
    const db = studyDb(tmp());
    const now = new Date(2026, 10, 10, 12);
    for (let i = 0; i < 60; i++) await addCard(db, { course: "A", front: `question number ${i}`, back: `answer ${i}` }, now);
    expect(counts(db, "A", now).newAvailable).toBe(20);
    expect(counts(db, "A", now, 35).newAvailable).toBe(35);
    expect(counts(db, "A", now, 100).newAvailable).toBe(60); // can't offer more than exist
    expect(await buildSession(db, "A", now, 120, 35)).toHaveLength(35);
    expect(await buildSession(db, "A", now, 20, 35)).toHaveLength(20); // a session's own cap still applies
  });

  it("is saved through the API and used by the Study screen's counts and sessions", async () => {
    await j("/api/study/cards", "POST", { course: "ECON301", front: "seed card", back: "seed" }); // makes the study db
    for (let i = 0; i < 40; i++) await j("/api/study/cards", "POST", { course: "ECON301", front: `Card ${i} about topic ${i * 7}`, back: `Back ${i}` });
    expect((await (await j("/api/study/today?course=ECON301")).json())).toMatchObject({ newPerDay: 20, counts: { newAvailable: 20, total: 41 } });
    const set = await (await j("/api/settings", "POST", { newPerDay: 30 })).json();
    expect(set).toMatchObject({ ok: true, newPerDay: 30, aiPaused: false });
    expect((await (await j("/api/study/today?course=ECON301")).json())).toMatchObject({ newPerDay: 30, counts: { newAvailable: 30 } });
    expect((await (await j("/api/study/session?course=ECON301&limit=120")).json())).toHaveLength(30);
    expect(loadSettings(dataDir).newPerDay).toBe(30); // it survives a restart
  });

  it("rejects an out-of-range value with a clear message and keeps the old one", async () => {
    for (const bad of [3, 500, "lots", 12.5]) {
      const r = await j("/api/settings", "POST", { newPerDay: bad });
      expect(r.status).toBe(400);
      expect((await r.json()).error).toBe(`Pick a whole number of new cards a day from ${MIN_NEW_PER_DAY} to ${MAX_NEW_PER_DAY}.`);
    }
    expect((await (await j("/api/study/today?course=ECON301")).json()).newPerDay).toBe(30);
    // changing another setting leaves the limit alone
    await j("/api/settings", "POST", { aiPaused: true });
    expect(loadSettings(dataDir).newPerDay).toBe(30);
    await j("/api/settings", "POST", { aiPaused: false });
  });
});
