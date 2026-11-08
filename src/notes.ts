import fs from "node:fs";
import path from "node:path";
import { DEFAULT_COURSES, activeIdsOf, idsOf, type Course } from "./courses.js";

export interface Note {
  /** "<course>/<file>" — unique and safe to use in URLs */
  id: string;
  course: string;
  file: string;
  date: string;
  title: string;
  sample: boolean;
  body: string;
  granolaId?: string;
  /** Granola's updated_at when this note was last copied, used to detect later edits. */
  granolaUpdatedAt?: string;
}

export const NOTES_DIR = path.resolve(process.env.STUDYDECK_NOTES_DIR ?? "notes");
export const SAMPLE_DIR = path.resolve(process.env.STUDYDECK_SAMPLE_DIR ?? "sample-notes");

export type NotesSource = "notes" | "samples";

const DEFAULT_IDS = idsOf(DEFAULT_COURSES);

/** Demo mode always uses samples; otherwise real notes, falling back to samples when ./notes is empty. */
export function resolveNotesDir(notesDir: string, sampleDir: string, demo: boolean, ids: string[] = DEFAULT_IDS): { dir: string; source: NotesSource } {
  if (!demo && loadNotes("all", notesDir, ids).length > 0) return { dir: notesDir, source: "notes" };
  return { dir: sampleDir, source: "samples" };
}

export function parseFrontmatter(raw: string): { meta: Record<string, string>; body: string } {
  const m = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!m) return { meta: {}, body: raw };
  const meta: Record<string, string> = {};
  for (const line of m[1].split(/\r?\n/)) {
    const kv = line.match(/^([A-Za-z_]+):\s*(.*)$/);
    if (kv) meta[kv[1]] = kv[2].replace(/^"(.*)"$/, "$1").trim();
  }
  return { meta, body: m[2] };
}

export function parseNote(course: string, file: string, raw: string): Note {
  const { meta, body } = parseFrontmatter(raw);
  const nameMatch = file.match(/^(\d{4}-\d{2}-\d{2})_(.*)\.md$/);
  const date = meta.date || nameMatch?.[1] || "";
  const fallbackTitle = (nameMatch?.[2] ?? file).replace(/^sample-/, "").replace(/-/g, " ");
  return {
    id: `${course}/${file}`,
    course,
    file,
    date,
    title: meta.title || fallbackTitle,
    sample: meta.sample === "true",
    body: body.trim(),
    granolaId: meta.granola_id || undefined,
    granolaUpdatedAt: meta.granola_updated_at || undefined,
  };
}

export function loadCourseNotes(course: string, dir = NOTES_DIR): Note[] {
  const courseDir = path.join(dir, course);
  if (!fs.existsSync(courseDir)) return [];
  return fs
    .readdirSync(courseDir)
    .filter((f) => f.endsWith(".md"))
    .sort()
    .map((f) => parseNote(course, f, fs.readFileSync(path.join(courseDir, f), "utf8")));
}

/** course === "all" loads the folders of the given course ids (default: the seed courses). */
export function loadNotes(course: string, dir = NOTES_DIR, ids: string[] = DEFAULT_IDS): Note[] {
  if (course === "all") return ids.flatMap((c) => loadCourseNotes(c, dir));
  return loadCourseNotes(course, dir);
}

/** Every course with its note count. The total only counts active (non-archived) courses, matching the "all" scope. */
export function listCourses(dir = NOTES_DIR, courses: Course[] = DEFAULT_COURSES) {
  const withCounts = courses.map((c) => {
    const notes = loadCourseNotes(c.id, dir);
    return { ...c, count: notes.length, latest: notes.map((n) => n.date).sort().at(-1) };
  });
  const active = new Set(activeIdsOf(courses));
  return { courses: withCounts, total: withCounts.filter((c) => active.has(c.id)).reduce((n, c) => n + c.count, 0) };
}

/** Safe single-note lookup (rejects path traversal). */
export function readNote(course: string, file: string, dir = NOTES_DIR, ids: string[] = DEFAULT_IDS): Note | null {
  if (!ids.includes(course) || file !== path.basename(file) || !file.endsWith(".md")) return null;
  const p = path.join(dir, course, file);
  if (!fs.existsSync(p)) return null;
  return parseNote(course, file, fs.readFileSync(p, "utf8"));
}

export function citationLabel(n: Note): string {
  return `${n.course} ${n.date}: ${n.title}`;
}

/** A short plain-text preview of a note: the first real sentence, without markdown or the title heading. */
export function noteSnippet(body: string, max = 150): string {
  const picked: string[] = [];
  for (const raw of body.split("\n")) {
    const l = raw.trim();
    if (!l || /^#{1,2}\s/.test(l) || /^>\s*\*\*SAMPLE/.test(l) || /^\|?\s*:?-{2,}/.test(l)) continue;
    let text: string;
    if (l.startsWith("|")) {
      // table row: "cue: note"; skip the Cue | Notes header row
      const cells = l.split("|").map((c) => c.trim()).filter(Boolean);
      if (cells.length && cells.every((c) => /^(cue|notes?|key terms?)$/i.test(c))) continue;
      text = cells.length > 1 ? `${cells[0]}: ${cells.slice(1).join(" ")}` : cells[0] ?? "";
    } else {
      text = l.replace(/^#{3,}\s+/, "").replace(/^[-*]\s+/, "");
    }
    text = text.replace(/\*\*(.+?)\*\*/g, "$1").replace(/\s+/g, " ").trim();
    if (text) picked.push(text);
    if (picked.join(" — ").length >= max) break;
  }
  const out = picked.join(" — ");
  return out.length > max ? out.slice(0, max - 1).trimEnd() + "…" : out;
}

export class MoveError extends Error {}

/** Re-file a note under another course: moves the file and rewrites its `course:` line. */
export function moveNote(dir: string, ids: string[], course: string, file: string, target: string): Note {
  if (!ids.includes(course) || !ids.includes(target)) throw new MoveError("Unknown course.");
  const from = path.join(dir, course, file);
  if (file !== path.basename(file) || !file.endsWith(".md") || !fs.existsSync(from)) throw new MoveError("Note not found.");
  if (course === target) return parseNote(course, file, fs.readFileSync(from, "utf8"));
  const to = path.join(dir, target, file);
  if (fs.existsSync(to)) throw new MoveError(`${target} already has a note with that file name.`);
  let raw = fs.readFileSync(from, "utf8");
  raw = /^---\r?\n[\s\S]*?^course:/m.test(raw) ? raw.replace(/^course:.*$/m, `course: ${target}`) : `---\ncourse: ${target}\n---\n${raw}`;
  fs.mkdirSync(path.dirname(to), { recursive: true });
  fs.writeFileSync(to, raw, "utf8");
  fs.rmSync(from);
  return parseNote(target, file, raw);
}
