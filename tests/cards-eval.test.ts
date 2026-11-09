import { describe, it, expect } from "vitest";
import path from "node:path";
import type { Runner } from "../src/claude";
import { evalAll, evalNote, pickEvalNotes, summarizeCardsEval, type NoteEval } from "../src/eval/cards";

const notes = pickEvalNotes(path.resolve("sample-notes"));

/** Cards with a real quote from the note, one fabricated card, and one two-question card. */
const fake: Runner = async (o) => {
  const body = o.prompt.split(/<note[^>]*>\n/)[1].split("\n</note>")[0];
  const words = body.split(/\s+/);
  const cards = [
    { front: "What is the central idea of this lecture?", back: "An answer.", quote: words.slice(15, 22).join(" ") },
    { front: "A made-up question about nothing?", back: "Nothing.", quote: "This sentence was never in the note at all." },
    { front: "What is X, and what is Y?", back: "Two things.", quote: words.slice(30, 37).join(" ") },
  ];
  return { text: JSON.stringify(cards), costUsd: 0.02 };
};

describe("card generation eval", () => {
  it("uses a fixed, comparable set of sample lectures", () => {
    expect(notes).toHaveLength(6);
    expect([...new Set(notes.map((n) => n.course))]).toEqual(["ECON300", "ECON301", "ECON196"]);
    expect(pickEvalNotes(path.resolve("sample-notes"), 1)).toHaveLength(3);
  });

  it("counts what was kept and why the rest was dropped", async () => {
    const rows = await evalAll(notes, fake, 3);
    const s = summarizeCardsEval(rows);
    expect(rows.every((r) => r.ok && r.accepted === 1)).toBe(true);
    expect(s).toMatchObject({ notes: 6, failedNotes: 0, cardsAccepted: 6, cardsRejected: 12, calls: 6 });
    expect(s.rejectedByReason).toEqual({ quote_not_found: 6, two_questions: 6 });
    expect(s.acceptanceRate).toBeCloseTo(6 / 18, 5);
    expect(s.cardsPerNote).toBe(1);
    expect(s.costUsd).toBeCloseTo(0.12, 5);
  });

  it("doesn't count duplicates against acceptance, and reports lectures that failed", async () => {
    const rows: NoteEval[] = [
      { note: "a", ok: true, accepted: 3, rejected: { duplicate: 5, quote_not_found: 1 }, calls: 1, seconds: 4, costUsd: 0.01 },
      { note: "b", ok: false, error: "boom", accepted: 0, rejected: {}, calls: 1, seconds: 2, costUsd: 0 },
    ];
    const s = summarizeCardsEval(rows);
    expect(s.acceptanceRate).toBeCloseTo(3 / 4, 5);
    expect(s.failedNotes).toBe(1);
    expect(s.secondsPerNote).toBe(3);
    const failing: Runner = async () => {
      throw new Error("rate_limit_error");
    };
    const r = await evalNote(notes[0], failing);
    expect(r).toMatchObject({ ok: false, accepted: 0 });
    expect(r.error).toMatch(/usage limit/);
  });
});
