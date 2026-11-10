import { randomUUID } from "node:crypto";
import type { Runner } from "../claude.js";
import type { Db } from "../library/db.js";
import { CALL_TIMEOUT_MS, parseJsonList } from "./cardgen.js";
import { QuizError } from "./questions.js";

export type SheetKind = "onepage" | "guide";
export const ONEPAGE_LIMIT = 36;

export interface SheetItem {
  front: string;
  back: string;
  quote: string | null;
  lecture: string;
  noteId: string | null;
}

export interface Sheet {
  title: string;
  kind: SheetKind;
  groups: { heading: string; items: SheetItem[] }[];
  /** Cards that were in scope but didn't make the one-page cut */
  left: number;
  cards: number;
}

export interface SheetRow {
  id: string;
  course: string;
  examId: string | null;
  kind: SheetKind;
  version: number;
  title: string;
  cards: number;
  createdAt: number;
}

interface CardRef extends SheetItem {
  id: string;
  date: string;
  section: string | null;
  createdAt: number;
}

export interface NoteMeta {
  id: string;
  title: string;
  date: string;
}

/** Every active card made from these lectures: the verified material a sheet is assembled from. Nothing is written fresh. */
export function cardsForSheet(db: Db, notes: NoteMeta[]): CardRef[] {
  if (!notes.length) return [];
  const meta = new Map(notes.map((n) => [n.id, n]));
  const rows = db.prepare(`SELECT id, note_id, section, front, back, quote, created_at FROM cards WHERE suspended = 0 AND note_id IN (${notes.map(() => "?").join(",")}) ORDER BY created_at`).all(...notes.map((n) => n.id)) as any[];
  return rows.map((r) => {
    const n = meta.get(r.note_id)!;
    return { id: r.id, front: r.front, back: r.back, quote: r.quote, lecture: n.title, noteId: r.note_id, date: n.date, section: r.section, createdAt: r.created_at };
  });
}

const toItem = (c: CardRef): SheetItem => ({ front: c.front, back: c.back, quote: c.quote, lecture: c.lecture, noteId: c.noteId });

/** The study guide: every card, grouped by lecture (in date order) and then by section. No AI. */
export function buildGuide(cards: CardRef[], title: string): Sheet {
  if (!cards.length) throw new QuizError("There are no flashcards for these lectures yet. Make cards first, then build the sheet.");
  const byLecture = new Map<string, CardRef[]>();
  for (const c of cards) (byLecture.get(c.noteId ?? "") ?? byLecture.set(c.noteId ?? "", []).get(c.noteId ?? "")!).push(c);
  const groups = [...byLecture.values()]
    .sort((a, b) => a[0].date.localeCompare(b[0].date))
    .flatMap((list) => {
      const bySection = new Map<string, CardRef[]>();
      for (const c of list) (bySection.get(c.section ?? "") ?? bySection.set(c.section ?? "", []).get(c.section ?? "")!).push(c);
      return [...bySection.entries()].map(([section, items]) => ({
        heading: `${list[0].date.slice(5).replace("-", "/")} · ${list[0].lecture}${section && section !== list[0].lecture ? ` › ${section}` : ""}`,
        items: items.map(toItem),
      }));
    });
  return { title, kind: "guide", groups, left: 0, cards: cards.length };
}

export function buildOnePagePrompts(cards: CardRef[], limit: number): { system: string; prompt: string } {
  const system = [
    "You help a college student build a one-page exam cheat sheet from their own flashcards.",
    "You do NOT write any card text. You only choose cards by id and group them under headings.",
    `Choose at most ${limit} cards the student could least afford to forget under exam pressure: formulas and how to use them, definitions of key terms, step-by-step procedures, and distinctions that are easy to mix up. Skip anything obvious, narrow, or a duplicate of a chosen card.`,
    "Group the chosen cards under at most 8 short topic headings (2 to 5 words each), in the order a student would read the sheet. Order cards sensibly within each group.",
    'OUTPUT: ONLY a JSON array, no prose and no code fences: [{"heading":"...","ids":["card id","card id"]}]',
  ].join("\n");
  const lines = cards.map((c) => `${c.id} | ${c.lecture} | ${c.front} → ${c.back.replace(/\s+/g, " ").slice(0, 170)}`).join("\n");
  return { system, prompt: `Cards (id | lecture | front → back):\n${lines}\n\nChoose the cards for the sheet now.` };
}

