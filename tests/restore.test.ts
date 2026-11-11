import { describe, it, expect, afterAll } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { closeStudyDbs, studyDb } from "../src/study/db";
import { addCard, listCards, reviewCard } from "../src/study/cards";
import { RestoreError, backupDir, backupNow, checkBackup, listBackups, restoreBackup } from "../src/study/backup";
import { MIGRATIONS } from "../src/library/migrations";
import { currentVersion } from "../src/library/db";

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "sd-restore-"));
afterAll(() => closeStudyDbs());
const at = (d: number, h = 9) => new Date(2026, 10, d, h, 0, 0);

async function seeded() {
  const dir = tmp();
  const db = studyDb(dir);
  const a = await addCard(db, { course: "ECON301", front: "Kept from the start", back: "A" });
  await reviewCard(db, a.id, 3, at(1));
  const backup = backupNow(db, dir, at(2));
  return { dir, backup, a };
}

describe("restoring a backup", () => {
  it("describes a healthy backup without changing anything", async () => {
    const { dir, backup } = await seeded();
    const sum = checkBackup(dir, backup.file);
    expect(sum).toMatchObject({ file: backup.file, version: MIGRATIONS.length, counts: { cards: 1, reviews: 1, questions: 0, problems: 0, exams: 0 } });
  });

  it("brings back what was lost after the backup, and keeps a copy of what it replaced", async () => {
    const { dir, backup, a } = await seeded();
    // after the backup: the card is destroyed and a different one is made
    const db = studyDb(dir);
    db.prepare("DELETE FROM cards WHERE id = ?").run(a.id);
    await addCard(db, { course: "ECON301", front: "Made after the backup", back: "B" });
    expect(listCards(db, "ECON301").map((c) => c.front)).toEqual(["Made after the backup"]);

    const r = restoreBackup(dir, backup.file, at(3));
    expect(r.restored.counts.cards).toBe(1);
    const now = studyDb(dir);
    expect(listCards(now, "ECON301").map((c) => c.front)).toEqual(["Kept from the start"]);
    expect((now.prepare("SELECT COUNT(*) AS n FROM reviews").get() as { n: number }).n).toBe(1);

    // the state from just before the restore is itself a backup, so the restore can be undone
    expect(listBackups(dir).map((b) => b.file)).toContain(r.safetyCopy.file);
    restoreBackup(dir, r.safetyCopy.file, at(4));
    expect(listCards(studyDb(dir), "ECON301").map((c) => c.front)).toEqual(["Made after the backup"]);
    expect(fs.existsSync(path.join(dir, "studydeck.db.restoring"))).toBe(false);
  });

  it("refuses a corrupted backup and leaves the current data exactly as it was", async () => {
    const { dir, backup } = await seeded();
    const db = studyDb(dir);
    await addCard(db, { course: "ECON301", front: "Current work", back: "B" });
    // corrupt the backup: overwrite the middle of the file with junk
    const file = path.join(backupDir(dir), backup.file);
    const bytes = fs.readFileSync(file);
    bytes.fill(0x5a, 4096, Math.min(bytes.length, 4096 * 6));
    fs.writeFileSync(file, bytes);

    expect(() => checkBackup(dir, backup.file)).toThrow(RestoreError);
    const before = listBackups(dir).length;
    expect(() => restoreBackup(dir, backup.file, at(3))).toThrow(/damaged|can't be opened/);
    expect(listBackups(dir).length).toBe(before);
    expect(listCards(studyDb(dir), "ECON301").map((c) => c.front).sort()).toEqual(["Current work", "Kept from the start"]);
  });

  it("refuses a file that isn't one of our backups, including paths that try to leave the folder", async () => {
    const { dir } = await seeded();
    fs.writeFileSync(path.join(dir, "evil.db"), "not a database");
    for (const name of ["../evil.db", "..%2Fstudydeck.db", "/etc/passwd", "studydeck.db", "studydeck-20261102-090000.db/../../evil.db", "studydeck-99999999-000000.db"]) {
      expect(() => restoreBackup(dir, name), name).toThrow(/isn't in your backups folder/);
    }
  });

  it("refuses a file that has a backup's name but isn't a StudyDeck database", async () => {
    const { dir } = await seeded();
    fs.writeFileSync(path.join(backupDir(dir), "studydeck-20261105-090000.db"), "this is just text");
    expect(() => restoreBackup(dir, "studydeck-20261105-090000.db")).toThrow(RestoreError);
    const other = new DatabaseSync(path.join(backupDir(dir), "studydeck-20261106-090000.db"));
    other.exec("CREATE TABLE unrelated (x); PRAGMA user_version = 3;");
    other.close();
    expect(() => restoreBackup(dir, "studydeck-20261106-090000.db")).toThrow(/isn't a StudyDeck study backup/);
  });

  it("refuses a backup from a newer version of the app", async () => {
    const { dir, backup } = await seeded();
    const b = new DatabaseSync(path.join(backupDir(dir), backup.file));
    b.exec(`PRAGMA user_version = ${MIGRATIONS.length + 1}`);
    b.close();
    expect(() => restoreBackup(dir, backup.file)).toThrow(/newer version/);
  });

  it("upgrades an older backup to today's schema when it is restored", async () => {
    const { dir } = await seeded();
    // build a backup at schema 7 (before the trash existed)
    const oldFile = path.join(backupDir(dir), "studydeck-20261001-090000.db");
    const old = new DatabaseSync(oldFile);
    for (const m of MIGRATIONS.filter((x) => x.version <= 7)) old.exec(m.sql);
    old.exec("PRAGMA user_version = 7");
    old.prepare("INSERT INTO cards (id, course, front, back, fsrs, due, created_at) VALUES ('old1', 'ECON301', 'From an old backup', 'A', '{}', 0, 0)").run();
    old.close();

    restoreBackup(dir, "studydeck-20261001-090000.db", at(5));
    const db = studyDb(dir);
    expect(currentVersion(db)).toBe(MIGRATIONS.length);
    expect((db.prepare("SELECT front FROM cards").all() as { front: string }[]).map((c) => c.front)).toEqual(["From an old backup"]);
    expect(db.prepare("SELECT COUNT(*) AS n FROM trash").get()).toEqual({ n: 0 });
  });
});
