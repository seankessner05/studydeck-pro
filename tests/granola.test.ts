import { describe, it, expect } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { decodeEntities, meetingDate, parseAttrs, parseMeetingList, parseMeetings, type FullMeeting } from "../src/granola/parse";
import { composeBody, courseForFolders, formatDirectSync, renderNote, runDirectSync } from "../src/granola/sync";
import type { GranolaApi } from "../src/granola/api";
import { DEFAULT_COURSES } from "../src/courses";
import { parseNote } from "../src/notes";

const fixture = (n: string) => fs.readFileSync(path.join(__dirname, "fixtures", n), "utf8");

describe("granola parsing", () => {
  it("decodes entities and attributes", () => {
    expect(decodeEntities("Q&amp;A &lt;b&gt; &quot;x&quot; &#39;y&#39;")).toBe("Q&A <b> \"x\" 'y'");
    expect(parseAttrs('id="1" title="A &amp; B" empty=""')).toEqual({ id: "1", title: "A & B", empty: "" });
    expect(meetingDate("2026-10-13T14:49:40.499-04:00")).toBe("2026-10-13");
    expect(meetingDate("garbage")).toBe("");
  });

  it("parses a meeting list with pagination", () => {
    const page = parseMeetingList(fixture("granola-list.txt"));
    expect(page.meetings.map((m) => m.title)).toEqual(["Accrual vs cash basis accounting", "New note", 'Speaker: "AI" & investing']);
    expect(page.meetings[0]).toMatchObject({ id: "11111111-1111-4111-8111-111111111111", meetingAt: "2026-10-02T09:50:34.595-04:00" });
    expect(page).toMatchObject({ hasMore: true, nextCursor: "abc123", total: 72 });
  });

  it("parses full meetings: folders, summary, creator, and the connected user", () => {
    const b = parseMeetings(fixture("granola-meetings.txt"));
    expect(b.connectedEmail).toBe("test@example.com");
    expect(b.meetings).toHaveLength(2);
    const [a, other] = b.meetings;
    expect(a).toMatchObject({ updatedAt: "2026-10-02T12:00:00.000-04:00", creatorEmail: "test@example.com", privateNotes: "" });
    expect(a.folders).toEqual([{ id: "f-acct", title: "Accounting" }]);
    expect(a.summary).toContain("### Q&A Highlights");
    expect(a.summary).toContain("2 < 3");
    expect(a.summary.startsWith("### Accrual")).toBe(true);
    expect(other.creatorEmail).toBe("friend@example.com");
    expect(other.folders).toEqual([]);
  });

  it("reads typed private notes and omitted meetings", () => {
    const text = `<meeting id="a" title="T" meeting_at="2026-10-02T09:00:00-04:00"><private_notes status="ok">my own words &amp; more</private_notes><summary>S</summary></meeting>
      <omitted_meetings>11111111-1111-4111-8111-111111111111, 22222222-2222-4222-8222-222222222222</omitted_meetings>`;
    const b = parseMeetings(text);
    expect(b.meetings[0].privateNotes).toBe("my own words & more");
    expect(b.omitted).toEqual(["11111111-1111-4111-8111-111111111111", "22222222-2222-4222-8222-222222222222"]);
  });
});

// ---------- sync engine ----------
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "sd-gsync-"));
const meeting = (id: string, title: string, over: Partial<FullMeeting> = {}): FullMeeting => ({
  id, title, meetingAt: "2026-10-13T14:49:40.000-04:00", updatedAt: "2026-10-13T17:00:00.000-04:00",
  folders: [], privateNotes: "", summary: `## ${title}\n\n- point`, creatorEmail: "me@example.com", ...over,
});

function fakeApi(meetings: FullMeeting[], opts: { pageSize?: number } = {}) {
  const calls = { search: 0, get: [] as string[][] };
  const api: GranolaApi = {
    async listFolders() { return []; },
    async searchMeetings({ cursor }) {
      calls.search++;
      const size = opts.pageSize ?? 100;
      const start = cursor ? Number(cursor) : 0;
      const slice = meetings.slice(start, start + size);
      const end = start + size;
      return { meetings: slice.map((m) => ({ id: m.id, title: m.title, meetingAt: m.meetingAt })), hasMore: end < meetings.length, nextCursor: String(end) };
    },
    async getMeetings(ids) { calls.get.push(ids); return { connectedEmail: "me@example.com", meetings: meetings.filter((m) => ids.includes(m.id)) }; },
  };
  return { api, calls, meetings };
}