/** Build the sheet from whatever Claude chose, keeping only ids that exist, each once, within the limit. */
export function assembleOnePage(cards: CardRef[], raw: unknown[], limit: number, title: string): Sheet {
  const byId = new Map(cards.map((c) => [c.id, c]));
  const used = new Set<string>();
  const groups: Sheet["groups"] = [];
  let total = 0;
  for (const g of raw) {
    const r = (g && typeof g === "object" ? g : {}) as Record<string, unknown>;
    const heading = typeof r.heading === "string" ? r.heading.replace(/\s+/g, " ").trim().slice(0, 60) : "";
    if (!heading || !Array.isArray(r.ids) || groups.length >= 8) continue;
    const items: SheetItem[] = [];
    for (const id of r.ids) {
      if (typeof id !== "string" || used.has(id) || !byId.has(id) || total >= limit) continue;
      used.add(id);
      items.push(toItem(byId.get(id)!));
      total++;
    }
    if (items.length) groups.push({ heading, items });
  }
  if (!total) throw new QuizError("Claude's choice didn't match any of your cards, so no sheet was made. Try again.");
  return { title, kind: "onepage", groups, left: cards.length - total, cards: total };
}

export async function generateOnePage(opts: { runner: Runner; cards: CardRef[]; limit?: number; title: string; signal?: AbortSignal }): Promise<{ sheet: Sheet; calls: number; costUsd: number }> {
  if (!opts.cards.length) throw new QuizError("There are no flashcards for these lectures yet. Make cards first, then build the sheet.");
  const limit = opts.limit ?? ONEPAGE_LIMIT;
  const { system, prompt } = buildOnePagePrompts(opts.cards, limit);
  let calls = 0;
  let costUsd = 0;
  let raw: unknown[] | undefined;
  let nudge = "";
  for (let attempt = 0; attempt < 2 && !raw; attempt++) {
    const r = await opts.runner({ system, prompt: prompt + nudge, signal: opts.signal, timeoutMs: CALL_TIMEOUT_MS });
    calls++;
    costUsd += r.costUsd ?? 0;
    try {
      raw = parseJsonList(r.text, "groups", "card groups");
    } catch (e) {
      if (attempt === 1) throw e;
      nudge = "\n\nIMPORTANT: your previous reply could not be parsed. Reply with ONLY the raw JSON array, starting with [ and ending with ].";
    }
  }
  return { sheet: assembleOnePage(opts.cards, raw ?? [], limit, opts.title), calls, costUsd };
}

// ---------- saving and exporting ----------

export function saveSheet(db: Db, o: { course: string; examId?: string | null; sheet: Sheet }, now = new Date()): SheetRow {
  const prev = db.prepare("SELECT COALESCE(MAX(version), 0) v FROM cheatsheets WHERE course = ? AND COALESCE(exam_id, '') = ? AND kind = ?").get(o.course, o.examId ?? "", o.sheet.kind) as { v: number };
  const id = randomUUID();
  db.prepare("INSERT INTO cheatsheets (id, course, exam_id, kind, version, title, body_json, card_count, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)").run(
    id, o.course, o.examId ?? null, o.sheet.kind, Number(prev.v) + 1, o.sheet.title, JSON.stringify(o.sheet), o.sheet.cards, now.getTime(),
  );
  return listSheets(db, o.course).find((s) => s.id === id)!;
}

const toRow = (r: any): SheetRow => ({ id: r.id, course: r.course, examId: r.exam_id, kind: r.kind, version: r.version, title: r.title, cards: r.card_count, createdAt: r.created_at });

export function listSheets(db: Db, course: string, examId?: string): SheetRow[] {
  const rows = db
    .prepare(`SELECT * FROM cheatsheets WHERE ${course === "all" ? "1=1" : "course = ?"} ${examId ? "AND exam_id = ?" : ""} ORDER BY created_at DESC`)
    .all(...(course === "all" ? [] : [course]), ...(examId ? [examId] : [])) as any[];
  return rows.map(toRow);
}

export function getSheet(db: Db, id: string): (SheetRow & { sheet: Sheet }) | undefined {
  const r = db.prepare("SELECT * FROM cheatsheets WHERE id = ?").get(id) as any;
  return r ? { ...toRow(r), sheet: JSON.parse(r.body_json) as Sheet } : undefined;
}

export function deleteSheet(db: Db, id: string): boolean {
  return db.prepare("DELETE FROM cheatsheets WHERE id = ?").run(id).changes > 0;
}

/** Plain markdown, for pasting into a doc or printing from anywhere. */
export function sheetToMarkdown(sheet: Sheet, version: number): string {
  const lines = [`# ${sheet.title}`, `_${sheet.kind === "onepage" ? "One-page sheet" : "Study guide"} · version ${version} · ${sheet.cards} cards, each from your own lecture notes_`, ""];
  for (const g of sheet.groups) {
    lines.push(`## ${g.heading}`);
    for (const it of g.items) lines.push(`- **${it.front}**  ${it.back.replace(/\n+/g, "  ")}`);
    lines.push("");
  }
  return lines.join("\n");
}
