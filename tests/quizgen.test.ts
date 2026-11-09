import { describe, it, expect } from "vitest";
import path from "node:path";
import { loadNotes } from "../src/notes";
import { DEFAULT_COURSES } from "../src/courses";
import type { Runner } from "../src/claude";
import { CALL_TIMEOUT_MS } from "../src/study/cardgen";
import {
  QUIZ_TARGET, buildQuestionPrompts, buildSolverPrompts, compareWithKey, generateQuestionsForNote, hasLengthTell, maxQuestions, validateQuestions,
  type GeneratedQuestion,
} from "../src/study/quizgen";

const fiscal = loadNotes("all", path.resolve("sample-notes")).find((n) => n.file.includes("fiscal-multipliers"))!;
const noShuffle = () => 0.999; // Fisher–Yates with this leaves the order unchanged

const single = {
  kind: "single",
  stem: "In the simple model with no taxes, what is the spending multiplier when MPC = 0.8?",
  options: ["5", "2.5", "0.8", "1.25"],
  answer: ["A"],
  explanation: "The multiplier is 1 / (1 − 0.8) = 5; 2.5 is the value once a 0.25 tax rate is added.",
  quote: "With MPC = 0.8 the multiplier is 1 / (1 − 0.8) = 5.",
  section: "Notes",
};
const multi = {
  kind: "multi",
  stem: "Select all that apply: which of these make real multipliers smaller than the simple formula?",
  options: ["Crowding out", "Imports leaking abroad", "A larger MPC", "Households who save a windfall", "Automatic stabilizers disappearing"],
  answer: ["A", "B", "D"],
  explanation: "The note lists crowding out, imports leaking abroad, and forward-looking households who save a windfall.",
  quote: "Crowding out, imports leaking abroad, and forward-looking households who save a windfall.",
};
const tf = {
  kind: "tf",
  stem: "The tax-cut multiplier is smaller in magnitude than the spending multiplier.",
  answer: true,
  explanation: "Part of a tax cut is saved first, so the tax-cut multiplier MPC / (1 − MPC) is smaller.",
  quote: "Smaller in magnitude than the spending multiplier",
};

