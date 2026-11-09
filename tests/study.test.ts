import { describe, it, expect, afterAll } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { closeStudyDbs, studyDb } from "../src/study/db";
import { deserialize, formatInterval, newCard, preview, review, serialize } from "../src/study/fsrs";
import { CardError, NEW_PER_DAY, accuracy, addCard, buildSession, counts, deleteCard, forecast, getCard, listCards, reviewCard, setSuspended, studyDays } from "../src/study/cards";
import { recordUsage, usageSummary } from "../src/study/usage";
import { studyStreak } from "../src/chats";
import { MIGRATIONS } from "../src/library/migrations";
import { currentVersion } from "../src/library/db";

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "sd-study-"));
const noon = (d = 9) => new Date(2026, 10, d, 12, 0, 0);
const minutes = (d: Date, m: number) => new Date(d.getTime() + m * 60_000);
const days = (d: Date, n: number) => new Date(d.getTime() + n * 86_400_000);
afterAll(() => closeStudyDbs());

describe("scheduler wrapper", () => {
  it("previews four outcomes whose intervals grow from Again to Easy", async () => {
    const now = noon();
    const p = await preview(await newCard(now), now);
    expect(p.map((x) => x.grade)).toEqual([1, 2, 3, 4]);
    expect(p[0].label).toBe("1m");
    expect(p[0].days).toBeLessThan(p[1].days);
    expect(p[1].days).toBeLessThan(p[2].days);
    expect(p[2].days).toBeLessThan(p[3].days);
    expect(p[2].days).toBeGreaterThan(1);
  });

  it("moves a card to review on Good, and to relearning on a lapse", async () => {
    let now = noon();
    let { card } = await review(await newCard(now), 3, now);
    expect(card.state).toBe(2);
    expect(card.dueAt.getTime()).toBeGreaterThan(now.getTime());
    now = card.dueAt;
    ({ card } = await review(card, 3, now));
    now = card.dueAt;
    const lapse = await review(card, 1, now);
    expect(lapse.card.state).toBe(3);
    expect(lapse.card.lapses).toBe(1);
  });

  it("survives a JSON round trip (dates come back as Dates)", async () => {
    const now = noon();
    const { card } = await review(await newCard(now), 3, now);
    const back = deserialize(serialize(card));
    expect(back.dueAt).toBeInstanceOf(Date);
    const next = await review(back, 3, back.dueAt);
    expect(next.card.reps).toBe(2);
  });

  it("formats intervals for the buttons", () => {
    expect([0.0007, 0.02, 0.6, 1, 4.78, 29, 45, 400].map(formatInterval)).toEqual(["1m", "29m", "14h", "1d", "5d", "29d", "2mo", "1.1y"]);
  });
});

describe("study database", () => {
  it("is created at the latest version with the study tables", () => {
    const db = studyDb(tmp());
    expect(currentVersion(db)).toBe(MIGRATIONS.length);
    const tables = (db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as { name: string }[]).map((t) => t.name);
    expect(tables).toEqual(expect.arrayContaining(["cards", "reviews", "ai_usage", "meta"]));
  });

  it("keeps demo practice apart from real practice", () => {
    const dir = tmp();
    expect(studyDb(dir, false)).not.toBe(studyDb(dir, true));
    expect(fs.readdirSync(dir).sort()).toEqual(["studydeck-demo.db", "studydeck-demo.db-shm", "studydeck-demo.db-wal", "studydeck.db", "studydeck.db-shm", "studydeck.db-wal"].filter((f) => fs.existsSync(path.join(dir, f))));
  });
});

