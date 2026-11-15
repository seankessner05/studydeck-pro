import { describe, it, expect, afterAll } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { closeStudyDbs, studyDb } from "../src/study/db";
import { CardError, accuracy, addCard, buildSession, counts, editCard, flagCard, getCard, reviewCard, undoLastReview } from "../src/study/cards";

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "sd-cedit-"));
afterAll(() => closeStudyDbs());
const NOTE = "## Marginal cost\n- Marginal cost (MC): derivative of the cost function with respect to Q\n- For C(Q) = 25 + 10Q + Q^2, MC = 10 + 2Q";

describe("undoing a rating", () => {
  it("puts the card back exactly as it was and forgets the rating", async () => {
    const db = studyDb(tmp());
    const t0 = new Date(2026, 10, 14, 10);
    const card = await addCard(db, { course: "ECON301", front: "MC of C = 25 + 10Q + Q^2?", back: "10 + 2Q" }, t0);
    const before = db.prepare("SELECT fsrs, due, state, reps, lapses FROM cards WHERE id = ?").get(card.id);
    await reviewCard(db, card.id, 4, t0);
    expect(getCard(db, card.id)!.state).not.toBe(0);
    const undone = await undoLastReview(db, card.id, new Date(t0.getTime() + 60_000));
    expect(db.prepare("SELECT fsrs, due, state, reps, lapses FROM cards WHERE id = ?").get(card.id)).toEqual(before);
    expect(undone.previews.map((p) => p.grade)).toEqual([1, 2, 3, 4]);
    expect(accuracy(db, "ECON301", t0).reviews).toBe(0);
    // the new card counts against today's limit again only once it's really rated
    expect(counts(db, "ECON301", t0, 1).newAvailable).toBe(1);
  });

  it("undoes only the latest rating, within ten minutes", async () => {
    const db = studyDb(tmp());
    const t0 = new Date(2026, 10, 14, 10);
    const card = await addCard(db, { course: "ECON301", front: "Q", back: "A" }, t0);
    await expect(undoLastReview(db, card.id, t0)).rejects.toThrow(/hasn't been rated/);
    await reviewCard(db, card.id, 1, t0);
    await reviewCard(db, card.id, 3, new Date(t0.getTime() + 120_000));
    await undoLastReview(db, card.id, new Date(t0.getTime() + 180_000));
    expect((db.prepare("SELECT COUNT(*) n FROM reviews").get() as { n: number }).n).toBe(1);
    await expect(undoLastReview(db, card.id, new Date(t0.getTime() + 60 * 60_000))).rejects.toThrow(/last 10 minutes/);
  });

  it("refuses ratings made before undo existed", async () => {
    const db = studyDb(tmp());
    const t0 = new Date(2026, 10, 14, 10);
    const card = await addCard(db, { course: "ECON301", front: "Q", back: "A" }, t0);
    await reviewCard(db, card.id, 3, t0);
    db.prepare("UPDATE reviews SET fsrs_before = NULL").run();
    await expect(undoLastReview(db, card.id, t0)).rejects.toThrow(/before undo existed/);
  });
});

describe("editing a card", () => {
  it("changes the wording and marks it as edited by you", async () => {
    const db = studyDb(tmp());
    const card = await addCard(db, { course: "ECON301", front: "MC?", back: "10 + 2Q", quote: "MC = 10 + 2Q", noteId: "ECON301/x.md", origin: "generated" });
    expect(card.editedAt).toBeNull();
    const t = new Date(2026, 10, 14, 11);
    const edited = editCard(db, card.id, { front: "For C(Q) = 25 + 10Q + Q^2, what is marginal cost?" }, NOTE, t);
    expect(edited).toMatchObject({ front: "For C(Q) = 25 + 10Q + Q^2, what is marginal cost?", back: "10 + 2Q", editedAt: t.getTime() });
  });

  it("checks a new receipt quote against the lecture, word for word", async () => {
    const db = studyDb(tmp());
    const card = await addCard(db, { course: "ECON301", front: "MC?", back: "10 + 2Q", quote: "MC = 10 + 2Q", noteId: "ECON301/x.md" });
    expect(editCard(db, card.id, { quote: "derivative of the cost function with respect to Q" }, NOTE).quote).toBe("derivative of the cost function with respect to Q");
    expect(() => editCard(db, card.id, { quote: "the derivative of revenue" }, NOTE)).toThrow(/word for word/);
    expect(() => editCard(db, card.id, { quote: "anything new" }, undefined)).toThrow(/isn't available/);
    expect(() => editCard(db, card.id, { front: "  " }, NOTE)).toThrow(CardError);
  });
});

describe("flagging a card", () => {
  it("takes a flagged card out of sessions and brings it back when the flag is cleared", async () => {
    const db = studyDb(tmp());
    const now = new Date(2026, 10, 14, 10);
    const card = await addCard(db, { course: "ECON301", front: "Q", back: "A" }, now);
    expect(flagCard(db, card.id, "wrong", "the key is backwards", now)).toMatchObject({ flag: "wrong", suspended: true });
    expect(await buildSession(db, "ECON301", now)).toHaveLength(0);
    expect(flagCard(db, card.id, null)).toMatchObject({ flag: null, suspended: false });
    expect(await buildSession(db, "ECON301", now)).toHaveLength(1);
    expect(() => flagCard(db, card.id, "nonsense" as never)).toThrow(/Unknown flag/);
    expect(() => flagCard(db, "nope", "wrong")).toThrow(/not found/);
  });
});

describe("formulas on typed cards", () => {
  it("saves good LaTeX and refuses a formula the page can't show, on create and on edit", async () => {
    const db = studyDb(tmp());
    const card = await addCard(db, { course: "ECON300", front: "Multiplier with \\(MPC = 0.8\\)?", back: "\\(\\frac{1}{1 - 0.8} = 5\\)" });
    expect(card.back).toBe("\\(\\frac{1}{1 - 0.8} = 5\\)");
    await expect(addCard(db, { course: "ECON300", front: "Broken \\(\\frac{1}{2\\)", back: "x" })).rejects.toThrow(/formula can't be shown/);
    expect(() => editCard(db, card.id, { back: "\\(\\frac{1}{1 - 0.8} = 5" }, undefined)).toThrow(CardError);
    expect(getCard(db, card.id)!.back).toBe("\\(\\frac{1}{1 - 0.8} = 5\\)");
  });
});
