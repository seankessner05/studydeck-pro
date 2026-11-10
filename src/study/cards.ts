import { randomUUID } from "node:crypto";
import type { Db } from "../library/db.js";
import { tx } from "./db.js";
import { deserialize, newCard, preview, review, serialize, type Grade, type Preview } from "./fsrs.js";
import type { GeneratedCard } from "./cardgen.js";

export const NEW_PER_DAY = 20;
const MAX_FRONT = 600;
const MAX_BACK = 2000;
const DAY = 86_400_000;

export interface CardRow {
  id: string;
  course: string;
  noteId: string | null;
  section: string | null;
  front: string;
  back: string;
  quote: string | null;
  origin: "manual" | "generated";
  /** 0 new, 1 learning, 2 review, 3 relearning */
  state: number;
  due: number;
  reps: number;
  lapses: number;
  suspended: boolean;
  createdAt: number;
}

export interface NewCardInput {
  course: string;
  front: string;
  back: string;
  noteId?: string | null;
  section?: string | null;
  quote?: string | null;
  origin?: "manual" | "generated";
  noteVersion?: string | null;
}

export class CardError extends Error {}

const startOfDay = (ms: number) => new Date(new Date(ms).setHours(0, 0, 0, 0)).getTime();

function toRow(r: any): CardRow {
  return {
    id: r.id, course: r.course, noteId: r.note_id, section: r.section, front: r.front, back: r.back, quote: r.quote,
    origin: r.origin, state: r.state, due: r.due, reps: r.reps, lapses: r.lapses, suspended: !!r.suspended, createdAt: r.created_at,
  };
}

/** Scope clause: one class, or every class when course is "all". */
const scope = (course: string) => (course === "all" ? { sql: "1=1", args: [] as string[] } : { sql: "course = ?", args: [course] });

export async function addCard(db: Db, input: NewCardInput, now = new Date()): Promise<CardRow> {
  const front = input.front?.trim();
  const back = input.back?.trim();
  if (!input.course) throw new CardError("Pick a class for this card.");
  if (!front || !back) throw new CardError("A card needs both a front and a back.");
  if (front.length > MAX_FRONT) throw new CardError(`The front is too long (max ${MAX_FRONT} characters).`);
  if (back.length > MAX_BACK) throw new CardError(`The back is too long (max ${MAX_BACK} characters).`);
  const card = await newCard(now);
  const id = randomUUID();
  db.prepare(
    `INSERT INTO cards (id, course, note_id, section, front, back, quote, origin, note_version, fsrs, due, state, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?)`,
  ).run(id, input.course, input.noteId ?? null, input.section ?? null, front, back, input.quote?.trim() || null, input.origin ?? "manual", input.noteVersion ?? null, serialize(card), card.dueAt.getTime(), now.getTime());
  return getCard(db, id)!;
}

export function getCard(db: Db, id: string): CardRow | undefined {
  const r = db.prepare("SELECT * FROM cards WHERE id = ?").get(id);
  return r ? toRow(r) : undefined;
}

export function listCards(db: Db, course: string): CardRow[] {
  const sc = scope(course);
  return db.prepare(`SELECT * FROM cards WHERE ${sc.sql} ORDER BY created_at DESC, rowid DESC`).all(...sc.args).map(toRow);
}

export function deleteCard(db: Db, id: string): boolean {
  return Number(db.prepare("DELETE FROM cards WHERE id = ?").run(id).changes) > 0;
}

export function setSuspended(db: Db, id: string, suspended: boolean) {
  db.prepare("UPDATE cards SET suspended = ? WHERE id = ?").run(suspended ? 1 : 0, id);
}

/** How many brand-new cards were first reviewed today (they count against the daily limit). */
function newIntroducedToday(db: Db, course: string, now: number): number {
  const sc = scope(course);
  return Number(
    (db.prepare(`SELECT COUNT(*) n FROM reviews WHERE ${sc.sql} AND state_before = 0 AND reviewed_at >= ?`).get(...sc.args, startOfDay(now)) as { n: number }).n,
  );
}

export interface Counts {
  /** Reviews that are due (state: review) */
  due: number;
  /** Cards in (re)learning that are due */
  learning: number;
  /** New cards available today after the daily limit */
  newAvailable: number;
  total: number;
  suspended: number;
}