describe("cards", () => {
  it("adds, lists and deletes cards, rejecting bad input", async () => {
    const db = studyDb(tmp());
    const c = await addCard(db, { course: "ECON301", front: " What is MRTS? ", back: "Slope of an isoquant", quote: "Slope = MPL/MPK" }, noon());
    expect(c).toMatchObject({ front: "What is MRTS?", state: 0, origin: "manual", quote: "Slope = MPL/MPK", suspended: false });
    await expect(addCard(db, { course: "ECON301", front: "", back: "x" })).rejects.toThrow(CardError);
    await expect(addCard(db, { course: "", front: "a", back: "b" })).rejects.toThrow(/class/);
    await expect(addCard(db, { course: "X", front: "a".repeat(601), back: "b" })).rejects.toThrow(/too long/);
    expect(listCards(db, "ECON301")).toHaveLength(1);
    expect(listCards(db, "ECON300")).toHaveLength(0);
    expect(listCards(db, "all")).toHaveLength(1);
    expect(deleteCard(db, c.id)).toBe(true);
    expect(deleteCard(db, c.id)).toBe(false);
  });

  it("limits new cards per day and counts them back as you review", async () => {
    const db = studyDb(tmp());
    const now = noon();
    for (let i = 0; i < 25; i++) await addCard(db, { course: "A", front: `q${i}`, back: `a${i}` }, now);
    expect(counts(db, "A", now)).toMatchObject({ newAvailable: NEW_PER_DAY, due: 0, learning: 0, total: 25 });
    const session = await buildSession(db, "A", now);
    expect(session).toHaveLength(NEW_PER_DAY);
    for (const c of session.slice(0, 3)) await reviewCard(db, c.id, 3, now);
    expect(counts(db, "A", now).newAvailable).toBe(NEW_PER_DAY - 3);
    // tomorrow the allowance resets
    expect(counts(db, "A", days(now, 1)).newAvailable).toBe(NEW_PER_DAY);
  });

  it("puts due reviews before new cards and shows button previews", async () => {
    const db = studyDb(tmp());
    const now = noon();
    const old = await addCard(db, { course: "A", front: "old", back: "o" }, now);
    await reviewCard(db, old.id, 3, now);
    await addCard(db, { course: "A", front: "new", back: "n" }, now);
    const later = days(now, 10);
    const s = await buildSession(db, "A", later);
    expect(s.map((c) => c.front)).toEqual(["old", "new"]);
    expect(s[0].previews).toHaveLength(4);
    expect(counts(db, "A", later)).toMatchObject({ due: 1, newAvailable: 1 });
  });

  it("reviews a card: reschedules it, logs the review, and returns fresh previews", async () => {
    const db = studyDb(tmp());
    const now = noon();
    const c = await addCard(db, { course: "A", front: "f", back: "b" }, now);
    const r = await reviewCard(db, c.id, 3, now, 4200);
    expect(r.card.state).toBe(2);
    expect(r.card.reps).toBe(1);
    expect(r.card.due).toBeGreaterThan(now.getTime());
    expect(r.previews).toHaveLength(4);
    const log = db.prepare("SELECT grade, state_before, ms_taken FROM reviews").all();
    expect(log).toEqual([{ grade: 3, state_before: 0, ms_taken: 4200 }]);
    await expect(reviewCard(db, c.id, 9 as any)).rejects.toThrow(/1 to 4/);
    await expect(reviewCard(db, "nope", 3)).rejects.toThrow(/not found/);
  });

  it("brings a missed card back within minutes (learning), not days", async () => {
    const db = studyDb(tmp());
    const now = noon();
    const c = await addCard(db, { course: "A", front: "f", back: "b" }, now);
    const r = await reviewCard(db, c.id, 1, now);
    expect(r.card.state).toBe(1);
    expect(r.card.due - now.getTime()).toBeLessThan(5 * 60_000);
    expect(counts(db, "A", now).learning).toBe(0);
    expect(counts(db, "A", minutes(now, 2)).learning).toBe(1);
  });

  it("suspended cards leave the queue", async () => {
    const db = studyDb(tmp());
    const now = noon();
    const c = await addCard(db, { course: "A", front: "f", back: "b" }, now);
    setSuspended(db, c.id, true);
    expect(counts(db, "A", now)).toMatchObject({ newAvailable: 0, suspended: 1, total: 1 });
    expect(await buildSession(db, "A", now)).toHaveLength(0);
    expect(getCard(db, c.id)?.suspended).toBe(true);
  });

  it("scopes by class and by 'all'", async () => {
    const db = studyDb(tmp());
    const now = noon();
    await addCard(db, { course: "A", front: "1", back: "1" }, now);
    await addCard(db, { course: "B", front: "2", back: "2" }, now);
    expect(counts(db, "A", now).total).toBe(1);
    expect(counts(db, "all", now).total).toBe(2);
    expect((await buildSession(db, "all", now)).map((c) => c.course).sort()).toEqual(["A", "B"]);
  });

  it("forecasts upcoming reviews, tracks accuracy, and reports study days", async () => {
    const db = studyDb(tmp());
    const now = noon();
    const ids: string[] = [];
    for (let i = 0; i < 3; i++) ids.push((await addCard(db, { course: "A", front: `q${i}`, back: "a" }, now)).id);
    await reviewCard(db, ids[0], 3, now);
    await reviewCard(db, ids[1], 4, now);
    await reviewCard(db, ids[2], 1, now);
    const f = forecast(db, "A", now, 7);
    expect(f).toHaveLength(7);
    expect(f[0]).toBe(1); // the miss comes back today
    expect(f.reduce((a, b) => a + b, 0)).toBe(2); // plus the Good card (about 5 days out); the Easy card is ~54 days away, past the window
    expect(forecast(db, "A", now, 90).reduce((a, b) => a + b, 0)).toBe(3);
    expect(accuracy(db, "A", now)).toEqual({ reviews: 3, correct: 2, pct: 67 });
    expect(accuracy(db, "B", now)).toEqual({ reviews: 0, correct: 0, pct: null });
    expect(studyDays(db)).toEqual(["2026-11-09"]);
  });

  it("makes reviewing count toward the study streak", () => {
    const today = new Date(2026, 10, 9, 15);
    expect(studyStreak({}, today, ["2026-11-09", "2026-11-08", "2026-11-07"])).toBe(3);
    expect(studyStreak({}, today, [])).toBe(0);
  });
});

describe("AI usage", () => {
  it("adds up calls and cost for today and the week, by kind", () => {
    const db = studyDb(tmp());
    const now = noon();
    recordUsage(db, "chat", 1, 0.01, now);
    recordUsage(db, "chat", 1, 0.02, now);
    recordUsage(db, "cards", 3, 0.05, days(now, -3));
    recordUsage(db, "exam", 1, 0.5, days(now, -20));
    const u = usageSummary(db, now);
    expect(u.today).toEqual({ calls: 2, costUsd: 0.03 });
    expect(u.week).toEqual({ calls: 5, costUsd: 0.08 });
    expect(u.byKind).toEqual({ chat: 2, cards: 3 });
  });
});
