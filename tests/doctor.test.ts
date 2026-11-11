import { describe, it, expect } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { formatChecks, nodeIsNewEnough, runDoctor, summarizeChecks, type DoctorDeps, type ExecResult } from "../src/doctor";
import { DEFAULT_COURSES } from "../src/courses";
import type { Runner } from "../src/claude";

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "sd-doc-"));
const res = (stdout: string, code = 0): ExecResult => ({ code, stdout, stderr: "" });

/** A fake machine: map "cmd arg arg" -> result, or undefined to simulate a missing program. */
function machine(map: Record<string, ExecResult | undefined>): DoctorDeps["exec"] {
  return async (cmd, args) => {
    const r = map[[cmd, ...args].join(" ")];
    if (!r) throw Object.assign(new Error(`spawn ${cmd} ENOENT`), { code: "ENOENT" });
    return r;
  };
}

const healthy = {
  "claude --version": res("2.1.310 (Claude Code)\n"),
  "claude auth status": res('{"loggedIn": true, "authMethod": "claude.ai"}'),
  "claude mcp list": res("claude.ai Granola: https://mcp.granola.ai/mcp - ✔ Connected\n"),
  "yt-dlp --version": res("2026.10.01\n"),
};

const base = (over: Partial<DoctorDeps> = {}): DoctorDeps => {
  const notesDir = tmp();
  fs.mkdirSync(path.join(notesDir, "ECON300"));
  fs.writeFileSync(path.join(notesDir, "ECON300", "2026-10-14_a.md"), "---\ntitle: A\n---\nbody");
  return { exec: machine(healthy), dataDir: tmp(), notesDir, courses: DEFAULT_COURSES, granolaConnected: () => true, ...over };
};
const byId = (cs: Awaited<ReturnType<typeof runDoctor>>, id: string) => cs.find((c) => c.id === id)!;

