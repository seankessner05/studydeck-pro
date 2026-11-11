import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import type { Server } from "node:http";
import { createApp } from "../src/server";
import { closeStudyDbs } from "../src/study/db";
import { isLocalHost, isOwnOrigin, parseHost } from "../src/security";
import type { Runner } from "../src/claude";

let server: Server, port: number, dataDir: string;
let claudeCalls = 0;
const runner: Runner = async () => {
  claudeCalls++;
  return { text: "ok", costUsd: 0 };
};

beforeAll(async () => {
  const notesDir = fs.mkdtempSync(path.join(os.tmpdir(), "sd-secnotes-"));
  fs.mkdirSync(path.join(notesDir, "ECON301"));
  fs.writeFileSync(path.join(notesDir, "ECON301", "2026-10-13_a.md"), "---\ntitle: Private lecture\ncourse: ECON301\ndate: 2026-10-13\n---\nsecret body");
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "sd-secdata-"));
  const ok = (stdout: string) => ({ code: 0, stdout, stderr: "" });
  const doctorExec = async (_cmd: string, args: string[]) => (args[0] === "auth" ? ok('{"loggedIn": true, "authMethod": "claude.ai", "subscriptionType": "pro"}') : ok("1.0.0\n"));
  const app = createApp({ runner, notesDir, sampleDir: path.resolve("sample-notes"), dataDir, doctorExec });
  await new Promise<void>((r) => (server = app.listen(0, "127.0.0.1", () => r())));
  port = (server.address() as any).port;
});
afterAll(() => {
  server.close();
  closeStudyDbs();
});

/** A raw request, so the test can forge headers a browser's fetch() refuses to set (Host, Origin, Sec-Fetch-*). */
function raw(method: string, url: string, headers: Record<string, string> = {}, body?: string): Promise<{ status: number; headers: http.IncomingHttpHeaders; text: string }> {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: "127.0.0.1", port, method, path: url, headers: { host: `localhost:${port}`, ...headers, ...(body ? { "content-length": String(Buffer.byteLength(body)) } : {}) } }, (res) => {
      let text = "";
      res.on("data", (c) => (text += c));
      res.on("end", () => resolve({ status: res.statusCode ?? 0, headers: res.headers, text }));
    });
    req.on("error", reject);
    req.end(body);
  });
}
const backups = () => (fs.existsSync(path.join(dataDir, "backups")) ? fs.readdirSync(path.join(dataDir, "backups")).length : 0);

describe("host and origin parsing", () => {
  it("reads host[:port] and rejects anything else", () => {
    expect(parseHost("localhost:3000")).toEqual({ name: "localhost", port: 3000 });
    expect(parseHost("[::1]:3000")).toEqual({ name: "[::1]", port: 3000 });
    expect(parseHost("LOCALHOST")).toEqual({ name: "localhost", port: undefined });
    expect(parseHost("localhost:3000/evil")).toBeUndefined();
    expect(parseHost("user@localhost:3000")).toBeUndefined();
    expect(parseHost(undefined)).toBeUndefined();
  });

  it("accepts only this machine's names on the port the request arrived at", () => {
    expect(isLocalHost("localhost:3000", 3000)).toBe(true);
    expect(isLocalHost("127.0.0.1:3000", 3000)).toBe(true);
    expect(isLocalHost("[::1]:3000", 3000)).toBe(true);
    expect(isLocalHost("localhost:3001", 3000)).toBe(false);
    expect(isLocalHost("evil.example:3000", 3000)).toBe(false);
    expect(isLocalHost("localhost.evil.example:3000", 3000)).toBe(false);
    expect(isLocalHost("127.0.0.1.evil.example:3000", 3000)).toBe(false);
    expect(isLocalHost("localhost", 3000)).toBe(false);
    expect(isLocalHost("localhost", 80)).toBe(true);
    expect(isLocalHost(undefined, 3000)).toBe(false);
  });

  it("accepts only its own origin", () => {
    expect(isOwnOrigin("http://localhost:3000", 3000)).toBe(true);
    expect(isOwnOrigin("http://127.0.0.1:3000", 3000)).toBe(true);
    expect(isOwnOrigin("https://localhost:3000", 3000)).toBe(false);
    expect(isOwnOrigin("http://localhost:5173", 3000)).toBe(false);
    expect(isOwnOrigin("https://evil.example", 3000)).toBe(false);
    expect(isOwnOrigin("null", 3000)).toBe(false);
  });
});