export function counts(db: Db, course: string, now = new Date(), newPerDay = NEW_PER_DAY): Counts {
  const sc = scope(course);
  const n = now.getTime();
  const one = (where: string, ...args: (string | number)[]) =>
    Number((db.prepare(`SELECT COUNT(*) n FROM cards WHERE ${sc.sql} AND ${where}`).get(...sc.args, ...args) as { n: number }).n);
  const newTotal = one("suspended = 0 AND state = 0");
  return {
    due: one("suspended = 0 AND state = 2 AND due <= ?", n),
    learning: one("suspended = 0 AND state IN (1, 3) AND due <= ?", n),
    newAvailable: Math.min(newTotal, Math.max(0, newPerDay - newIntroducedToday(db, course, n))),
    total: one("1=1"),
    suspended: one("suspended = 1"),
  };
}

export interface SessionCard extends CardRow {
  previews: Preview[];
}

/** Today's work: everything due (oldest first), then new cards up to the daily limit. */
export async function buildSession(db: Db, course: string, now = new Date(), limit = 50, newPerDay = NEW_PER_DAY): Promise<SessionCard[]> {
  const sc = scope(course);
  const n = now.getTime();
  const due = db
    .prepare(`SELECT * FROM cards WHERE ${sc.sql} AND suspended = 0 AND state != 0 AND due <= ? ORDER BY due ASC LIMIT ?`)
    .all(...sc.args, n, limit)
    .map(toRow);
  const room = Math.max(0, Math.min(limit - due.length, newPerDay - newIntroducedToday(db, course, n)));
  const fresh = room
    ? db.prepare(`SELECT * FROM cards WHERE ${sc.sql} AND suspended = 0 AND state = 0 ORDER BY created_at ASC, rowid ASC LIMIT ?`).all(...sc.args, room).map(toRow)
    : [];
  const out: SessionCard[] = [];
  for (const row of [...due, ...fresh]) {
    const stored = db.prepare("SELECT fsrs FROM cards WHERE id = ?").get(row.id) as { fsrs: string };
    out.push({ ...row, previews: await preview(deserialize(stored.fsrs), now) });
  }
  return out;
}

export interface ReviewResult {
  card: CardRow;
  /** Fresh button previews for the card's new state, so the UI can re-queue it within the session. */
  previews: Preview[];
  scheduledDays: number;
}

export async function reviewCard(db: Db, id: string, grade: Grade, now = new Date(), msTaken?: number): Promise<ReviewResult> {
  if (![1, 2, 3, 4].includes(grade)) throw new CardError("Grade must be 1 to 4.");
  const row = db.prepare("SELECT * FROM cards WHERE id = ?").get(id) as any;
  if (!row) throw new CardError("Card not found.");
  const result = await review(deserialize(row.fsrs), grade, now);
  tx(db, () => {
    db.prepare("UPDATE cards SET fsrs = ?, due = ?, state = ?, reps = ?, lapses = ? WHERE id = ?").run(
      serialize(result.card), result.card.dueAt.getTime(), result.card.state, result.card.reps, result.card.lapses, id,
    );
    db.prepare("INSERT INTO reviews (card_id, course, grade, state_before, reviewed_at, scheduled_days, ms_taken) VALUES (?, ?, ?, ?, ?, ?, ?)").run(
      id, row.course, grade, row.state, now.getTime(), result.scheduledDays, msTaken ?? null,
    );
  });
  return { card: getCard(db, id)!, previews: await preview(result.card, now), scheduledDays: result.scheduledDays };
}

/** Cards coming due on each of the next `days` days (day 0 includes anything overdue). */
export function forecast(db: Db, course: string, now = new Date(), days = 7): number[] {
  const sc = scope(course);
  const today = startOfDay(now.getTime());
  const out: number[] = [];
  for (let i = 0; i < days; i++) {
    const lo = i === 0 ? 0 : today + i * DAY;
    const hi = today + (i + 1) * DAY;
    out.push(Number((db.prepare(`SELECT COUNT(*) n FROM cards WHERE ${sc.sql} AND suspended = 0 AND state != 0 AND due >= ? AND due < ?`).get(...sc.args, lo, hi) as { n: number }).n));
  }
  return out;
}

