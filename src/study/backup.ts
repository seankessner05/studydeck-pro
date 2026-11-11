import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { Db } from "../library/db.js";
import { MIGRATIONS } from "../library/migrations.js";
import { closeStudyDb, studyDb } from "./db.js";

export const KEEP_BACKUPS = 10;
const PATTERN = /^studydeck-(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})(\d{2})(?:-(\d+))?\.db$/;

const stamp = (d: Date) => {
  const p = (n: number, w = 2) => String(n).padStart(w, "0");
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
};

export interface BackupInfo {
  file: string;
  at: number;
  bytes: number;
}

export function backupDir(dataDir: string): string {
  return path.join(dataDir, "backups");
}

/** Newest first. The time comes from the file name, not the file's modified time, which changes whenever a backup is opened. */
export function listBackups(dataDir: string): BackupInfo[] {
  const dir = backupDir(dataDir);
  if (!fs.existsSync(dir)) return [];
  const out: (BackupInfo & { n: number })[] = [];
  for (const file of fs.readdirSync(dir)) {
    const m = file.match(PATTERN);
    if (!m) continue;
    const at = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4]), Number(m[5]), Number(m[6])).getTime();
    out.push({ file, at, bytes: fs.statSync(path.join(dir, file)).size, n: Number(m[7] ?? 1) });
  }
  return out.sort((a, b) => b.at - a.at || b.n - a.n).map(({ n: _n, ...rest }) => rest);
}

/**
 * A consistent copy of your study database (cards, review history, quizzes, exams, sheets), made while the app is running.
 * Keeps the newest few and deletes older ones. Your notes are plain files and aren't copied: they're already on disk.
 */
export function backupNow(db: Db, dataDir: string, now = new Date(), keep = KEEP_BACKUPS): BackupInfo {
  const dir = backupDir(dataDir);
  fs.mkdirSync(dir, { recursive: true });
  // Two backups in the same second get -2, -3, … so none overwrites another.
  let file = "";
  for (let n = 1; !file || fs.existsSync(path.join(dir, file)); n++) file = `studydeck-${stamp(now)}${n > 1 ? `-${n}` : ""}.db`;
  const target = path.join(dir, file);
  db.exec(`VACUUM INTO '${target.replace(/'/g, "''")}'`);
  // prune
  const all = listBackups(dataDir);
  for (const old of all.slice(keep)) fs.rmSync(path.join(dir, old.file), { force: true });
  const st = fs.statSync(target);
  return { file, at: now.getTime() - (now.getTime() % 1000), bytes: st.size };
}

/** Back up at most once in `hours` hours: for the automatic daily copy when the app starts. */
export function backupIfDue(db: Db, dataDir: string, now = new Date(), hours = 20): BackupInfo | undefined {
  const last = listBackups(dataDir)[0];
  if (last && now.getTime() - last.at < hours * 3_600_000) return undefined;
  return backupNow(db, dataDir, now);
}

export class RestoreError extends Error {}

export interface BackupSummary extends BackupInfo {
  /** Schema version the backup was made with. Older ones are upgraded when restored. */
  version: number;
  counts: { cards: number; reviews: number; questions: number; problems: number; exams: number };
}

const COUNTED: Record<keyof BackupSummary["counts"], string> = { cards: "cards", reviews: "reviews", questions: "questions", problems: "problems", exams: "exams" };

function countsOf(db: Db): BackupSummary["counts"] {
  const has = (t: string) => !!db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(t);
  const out = {} as BackupSummary["counts"];
  for (const [key, table] of Object.entries(COUNTED) as [keyof BackupSummary["counts"], string][]) {
    out[key] = has(table) ? Number((db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }).n) : 0;
  }
  return out;
}

/** What is in the study database right now, for the "this is what you'd replace" side of the confirm step. */
export const currentCounts = (db: Db) => countsOf(db);

/**
 * Open a backup read-only and make sure it is a healthy StudyDeck database this app can use.
 * The name must be one of our own backup names, so a request can never point this at another file.
 */
export function checkBackup(dataDir: string, file: string): BackupSummary {
  const info = PATTERN.test(file) ? listBackups(dataDir).find((b) => b.file === file) : undefined;
  if (!info) throw new RestoreError("That backup isn't in your backups folder.");
  let db: DatabaseSync;
  try {
    db = new DatabaseSync(path.join(backupDir(dataDir), file), { readOnly: true });
  } catch {
    throw new RestoreError("That backup can't be opened, so it wasn't used. Your current data is untouched.");
  }
  try {
    const health = db.prepare("PRAGMA integrity_check").all() as { integrity_check: string }[];
    if (health.length !== 1 || health[0].integrity_check !== "ok") throw new RestoreError("That backup is damaged, so it wasn't used. Your current data is untouched.");
    const version = (db.prepare("PRAGMA user_version").get() as { user_version: number }).user_version;
    if (version > MIGRATIONS.length) throw new RestoreError("That backup was made by a newer version of StudyDeck. Update the app, then restore it.");
    if (version < 2 || !db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'cards'").get()) throw new RestoreError("That file isn't a StudyDeck study backup.");
    return { ...info, version, counts: countsOf(db) };
  } catch (e) {
    if (e instanceof RestoreError) throw e;
    throw new RestoreError("That backup is damaged, so it wasn't used. Your current data is untouched.");
  } finally {
    db.close();
  }
}

/**
 * Replace the study database with a backup.
 *  1. The backup is checked first (opens, passes SQLite's integrity check, right kind of file, not from a newer app).
 *  2. The current database is backed up, so the restore itself can be undone.
 *  3. The backup is copied next to the live file and renamed over it. A rename either happens or doesn't, so a
 *     crash at any point leaves either the old database or the new one, never half of each.
 *  4. The database is opened again (which upgrades an older backup to today's schema).
 */
export function restoreBackup(dataDir: string, file: string, now = new Date()): { restored: BackupSummary; safetyCopy: BackupInfo } {
  const restored = checkBackup(dataDir, file);
  // Keep every existing backup while doing this: pruning here could delete the very file being restored.
  const safetyCopy = backupNow(studyDb(dataDir, false), dataDir, now, Number.MAX_SAFE_INTEGER);
  const live = path.join(dataDir, "studydeck.db");
  const staged = `${live}.restoring`;
  fs.rmSync(staged, { force: true });
  fs.copyFileSync(path.join(backupDir(dataDir), file), staged);
  closeStudyDb(dataDir, false);
  try {
    // Leftovers from the old database's write-ahead log must not be replayed onto the restored file.
    fs.rmSync(`${live}-wal`, { force: true });
    fs.rmSync(`${live}-shm`, { force: true });
    fs.renameSync(staged, live);
  } finally {
    fs.rmSync(staged, { force: true });
  }
  studyDb(dataDir, false);
  return { restored, safetyCopy };
}