describe("question gate", () => {
  it("accepts one of each kind, with the answer key and a section", () => {
    const { accepted, rejected } = validateQuestions([single, multi, tf], fiscal, [], 8, noShuffle);
    expect(rejected).toEqual([]);
    expect(accepted.map((q) => q.kind)).toEqual(["single", "multi", "tf"]);
    expect(accepted[0]).toMatchObject({ options: single.options, answer: [0], section: "Notes" });
    expect(accepted[1].answer).toEqual([0, 1, 3]);
    expect(accepted[2]).toMatchObject({ options: ["True", "False"], answer: [0] });
  });

  it("shuffles options and moves the key with them", () => {
    let n = 0;
    const rand = () => [0.1, 0.7, 0.3][n++ % 3];
    const { accepted } = validateQuestions([single], fiscal, [], 8, rand);
    const q = accepted[0];
    expect(new Set(q.options)).toEqual(new Set(single.options));
    expect(q.options[q.answer[0]]).toBe("5");
  });

  it("really does change the position of the right answer over many questions", () => {
    const positions = new Set<number>();
    for (let i = 0; i < 40; i++) positions.add(validateQuestions([single], fiscal, [], 8).accepted[0].answer[0]);
    expect(positions.size).toBeGreaterThan(1);
  });

  it("rejects a receipt quote that isn't in the note", () => {
    const r = validateQuestions([{ ...single, quote: "The multiplier is always exactly ten dollars." }], fiscal, [], 8, noShuffle);
    expect(r.rejected[0]).toMatchObject({ reason: "quote_not_found" });
  });

  it("rejects numbers the note doesn't have in the question, the right answer or the explanation, but lets wrong options be anything", () => {
    expect(validateQuestions([{ ...single, explanation: "The multiplier is 7.5 here." }], fiscal, [], 8, noShuffle).rejected[0]).toMatchObject({ reason: "number_not_in_note", detail: "7.5" });
    expect(validateQuestions([{ ...single, stem: "What is the multiplier when MPC = 0.95?" }], fiscal, [], 8, noShuffle).rejected[0]).toMatchObject({ reason: "number_not_in_note" });
    expect(validateQuestions([{ ...single, options: ["7.5", "2.5", "0.8", "1.25"] }], fiscal, [], 8, noShuffle).rejected[0]).toMatchObject({ reason: "number_not_in_note" });
    // 99 and 3.7 are only wrong options: fine
    expect(validateQuestions([{ ...single, options: ["5", "99", "3.7", "1.25"] }], fiscal, [], 8, noShuffle).accepted).toHaveLength(1);
  });

  it("lets a false true/false statement change a number, but not a true one", () => {
    const falseTf = { kind: "tf", stem: "With MPC = 0.8 the simple multiplier is 7.5.", answer: false, explanation: "It is 1 / (1 − 0.8) = 5, not 7.5 times larger.", quote: "With MPC = 0.8 the multiplier is 1 / (1 − 0.8) = 5." };
    // the explanation here also mentions 7.5, which is not in the note, so it is rejected
    expect(validateQuestions([falseTf], fiscal, [], 8, noShuffle).rejected[0]).toMatchObject({ reason: "number_not_in_note" });
    expect(validateQuestions([{ ...falseTf, explanation: "It is 1 / (1 − 0.8) = 5." }], fiscal, [], 8, noShuffle).accepted).toHaveLength(1);
    expect(validateQuestions([{ ...falseTf, answer: true, explanation: "It is 1 / (1 − 0.8) = 5." }], fiscal, [], 8, noShuffle).rejected[0]).toMatchObject({ reason: "number_not_in_note" });
  });

  it("rejects the wrong number of options, repeats, and 'all of the above'", () => {
    const bad = (options: string[]) => validateQuestions([{ ...single, options }], fiscal, [], 8, noShuffle).rejected[0]?.reason;
    expect(bad(["5", "2.5", "0.8"])).toBe("bad_options");
    expect(bad(["5", "2.5", "0.8", "1.25", "9"])).toBe("bad_options");
    expect(bad(["5", "5", "0.8", "1.25"])).toBe("bad_options");
    expect(bad(["5", "2.5", "0.8", "All of the above"])).toBe("bad_options");
    expect(bad(["5", "2.5", "0.8", "Both A and B"])).toBe("bad_options");
    expect(bad(["5", "2.5", "0.8", "both a firm and a household"])).toBeUndefined(); // ordinary English is fine
    expect(validateQuestions([{ ...multi, options: ["a", "b", "c"] }], fiscal, [], 8, noShuffle).rejected[0].reason).toBe("bad_options");
  });

  it("strips letter prefixes from options", () => {
    const r = validateQuestions([{ ...single, options: ["A. 5", "B. 2.5", "C) 0.8", "D. 1.25"] }], fiscal, [], 8, noShuffle);
    expect(r.accepted[0].options).toEqual(["5", "2.5", "0.8", "1.25"]);
  });

  it("checks the answer key fits the type", () => {
    const bad = (q: object) => validateQuestions([q], fiscal, [], 8, noShuffle).rejected[0]?.reason;
    expect(bad({ ...single, answer: ["A", "B"] })).toBe("bad_answer"); // single with two answers
    expect(bad({ ...single, answer: ["E"] })).toBe("bad_answer"); // no such option
    expect(bad({ ...single, answer: [] })).toBe("bad_answer");
    expect(bad({ ...multi, answer: ["A"] })).toBe("bad_answer"); // multi needs at least two
    expect(bad({ ...multi, answer: ["A", "B", "C", "D", "E"] })).toBe("bad_answer"); // all of them is not a quiz
    expect(bad({ ...tf, answer: "maybe" })).toBe("bad_answer");
    expect(validateQuestions([{ ...single, answer: "A" }], fiscal, [], 8, noShuffle).accepted).toHaveLength(1);
    expect(validateQuestions([{ ...tf, answer: "True" }], fiscal, [], 8, noShuffle).accepted[0].answer).toEqual([0]);
  });

  it("strips 'True or false:' and rejects a true/false that is phrased as a question", () => {
    expect(validateQuestions([{ ...tf, stem: "True or false: " + tf.stem }], fiscal, [], 8, noShuffle).accepted[0].stem).toBe(tf.stem);
    expect(validateQuestions([{ ...tf, stem: "Is the tax-cut multiplier smaller?" }], fiscal, [], 8, noShuffle).rejected[0].reason).toBe("malformed");
  });

  it("rejects two-part and 'according to the notes' stems", () => {
    expect(validateQuestions([{ ...single, stem: "What is the multiplier, and why is it smaller with taxes?" }], fiscal, [], 8, noShuffle).rejected[0].reason).toBe("two_questions");
    expect(validateQuestions([{ ...single, stem: "According to the notes, what is the multiplier when MPC = 0.8?" }], fiscal, [], 8, noShuffle).rejected[0].reason).toBe("refers_to_notes");
    // an introductory phrase is fine
    expect(validateQuestions([{ ...single, stem: "In the simple model, what is the multiplier when MPC = 0.8?" }], fiscal, [], 8, noShuffle).accepted).toHaveLength(1);
  });

  it("drops duplicates of existing and of earlier questions", () => {
    expect(validateQuestions([single], fiscal, [single.stem], 8, noShuffle).rejected[0].reason).toBe("duplicate");
    const twice = validateQuestions([single, { ...single, stem: single.stem + " " }], fiscal, [], 8, noShuffle);
    expect(twice.accepted).toHaveLength(1);
    expect(twice.rejected[0].reason).toBe("duplicate");
  });

  // Four different facts from the note, so the duplicate check has nothing to merge.
  const facts: [string, string][] = [
    ["The tax-cut multiplier is smaller in magnitude than the spending multiplier.", "Smaller in magnitude than the spending multiplier"],
    ["Crowding out is one reason real multipliers are smaller than the simple formula.", "Crowding out, imports leaking abroad"],
    ["Automatic stabilizers move with the cycle without new legislation.", "taxes and transfers that move with the cycle without new legislation"],
    ["The MPC is the share of extra income that is spent.", "the share of extra income that is spent"],
  ];

  it("keeps true/false to a quarter of a lecture's questions", () => {
    const many = facts.map(([stem, quote]) => ({ ...tf, stem, quote, explanation: "That is what the note says." }));
    const r = validateQuestions(many, fiscal, [], 8, noShuffle);
    expect(r.accepted).toHaveLength(2); // ceil(8 / 4)
    expect(r.rejected.every((x) => x.reason === "too_many_tf")).toBe(true);
  });

  it("stops at the maximum and survives junk", () => {
    const four = facts.map(([stem, quote]) => ({ ...single, stem: stem.replace(/\.$/, "") + ", which option fits?", quote, explanation: "That is what the note says.", options: ["w", "x", "y", "z"] }));
    expect(validateQuestions(four, fiscal, [], 3, noShuffle).accepted).toHaveLength(3);
    const junk = validateQuestions([null, 7, "text", [], {}] as unknown[], fiscal, [], 8, noShuffle);
    expect(junk.accepted).toEqual([]);
    expect(junk.rejected).toHaveLength(5);
  });
});

