import fs from "node:fs";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { UnauthorizedError } from "@modelcontextprotocol/sdk/client/auth.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { FileAuthProvider, hasTokens, readStored } from "./auth.js";
import { parseMeetingList, parseMeetings, type FullMeeting, type ListPage } from "./parse.js";

export const GRANOLA_MCP_URL = "https://mcp.granola.ai/mcp";

/** What the sync engine needs from Granola. The real one talks MCP; tests use a fake. */
export interface GranolaApi {
  listFolders(): Promise<{ id: string; title: string; noteCount?: number }[]>;
  searchMeetings(args: { from?: string; to?: string; cursor?: string }): Promise<ListPage>;
  /** Any number of ids; batching and size limits are handled inside. */
  getMeetings(ids: string[]): Promise<{ connectedEmail?: string; meetings: FullMeeting[] }>;
}

export class NotConnectedError extends Error {
  constructor() {
    super("Granola isn't connected yet. Click “Connect Granola” in StudyDeck.");
  }
}

export class GranolaError extends Error {}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export class McpGranolaApi implements GranolaApi {
  constructor(private readonly client: Client) {}

  private async call(name: string, args: Record<string, unknown>): Promise<string> {
    for (let attempt = 0; ; attempt++) {
      const res = await this.client.callTool({ name, arguments: args });
      const text = (res.content as { type: string; text?: string }[]).filter((c) => c.type === "text").map((c) => c.text ?? "").join("\n");
      if (!res.isError) return text;
      const wait = text.match(/retry_after_seconds["':\s]+(\d+)/)?.[1];
      if (/rate.?limit/i.test(text) && wait && attempt < 3) {
        await sleep(Math.min(Number(wait), 30) * 1000);
        continue;
      }
      throw new GranolaError(`Granola ${name} failed: ${text.slice(0, 300)}`);
    }
  }

  async listFolders() {
    const text = await this.call("list_meeting_folders", {});
    const json = JSON.parse(text.slice(text.indexOf("{")));
    return (json.folders ?? []).map((f: any) => ({ id: String(f.id), title: String(f.title), noteCount: f.note_count }));
  }

  async searchMeetings(a: { from?: string; to?: string; cursor?: string }) {
    const args: Record<string, unknown> = { limit: 100, max_participants: 0, include_shared: false };
    if (a.from) args.from_date = a.from;
    if (a.to) args.to_date = a.to;
    if (a.cursor) args.cursor = a.cursor;
    return parseMeetingList(await this.call("search_meetings", args));
  }

  async getMeetings(ids: string[]) {
    const meetings: FullMeeting[] = [];
    let connectedEmail: string | undefined;
    let queue = [...ids];
    while (queue.length) {
      const batch = queue.slice(0, 10);
      queue = queue.slice(10);
      const parsed = parseMeetings(await this.call("get_meetings", { meeting_ids: batch, attachments: "none", max_participants: 0 }));
      connectedEmail ??= parsed.connectedEmail;
      meetings.push(...parsed.meetings);
      // Responses over ~80k characters leave some meetings out; ask for those again (once per id, to avoid a loop).
      const got = new Set(parsed.meetings.map((m) => m.id));
      const retry = parsed.omitted.filter((id) => !got.has(id) && batch.includes(id));
      if (retry.length && retry.length < batch.length) queue.unshift(...retry);
      else if (retry.length) queue.unshift(...retry.slice(0, 1));
    }
    return { connectedEmail, meetings };
  }
}

/** The slice of the connection the server needs; tests provide a fake. */
export interface GranolaService {
  isConnected(): boolean;
  /** Starts the browser login; resolves with the URL to open. */
  startAuth(redirectUrl: string): Promise<string>;
  finishAuth(code: string, state: string | undefined): Promise<void>;
  withApi<T>(redirectUrl: string, fn: (api: GranolaApi) => Promise<T>): Promise<T>;
  disconnect(): void;
}

export class GranolaConnection implements GranolaService {
  private pending?: { transport: StreamableHTTPClientTransport; client: Client };

  constructor(private readonly file: string) {}

  isConnected() {
    return hasTokens(this.file);
  }

  async startAuth(redirectUrl: string): Promise<string> {
    let authUrl: URL | undefined;
    const provider = new FileAuthProvider(this.file, redirectUrl, (u) => (authUrl = u));
    const transport = new StreamableHTTPClientTransport(new URL(GRANOLA_MCP_URL), { authProvider: provider });
    const client = new Client({ name: "studydeck", version: "0.1.0" });
    try {
      await client.connect(transport);
      // Already logged in (tokens still valid): nothing to do.
      await client.close();
      throw new GranolaError("Granola is already connected.");
    } catch (e) {
      if (!(e instanceof UnauthorizedError) || !authUrl) throw e;
    }
    this.pending = { transport, client };
    return authUrl.toString();
  }

  async finishAuth(code: string, state: string | undefined) {
    const stored = readStored(this.file);
    if (!this.pending || !stored.state || stored.state !== state) throw new GranolaError("This login link isn't valid any more. Click “Connect Granola” again.");
    const { transport, client } = this.pending;
    this.pending = undefined;
    await transport.finishAuth(code);
    await client.close().catch(() => {});
  }

  async withApi<T>(redirectUrl: string, fn: (api: GranolaApi) => Promise<T>): Promise<T> {
    const provider = new FileAuthProvider(this.file, redirectUrl, () => {
      throw new NotConnectedError();
    });
    const transport = new StreamableHTTPClientTransport(new URL(GRANOLA_MCP_URL), { authProvider: provider });
    const client = new Client({ name: "studydeck", version: "0.1.0" });
    try {
      await client.connect(transport);
    } catch (e) {
      if (e instanceof UnauthorizedError || e instanceof NotConnectedError) throw new NotConnectedError();
      throw e;
    }
    try {
      return await fn(new McpGranolaApi(client));
    } finally {
      await client.close().catch(() => {});
    }
  }

  disconnect() {
    fs.rmSync(this.file, { force: true });
  }
}
