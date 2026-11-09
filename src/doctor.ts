import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { DatabaseSync } from "node:sqlite";
import { BILLING_ENV_VARS, LOGIN_FIX, parseAuthStatus, type AuthStatus, type Runner } from "./claude.js";
import { idsOf, type Course } from "./courses.js";
import { loadNotes } from "./notes.js";

export type CheckStatus = "ok" | "warn" | "fail";

export interface DoctorCheck {
  id: string;
  label: string;
  status: CheckStatus;
  detail: string;
  /** What to do, shown only when something is wrong. */
  fix?: string;
}

export interface ExecResult {
  code: number | null;
  stdout: string;
  stderr: string;
}

export interface DoctorDeps {
  /** Run a command; rejects (like spawn) when the program does not exist. Injectable for tests. */
  exec?: (cmd: string, args: string[], timeoutMs?: number) => Promise<ExecResult>;
  nodeVersion?: string;
  dataDir: string;
  notesDir: string;
  courses: Course[];
  /** Used only for the deep check: one real, tiny question to Claude. */
  runner?: Runner;
  /** AI usage for the Doctor's usage row. */
  usage?: () => { today: { calls: number; costUsd: number }; week: { calls: number; costUsd: number }; paused: boolean };
  /** Environment to inspect for API keys. Defaults to process.env. */
  env?: NodeJS.ProcessEnv;
  /** Throws if full-text search is unavailable. Injectable for tests. */
  sqliteProbe?: () => void;
}

export const exec: NonNullable<DoctorDeps["exec"]> = (cmd, args, timeoutMs = 20_000) =>
  new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => child.kill("SIGTERM"), timeoutMs);
    child.stdout.on("data", (d) => (stdout += d));
    child.stderr.on("data", (d) => (stderr += d));
    child.on("error", (e) => {
      clearTimeout(timer);
      reject(e);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code, stdout, stderr });
    });
  });

export function defaultSqliteProbe() {
  const db = new DatabaseSync(":memory:");
  try {
    db.exec(`CREATE VIRTUAL TABLE t USING fts5(body, tokenize = 'porter unicode61')`);
  } finally {
    db.close();
  }
}

/** Node 24+: the study scheduler (ts-fsrs 6) requires it, and Node's built-in SQLite needs 22.13 or newer anyway. */
export function nodeIsNewEnough(version: string): boolean {
  return Number(version.replace(/^v/, "").split(".")[0]) >= 24;
}

const ok = (id: string, label: string, detail: string): DoctorCheck => ({ id, label, status: "ok", detail });
const bad = (id: string, label: string, status: "warn" | "fail", detail: string, fix: string): DoctorCheck => ({ id, label, status, detail, fix });

