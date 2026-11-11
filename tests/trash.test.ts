import { describe, it, expect, afterAll } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { closeStudyDbs, studyDb } from "../src/study/db";
import { accuracy, addCard, counts, listCards, reviewCard } from "../src/study/cards";
import { addGeneratedQuestions, answerQuestion, listQuestions, quizAccuracy, startQuiz } from "../src/study/questions";
import type { GeneratedQuestion } from "../src/study/quizgen";
import { TRASH_DAYS, TrashError, emptyOldTrash, listTrash, moveToTrash, purgeTrash, restoreFromTrash } from "../src/study/trash";

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "sd-trash-"));
const fresh = () => studyDb(tmp());
afterAll(() => closeStudyDbs());
const q = (stem: string): GeneratedQuestion => ({ kind: "single", stem, options: ["one", "two", "three", "four"], answer: [1], explanation: "Because two.", quote: "a quote", section: "Notes" });

describe("the trash", () => {
  it("takes a card out of study and puts it back exactly as it was, review history included", async () => {
    const db = fresh();
    const card = await addCard(db, { course: "ECON301", front: "What is MRTS?", back: "The slope of the isoquant", quote: "MRTS = MPL / MPK", noteId: "ECON301/a.md", section: "Isoquants" });
    await reviewCard(db, card.id, 3, new Date("2026-11-01T12:00:00"));
    await reviewCard(db, card.id, 1, new Date("2026-11-04T12:00:00"));
    const before = db.prepare("SELECT * FROM cards WHERE id = ?").get(card.id);
    const reviewsBefore = db.prepare("SELECT * FROM reviews WHERE card_id = ? ORDER BY reviewed_at").all(card.id);
    expect(reviewsBefore).toHaveLength(2);

    const entry = moveToTrash(db, "card", card.id)!;
    expect(entry).toMatchObject({ kind: "card", itemId: card.id, course: "ECON301", label: "What is MRTS?", history: 2 });
    expect(listCards(db, "ECON301")).toHaveLength(0);
    expect(counts(db, "ECON301").total).toBe(0);
    expect(accuracy(db, "ECON301").reviews).toBe(0);
    expect(listTrash(db, "ECON301")).toHaveLength(1);
    expect(listTrash(db, "ECON300")).toHaveLength(0);

    restoreFromTrash(db, entry.id);
    expect(db.prepare("SELECT * FROM cards WHERE id = ?").get(card.id)).toEqual(before);
    expect(db.prepare("SELECT * FROM reviews WHERE card_id = ? ORDER BY reviewed_at").all(card.id)).toEqual(reviewsBefore);
    expect(listTrash(db)).toHaveLength(0);
  });

  it("does the same for a quiz question and its answers", () => {
    const db = fresh();
    addGeneratedQuestions(db, { id: "ECON301/a.md", course: "ECON301" }, "v1", [q("First?"), q("Second?")]);
    const run = startQuiz(db, { course: "ECON301", length: 2 });
    const first = run.questions.find((x) => x.stem === "First?")!;
    answerQuestion(db, { runId: run.runId, questionId: first.id, picked: [1] });
    expect(quizAccuracy(db, "ECON301")).toMatchObject({ answers: 1 });

    const entry = moveToTrash(db, "question", first.id)!;
    expect(entry.history).toBe(1);
    expect(listQuestions(db, "ECON301").map((x) => x.stem)).toEqual(["Second?"]);
    expect(quizAccuracy(db, "ECON301")).toMatchObject({ answers: 0 });

    restoreFromTrash(db, entry.id);
    expect(listQuestions(db, "ECON301").map((x) => x.stem).sort()).toEqual(["First?", "Second?"]);
    expect(listQuestions(db, "ECON301").find((x) => x.stem === "First?")).toMatchObject({ asked: 1, right: 1 });
  });

  it("says so when there is nothing to delete or restore, and never restores twice", async () => {
    const db = fresh();
    expect(moveToTrash(db, "card", "nope")).toBeUndefined();
    expect(() => restoreFromTrash(db, "nope")).toThrow(TrashError);
    const card = await addCard(db, { course: "ECON301", front: "Q", back: "A" });
    const entry = moveToTrash(db, "card", card.id)!;
    restoreFromTrash(db, entry.id);
    expect(() => restoreFromTrash(db, entry.id)).toThrow(/isn't in the trash/);
  });

  it("keeps only the newest copy when the same item is deleted, restored and deleted again", async () => {
    const db = fresh();
    const card = await addCard(db, { course: "ECON301", front: "Q", back: "A" });
    restoreFromTrash(db, moveToTrash(db, "card", card.id)!.id);
    await reviewCard(db, card.id, 3);
    const again = moveToTrash(db, "card", card.id)!;
    expect(listTrash(db)).toHaveLength(1);
    expect(again.history).toBe(1);
  });

  it("restores into a table that has gained a column since the item was deleted", async () => {
    const db = fresh();
    const card = await addCard(db, { course: "ECON301", front: "Q", back: "A" });
    const entry = moveToTrash(db, "card", card.id)!;
    db.exec("ALTER TABLE cards ADD COLUMN flagged INTEGER NOT NULL DEFAULT 0");
    restoreFromTrash(db, entry.id);
    expect(db.prepare("SELECT front, flagged FROM cards WHERE id = ?").get(card.id)).toEqual({ front: "Q", flagged: 0 });
  });

  it("empties items older than the keeping period, and deletes one for good on request", async () => {
    const db = fresh();
    const a = await addCard(db, { course: "ECON301", front: "Old", back: "A" });
    const b = await addCard(db, { course: "ECON301", front: "Recent", back: "A" });
    const now = new Date("2026-11-11T12:00:00");
    moveToTrash(db, "card", a.id, new Date(now.getTime() - (TRASH_DAYS + 1) * 86_400_000));
    const recent = moveToTrash(db, "card", b.id, new Date(now.getTime() - 86_400_000))!;
    expect(emptyOldTrash(db, now)).toBe(1);
    expect(listTrash(db).map((t) => t.label)).toEqual(["Recent"]);
    expect(purgeTrash(db, recent.id)).toBe(true);
    expect(purgeTrash(db, recent.id)).toBe(false);
    expect(listTrash(db)).toHaveLength(0);
  });
});
