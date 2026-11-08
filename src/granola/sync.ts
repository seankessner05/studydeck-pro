import fs from "node:fs";
import path from "node:path";
import { DEFAULT_COURSES, idsOf, routeTitle, stripCoursePrefix, type Course } from "../courses.js";
import { NOTES_DIR, loadNotes, type Note } from "../notes.js";
import { slugify } from "../sync.js";
import type { GranolaApi } from "./api.js";
import { meetingDate, type FullMeeting, type ListedMeeting } from "./parse.js";

export interface SyncItem {
  course: string;
  file: string;
  title: string;
}

export interface DirectSyncResult {
  /** Meetings Granola reported in the window. */
  scanned: number;
  added: SyncItem[];
  updated: SyncItem[];
  moved: SyncItem[];
  skipped: { title: string; reason: string }[];
  errors: { title: string; error: string }[];
}

export interface DirectSyncOptions {
  api: GranolaApi;
  notesDir?: string;
  courses?: Course[];
  /** How far back to look. Default: 120 days, which covers a semester. */
  days?: number;
  now?: Date;
  onProgress?: (message: string) => void;
}

const ymd = (d: Date) => d.toISOString().slice(0, 10);
const CHUNK = 10;

/** The course whose Granola folder (or name) matches one of the meeting's folders. */
export function courseForFolders(folders: { title: string }[], courses: Course[]): string | undefined {
  for (const f of folders) {
    const t = f.title.trim().toLowerCase();
    const c = courses.find((c) => c.id !== "unsorted" && !c.archived && [c.granolaFolder, c.name].some((x) => x?.trim().toLowerCase() === t));
    if (c) return c.id;
  }
  return undefined;
}

export function composeBody(m: FullMeeting): string {
  const parts: string[] = [];
  if (m.privateNotes) parts.push(`## My notes\n\n${m.privateNotes}`);
  if (m.summary) parts.push(m.privateNotes ? `## Granola summary\n\n${m.summary}` : m.summary);
  return parts.join("\n\n");
}

export function renderNote(m: FullMeeting, course: string, courses: Course[]): string {
  const title = stripCoursePrefix(m.title, courses).replace(/"/g, "'");
  const head = [
    `title: ${title}`,
    `course: ${course}`,
    `date: ${meetingDate(m.meetingAt)}`,
    "sample: false",
    "source: granola",
    `granola_id: ${m.id}`,
    m.updatedAt ? `granola_updated_at: ${m.updatedAt}` : "",
    m.url ? `granola_url: ${m.url}` : "",
    m.folders.length ? `granola_folder: ${m.folders.map((f) => f.title).join(", ")}` : "",
  ].filter(Boolean);
  return `---\n${head.join("\n")}\n---\n\n# ${title}\n\n${composeBody(m)}\n`;
}

function writeAtomic(file: string, text: string) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, text, "utf8");
  fs.renameSync(tmp, file);
}

/** A file name that doesn't clash with a different meeting's note (two same-titled meetings on one day happen). */
function freeName(dir: string, wanted: string, id: string): string {
  if (!fs.existsSync(path.join(dir, wanted))) return wanted;
  return wanted.replace(/\.md$/, `-${id.slice(0, 6)}.md`);
}

/**
 * Copy notes from Granola into ./notes, exactly as Granola has them (no AI involved).
 * - Courses come from the meeting's Granola folder, then a course code or keyword in the title, else the Inbox ("unsorted").
 * - Notes already copied are refreshed only if you edited them in Granola since, and re-filed if their course is now known.
 */
