import { describe, it, expect } from "vitest";
import { buildSystemPrompt, buildUserPrompt } from "../src/prompt";
import { buildArgs, cleanEnv, friendlyError, parseAuthStatus, parseStreamLine } from "../src/claude";
import { routeTitle } from "../src/courses";

describe("prompt", () => {
  it("strict mode forbids outside knowledge", () => {
    const s = buildSystemPrompt(false);
    expect(s).toContain("Answer ONLY from the provided notes");
    expect(s).toContain("Not in your notes");
    expect(s).not.toContain("(General knowledge)");
  });
  it("general mode requires labels", () => {
    expect(buildSystemPrompt(true)).toContain("(General knowledge)");
  });
  it("wraps notes in labeled tags and includes history", () => {
    const p = buildUserPrompt("Q?", [{ id: "a", course: "CLUB", file: "f", date: "2026-01-01", title: "T", sample: false, body: "B" }], [{ role: "user", text: "hi" }]);
    expect(p).toContain('<note label="CLUB 2026-01-01: T">');
    expect(p).toContain("Student: hi");
    expect(p.trim().endsWith("Student question: Q?")).toBe(true);
    expect(buildUserPrompt("Q?", [], [], new Date(2026, 9, 25))).toContain("Today is Sunday, October 25, 2026.");
  });
});

describe("claude cli helpers", () => {
  it("isolates chat calls from MCP and tools", () => {
    const a = buildArgs({ prompt: "x", system: "s" });
    expect(a).toContain("--strict-mcp-config");
    expect(a).toContain("--no-session-persistence");
    const b = buildArgs({ prompt: "x", withMcp: true, extraArgs: ["--allowedTools", "t"] });
    expect(b).not.toContain("--strict-mcp-config");
    expect(b).toContain("--allowedTools");
  });
  it("parses stream-json lines", () => {
    expect(parseStreamLine(JSON.stringify({ type: "stream_event", event: { type: "content_block_delta", delta: { type: "text_delta", text: "hi" } } }))).toEqual({ delta: "hi" });
    expect(parseStreamLine(JSON.stringify({ type: "result", result: "done", total_cost_usd: 0.01 })).result).toMatchObject({ text: "done", isError: false });
    expect(parseStreamLine("not json")).toEqual({});
  });
});

describe("routing", () => {
  it("routes by title prefix", () => {
    expect(routeTitle("ECON300 Macro: IS-LM")).toBe("ECON300");
    expect(routeTitle("econ 301 - monopoly")).toBe("ECON301");
    expect(routeTitle("MGMT220 Social Innovation")).toBe("MGMT220");
    expect(routeTitle("CLUB: pitch night")).toBe("CLUB");
    expect(routeTitle("ATHLETICS team meeting")).toBe("ATHLETICS");
    expect(routeTitle("Coffee with Sam")).toBe("unsorted");
    expect(routeTitle("ECON999 mystery")).toBe("unsorted");
  });
});

describe("login detection", () => {
  it("parses `claude auth status` output", () => {
    expect(parseAuthStatus('{"loggedIn": true, "authMethod": "claude.ai"}')).toEqual({ loggedIn: true, method: "claude.ai" });
    expect(parseAuthStatus('{"loggedIn": false, "authMethod": "none"}')).toEqual({ loggedIn: false, method: undefined });
    expect(parseAuthStatus("garbage")).toEqual({ loggedIn: false });
  });
  it("tells the student how to fix an expired session", () => {
    expect(friendlyError(new Error("Failed to authenticate: OAuth session expired and could not be refreshed"))).toContain("claude auth login");
  });
});

describe("billing safety", () => {
  it("never passes an API key or cloud-provider switch to the claude CLI", () => {
    const env = cleanEnv({
      PATH: "/bin", HOME: "/h", ANTHROPIC_API_KEY: "sk-x", ANTHROPIC_AUTH_TOKEN: "t",
      CLAUDE_CODE_USE_BEDROCK: "1", CLAUDE_CODE_USE_VERTEX: "1", CLAUDE_CODE_USE_FOUNDRY: "1",
    });
    expect(env).toEqual({ PATH: "/bin", HOME: "/h" });
  });
  it("reads the subscription type from auth status", () => {
    expect(parseAuthStatus('{"loggedIn": true, "authMethod": "claude.ai", "subscriptionType": "pro"}')).toMatchObject({ loggedIn: true, method: "claude.ai", subscription: "pro" });
  });
});
