import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { Server } from "node:http";
import { createApp } from "../src/server";
import { closeStudyDbs } from "../src/study/db";
import { DEFAULT_COURSES } from "../src/courses";
import { Suggester } from "../src/suggest";
import type { Note } from "../src/notes";
import type { Runner } from "../src/claude";

const note = (course: string, title: string, body: string): Note => ({ id: `${course}/${title}.md`, course, file: `${title}.md`, title, date: "2026-11-01", body, sample: false } as Note);
const macro = (t: string) => note("ECON300", t, "The IS curve and LM curve meet at equilibrium output and the interest rate. Government spending shifts IS right; the money supply shifts LM. Solow steady state capital per worker, savings rate, depreciation, golden rule consumption.");
const micro = (t: string) => note("ECON301", t, "A monopolist sets marginal revenue equal to marginal cost and reads price off the demand curve. Deadweight loss, consumer surplus, producer surplus, elasticity of demand, cost minimization with isoquants and isocosts.");
const filed = [macro("IS-LM"), macro("Solow"), macro("Golden rule"), micro("Monopoly"), micro("Welfare"), micro("Costs")];

describe("suggesting a class", () => {
  it("suggests the class whose notes a note resembles", () => {
    const s = new Suggester(filed, DEFAULT_COURSES);
    expect(s.suggest(note("unsorted", "Review", "We drew the IS and LM curves: more government spending shifts IS right, raising equilibrium output and the interest rate."))).toMatchObject({ course: "ECON300" });
    expect(s.suggest(note("unsorted", "Pricing", "The monopolist chooses output where marginal revenue equals marginal cost; deadweight loss and lost consumer surplus follow."))).toMatchObject({ course: "ECON301" });
  });

  it("says nothing for a note that isn't like any class", () => {
    const s = new Suggester(filed, DEFAULT_COURSES);
    expect(s.suggest(note("unsorted", "Visa appointment", "Bring the passport, two photos, the bank statement and the acceptance letter to the consulate on Tuesday."))).toBeUndefined();
  });

  it("gives a strong nudge when the title names the class", () => {
    const s = new Suggester(filed, DEFAULT_COURSES);
    const r = s.suggest(note("unsorted", "Macroeconomics study group", "We met in the library and divided the review sheet."));
    expect(r).toMatchObject({ course: "ECON300", confidence: "maybe" });
  });
});

describe("Inbox suggestions through the API", () => {
  let server: Server, base: string;
  beforeAll(async () => {
    const notesDir = fs.mkdtempSync(path.join(os.tmpdir(), "sd-sgnotes-"));
    const write = (n: Note) => {
      fs.mkdirSync(path.join(notesDir, n.course), { recursive: true });
      fs.writeFileSync(path.join(notesDir, n.course, n.file), `---\ntitle: ${n.title}\ncourse: ${n.course}\ndate: ${n.date}\n---\n${n.body}`);
    };
    filed.forEach(write);
    write(note("unsorted", "2026-11-12_review", "IS and LM curves: government spending shifts IS right, equilibrium output and the interest rate rise; Solow golden rule savings rate."));
    write(note("unsorted", "2026-11-13_visa", "Bring the passport and two photos to the consulate."));
    const app = createApp({ runner: (async () => ({ text: "" })) as Runner, notesDir, sampleDir: path.resolve("sample-notes"), dataDir: fs.mkdtempSync(path.join(os.tmpdir(), "sd-sgdata-")) });
    await new Promise<void>((r) => (server = app.listen(0, () => r())));
    base = `http://127.0.0.1:${(server.address() as any).port}`;
  });
  afterAll(() => {
    server.close();
    closeStudyDbs();
  });

  it("lists every Inbox note with a suggestion or none, and filing one moves it", async () => {
    const list = await (await fetch(`${base}/api/notes/suggestions`)).json();
    const byFile = Object.fromEntries(list.map((x: any) => [x.file, x.suggestion]));
    expect(byFile["2026-11-12_review.md"]).toMatchObject({ course: "ECON300" });
    expect(byFile["2026-11-13_visa.md"]).toBeNull();
    const moved = await fetch(`${base}/api/notes/unsorted/2026-11-12_review.md`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ course: "ECON300" }) });
    expect(moved.status).toBe(200);
    expect((await (await fetch(`${base}/api/notes/suggestions`)).json()).map((x: any) => x.file)).toEqual(["2026-11-13_visa.md"]);
  });
});