export async function runDirectSync(opts: DirectSyncOptions): Promise<DirectSyncResult> {
  const dir = opts.notesDir ?? NOTES_DIR;
  const courses = opts.courses ?? DEFAULT_COURSES;
  const now = opts.now ?? new Date();
  const log = opts.onProgress ?? (() => {});
  const result: DirectSyncResult = { scanned: 0, added: [], updated: [], moved: [], skipped: [], errors: [] };

  const from = ymd(new Date(now.getTime() - (opts.days ?? 120) * 86_400_000));
  const to = ymd(new Date(now.getTime() + 86_400_000));
  log(`Listing your Granola meetings since ${from}…`);
  const listed = new Map<string, ListedMeeting>();
  let cursor: string | undefined;
  do {
    const page = await opts.api.searchMeetings({ from, to, cursor });
    for (const m of page.meetings) listed.set(m.id, m);
    cursor = page.hasMore ? page.nextCursor : undefined;
  } while (cursor);
  const ids = [...listed.keys()];
  result.scanned = ids.length;
  log(`Found ${ids.length} meetings`);

  const local = new Map(
    loadNotes("all", dir, idsOf(courses))
      .filter((n): n is Note & { granolaId: string } => !!n.granolaId)
      .map((n) => [n.granolaId, n]),
  );

  for (let i = 0; i < ids.length; i += CHUNK) {
    const chunk = ids.slice(i, i + CHUNK);
    log(`Reading notes ${i + 1}–${Math.min(i + CHUNK, ids.length)} of ${ids.length}…`);
    let batch;
    try {
      batch = await opts.api.getMeetings(chunk);
    } catch (e) {
      for (const id of chunk) result.errors.push({ title: listed.get(id)?.title ?? id, error: e instanceof Error ? e.message : String(e) });
      continue;
    }
    for (const id of chunk) {
      if (!batch.meetings.some((m) => m.id === id)) result.skipped.push({ title: listed.get(id)?.title ?? id, reason: "Granola didn't return it" });
    }

    for (const m of batch.meetings) {
      const title = stripCoursePrefix(m.title, courses);
      try {
        if (m.creatorEmail && batch.connectedEmail && m.creatorEmail.toLowerCase() !== batch.connectedEmail.toLowerCase()) {
          result.skipped.push({ title: m.title, reason: "someone else's note" });
          continue;
        }
        if (!composeBody(m)) {
          result.skipped.push({ title: m.title, reason: "empty note" });
          continue;
        }

        const existing = local.get(m.id);
        const byTitle = routeTitle(m.title, courses);
        const course = courseForFolders(m.folders, courses) ?? (byTitle !== "unsorted" ? byTitle : existing?.course ?? "unsorted");
        const date = meetingDate(m.meetingAt);
        const wanted = `${date}_${slugify(title)}.md`;

        if (!existing) {
          const file = freeName(path.join(dir, course), wanted, m.id);
          writeAtomic(path.join(dir, course, file), renderNote(m, course, courses));
          result.added.push({ course, file, title });
          continue;
        }

        const moving = existing.course !== course;
        const stale = existing.granolaUpdatedAt !== m.updatedAt;
        if (!moving && !stale) {
          result.skipped.push({ title, reason: "up to date" });
          continue;
        }
        if (moving) {
          const file = freeName(path.join(dir, course), existing.file, m.id);
          writeAtomic(path.join(dir, course, file), renderNote(m, course, courses));
          fs.rmSync(path.join(dir, existing.course, existing.file), { force: true });
          result.moved.push({ course, file, title });
        } else {
          writeAtomic(path.join(dir, course, existing.file), renderNote(m, course, courses));
          result.updated.push({ course, file: existing.file, title });
        }
      } catch (e) {
        result.errors.push({ title: m.title, error: e instanceof Error ? e.message : String(e) });
      }
    }
  }
  return result;
}

export function formatDirectSync(r: DirectSyncResult): string {
  const upToDate = r.skipped.filter((s) => s.reason === "up to date").length;
  const lines = [`Scanned ${r.scanned} meetings: ${r.added.length} added, ${r.updated.length} updated, ${r.moved.length} re-filed, ${upToDate} already up to date`];
  for (const a of r.added) lines.push(`  + ${a.course}/${a.file}`);
  for (const a of r.updated) lines.push(`  ~ ${a.course}/${a.file} (edited in Granola)`);
  for (const a of r.moved) lines.push(`  → ${a.course}/${a.file} (re-filed)`);
  for (const s of r.skipped.filter((s) => s.reason !== "up to date")) lines.push(`  · skipped “${s.title}” (${s.reason})`);
  for (const e of r.errors) lines.push(`  ! ${e.title}: ${e.error}`);
  return lines.join("\n");
}