describe("the second solve", () => {
  const qs = validateQuestions([single, multi, tf], fiscal, [], 8, noShuffle).accepted;

  it("shows the note and the questions but never the key, the explanation or the quote", () => {
    const { system, prompt } = buildSolverPrompts(fiscal, qs);
    expect(prompt).toContain(fiscal.body);
    expect(prompt).toContain("Q1 (choose ONE)");
    expect(prompt).toContain("Q2 (select ALL that apply)");
    expect(prompt).toContain("Q3 (true or false)");
    expect(prompt).toContain("A. 5");
    expect(prompt).not.toContain(single.explanation);
    expect(prompt).not.toContain("answer");
    expect(system).toContain("have not seen any answer key");
    expect(system).toContain("ambiguous");
  });

  it("confirms matching answers and flags every kind of doubt", () => {
    const solved = [
      { n: 1, answer: ["A"] },
      { n: 2, answer: ["A", "B", "D"] },
      { n: 3, answer: true },
    ];
    expect(compareWithKey(qs, solved)).toEqual(["ok", "ok", "ok"]);
    expect(compareWithKey(qs, [{ n: 1, answer: ["B"] }, { n: 2, answer: ["A", "B"] }, { n: 3, answer: false }])).toEqual(["key_disagrees", "key_disagrees", "key_disagrees"]);
    expect(compareWithKey(qs, [{ n: 1, answer: ["A"], ambiguous: true }])).toEqual(["ambiguous", "not_checked", "not_checked"]);
    expect(compareWithKey(qs, [{ n: 1, answer: "nonsense" }, null, { answer: true }] as unknown[])).toEqual(["not_checked", "not_checked", "not_checked"]);
  });

  it("accepts letters in any case and true/false as text", () => {
    expect(compareWithKey(qs, [{ n: 1, answer: "a" }, { n: 2, answer: "A, B and D" }, { n: 3, answer: "True" }])).toEqual(["ok", "ok", "ok"]);
  });
});

describe("prompts", () => {
  it("asks for the right mix, one idea each, and a key in letters", () => {
    const { system, prompt } = buildQuestionPrompts(fiscal, { density: "thorough", focus: "only formulas", courses: DEFAULT_COURSES });
    expect(system).toContain(`at most ${QUIZ_TARGET.thorough} questions`);
    expect(system).toContain("never more than a quarter");
    expect(system).toContain("NOT be noticeably longer");
    expect(system).toContain("EXACTLY from the note");
    expect(system).toContain("ONLY a JSON array");
    expect(system).toContain("Quantitative economics");
    expect(prompt).toContain('<note title="Fiscal Multipliers" course="ECON300"');
    expect(prompt).toContain(fiscal.body);
    expect(prompt).toContain("only formulas");
    expect([4, 6, 10].map((n, i) => maxQuestions((["light", "normal", "thorough"] as const)[i]) - n)).toEqual([1, 2, 3]);
  });
});