export function accuracy(db: Db, course: string, now = new Date(), days = 7): { reviews: number; correct: number; pct: number | null } {
  const sc = scope(course);
  const r = db
    .prepare(`SELECT COUNT(*) n, SUM(CASE WHEN grade >= 2 THEN 1 ELSE 0 END) ok FROM reviews WHERE ${sc.sql} AND reviewed_at >= ?`)
    .get(...sc.args, startOfDay(now.getTime()) - (days - 1) * DAY) as { n: number; ok: number | null };
  const reviews = Number(r.n);
  const correct = Number(r.ok ?? 0);
  return { reviews, correct, pct: reviews ? Math.round((100 * correct) / reviews) : null };
}

/** Local calendar days (YYYY-MM-DD) on which at least one card was reviewed or one quiz question or practice problem answered. */
export function studyDays(db: Db): string[] {
  return db
    .prepare(
      `SELECT d FROM (
         SELECT date(reviewed_at / 1000, 'unixepoch', 'localtime') d FROM reviews
         UNION
         SELECT date(answered_at / 1000, 'unixepoch', 'localtime') d FROM quiz_answers
         UNION
         SELECT date(answered_at / 1000, 'unixepoch', 'localtime') d FROM problem_attempts
       ) ORDER BY d`,
    )
    .all()
    .map((r: any) => String(r.d));
}

/** Fronts of every card in a class, so a new batch can skip questions you already have. */
export function existingFronts(db: Db, course: string): string[] {
  return (db.prepare("SELECT front FROM cards WHERE course = ?").all(course) as { front: string }[]).map((r) => r.front);
}

/** Save verified, generated cards for one lecture. Existing cards (and their review history) are never touched. */
export async function addGeneratedCards(db: Db, note: { id: string; course: string }, version: string, cards: GeneratedCard[], now = new Date()): Promise<number> {
  const prepared: { c: GeneratedCard; fsrs: Awaited<ReturnType<typeof newCard>> }[] = [];
  for (const c of cards) prepared.push({ c, fsrs: await newCard(now) });
  tx(db, () => {
    const insert = db.prepare(
      `INSERT INTO cards (id, course, note_id, section, front, back, quote, origin, note_version, fsrs, due, state, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'generated', ?, ?, ?, 0, ?)`,
    );
    // Increasing timestamps keep a lecture's cards in the order they were written.
    prepared.forEach(({ c, fsrs }, i) => insert.run(randomUUID(), note.course, note.id, c.section, c.front, c.back, c.quote, version, serialize(fsrs), fsrs.dueAt.getTime(), now.getTime() + i));
  });
  return prepared.length;
}

export interface NoteCoverage {
  cards: number;
  /** Every version of the note that has been processed into cards */
  versions: string[];
}

/** Record that this version of a lecture has been processed (even if every new card was a duplicate or was dropped). */
export function logGeneration(db: Db, noteId: string, version: string, created: number, calls: number, now = new Date()) {
  db.prepare("INSERT OR REPLACE INTO gen_log (note_id, note_version, at, created, calls) VALUES (?, ?, ?, ?, ?)").run(noteId, version, now.getTime(), created, calls);
}

/** For each lecture that has been processed: how many generated cards it has, and which versions of the note were used. */
export function coverage(db: Db): Map<string, NoteCoverage> {
  const out = new Map<string, NoteCoverage>();
  const get = (id: string) => out.get(id) ?? out.set(id, { cards: 0, versions: [] }).get(id)!;
  const add = (c: NoteCoverage, v: string | null) => {
    if (v && !c.versions.includes(v)) c.versions.push(v);
  };
  for (const r of db.prepare("SELECT note_id, note_version, COUNT(*) n FROM cards WHERE origin = 'generated' AND note_id IS NOT NULL GROUP BY note_id, note_version").all() as { note_id: string; note_version: string | null; n: number }[]) {
    const c = get(r.note_id);
    c.cards += Number(r.n);
    add(c, r.note_version);
  }
  for (const r of db.prepare("SELECT note_id, note_version FROM gen_log").all() as { note_id: string; note_version: string }[]) add(get(r.note_id), r.note_version);
  return out;
}
