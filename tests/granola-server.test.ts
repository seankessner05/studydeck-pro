import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { Server } from "node:http";
import { createApp } from "../src/server";
import { GranolaError, NotConnectedError, type GranolaApi, type GranolaService } from "../src/granola/api";
import type { FullMeeting } from "../src/granola/parse";
import type { Runner } from "../src/claude";

const mk = (id: string, title: string, folder?: string): FullMeeting => ({
  id, title, meetingAt: "2026-11-02T09:45:00.000-05:00", updatedAt: "2026-11-02T12:00:00.000-05:00",
  folders: folder ? [{ id: "f", title: folder }] : [], privateNotes: "", summary: `## ${title}\n\n- point`, creatorEmail: "me@example.com",
});

class FakeGranola implements GranolaService {
  connected = false;
  failWith?: Error;
  finished: { code: string; state?: string }[] = [];
  release?: () => void;
  gate?: Promise<void>;
  isConnected() { return this.connected; }
  async startAuth(redirect: string) { return `https://auth.example/authorize?redirect=${encodeURIComponent(redirect)}`; }
  async finishAuth(code: string, state: string | undefined) {
    if (code !== "good") throw new GranolaError("This login link isn't valid any more.");
    this.finished.push({ code, state });
    this.connected = true;
  }
  disconnect() { this.connected = false; }
  async withApi<T>(_redirect: string, fn: (api: GranolaApi) => Promise<T>): Promise<T> {
    if (this.failWith) throw this.failWith;
    if (this.gate) await this.gate;
    const meetings = [mk("m1", "Isoquants", "Microeconomics"), mk("m2", "Ratio analysis", "Accounting"), mk("m3", "Visa appointment")];
    return fn({
      listFolders: async () => [],
      searchMeetings: async () => ({ meetings: meetings.map((m) => ({ id: m.id, title: m.title, meetingAt: m.meetingAt })), hasMore: false }),
      getMeetings: async (ids) => ({ connectedEmail: "me@example.com", meetings: meetings.filter((m) => ids.includes(m.id)) }),
    });
  }
}

let server: Server, base: string, notesDir: string, fake: FakeGranola;
const runner: Runner = async () => ({ text: "x" });

beforeAll(async () => {
  notesDir = fs.mkdtempSync(path.join(os.tmpdir(), "sd-gnotes-"));
  fake = new FakeGranola();
  const app = createApp({ runner, notesDir, sampleDir: path.resolve("sample-notes"), dataDir: fs.mkdtempSync(path.join(os.tmpdir(), "sd-gdata-")), granola: fake });
  await new Promise<void>((r) => (server = app.listen(0, () => r())));
  base = `http://127.0.0.1:${(server.address() as any).port}`;
});
afterAll(() => server.close());

const post = (url: string) => fetch(`${base}${url}`, { method: "POST" });
async function sse(res: Response) {
  const text = await res.text();
  return [...text.matchAll(/event: (\w+)\ndata: (.*)\n/g)].map((m) => [m[1], JSON.parse(m[2])] as const);
}

describe("granola connection and sync API", () => {
  it("reports the connection state and starts the login with this server's callback URL", async () => {
    expect(await (await fetch(`${base}/api/granola/status`)).json()).toMatchObject({ connected: false });
    const { authUrl } = await (await post("/api/granola/connect")).json();
    expect(decodeURIComponent(authUrl)).toContain(`${base.replace("127.0.0.1", "127.0.0.1")}/api/granola/callback`);
  });

  it("refuses to sync until connected", async () => {
    const res = await post("/api/sync");
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ needsConnect: true });
  });

  it("finishes the login from the browser redirect, and rejects a bad one", async () => {
    const bad = await fetch(`${base}/api/granola/callback?code=nope&state=s`);
    expect(bad.status).toBe(400);
    expect(await bad.text()).toContain("isn't valid");
    const cancelled = await fetch(`${base}/api/granola/callback?error=access_denied`);
    expect(cancelled.status).toBe(400);
    const ok = await fetch(`${base}/api/granola/callback?code=good&state=abc`);
    expect(ok.status).toBe(200);
    expect(await ok.text()).toContain("Granola is connected");
    expect(fake.finished).toEqual([{ code: "good", state: "abc" }]);
    expect(await (await fetch(`${base}/api/granola/status`)).json()).toMatchObject({ connected: true });
  });

  it("streams progress then a summary, and files the notes by folder", async () => {
    const events = await sse(await post("/api/sync"));
    expect(events.map((e) => e[0])).toContain("progress");
    const done = events.at(-1)!;
    expect(done[0]).toBe("done");
    expect((done[1] as any).added.map((a: any) => a.course).sort()).toEqual(["ECON196", "ECON301", "unsorted"]);
    expect(fs.existsSync(path.join(notesDir, "ECON301", "2026-11-02_isoquants.md"))).toBe(true);
    // a second sync is a no-op
    const again = (await sse(await post("/api/sync"))).at(-1)!;
    expect((again[1] as any).added).toEqual([]);
  });

  it("does not run two syncs at once", async () => {
    let open!: () => void;
    fake.gate = new Promise<void>((r) => (open = r));
    const first = post("/api/sync");
    await new Promise((r) => setTimeout(r, 50));
    expect((await post("/api/sync")).status).toBe(409);
    open();
    fake.gate = undefined;
    expect((await sse(await first)).at(-1)![0]).toBe("done");
  });

  it("turns a lost login or a network failure into a clear message", async () => {
    fake.failWith = new NotConnectedError();
    expect((await sse(await post("/api/sync"))).at(-1)).toEqual(["error", { message: expect.stringContaining("Connect Granola"), needsConnect: true }]);
    fake.failWith = new Error("fetch failed");
    expect(((await sse(await post("/api/sync"))).at(-1)![1] as any).message).toContain("Couldn't reach Granola");
    fake.failWith = undefined;
    await post("/api/granola/disconnect");
    expect(await (await fetch(`${base}/api/granola/status`)).json()).toMatchObject({ connected: false });
  });
});
