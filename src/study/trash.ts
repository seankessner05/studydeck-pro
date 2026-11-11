import { randomUUID } from "node:crypto";
import type { Db } from "../library/db.js";
import { tx } from "./db.js";

export type TrashKind = "card" | "question" | "problem";

/** Where each kind lives, what to show for it, and where its answer history is kept. */
const KINDS: Record<TrashKind, { table: string; label: string; history: { table: string; key: string }[] }> = {
  card: { table: "cards", label: "front", history: [{ table: "reviews", key: "card_id" }] },
  question: { table: "questions", label: "stem", history: [{ table: "quiz_answers", key: "question_id" }] },
  problem: { table: "problems", label: "stem", history: [{ table: "problem_attempts", key: "problem_id" }] },
};

/** Deleted items are kept this long, then removed for good the next time the app starts. */
export const TRASH_DAYS = 30;

export interface TrashEntry {
  id: string;
  kind: TrashKind;
  itemId: string;
  course: string;
  label: string;
  deletedAt: number;
  /** How many reviews or answers will come back with it. */
  history: number;
}

export class TrashError extends Error {}

type Row = Record<string, unknown>;
interface Payload {
  row: Row;
  history: Record<string, Row[]>;
}

const columnsOf = (db: Db, table: string) => new Set((db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]).map((c) => c.name));

/** Insert a stored row, using only the columns the table has today (the schema may have grown since it was deleted). */
function insertRow(db: Db, table: string, row: Row) {
  const cols = [...columnsOf(db, table)].filter((c) => c in row);
  db.prepare(`INSERT INTO ${table} (${cols.join(", ")}) VALUES (${cols.map(() => "?").join(", ")})`).run(...cols.map((c) => row[c] as string | number | null));
}

/**
 * Delete an item, keeping an exact copy (and its answer history) in the trash so the delete can be undone.
 * Returns undefined when there was nothing with that id.
 */
export function moveToTrash(db: Db, kind: TrashKind, itemId: string, now = new Date()): TrashEntry | undefined {
  const k = KINDS[kind];
  return tx(db, () => {
    const row = db.prepare(`SELECT * FROM ${k.table} WHERE id = ?`).get(itemId) as Row | undefined;
    if (!row) return undefined;
    const history: Payload["history"] = {};
    for (const h of k.history) history[h.table] = db.prepare(`SELECT * FROM ${h.table} WHERE ${h.key} = ?`).all(itemId) as Row[];
    const entry: TrashEntry = {
      id: randomUUID(), kind, itemId, course: String(row.course), label: String(row[k.label] ?? "").slice(0, 300), deletedAt: now.getTime(),
      history: Object.values(history).reduce((n, rows) => n + rows.length, 0),
    };
    // If the same id was trashed before (deleted, restored, deleted again), the newer copy replaces the older one.
    db.prepare("DELETE FROM trash WHERE kind = ? AND item_id = ?").run(kind, itemId);
    db.prepare("INSERT INTO trash (id, kind, item_id, course, label, payload, deleted_at) VALUES (?, ?, ?, ?, ?, ?, ?)")
      .run(entry.id, kind, itemId, entry.course, entry.label, JSON.stringify({ row, history } satisfies Payload), entry.deletedAt);
    db.prepare(`DELETE FROM ${k.table} WHERE id = ?`).run(itemId);
    return entry;
  });
}

function entryOf(r: any): TrashEntry {
  let history = 0;
  try {
    history = Object.values((JSON.parse(r.payload) as Payload).history).reduce((n, rows) => n + rows.length, 0);
  } catch {
    // an unreadable payload is reported when someone tries to restore it
  }
  return { id: r.id, kind: r.kind, itemId: r.item_id, course: r.course, label: r.label, deletedAt: r.deleted_at, history };
}

/** Newest first. */
export function listTrash(db: Db, course = "all", limit = 200): TrashEntry[] {
  const rows = course === "all"
    ? db.prepare("SELECT * FROM trash ORDER BY deleted_at DESC LIMIT ?").all(limit)
    : db.prepare("SELECT * FROM trash WHERE course = ? ORDER BY deleted_at DESC LIMIT ?").all(course, limit);
  return rows.map(entryOf);
}

/** Put a deleted item back exactly as it was, with its review or answer history. */
export function restoreFromTrash(db: Db, trashId: string): TrashEntry {
  return tx(db, () => {
    const r = db.prepare("SELECT * FROM trash WHERE id = ?").get(trashId) as any;
    if (!r) throw new TrashError("That item isn't in the trash any more.");
    const k = KINDS[r.kind as TrashKind];
    if (!k) throw new TrashError("That kind of item can't be restored.");
    let payload: Payload;
    try {
      payload = JSON.parse(r.payload);
    } catch {
      throw new TrashError("The saved copy of that item is damaged, so it can't be restored.");
    }
    if (db.prepare(`SELECT 1 FROM ${k.table} WHERE id = ?`).get(r.item_id)) throw new TrashError("That item is already back.");
    insertRow(db, k.table, payload.row);
    for (const h of k.history) {
      for (const row of payload.history[h.table] ?? []) {
        // A history row can point at something deleted since (a quiz run): skip just that row, keep the rest.
        try {
          insertRow(db, h.table, row);
        } catch {
          // skipped
        }
      }
    }
    db.prepare("DELETE FROM trash WHERE id = ?").run(trashId);
    return entryOf(r);
  });
}

/** Remove one trashed item for good. */
export function purgeTrash(db: Db, trashId: string): boolean {
  return Number(db.prepare("DELETE FROM trash WHERE id = ?").run(trashId).changes) > 0;
}

/** Remove everything that has been in the trash longer than `days`. Returns how many were removed. */
export function emptyOldTrash(db: Db, now = new Date(), days = TRASH_DAYS): number {
  return Number(db.prepare("DELETE FROM trash WHERE deleted_at < ?").run(now.getTime() - days * 86_400_000).changes);
}
