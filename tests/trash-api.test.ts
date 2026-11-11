import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { Server } from "node:http";
import { createApp } from "../src/server";
import { closeStudyDbs } from "../src/study/db";
import type { Runner } from "../src/claude";

let server: Server, base: string;
const runner: Runner = async () => ({ text: "ok", costUsd: 0 });

beforeAll(async () => {
  const notesDir = fs.mkdtempSync(path.join(os.tmpdir(), "sd-tnotes-"));
  fs.mkdirSync(path.join(notesDir, "ECON301"));
  fs.writeFileSync(path.join(notesDir, "ECON301", "2026-10-13_a.md"), "---\ntitle: A\ncourse: ECON301\ndate: 2026-10-13\n---\nbody");
  const app = createApp({ runner, notesDir, sampleDir: path.resolve("sample-notes"), dataDir: fs.mkdtempSync(path.join(os.tmpdir(), "sd-tdata-")) });
  await new Promise<void>((r) => (server = app.listen(0, () => r())));
  base = `http://127.0.0.1:${(server.address() as any).port}`;
});
afterAll(() => {
  server.close();
  closeStudyDbs();
});
const j = (url: string, method = "GET", body?: object) =>
  fetch(`${base}${url}`, { method, headers: body ? { "content-type": "application/json" } : undefined, body: body ? JSON.stringify(body) : undefined });

describe("deleting with undo, through the API", () => {
  it("moves a deleted card to the trash and brings it back with its reviews", async () => {
    const card = await (await j("/api/study/cards", "POST", { course: "ECON301", front: "What is MRTS?", back: "Slope of the isoquant" })).json();
    await j("/api/study/review", "POST", { cardId: card.id, grade: 3 });

    const del = await (await j(`/api/study/cards/${card.id}`, "DELETE")).json();
    expect(del).toMatchObject({ ok: true, trash: { kind: "card", label: "What is MRTS?", history: 1 } });
    expect(await (await j("/api/study/cards?course=ECON301")).json()).toHaveLength(0);

    const trash = await (await j("/api/study/trash?course=ECON301")).json();
    expect(trash.keptDays).toBe(30);
    expect(trash.items).toHaveLength(1);

    const back = await j(`/api/study/trash/${del.trash.id}/restore`, "POST");
    expect(back.status).toBe(200);
    const cards = await (await j("/api/study/cards?course=ECON301")).json();
    expect(cards).toHaveLength(1);
    expect(cards[0]).toMatchObject({ id: card.id, front: "What is MRTS?", reps: 1 });
    expect((await (await j("/api/study/trash?course=ECON301")).json()).items).toHaveLength(0);
  });

  it("answers plainly when there is nothing to delete or restore", async () => {
    expect(await (await j("/api/study/cards/nope", "DELETE")).json()).toEqual({ ok: false, trash: null });
    const r = await j("/api/study/trash/nope/restore", "POST");
    expect(r.status).toBe(400);
    expect((await r.json()).error).toMatch(/isn't in the trash/);
    expect((await j("/api/study/trash?course=NOPE")).status).toBe(404);
  });

  it("can delete something from the trash for good", async () => {
    const card = await (await j("/api/study/cards", "POST", { course: "ECON301", front: "Throwaway", back: "x" })).json();
    const del = await (await j(`/api/study/cards/${card.id}`, "DELETE")).json();
    expect(await (await j(`/api/study/trash/${del.trash.id}`, "DELETE")).json()).toEqual({ ok: true });
    expect((await j(`/api/study/trash/${del.trash.id}/restore`, "POST")).status).toBe(400);
  });
});