describe("requests from another website are refused", () => {
  it("serves the app at its own address, by either local name", async () => {
    expect((await raw("GET", "/api/state")).status).toBe(200);
    expect((await raw("GET", "/api/state", { host: `127.0.0.1:${port}` })).status).toBe(200);
    expect((await raw("GET", "/")).status).toBe(200);
  });

  it("stops DNS rebinding: a foreign Host header cannot read notes, even with GET", async () => {
    for (const host of ["evil.example", `evil.example:${port}`, `localhost.evil.example:${port}`, `localhost:${port + 1}`]) {
      const r = await raw("GET", "/api/notes?course=all", { host });
      expect(r.status, host).toBe(403);
      expect(r.text).not.toContain("Private lecture");
    }
    expect((await raw("GET", "/", { host: "evil.example" })).status).toBe(403);
    expect((await raw("GET", "/app.js", { host: "evil.example" })).status).toBe(403);
  });

  it("stops a cross-site form post from changing anything", async () => {
    const before = backups();
    const r = await raw("POST", "/api/study/backup", { origin: "https://evil.example", "content-type": "text/plain" });
    expect(r.status).toBe(403);
    expect(backups()).toBe(before);
    expect((await raw("POST", "/api/granola/disconnect", { origin: "https://evil.example" })).status).toBe(403);
    expect((await raw("POST", "/api/study/generate", { origin: "null" })).status).toBe(403);
    expect((await raw("DELETE", "/api/study/cards/x", { origin: "https://evil.example" })).status).toBe(403);
    expect((await raw("PATCH", "/api/courses/ECON301", { origin: `http://localhost:${port + 1}` })).status).toBe(403);
  });

  it("stops a request the browser marks as cross-site even when it carries no Origin", async () => {
    expect((await raw("POST", "/api/study/backup", { "sec-fetch-site": "cross-site" })).status).toBe(403);
    // another local web app on a different port is "same-site" but still not this app
    expect((await raw("POST", "/api/study/backup", { "sec-fetch-site": "same-site" })).status).toBe(403);
  });

  it("stops another site from making the browser call the API with GET (the deep Doctor check asks Claude)", async () => {
    const calls = claudeCalls;
    expect((await raw("GET", "/api/doctor?deep=1", { "sec-fetch-site": "cross-site" })).status).toBe(403);
    expect(claudeCalls).toBe(calls);
    expect((await raw("GET", "/api/notes?course=all", { "sec-fetch-site": "same-site" })).status).toBe(403);
  });

  it("still lets another site link to the app, and lets Granola return after sign-in", async () => {
    expect((await raw("GET", "/", { "sec-fetch-site": "cross-site", "sec-fetch-mode": "navigate" })).status).toBe(200);
    const cb = await raw("GET", "/api/granola/callback?error=access_denied", { "sec-fetch-site": "cross-site", "sec-fetch-mode": "navigate" });
    expect(cb.status).toBe(400);
    expect(cb.text).toContain("cancelled");
  });

  it("lets the app's own pages and local programs through", async () => {
    const own = { origin: `http://localhost:${port}`, "sec-fetch-site": "same-origin", "content-type": "application/json" };
    const r = await raw("POST", "/api/settings", own, JSON.stringify({ newPerDay: 25 }));
    expect(r.status).toBe(200);
    expect(JSON.parse(r.text).newPerDay).toBe(25);
    // no browser labels at all: curl, the test suite, the sync command
    expect((await raw("POST", "/api/settings", { "content-type": "application/json" }, JSON.stringify({ newPerDay: 20 }))).status).toBe(200);
    expect((await raw("POST", "/api/study/backup", { origin: `http://127.0.0.1:${port}` })).status).toBe(200);
  });

  it("only accepts JSON bodies", async () => {
    const r = await raw("POST", "/api/settings", { "content-type": "text/plain" }, JSON.stringify({ newPerDay: 99 }));
    expect(r.status).toBe(415);
    const form = await raw("POST", "/api/settings", { "content-type": "application/x-www-form-urlencoded" }, "newPerDay=99");
    expect(form.status).toBe(415);
    expect(JSON.parse(fs.readFileSync(path.join(dataDir, "settings.json"), "utf8")).newPerDay).toBe(20);
  });

  it("sends protective headers on every answer, including refusals", async () => {
    for (const r of [await raw("GET", "/"), await raw("GET", "/api/state"), await raw("GET", "/api/state", { host: "evil.example" })]) {
      expect(r.headers["x-content-type-options"]).toBe("nosniff");
      expect(r.headers["x-frame-options"]).toBe("DENY");
      expect(r.headers["content-security-policy"]).toContain("script-src 'self'");
      expect(r.headers["content-security-policy"]).toContain("frame-ancestors 'none'");
      expect(r.headers["x-powered-by"]).toBeUndefined();
    }
  });

  it("has no inline script in the page, so the content policy doesn't break it", () => {
    const html = fs.readFileSync(path.resolve("public/index.html"), "utf8");
    expect(html).not.toMatch(/<script(?![^>]*\bsrc=)[^>]*>/);
    expect(html).not.toMatch(/\son[a-z]+=/i);
  });
});
