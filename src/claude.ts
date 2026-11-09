import { spawn, spawnSync } from "node:child_process";

export interface RunOptions {
  system?: string;
  prompt: string;
  onText?: (chunk: string) => void;
  signal?: AbortSignal;
  /** Extra CLI flags, e.g. --allowedTools for the Granola sync. */
  extraArgs?: string[];
  /** Keep the user's MCP connectors (needed by sync). Chat runs fully isolated. */
  withMcp?: boolean;
  timeoutMs?: number;
}

export interface RunResult {
  text: string;
  costUsd?: number;
}

/** Injectable so tests never spawn the real CLI. */
export type Runner = (opts: RunOptions) => Promise<RunResult>;

export function checkClaude(): { ok: true; version: string } | { ok: false; error: string } {
  const r = spawnSync("claude", ["--version"], { encoding: "utf8" });
  if (r.error || r.status !== 0) {
    return {
      ok: false,
      error:
        "The `claude` CLI was not found on your PATH.\n" +
        "Install Claude Code (https://claude.com/claude-code), run `claude` once to log in, then restart StudyDeck.",
    };
  }
  return { ok: true, version: r.stdout.trim() };
}

/**
 * Isolation flags keep each call small and predictable: no user CLAUDE.md/settings,
 * no skills, no tools, no session files. (Measured: ~2.5k tokens vs ~60k without.)
 */
export function buildArgs(opts: RunOptions): string[] {
  const args = [
    "-p",
    "--output-format", "stream-json",
    "--include-partial-messages",
    "--verbose",
    "--disable-slash-commands",
    "--setting-sources", "",
    "--no-session-persistence",
  ];
  if (!opts.withMcp) args.push("--strict-mcp-config", "--tools", "");
  if (opts.system) args.push("--system-prompt", opts.system);
  if (opts.extraArgs) args.push(...opts.extraArgs);
  return args;
}

/** Feed stream-json lines to handlers. Exported for tests. */
export function parseStreamLine(line: string): { delta?: string; result?: { text: string; costUsd?: number; isError: boolean } } {
  if (!line.trim()) return {};
  let d: any;
  try {
    d = JSON.parse(line);
  } catch {
    return {};
  }
  if (d.type === "stream_event" && d.event?.type === "content_block_delta" && d.event.delta?.type === "text_delta") {
    return { delta: d.event.delta.text as string };
  }
  if (d.type === "result") {
    return { result: { text: String(d.result ?? ""), costUsd: d.total_cost_usd, isError: !!d.is_error } };
  }
  return {};
}

/** Variables that would make Claude Code bill per token (an API key) or route through a cloud account. */
export const BILLING_ENV_VARS = [
  "ANTHROPIC_API_KEY", "ANTHROPIC_AUTH_TOKEN",
  "CLAUDE_CODE_USE_BEDROCK", "CLAUDE_CODE_USE_VERTEX", "CLAUDE_CODE_USE_FOUNDRY",
];

/**
 * The environment StudyDeck gives the `claude` CLI: yours, minus anything that would switch it from your
 * subscription login to a pay-per-token API key. So StudyDeck can only ever use your Claude plan.
 */
export function cleanEnv(env: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const out = { ...env };
  for (const k of BILLING_ENV_VARS) delete out[k];
  return out;
}

export const runClaude: Runner = (opts) =>
  new Promise((resolve, reject) => {
    const child = spawn("claude", buildArgs(opts), { stdio: ["pipe", "pipe", "pipe"], env: cleanEnv() });
    let buf = "";
    let streamed = "";
    let final: RunResult | undefined;
    let isError = false;
    let stderr = "";
    const timer = setTimeout(() => child.kill("SIGTERM"), opts.timeoutMs ?? 5 * 60_000);
    opts.signal?.addEventListener("abort", () => child.kill("SIGTERM"));

    const handle = (line: string) => {
      const p = parseStreamLine(line);
      if (p.delta) {
        streamed += p.delta;
        opts.onText?.(p.delta);
      }
      if (p.result) {
        final = { text: p.result.text, costUsd: p.result.costUsd };
        isError = p.result.isError;
      }
    };

    child.stdout.on("data", (c: Buffer) => {
      buf += c.toString();
      let i;
      while ((i = buf.indexOf("\n")) >= 0) {
        handle(buf.slice(0, i));
        buf = buf.slice(i + 1);
      }
    });
    child.stderr.on("data", (c: Buffer) => (stderr += c.toString()));
    child.on("error", (e) => {
      clearTimeout(timer);
      reject(e);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (buf.trim()) handle(buf);
      if (opts.signal?.aborted) return reject(new Error("Cancelled"));
      if (code !== 0 || isError || !final) {
        return reject(new Error((final?.text || stderr || `claude exited with code ${code}`).trim()));
      }
      resolve({ text: final.text || streamed, costUsd: final.costUsd });
    });
    child.stdin.end(opts.prompt);
  });

/** Turn CLI failures into messages a student can act on. */
export function friendlyError(e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e);
  if (/ENOENT/.test(msg)) return "Couldn't find the `claude` command. Install Claude Code and make sure it's on your PATH, then restart StudyDeck.";
  if (/not logged in|\/login|authenticat|oauth/i.test(msg)) return `Claude Code isn't logged in (or its session expired). ${LOGIN_FIX}`;
  if (/rate.?limit|usage limit|overloaded|529/i.test(msg)) return "Claude is busy or you've hit your usage limit. Wait a minute and try again.";
  if (/SIGTERM|timed? ?out|exited with code null/i.test(msg)) return "Claude took too long to answer. Try a shorter question or a single course.";
  if (/Cancelled/.test(msg)) return "Request cancelled.";
  return `Something went wrong talking to Claude: ${msg.slice(0, 300)}`;
}

export interface AuthStatus {
  loggedIn: boolean;
  method?: string;
  /** e.g. "pro" or "max" for a Claude subscription. */
  subscription?: string;
}

export const LOGIN_FIX = "Run `claude auth login` in a terminal (or `claude`, then /login), then try again.";

export function parseAuthStatus(stdout: string): AuthStatus {
  try {
    const d = JSON.parse(stdout);
    return {
      loggedIn: d.loggedIn === true,
      method: typeof d.authMethod === "string" && d.authMethod !== "none" ? d.authMethod : undefined,
      subscription: typeof d.subscriptionType === "string" ? d.subscriptionType : undefined,
    };
  } catch {
    return { loggedIn: false };
  }
}

/** Is the CLI signed in? Free and instant (no model call), so it is safe to run before every batch job. */
export function checkAuth(): AuthStatus {
  const r = spawnSync("claude", ["auth", "status"], { encoding: "utf8", timeout: 15_000 });
  return r.error ? { loggedIn: false } : parseAuthStatus(r.stdout);
}
