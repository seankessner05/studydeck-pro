import { describe, it, expect } from "vitest";
import path from "node:path";
import { loadNotes } from "../src/notes";
import { DEFAULT_COURSES } from "../src/courses";
import type { Runner } from "../src/claude";
import {
  CALL_TIMEOUT_MS, DENSITY_TARGET, buildCardPrompts, requestedCards, checkableNumbers, generateCardsForNote, isCompoundQuestion, jaccard, noteVersion, parseCardsJson, sectionFor, validateCards,
} from "../src/study/cardgen";

const notes = loadNotes("all", path.resolve("sample-notes"));
const fiscal = notes.find((n) => n.file.includes("fiscal-multipliers"))!;

const good = {
  front: "What is the spending multiplier when MPC = 0.8 and there are no taxes?",
  back: "1 / (1 − 0.8) = 5, so each dollar of spending raises output by five dollars.",
  quote: "With MPC = 0.8 the multiplier is 1 / (1 − 0.8) = 5.",
  section: "Notes",
};

describe("card verification gate", () => {
  it("accepts a grounded card and finds its heading", () => {
    const { accepted, rejected } = validateCards([good], fiscal, [], 8);
    expect(rejected).toEqual([]);
    expect(accepted).toEqual([{ ...good, section: "Notes" }]);
  });

  it("rejects a receipt quote that isn't in the note (fabrication)", () => {
    const { accepted, rejected } = validateCards([{ ...good, quote: "The multiplier is always exactly ten dollars." }], fiscal, [], 8);
    expect(accepted).toEqual([]);
    expect(rejected[0]).toMatchObject({ reason: "quote_not_found" });
  });

  it("matches quotes despite markdown, bullets, tables and spacing", () => {
    const messy = { ...good, quote: "**With MPC = 0.8**   the multiplier   is 1 / (1 − 0.8) = 5." };
    expect(validateCards([messy], fiscal, [], 8).accepted).toHaveLength(1);
  });

  it("rejects numbers the note doesn't contain, but allows ones it does", () => {
    const bad = { ...good, back: "It is 7.5, because 1 / (1 − 0.8) = 5." };
    expect(validateCards([bad], fiscal, [], 8).rejected[0]).toMatchObject({ reason: "number_not_in_note", detail: "7.5" });
    const ok = { ...good, back: "With MPC = 0.8 and t = 0.25 the multiplier falls to 2.5.", quote: "With MPC = 0.8 and t = 0.25 it falls to 2.5." };
    expect(validateCards([ok], fiscal, [], 8).accepted).toHaveLength(1);
  });

  it("rejects duplicates of existing cards and near-duplicates within a batch", () => {
    const dupExisting = validateCards([good], fiscal, [good.front], 8);
    expect(dupExisting.rejected[0].reason).toBe("duplicate");
    const near = { ...good, front: "What is the spending multiplier when MPC = 0.8 and there are no taxes??" };
    const batch = validateCards([good, near], fiscal, [], 8);
    expect(batch.accepted).toHaveLength(1);
    expect(batch.rejected.map((r) => r.reason)).toEqual(["duplicate"]);
    expect(jaccard("What is MRTS?", "Define the marginal rate of technical substitution")).toBeLessThan(0.3);
  });

  it("rejects malformed, oversized, note-referencing and too-short-receipt cards", () => {
    const cases = [
      [{ front: "", back: "x", quote: "one two three four" }, "malformed"],
      [{ front: 5 as any, back: "x", quote: "q" }, "malformed"],
      [{ ...good, back: "x".repeat(501) }, "too_long"],
      [{ ...good, front: "According to the notes, what is the multiplier?" }, "refers_to_notes"],
      [{ ...good, quote: "multiplier is" }, "quote_too_short"],
    ] as const;
    for (const [card, reason] of cases) expect(validateCards([card], fiscal, [], 8).rejected[0]?.reason, reason).toBe(reason);
  });

  it("enforces one question per card", () => {
    const compound = [
      "How is producer surplus related to revenue and cost, and how does it differ from profit?",
      "What is the objective function and what is the constraint?",
      "When labor gets cheaper, how does the firm change inputs, and what happens to the isocost slope?",
      "What is MRTS? What does it equal?",
    ];
    for (const front of compound) expect(isCompoundQuestion(front), front).toBe(true);
    const single = [
      "In the cost-minimization Lagrangian, what is the constraint?",
      "When labor becomes cheaper, how does the slope of the isocost line change?",
      "In the long run, when should a firm shut down?",
      "For perfect substitutes with production function L + K, which input should the firm buy?",
      "After a sales tax, which areas does the government capture as tax revenue?",
      "What does the slope of an isocost line equal?",
      "Cobb-Douglas with exponents 0.75 and 0.25, W=15, R=5: what condition does MRTS = W/R give between K and L?",
      "Why does a firm with fixed cost of 20 keep producing at a loss in the short run?",
      "Distinguish a Pareto improvement from a Pareto optimal outcome.",
    ];
    for (const front of single) expect(isCompoundQuestion(front), front).toBe(false);
    const r = validateCards([{ ...good, front: "What is the multiplier, and what does MPC stand for?" }], fiscal, [], 8);
    expect(r.rejected[0].reason).toBe("two_questions");
  });

  it("puts the front on one line and tidies stray blank lines in the back", () => {
    const messy = { ...good, front: "What is the multiplier\n\nwhen MPC = 0.8?", back: "1 / (1 − 0.8) = 5.\n\n\n\nEach dollar raises output by five dollars." };
    const [c] = validateCards([messy], fiscal, [], 8).accepted;
    expect(c.front).toBe("What is the multiplier when MPC = 0.8?");
    expect(c.back).toBe("1 / (1 − 0.8) = 5.\n\nEach dollar raises output by five dollars.");
  });

  it("never returns more than the cap, and survives junk entries", () => {
    const many = Array.from({ length: 10 }, (_, i) => ({ ...good, front: `Distinct question number ${i} about ${["alpha", "beta", "gamma", "delta", "kappa", "sigma", "omega", "theta", "zeta", "lambda"][i]} concept?` }));
    expect(validateCards(many, fiscal, [], 3).accepted).toHaveLength(3);
    const junk = validateCards([null, 7, "text", [], {}] as unknown[], fiscal, [], 8);
    expect(junk.accepted).toEqual([]);
    expect(junk.rejected).toHaveLength(5);
  });
});