describe("doctor", () => {
  it("reports a healthy machine with no problems", async () => {
    const checks = await runDoctor(base());
    expect(summarizeChecks(checks)).toEqual({ ok: checks.length, warn: 0, fail: 0 });
    expect(byId(checks, "login").detail).toContain("claude.ai");
    expect(byId(checks, "notes").detail).toContain("1 notes");
  });

  it("explains a missing Claude CLI", async () => {
    const checks = await runDoctor(base({ exec: machine({}) }));
    expect(byId(checks, "claude")).toMatchObject({ status: "fail" });
    expect(byId(checks, "claude").fix).toMatch(/Install Claude Code/);
    expect(byId(checks, "login")).toBeUndefined();
    // Granola doesn't depend on Claude at all, so a missing CLI must not drag it down.
    expect(byId(checks, "granola").status).toBe("ok");
  });

  it("explains an expired login with the exact command", async () => {
    const checks = await runDoctor(base({ exec: machine({ ...healthy, "claude auth status": res('{"loggedIn": false, "authMethod": "none"}') }) }));
    expect(byId(checks, "login")).toMatchObject({ status: "fail" });
    expect(byId(checks, "login").fix).toContain("claude auth login");
  });

  it("checks StudyDeck's own Granola sign-in, not the connector inside Claude Code", async () => {
    // The Claude Code connector says "Connected", but the app has no sign-in of its own: that must be a warning.
    const dataDir = tmp();
    const none = await runDoctor(base({ dataDir, granolaConnected: undefined }));
    expect(byId(none, "granola")).toMatchObject({ status: "warn" });
    expect(byId(none, "granola").fix).toContain("Connect Granola");
    expect(byId(none, "granola").fix).not.toContain("mcp");
    // And the other way round: the app is signed in while the Claude Code connector isn't even configured.
    fs.writeFileSync(path.join(dataDir, "granola-auth.json"), JSON.stringify({ tokens: { access_token: "t" } }));
    const signedIn = await runDoctor(base({ dataDir, granolaConnected: undefined, exec: machine({ ...healthy, "claude mcp list": res("(no servers)\n") }) }));
    expect(byId(signedIn, "granola").status).toBe("ok");
  });

  it("doesn't blame Granola when the real problem is the Claude login", async () => {
    const out = await runDoctor(base({ exec: machine({ ...healthy, "claude auth status": res('{"loggedIn": false}') }) }));
    expect(byId(out, "login").status).toBe("fail");
    expect(byId(out, "granola").status).toBe("ok");
  });

  it("shows the billing situation: subscription login, API keys ignored", async () => {
    const sub = { ...healthy, "claude auth status": res('{"loggedIn": true, "authMethod": "claude.ai", "subscriptionType": "pro"}') };
    const ok1 = byId(await runDoctor(base({ exec: machine(sub), env: {} })), "billing");
    expect(ok1.status).toBe("ok");
    expect(ok1.detail).toContain("Claude pro subscription login, never an API key");
    expect(ok1.detail).toContain("Syncing Granola uses no Claude");
    const withKey = byId(await runDoctor(base({ exec: machine(sub), env: { ANTHROPIC_API_KEY: "sk-test" } })), "billing");
    expect(withKey.status).toBe("ok");
    expect(withKey.detail).toContain("ANTHROPIC_API_KEY is set in your environment, and StudyDeck ignores it");
    expect(withKey.detail).not.toContain("sk-test");
    const apiLogin = { ...healthy, "claude auth status": res('{"loggedIn": true, "authMethod": "api_key"}') };
    const warn = byId(await runDoctor(base({ exec: machine(apiLogin), env: {} })), "billing");
    expect(warn.status).toBe("warn");
    expect(warn.fix).toContain("claude auth login");
  });

  it("shows AI usage, and warns when AI is paused", async () => {
    const usage = (paused: boolean) => () => ({ today: { calls: 2, costUsd: 0.03 }, week: { calls: 9, costUsd: 0.12 }, paused });
    const on = byId(await runDoctor(base({ usage: usage(false) })), "usage");
    expect(on.status).toBe("ok");
    expect(on.detail).toContain("2 calls to Claude today, 9 in the last 7 days");
    expect(on.detail).toContain("isn't charged");
    const off = byId(await runDoctor(base({ usage: usage(true) })), "usage");
    expect(off.status).toBe("warn");
    expect(off.detail).toContain("AI is paused");
    expect(byId(await runDoctor(base()), "usage")).toBeUndefined();
  });

  it("flags a Node that is too old, and a broken SQLite", async () => {
    expect(nodeIsNewEnough("v24.14.1")).toBe(true);
    expect(nodeIsNewEnough("24.0.0")).toBe(true);
    expect(nodeIsNewEnough("22.13.0")).toBe(false);
    expect(nodeIsNewEnough("20.11.0")).toBe(false);
    const checks = await runDoctor(base({ nodeVersion: "20.11.0", sqliteProbe: () => { throw new Error("no such module: fts5"); } }));
    expect(byId(checks, "node").status).toBe("fail");
    expect(byId(checks, "sqlite").detail).toContain("fts5");
  });

  it("warns when there are no notes yet, and about folders that aren't courses", async () => {
    const empty = await runDoctor(base({ notesDir: path.join(tmp(), "nope") }));
    expect(byId(empty, "notes")).toMatchObject({ status: "warn" });
    const d = base();
    fs.mkdirSync(path.join(d.notesDir, "FIN310"));
    const stray = await runDoctor(d);
    expect(byId(stray, "notes").detail).toContain("FIN310");
  });

  it("fails when the data folder can't be written", async () => {
    const file = path.join(tmp(), "iam-a-file");
    fs.writeFileSync(file, "x");
    const checks = await runDoctor(base({ dataDir: path.join(file, "data") }));
    expect(byId(checks, "data").status).toBe("fail");
  });

  it("treats missing yt-dlp as an optional warning", async () => {
    const { "yt-dlp --version": _omit, ...rest } = healthy;
    const checks = await runDoctor(base({ exec: machine(rest) }));
    expect(byId(checks, "ytdlp")).toMatchObject({ status: "warn" });
    expect(byId(checks, "ytdlp").fix).toContain("pip3 install --user yt-dlp");
  });

  it("deep check asks Claude a real question only when requested", async () => {
    let asked = 0;
    const runner: Runner = async () => {
      asked++;
      return { text: "ok" };
    };
    expect(byId(await runDoctor(base({ runner })), "ping")).toBeUndefined();
    expect(asked).toBe(0);
    expect(byId(await runDoctor(base({ runner }), { deep: true }), "ping")).toMatchObject({ status: "ok" });
    expect(asked).toBe(1);
    const failing: Runner = async () => {
      throw new Error("OAuth session expired");
    };
    expect(byId(await runDoctor(base({ runner: failing }), { deep: true }), "ping").status).toBe("fail");
  });

  it("formats a readable report", async () => {
    const out = formatChecks(await runDoctor(base({ exec: machine({}) })));
    expect(out).toContain("✗ Claude Code CLI");
    expect(out).toContain("→ Install Claude Code");
    expect(out).toMatch(/\d+ ok · \d+ warnings · \d+ problems/);
  });
});
