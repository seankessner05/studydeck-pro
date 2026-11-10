import fs from "node:fs";
import path from "node:path";
import type { Db } from "../library/db.js";

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