const MICRO = { id: "f1", title: "Microeconomics" };
const ACCT = { id: "f2", title: "Accounting" };
const files = (dir: string, course: string) => (fs.existsSync(path.join(dir, course)) ? fs.readdirSync(path.join(dir, course)).sort() : []);
const run = (dir: string, api: GranolaApi) => runDirectSync({ api, notesDir: dir, courses: DEFAULT_COURSES, now: new Date("2026-11-08") });

describe("direct sync", () => {
  it("files notes by Granola folder, then title, else the Inbox", async () => {
    const dir = tmp();
    const { api } = fakeApi([
      meeting("a1", "Cost minimization", { folders: [MICRO] }),
      meeting("a2", "Adjusting entries", { folders: [ACCT] }),
      meeting("a3", "ECON300 Fiscal policy"),
      meeting("a4", "Coffee with Sam"),
    ]);
    const r = await run(dir, api);
    expect(r.added.map((x) => `${x.course}/${x.file}`).sort()).toEqual([
      "ECON196/2026-10-13_adjusting-entries.md", "ECON300/2026-10-13_fiscal-policy.md",
      "ECON301/2026-10-13_cost-minimization.md", "unsorted/2026-10-13_coffee-with-sam.md",
    ]);
    const note = parseNote("ECON301", "2026-10-13_cost-minimization.md", fs.readFileSync(path.join(dir, "ECON301", "2026-10-13_cost-minimization.md"), "utf8"));
    expect(note).toMatchObject({ title: "Cost minimization", granolaId: "a1", granolaUpdatedAt: "2026-10-13T17:00:00.000-04:00", date: "2026-10-13" });
    expect(note.body).toContain("- point");
  });

  it("is idempotent: a second run changes nothing", async () => {
    const dir = tmp();
    const { api } = fakeApi([meeting("a1", "Cost", { folders: [MICRO] }), meeting("a2", "Other")]);
    await run(dir, api);
    const before = fs.readFileSync(path.join(dir, "ECON301", "2026-10-13_cost.md"), "utf8");
    const r2 = await run(dir, api);
    expect(r2).toMatchObject({ added: [], updated: [], moved: [], errors: [] });
    expect(r2.skipped.filter((s) => s.reason === "up to date")).toHaveLength(2);
    expect(fs.readFileSync(path.join(dir, "ECON301", "2026-10-13_cost.md"), "utf8")).toBe(before);
  });

  it("refreshes a note you edited in Granola", async () => {
    const dir = tmp();
    const first = fakeApi([meeting("a1", "Cost", { folders: [MICRO] })]);
    await run(dir, first.api);
    const edited = fakeApi([meeting("a1", "Cost", { folders: [MICRO], updatedAt: "2026-10-14T09:00:00.000-04:00", summary: "## Cost\n\n- brand new point" })]);
    const r = await run(dir, edited.api);
    expect(r.updated).toHaveLength(1);
    expect(fs.readFileSync(path.join(dir, "ECON301", "2026-10-13_cost.md"), "utf8")).toContain("brand new point");
  });

  it("re-files a note when its course becomes known (Inbox to folder), without leaving a copy behind", async () => {
    const dir = tmp();
    await run(dir, fakeApi([meeting("a1", "Monopoly project")]).api);
    expect(files(dir, "unsorted")).toHaveLength(1);
    const r = await run(dir, fakeApi([meeting("a1", "Monopoly project", { folders: [ACCT] })]).api);
    expect(r.moved).toEqual([{ course: "ECON196", file: "2026-10-13_monopoly-project.md", title: "Monopoly project" }]);
    expect(files(dir, "unsorted")).toEqual([]);
    expect(fs.readFileSync(path.join(dir, "ECON196", "2026-10-13_monopoly-project.md"), "utf8")).toContain("course: ECON196");
  });

  it("keeps two same-titled meetings on the same day as separate notes", async () => {
    const dir = tmp();
    const { api } = fakeApi([meeting("aaaaaa1", "Midterm review", { summary: "first" }), meeting("bbbbbb2", "Midterm review", { summary: "second" })]);
    const r = await run(dir, api);
    expect(r.added).toHaveLength(2);
    expect(files(dir, "unsorted")).toEqual(["2026-10-13_midterm-review-bbbbbb.md", "2026-10-13_midterm-review.md"]);
    const again = await run(dir, api);
    expect(again.added).toEqual([]);
  });

  it("skips empty notes and other people's notes; combines your own notes with the summary", async () => {
    const dir = tmp();
    const { api } = fakeApi([
      meeting("e1", "New note", { summary: "" }),
      meeting("o1", "Shared", { creatorEmail: "friend@example.com" }),
      meeting("p1", "Mine", { privateNotes: "typed by me", summary: "AI summary" }),
    ]);
    const r = await run(dir, api);
    expect(r.skipped.map((s) => s.reason).sort()).toEqual(["empty note", "someone else's note"]);
    const text = fs.readFileSync(path.join(dir, "unsorted", "2026-10-13_mine.md"), "utf8");
    expect(text).toContain("## My notes\n\ntyped by me");
    expect(text).toContain("## Granola summary\n\nAI summary");
  });

  it("follows pagination and reads in chunks of ten", async () => {
    const dir = tmp();
    const many = Array.from({ length: 25 }, (_, i) => meeting(`id${String(i).padStart(2, "0")}`, `Lecture ${i}`, { folders: [MICRO] }));
    const { api, calls } = fakeApi(many, { pageSize: 10 });
    const r = await run(dir, api);
    expect(r.scanned).toBe(25);
    expect(r.added).toHaveLength(25);
    expect(calls.search).toBe(3);
    expect(calls.get.map((c) => c.length)).toEqual([10, 10, 5]);
  });

  it("reports a failing chunk without losing the rest", async () => {
    const dir = tmp();
    const ms = Array.from({ length: 12 }, (_, i) => meeting(`id${i}`, `L${i}`));
    const { api } = fakeApi(ms);
    let n = 0;
    const flaky: GranolaApi = { ...api, getMeetings: async (ids) => { if (n++ === 0) throw new Error("Granola busy"); return api.getMeetings(ids); } };
    const r = await run(dir, flaky);
    expect(r.errors).toHaveLength(10);
    expect(r.added).toHaveLength(2);
  });

  it("matches folders to courses by folder setting or course name, ignoring archived courses", () => {
    expect(courseForFolders([{ title: "Social Innovation" }], DEFAULT_COURSES)).toBe("MGMT220");
    expect(courseForFolders([{ title: "microeconomics" }], DEFAULT_COURSES)).toBe("ECON301");
    expect(courseForFolders([{ title: "Other" }, { title: "Accounting" }], DEFAULT_COURSES)).toBe("ECON196");
    expect(courseForFolders([{ title: "Accounting" }], DEFAULT_COURSES.map((c) => (c.id === "ECON196" ? { ...c, archived: true } : c)))).toBeUndefined();
    expect(courseForFolders([{ title: "Unsorted" }], DEFAULT_COURSES)).toBeUndefined();
  });

  it("renders readable frontmatter and a summary line", async () => {
    const m = meeting("a1", "ECON301: Cost \"minimization\"", { folders: [MICRO], url: "https://notes.granola.ai/d/a1" });
    const text = renderNote(m, "ECON301", DEFAULT_COURSES);
    expect(text).toContain("title: Cost 'minimization'");
    expect(text).toContain("granola_url: https://notes.granola.ai/d/a1");
    expect(text).toContain("granola_folder: Microeconomics");
    expect(composeBody(meeting("x", "t", { summary: "" }))).toBe("");
    const r = await runDirectSync({ api: fakeApi([m]).api, notesDir: tmp(), courses: DEFAULT_COURSES, now: new Date("2026-11-08") });
    expect(formatDirectSync(r)).toMatch(/Scanned 1 meetings: 1 added/);
  });
});