describe("helpers", () => {
  it("checks numbers with two digits or a decimal, ignoring thousands commas", () => {
    expect(checkableNumbers("Cost is $1,800, MPC 0.8, step 3, 12 units, and 2.5")).toEqual(["1800", "0.8", "12", "2.5"]);
  });

  it("finds the heading above a quote", () => {
    const body = "# T\n\n## Key Terms\n- **MPC** — the share spent\n\n## Notes\n| a | the multiplier is five dollars |\n";
    expect(sectionFor(body, "the share spent")).toBe("Key Terms");
    expect(sectionFor(body, "the multiplier is five dollars")).toBe("Notes");
    expect(sectionFor(body, "not in the note at all")).toBeUndefined();
  });

  it("versions a note by Granola's edit time, or else by its content", () => {
    expect(noteVersion({ ...fiscal, granolaUpdatedAt: "2026-10-13T17:00:00.000-04:00" })).toBe("2026-10-13T17:00:00.000-04:00");
    const a = noteVersion(fiscal);
    expect(a).toMatch(/^h:[0-9a-f]{12}$/);
    expect(noteVersion({ ...fiscal, body: fiscal.body + " edited" })).not.toBe(a);
    expect(noteVersion(fiscal)).toBe(a);
  });

  it("parses model replies: fenced, chatty, or wrapped", () => {
    const card = { front: "f", back: "b", quote: "q q q" };
    expect(parseCardsJson(JSON.stringify([card]))).toEqual([card]);
    expect(parseCardsJson("Sure! Here you go:\n```json\n" + JSON.stringify([card]) + "\n```\nHope it helps")).toEqual([card]);
    expect(parseCardsJson(JSON.stringify({ cards: [card] }))).toEqual([card]);
    expect(() => parseCardsJson("I could not make cards")).toThrow(/JSON list/);
    expect(() => parseCardsJson("[not json")).toThrow();
  });
});

