import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { Server } from "node:http";
import { createApp } from "../src/server";
import { closeStudyDbs } from "../src/study/db";
import { ClaudeError, describeClaudeError, friendlyError, guardRunner, limitResetTime, type Runner } from "../src/claude";

describe("Claude failures in plain words", () => {
  it("tells the kinds of failure apart", () => {
    const kind = (m: string) => describeClaudeError(new Error(m)).kind;
    expect(kind("spawn claude ENOENT")).toBe("missing");
    expect(kind("Failed to authenticate: OAuth session expired and could not be refreshed")).toBe("login");
    expect(kind("Invalid API key · Please run /login")).toBe("login");
    expect(kind("Claude AI usage limit reached|1794370000")).toBe("limit");
    expect(kind("You've hit your limit · resets 3pm (America/New_York)")).toBe("limit");
    expect(kind("5-hour limit reached ∙ resets 11:30pm")).toBe("limit");
    expect(kind("rate_limit_error")).toBe("limit");
    expect(kind('API Error: 529 {"type":"overloaded_error"}')).toBe("busy");
    expect(kind("Claude took too long to answer (timed out)")).toBe("timeout");
    expect(kind("claude exited with code 143")).toBe("timeout");
    expect(kind("Cancelled")).toBe("cancelled");
    expect(kind("something odd")).toBe("other");
  });

  it("says when the usage limit resets, when Claude says so", () => {
    expect(limitResetTime("You've hit your limit · resets 3pm (America/New_York)")).toBe("3pm");
    expect(limitResetTime("limit reached ∙ resets at 11:30 PM")).toBe("11:30pm");
    expect(limitResetTime("Claude AI usage limit reached|1794370000")).toMatch(/\d{1,2}:\d{2}/);
    expect(limitResetTime("rate_limit_error")).toBeUndefined();
    const withTime = friendlyError(new Error("You've hit your limit · resets 3pm (America/New_York)"));
    expect(withTime).toContain("resets at 3pm");
    expect(withTime).toContain("still works");
    expect(friendlyError(new Error("rate_limit_error"))).toMatch(/usage limit.*within a few hours/);
  });

  it("does not call an overloaded Claude a usage limit", () => {
    const m = friendlyError(new Error('API Error: 529 {"type":"overloaded_error"}'));
    expect(m).toContain("overloaded");
    expect(m).toContain("not your usage limit");
  });

  it("never shows a raw error twice over", () => {
    const once = new ClaudeError("limit", "You've reached your Claude plan's usage limit.");
    expect(friendlyError(once)).toBe(once.message);
    expect(describeClaudeError(once).kind).toBe("limit");
  });

  it("wraps a runner so its failures arrive as ClaudeError, but leaves a cancel alone", async () => {
    const failing: Runner = async () => {
      throw new Error("spawn claude ENOENT");
    };
    await expect(guardRunner(failing)({ prompt: "x" })).rejects.toMatchObject({ name: "ClaudeError", kind: "missing" });
    const abort = new AbortController();
    abort.abort();
    const cancelled: Runner = async () => {
      throw new Error("Cancelled");
    };
    await expect(guardRunner(cancelled)({ prompt: "x", signal: abort.signal })).rejects.not.toBeInstanceOf(ClaudeError);
    const fine: Runner = async () => ({ text: "hi", costUsd: 0 });
    expect((await guardRunner(fine)({ prompt: "x" })).text).toBe("hi");
  });
});

describe("study routes when Claude fails", () => {
  let server: Server, base: string;
  let failWith: string | undefined;
  const runner: Runner = async () => {
    if (failWith) throw new Error(failWith);
    return { text: "A plain explanation.", costUsd: 0 };
  };
  const noteId = "ECON301/2026-10-13_a.md";

  beforeAll(async () => {
    const notesDir = fs.mkdtempSync(path.join(os.tmpdir(), "sd-cenotes-"));
    fs.mkdirSync(path.join(notesDir, "ECON301"));
    fs.writeFileSync(path.join(notesDir, "ECON301", "2026-10-13_a.md"), "---\ntitle: Costs\ncourse: ECON301\ndate: 2026-10-13\n---\n## Marginal cost\nMarginal cost is the derivative of total cost with respect to quantity.");
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "sd-cedata-"));
    const app = createApp({ runner, notesDir, sampleDir: path.resolve("sample-notes"), dataDir });
    await new Promise<void>((r) => (server = app.listen(0, () => r())));
    base = `http://127.0.0.1:${(server.address() as any).port}`;
  });
  afterAll(() => {
    server.close();
    closeStudyDbs();
  });
  const post = (url: string, body: object) => fetch(`${base}${url}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

  it("answers a usage limit with 429 and a message a student can act on, not a bare server error", async () => {
    const session = await (await post("/api/study/tutor/start", { noteId })).json();
    failWith = "You've hit your limit · resets 3pm (America/New_York)";
    const r = await post(`/api/study/tutor/${session.id}/turn`, { text: "Marginal cost is how much one more unit adds to total cost." });
    expect(r.status).toBe(429);
    const body = await r.json();
    expect(body.kind).toBe("limit");
    expect(body.error).toContain("resets at 3pm");
    expect(body.error).not.toContain("America/New_York");
  });

  it("answers a signed-out Claude with the exact command to run", async () => {
    const session = await (await post("/api/study/tutor/start", { noteId })).json();
    failWith = "Failed to authenticate: OAuth session expired and could not be refreshed";
    const r = await post(`/api/study/tutor/${session.id}/turn`, { text: "Marginal cost is how much one more unit adds to total cost." });
    expect(r.status).toBe(503);
    const body = await r.json();
    expect(body.kind).toBe("login");
    expect(body.error).toContain("claude auth login");
  });

  it("works again as soon as Claude does", async () => {
    failWith = undefined;
    const r = await post("/api/chat", { course: "ECON301", question: "What is marginal cost?" });
    const text = await r.text();
    expect(text).toContain("event: done");
    expect(text).not.toContain("event: error");
  });
});