export async function runDoctor(deps: DoctorDeps, opts: { deep?: boolean } = {}): Promise<DoctorCheck[]> {
  const run = deps.exec ?? exec;
  const tryRun = async (cmd: string, args: string[], t?: number): Promise<ExecResult | undefined> => {
    try {
      return await run(cmd, args, t);
    } catch {
      return undefined;
    }
  };

  // Connectors come with your Claude account, so several checks depend on the login. Ask once.
  let authP: Promise<AuthStatus> | undefined;
  const getAuth = () =>
    (authP ??= (async () => {
      const a = await tryRun("claude", ["auth", "status"], 15_000);
      return a ? parseAuthStatus(a.stdout) : { loggedIn: false };
    })());

  const nodeCheck = async (): Promise<DoctorCheck> => {
    const v = deps.nodeVersion ?? process.versions.node;
    return nodeIsNewEnough(v)
      ? ok("node", "Node.js", `v${v.replace(/^v/, "")}`)
      : bad("node", "Node.js", "fail", `v${v.replace(/^v/, "")} is too old (the study scheduler needs Node 24)`, "Install Node 24 or newer from nodejs.org.");
  };

  const sqliteCheck = async (): Promise<DoctorCheck> => {
    try {
      (deps.sqliteProbe ?? defaultSqliteProbe)();
      return ok("sqlite", "Library database", "SQLite with full-text search is available");
    } catch (e) {
      return bad("sqlite", "Library database", "fail", `SQLite full-text search is unavailable (${e instanceof Error ? e.message : e})`, "Use Node 22.13 or newer.");
    }
  };

  const claudeChecks = async (): Promise<DoctorCheck[]> => {
    const v = await tryRun("claude", ["--version"], 10_000);
    if (!v || v.code !== 0) {
      return [bad("claude", "Claude Code CLI", "fail", "`claude` was not found on your PATH", "Install Claude Code (https://claude.com/claude-code), then restart StudyDeck.")];
    }
    const checks = [ok("claude", "Claude Code CLI", v.stdout.trim())];
    const auth = await getAuth();
    checks.push(
      auth.loggedIn
        ? ok("login", "Claude login", auth.method ? `signed in (${auth.method})` : "signed in")
        : bad("login", "Claude login", "fail", "Not signed in, or the session expired. Questions and sync will fail.", LOGIN_FIX),
    );
    if (auth.loggedIn) {
      const keys = BILLING_ENV_VARS.filter((k) => (deps.env ?? process.env)[k]);
      const plan = auth.subscription ? `${auth.subscription} ` : "";
      if (auth.method !== "claude.ai") {
        checks.push(bad("billing", "Billing", "warn", `Signed in with “${auth.method ?? "unknown"}”, not a Claude subscription, so use may be billed per token.`, "Run `claude auth login` and choose your Claude account (the subscription login)."));
      } else {
        checks.push(ok("billing", "Billing", `Uses your Claude ${plan}subscription login, never an API key${keys.length ? ` (${keys.join(", ")} is set in your environment, and StudyDeck ignores it)` : ""}. Questions count toward your plan's usage allowance, not per-token charges. Syncing Granola uses no Claude at all. If you've turned on "extra usage" in your Claude settings, heavy use past your allowance could be billed.`));
      }
    }
    if (opts.deep) {
      if (!auth.loggedIn || !deps.runner) {
        checks.push(bad("ping", "Claude answers a question", "warn", "Skipped because Claude isn't signed in.", LOGIN_FIX));
      } else {
        const started = Date.now();
        try {
          const r = await deps.runner({ prompt: "Reply with the single word: ok", system: "Reply with exactly one word.", timeoutMs: 60_000 });
          checks.push(ok("ping", "Claude answers a question", `replied "${r.text.trim().slice(0, 20)}" in ${((Date.now() - started) / 1000).toFixed(1)}s`));
        } catch (e) {
          checks.push(bad("ping", "Claude answers a question", "fail", e instanceof Error ? e.message.slice(0, 200) : String(e), "Check your network and Claude plan, then run the check again."));
        }
      }
    }
    return checks;
  };

  const granolaCheck = async (): Promise<DoctorCheck> => {
    if (!(await getAuth()).loggedIn) {
      return bad("granola", "Granola connector", "warn", "Can't check yet: your connectors come with your Claude account, and you're not signed in.", LOGIN_FIX);
    }
    const r = await tryRun("claude", ["mcp", "list"], 45_000);
    if (!r) return bad("granola", "Granola connector", "warn", "Couldn't check (the `claude` command wasn't available).", "Fix the Claude Code CLI first.");
    const line = r.stdout.split("\n").find((l) => /granola/i.test(l));
    if (!line) {
      return bad("granola", "Granola connector", "warn", "Not configured. Sync from Granola won't work.", "Run: claude mcp add --transport http granola https://mcp.granola.ai/mcp  then run /mcp inside Claude Code to sign in.");
    }
    if (/connected/i.test(line) && !/needs auth/i.test(line)) return ok("granola", "Granola connector", "connected");
    return bad("granola", "Granola connector", "warn", "Configured but not connected.", "Run /mcp inside Claude Code and sign in to Granola.");
  };

  const notesCheck = async (): Promise<DoctorCheck> => {
    if (!fs.existsSync(deps.notesDir)) {
      return bad("notes", "Your notes", "warn", "No ./notes folder yet, so StudyDeck shows the sample notes.", "Click “Sync from Granola”, or run: npm run sync");
    }
    const known = new Set(idsOf(deps.courses));
    const strays = fs.readdirSync(deps.notesDir, { withFileTypes: true }).filter((d) => d.isDirectory() && !known.has(d.name)).map((d) => d.name);
    const count = loadNotes("all", deps.notesDir, idsOf(deps.courses)).length;
    if (strays.length) {
      return bad("notes", "Your notes", "warn", `${count} notes found, but these folders aren't a course and are ignored: ${strays.join(", ")}`, "Add them as courses with Manage in the sidebar, or rename the folders.");
    }
    return count
      ? ok("notes", "Your notes", `${count} notes across ${idsOf(deps.courses).length - 1} courses`)
      : bad("notes", "Your notes", "warn", "The notes folder is empty, so StudyDeck shows the sample notes.", "Click “Sync from Granola”, or run: npm run sync");
  };

  const dataCheck = async (): Promise<DoctorCheck> => {
    try {
      fs.mkdirSync(deps.dataDir, { recursive: true });
      const probe = path.join(deps.dataDir, `.doctor-${process.pid}`);
      fs.writeFileSync(probe, "ok");
      fs.unlinkSync(probe);
      return ok("data", "Data folder", `${deps.dataDir} is writable`);
    } catch (e) {
      return bad("data", "Data folder", "fail", `Can't write to ${deps.dataDir} (${e instanceof Error ? e.message : e})`, "Check the folder's permissions, or set STUDYDECK_DATA_DIR to another folder.");
    }
  };

  const ytCheck = async (): Promise<DoctorCheck> => {
    const r = await tryRun("yt-dlp", ["--version"], 10_000);
    return r && r.code === 0
      ? ok("ytdlp", "YouTube transcripts (optional)", `yt-dlp ${r.stdout.trim()}`)
      : bad("ytdlp", "YouTube transcripts (optional)", "warn", "yt-dlp isn't installed. It's only needed for YouTube sources, which arrive in a later update.", "Run: pip3 install --user yt-dlp");
  };

  const usageCheck = async (): Promise<DoctorCheck | undefined> => {
    if (!deps.usage) return undefined;
    const u = deps.usage();
    const detail = `${u.today.calls} ${u.today.calls === 1 ? "call" : "calls"} to Claude today, ${u.week.calls} in the last 7 days (about $${u.week.costUsd.toFixed(2)} at API rates; on a subscription this counts toward your allowance and isn't charged).`;
    return u.paused
      ? bad("usage", "AI usage", "warn", `AI is paused: chat and generation are off. ${detail}`, "Turn it back on with the AI switch in the sidebar.")
      : ok("usage", "AI usage", detail);
  };

  const groups = await Promise.all([nodeCheck(), sqliteCheck(), claudeChecks(), usageCheck(), granolaCheck(), notesCheck(), dataCheck(), ytCheck()]);
  return groups.flat().filter((c): c is DoctorCheck => !!c);
}

export function summarizeChecks(checks: DoctorCheck[]): { ok: number; warn: number; fail: number } {
  return { ok: checks.filter((c) => c.status === "ok").length, warn: checks.filter((c) => c.status === "warn").length, fail: checks.filter((c) => c.status === "fail").length };
}

export function formatChecks(checks: DoctorCheck[]): string {
  const icon = { ok: "✓", warn: "⚠", fail: "✗" } as const;
  const lines = checks.map((c) => `${icon[c.status]} ${c.label.padEnd(34)} ${c.detail}${c.fix ? `\n    → ${c.fix}` : ""}`);
  const s = summarizeChecks(checks);
  return `${lines.join("\n")}\n\n${s.ok} ok · ${s.warn} warnings · ${s.fail} problems`;
}
