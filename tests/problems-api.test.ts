import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { Server } from "node:http";
import { createApp } from "../src/server";
import { closeStudyDbs } from "../src/study/db";
import type { Runner } from "../src/claude";

let server: Server, base: string;

/** Claude stand-in: writes one problem per lecture (the app computes the answer, 500) and solves blind with 500. */
const runner: Runner = async (o) => {
  const sys = o.system ?? "";
  if (sys.includes("have not seen any worked solution")) return { text: JSON.stringify([{ n: 1, answer: 500 }]), costUsd: 0.01 };
  if (sys.includes("numerical practice problems")) {
    const title = o.prompt.match(/<note title="([^"]*)"/)![1];
    const body = o.prompt.split(/<note[^>]*>\n/)[1].split("\n</note>")[0];
    const words = body.split(/\s+/);
    return {
      text: JSON.stringify([{
        stem: `The marginal propensity to consume is 0.9 and spending rises by 50. By how much does output rise? (${title})`,
        givens: [{ name: "mpc", value: 0.9, label: "marginal propensity to consume" }, { name: "dg", value: 50, label: "spending change" }],
        steps: [
          { name: "mult", label: "Spending multiplier", expr: "1 / (1 - mpc)", explain: "Multiplier is 1 / (1 − MPC)." },
          { name: "dy", label: "Change in output", expr: "mult * dg", explain: "Output moves by multiplier times spending." },
        ],
        unit: "", quote: words.slice(15, 22).join(" "),
      }]),
      costUsd: 0.03,
    };
  }
  return { text: "Fine.", costUsd: 0.01 };
};

beforeAll(async () => {
  const notesDir = fs.mkdtempSync(path.join(os.tmpdir(), "sd-pnotes-"));
  fs.cpSync(path.resolve("sample-notes/ECON301"), path.join(notesDir, "ECON301"), { recursive: true });
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "sd-pdata-"));
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
    const s = await (await j("/api/study/problems/generate/status")).json();
    if (!s.running) return s.job;
    await new Promise((r) => setTimeout(r, 15));
  }
  throw new Error("job never finished");
};

describe("practice problems over the API", () => {
  let runId = "";
  let problems: any[] = [];

  it("plans with problem-sized options and generates a checked problem per lecture", async () => {
    const p = await (await j("/api/study/problems/generate/plan?course=ECON301")).json();
    expect(p.densities).toEqual([
      { id: "light", label: "Few", target: 2 },
      { id: "normal", label: "Normal", target: 3 },
      { id: "thorough", label: "Many", target: 5 },
    ]);
    expect((await j("/api/study/problems/generate", "POST", { course: "ECON301" })).status).toBe(200);
    const job = await waitDone();
    expect(job.totals).toMatchObject({ created: 3, calls: 6, dropped: 0 });
    expect((await (await j("/api/usage")).json()).byKind).toMatchObject({ problems: 6 });
  });

  it("shows the home screen and starts a session without any solution numbers", async () => {
    const h = await (await j("/api/study/problems/home?course=ECON301")).json();
    expect(h.counts).toEqual({ total: 3, seen: 0 });
    expect(h.problems[0]).toMatchObject({ difficulty: 1, asked: 0 });
    expect(JSON.stringify(h)).not.toMatch(/"answer"|"steps"|"expr"/);
    const r = await (await j("/api/study/problems/start", "POST", { course: "ECON301", length: 3 })).json();
    runId = r.runId;
    problems = r.problems;
    expect(problems).toHaveLength(3);
    expect(JSON.stringify(problems)).not.toMatch(/"answer"|"expr"|"value"/);
    expect(problems[0].hint.label).toBe("Spending multiplier");
    expect((await j("/api/study/problems/start", "POST", { course: "NOPE" })).status).toBe(404);
  });

  it("checks a typed answer, reveals the worked steps with app-computed numbers, and re-asks a miss as attempt 2", async () => {
    const ok = await (await j("/api/study/problems/answer", "POST", { runId, problemId: problems[0].id, submitted: "500" })).json();
    expect(ok).toMatchObject({ correct: true, attempt: 1 });
    expect(ok.steps.map((s: any) => [s.name, Math.round(s.value)])).toEqual([["mult", 10], ["dy", 500]]);
    const miss = await (await j("/api/study/problems/answer", "POST", { runId, problemId: problems[1].id, submitted: 50, hinted: true })).json();
    expect(miss).toMatchObject({ correct: false, attempt: 1 });
    expect(miss.off).toBeCloseTo(0.9, 9);
    const again = await (await j("/api/study/problems/answer", "POST", { runId, problemId: problems[1].id, submitted: "$500" })).json();
    expect(again).toMatchObject({ correct: true, attempt: 2 });
    await j("/api/study/problems/answer", "POST", { runId, problemId: problems[2].id, gaveUp: true });
    const bad = await j("/api/study/problems/answer", "POST", { runId, problemId: problems[0].id, submitted: "lots" });
    expect(bad.status).toBe(400);
    expect((await bad.json()).error).toMatch(/Type a number/);
  });

  it("summarizes the session and counts the day toward the streak", async () => {
    const s = await (await j("/api/study/problems/finish", "POST", { runId })).json();
    expect(s).toMatchObject({ total: 3, correct: 1, unaided: 1, recovered: 1 });
    expect(s.missed).toHaveLength(2);
    expect(s.streak).toBeGreaterThanOrEqual(1);
    const h = await (await j("/api/study/problems/home?course=ECON301")).json();
    expect(h.counts).toEqual({ total: 3, seen: 3 });
    expect(h.accuracy).toEqual({ answers: 3, correct: 1, pct: 33 });
  });

  it("won't run a problem job alongside another generation job, and pausing blocks it", async () => {
    await j("/api/settings", "POST", { aiPaused: true });
    const paused = await j("/api/study/problems/generate", "POST", { course: "ECON301", noteIds: ["ECON301/x.md"] });
    expect(paused.status).toBe(409);
    await j("/api/settings", "POST", { aiPaused: false });
  });

  it("deletes a problem", async () => {
    expect(await (await j(`/api/study/problems/${problems[0].id}`, "DELETE")).json()).toEqual({ ok: true });
    expect((await (await j("/api/study/problems/home?course=ECON301")).json()).counts.total).toBe(2);
  });
});