describe("prompt", () => {
  it("carries the note, the target count, the focus and the class style", () => {
    const { system, prompt } = buildCardPrompts(fiscal, { density: "thorough", focus: "only formulas", courses: DEFAULT_COURSES });
    expect(system).toContain(`at most ${DENSITY_TARGET.thorough} cards`);
    expect([5, 8, 14].map((n, i) => requestedCards((["light", "normal", "thorough"] as const)[i]) - n)).toEqual([2, 2, 4]);
    expect(system).toContain("EXACTLY from the note");
    expect(system).toContain("Quantitative economics");
    expect(system).toContain("ONLY a JSON array");
    expect(system).toContain("Ask exactly ONE thing");
    expect(system).toContain("Bad:");
    expect(system).toContain("One question mark per card");
    expect(system).toContain("put the setup in the front");
    expect(prompt).toContain('<note title="Fiscal Multipliers" course="ECON300"');
    expect(prompt).toContain(fiscal.body);
    expect(prompt).toContain("only formulas");
  });
});

describe("generating for one lecture", () => {
  const reply = (cards: unknown[]) => ({ text: JSON.stringify(cards), costUsd: 0.02 });

  it("returns verified cards and the rejected ones with reasons", async () => {
    const runner: Runner = async () => reply([good, { ...good, front: "Fabricated?", quote: "Totally invented sentence from nowhere." }]);
    const r = await generateCardsForNote({ runner, note: fiscal, courses: DEFAULT_COURSES, density: "normal", existingFronts: [] });
    expect(r.accepted).toHaveLength(1);
    expect(r.rejected.map((x) => x.reason)).toEqual(["quote_not_found"]);
    expect(r).toMatchObject({ calls: 1, costUsd: 0.02 });
  });

  it("retries once when the first reply can't be parsed, and counts both calls", async () => {
    let n = 0;
    const runner: Runner = async (o) => {
      n++;
      if (n === 1) return { text: "Sorry, here are some thoughts…", costUsd: 0.01 };
      expect(o.prompt).toContain("could not be parsed");
      return reply([good]);
    };
    const r = await generateCardsForNote({ runner, note: fiscal, courses: DEFAULT_COURSES, density: "light", existingFronts: [] });
    expect(r).toMatchObject({ calls: 2, costUsd: 0.03 });
    expect(r.accepted).toHaveLength(1);
  });

  it("gives up after a second unparseable reply", async () => {
    const runner: Runner = async () => ({ text: "no json here", costUsd: 0.01 });
    await expect(generateCardsForNote({ runner, note: fiscal, courses: DEFAULT_COURSES, density: "light", existingFronts: [] })).rejects.toThrow(/JSON list/);
  });

  it("limits how long one call may take, so a stall becomes an error instead of a hang", async () => {
    let seen: number | undefined;
    const runner: Runner = async (o) => {
      seen = o.timeoutMs;
      return reply([good]);
    };
    await generateCardsForNote({ runner, note: fiscal, courses: DEFAULT_COURSES, density: "normal", existingFronts: [] });
    expect(seen).toBe(CALL_TIMEOUT_MS);
    expect(CALL_TIMEOUT_MS).toBe(150_000);
  });

  it("skips questions that already exist in the class", async () => {
    const runner: Runner = async () => reply([good]);
    const r = await generateCardsForNote({ runner, note: fiscal, courses: DEFAULT_COURSES, density: "normal", existingFronts: [good.front] });
    expect(r.accepted).toEqual([]);
    expect(r.rejected[0].reason).toBe("duplicate");
  });
});