describe("generating for one lecture", () => {
  /** A runner that writes the given questions, then answers the quiz with the given solver. */
  const runnerWith = (questions: unknown[], solver: (n: number) => unknown): { runner: Runner; calls: string[] } => {
    const calls: string[] = [];
    const runner: Runner = async (o) => {
      if (o.system?.includes("You have not seen any answer key")) {
        calls.push("solve");
        const count = (o.prompt.match(/^Q\d+ /gm) ?? []).length;
        return { text: JSON.stringify(solver(count)), costUsd: 0.01 };
      }
      calls.push("write");
      return { text: JSON.stringify(questions), costUsd: 0.02 };
    };
    return { runner, calls };
  };
  const base = { note: fiscal, courses: DEFAULT_COURSES, density: "normal" as const, existingStems: [] as string[], rand: noShuffle };

  it("keeps only the questions the second solver confirms", async () => {
    const wrongKey = { ...single, stem: "In the simple model with no taxes, which multiplier fits MPC = 0.8?", answer: ["B"] }; // key says 2.5, really 5
    const { runner, calls } = runnerWith([single, wrongKey, multi, tf], () => [
      { n: 1, answer: ["A"] },
      { n: 2, answer: ["A"] }, // disagrees with the key B
      { n: 3, answer: ["A", "B", "D"] },
      { n: 4, answer: true, ambiguous: true },
    ]);
    const r = await generateQuestionsForNote({ runner, ...base });
    expect(calls).toEqual(["write", "solve"]);
    expect(r.accepted.map((q) => q.kind)).toEqual(["single", "multi"]);
    expect(r.rejected.map((x) => x.reason).sort()).toEqual(["ambiguous", "key_disagrees"]);
    expect(r).toMatchObject({ calls: 2, checked: 4, costUsd: 0.03 });
  });

  it("does not bother the second solver when nothing passed the gate", async () => {
    const { runner, calls } = runnerWith([{ ...single, quote: "Totally invented sentence." }], () => []);
    const r = await generateQuestionsForNote({ runner, ...base });
    expect(calls).toEqual(["write"]);
    expect(r).toMatchObject({ accepted: [], calls: 1, checked: 0 });
  });

  it("saves nothing when the second solve can't be read, rather than trusting unchecked keys", async () => {
    const calls: string[] = [];
    const runner: Runner = async (o) => {
      if (o.system?.includes("You have not seen any answer key")) { calls.push("solve"); return { text: "I think they are all fine!", costUsd: 0.01 }; }
      calls.push("write");
      return { text: JSON.stringify([single]), costUsd: 0.02 };
    };
    await expect(generateQuestionsForNote({ runner, ...base })).rejects.toThrow(/couldn't be double-checked/);
    expect(calls).toEqual(["write", "solve", "solve"]); // one retry
  });

  it("retries an unparseable first reply once", async () => {
    let n = 0;
    const runner: Runner = async (o) => {
      n++;
      if (n === 1) return { text: "Sure, thinking…", costUsd: 0.01 };
      if (o.system?.includes("You have not seen any answer key")) return { text: JSON.stringify([{ n: 1, answer: ["A"] }]), costUsd: 0.01 };
      expect(o.prompt).toContain("could not be parsed");
      return { text: JSON.stringify([single]), costUsd: 0.01 };
    };
    const r = await generateQuestionsForNote({ runner, ...base });
    expect(r.calls).toBe(3);
    expect(r.accepted).toHaveLength(1);
  });

  it("gives every call the stall timeout", async () => {
    const seen: (number | undefined)[] = [];
    const runner: Runner = async (o) => {
      seen.push(o.timeoutMs);
      return { text: JSON.stringify(o.system?.includes("You have not seen any answer key") ? [{ n: 1, answer: ["A"] }] : [single]), costUsd: 0 };
    };
    await generateQuestionsForNote({ runner, ...base });
    expect(seen).toEqual([CALL_TIMEOUT_MS, CALL_TIMEOUT_MS]);
  });
});

describe("measurements", () => {
  const q = (right: string, others: string[]): GeneratedQuestion => ({ kind: "single", stem: "s", options: [right, ...others], answer: [0], explanation: "e", quote: "q", section: "s" });
  it("spots a right answer that is clearly the longest option", () => {
    expect(hasLengthTell(q("A much longer and more detailed answer than the rest", ["short", "brief", "tiny"]))).toBe(true);
    expect(hasLengthTell(q("about the same", ["about as long", "of equal size", "similar length"]))).toBe(false);
    expect(hasLengthTell({ ...q("x", ["y", "z", "w"]), kind: "tf" })).toBe(false);
  });
});
