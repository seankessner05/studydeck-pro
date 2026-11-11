import path from "node:path";
import { openDb, type Db } from "../library/db.js";

const open = new Map<string, Db>();

/**
 * Study progress lives in its own SQLite file, separate for the demo notes so sample practice never mixes with yours.
 * Opening applies any pending migrations (with an automatic backup first).
 */
export function studyDb(dataDir: string, sample = false): Db {
  const file = path.join(dataDir, sample ? "studydeck-demo.db" : "studydeck.db");
  let db = open.get(file);
  if (!db) {
    db = openDb(file);
    open.set(file, db);
  }
  return db;
}

/** Close one study database (so its file can be replaced). The next studyDb() call opens it again. */
export function closeStudyDb(dataDir: string, sample = false) {
  const file = path.join(dataDir, sample ? "studydeck-demo.db" : "studydeck.db");
  open.get(file)?.close();
  open.delete(file);
}

export function closeStudyDbs() {
  for (const db of open.values()) db.close();
  open.clear();
}

/** Run fn inside a transaction; roll back if it throws. */
export function tx<T>(db: Db, fn: () => T): T {
  db.exec("BEGIN");
  try {
    const out = fn();
    db.exec("COMMIT");
    return out;
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
}
