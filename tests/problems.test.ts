import { describe, it, expect, afterAll } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { loadNotes } from "../src/notes";
import { DEFAULT_COURSES } from "../src/courses";
import type { Runner } from "../src/claude";
import { closeStudyDbs, studyDb } from "../src/study/db";
import { studyDays } from "../src/study/cards";
import { noteVersion } from "../src/study/cardgen";
import {
  ProblemCheckError, asksTwoThings, buildProblemPrompts, buildProblemSolverPrompts, compareSolutions, compute, generateProblemsForNote, maxProblems, numberInText, numbersClose, parseNumber, validateProblems,
  PROBLEM_TARGET,
} from "../src/study/problemgen";
import {
  addGeneratedProblems, answerProblem, deleteProblem, existingProblemStems, finishPractice, getProblem, listProblems, logProblemGeneration, problemAccuracy, problemCounts, problemCoverage, startPractice,
} from "../src/study/problems";
import { ProblemGenerationJobs } from "../src/study/jobs";
import { usageSummary } from "../src/study/usage";

const sample = loadNotes("all", path.resolve("sample-notes"));
const fiscal = sample.find((n) => n.file.includes("fiscal-multipliers"))!;
const econ301 = sample.filter((n) => n.course === "ECON301");
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "sd-prob-"));
afterAll(() => closeStudyDbs());

const good = {
  stem: "In the simple model with no taxes, the marginal propensity to consume is 0.9 and government spending rises by 50. By how much does output rise?",
  givens: [{ name: "mpc", value: 0.9, label: "marginal propensity to consume" }, { name: "dg", value: 50, label: "rise in government spending" }],
  steps: [
    { name: "mult", label: "Spending multiplier", expr: "1 / (1 - mpc)", explain: "The simple multiplier is 1 / (1 − MPC)." },
    { name: "dy", label: "Change in output", expr: "mult * dg", explain: "Output changes by the multiplier times the spending change." },
  ],
  unit: "",
  quote: "With MPC = 0.8 the multiplier is 1 / (1 − 0.8) = 5.",
  section: "Notes",
};

describe("the calculator", () => {
  it("does arithmetic over named numbers", () => {
    expect(compute("1 / (1 - mpc)", { mpc: 0.75 })).toEqual({ value: 4 });
    expect(compute("sqrt(a) + 2^3 + round(2.6) + max(1, b)", { a: 16, b: 5 })).toEqual({ value: 4 + 8 + 3 + 5 });
    expect(compute("log(e) + log10(1000) + abs(-2) + pow(2, 3)", {})).toEqual({ value: 1 + 3 + 2 + 8 });
    expect((compute("2 * x", { x: 3 }) as { value: number }).value).toBe(6);
  });

  it("refuses anything that is not plain arithmetic", () => {
    const bad = (e: string) => expect("error" in compute(e, { x: 2 })).toBe(true);
    bad("import({a: 1})");
    bad("x; y");
    bad("evaluate('1+1')");
    bad("unknownname * 2");
    bad("x[0]");
    bad('"text"');
    bad("1 / 0");
    bad("sqrt(0 - 4)");
    bad("");
    bad("x".repeat(200));
    bad("2 ** 3 ?");
    bad("x = 5");
  });

  it("compares answers within 1% or half a cent, and parses what a student types", () => {
    expect(numbersClose(100.5, 100)).toBe(true);
    expect(numbersClose(102, 100)).toBe(false);
    expect(numbersClose(0.004, 0)).toBe(true);
    expect(numbersClose(0.2, 0)).toBe(false);
    expect([parseNumber("$1,250"), parseNumber(" 25% "), parseNumber("−3.5"), parseNumber(".5"), parseNumber(12)]).toEqual([1250, 25, -3.5, 0.5, 12]);
    expect([parseNumber("abc"), parseNumber("1 2"), parseNumber(""), parseNumber(NaN), parseNumber(null)]).toEqual([undefined, undefined, undefined, undefined, undefined]);
  });

  it("finds a number in the problem text in plain, comma and percent forms", () => {
    expect(numberInText(1250, "A firm pays $1,250 a month")).toBe(true);
    expect(numberInText(0.25, "a tax rate of 25%")).toBe(true);
    expect(numberInText(0.8, "MPC = 0.8")).toBe(true);
    expect(numberInText(0.8, "MPC = 0.85")).toBe(false);
    expect(numberInText(50, "spending rises by 500")).toBe(false);
  });
});

describe("problem gate", () => {
  it("accepts a good problem and computes the answer itself", () => {
    const r = validateProblems([good], fiscal, [], 3);
    expect(r.rejected).toEqual([]);
    expect(r.accepted).toHaveLength(1);
    const p = r.accepted[0];
    expect(p.steps.map((s) => s.value)).toEqual([10, 500].map((x) => expect.closeTo(x, 9)));
    expect(p).toMatchObject({ difficulty: 1, section: "Notes", unit: "" });
    expect(p.answer).toBeCloseTo(500, 9);
  });

  it("ignores any answer or step value Claude claims", () => {
    const lying = { ...good, answer: 12345, steps: good.steps.map((s) => ({ ...s, value: 999 })) };
    expect(validateProblems([lying], fiscal, [], 3).accepted[0].answer).toBeCloseTo(500, 9);
  });

  it("makes the numbers in the text match the numbers in the program", () => {
    const r = validateProblems([{ ...good, givens: [{ name: "mpc", value: 0.9, label: "m" }, { name: "dg", value: 75, label: "g" }] }], fiscal, [], 3);
    expect(r.rejected[0]).toMatchObject({ reason: "given_not_in_stem", detail: "dg = 75" });
    // a percent in the text may stand for a decimal given
    const pct = { ...good, stem: good.stem.replace("0.9", "90%") };
    expect(validateProblems([pct], fiscal, [], 3).accepted).toHaveLength(1);
  });

  it("rejects steps that are not arithmetic, use unknown names, or blow up", () => {
    const withStep = (expr: string) => validateProblems([{ ...good, steps: [{ ...good.steps[0], expr }, good.steps[1]] }], fiscal, [], 3).rejected[0];
    expect(withStep("import(1)")).toMatchObject({ reason: "bad_expression" });
    expect(withStep("1 / (1 - nothing)")).toMatchObject({ reason: "bad_expression", detail: expect.stringContaining("unknown name") });
    expect(withStep("1 / (1 - 1)")).toMatchObject({ reason: "bad_expression" });
    expect(withStep("10 ^ 30")).toMatchObject({ reason: "bad_value" });
  });

  it("rejects bad step lists and bad given names", () => {
    const steps = (s: unknown[]) => validateProblems([{ ...good, steps: s }], fiscal, [], 3).rejected[0]?.reason;
    expect(steps([])).toBe("bad_steps");
    expect(steps(Array.from({ length: 7 }, (_, i) => ({ name: `s${i}`, label: "l", expr: "1", explain: "e" })))).toBe("bad_steps");
    expect(steps([{ ...good.steps[0], name: "mpc" }])).toBe("bad_steps"); // collides with a given
    expect(steps([{ ...good.steps[0], name: "Mult" }])).toBe("bad_steps"); // not lowercase
    expect(steps([{ ...good.steps[0], explain: "" }])).toBe("bad_steps");
    expect(validateProblems([{ ...good, givens: [] }], fiscal, [], 3).rejected[0].reason).toBe("bad_givens");
    expect(validateProblems([{ ...good, givens: [{ name: "sqrt", value: 1, label: "x" }] }], fiscal, [], 3).rejected[0].reason).toBe("bad_givens");
    expect(validateProblems([{ ...good, givens: [good.givens[0], good.givens[0]] }], fiscal, [], 3).rejected[0].reason).toBe("bad_givens");
  });

  it("asks for exactly one number", () => {
    const two = { ...good, stem: good.stem.replace("By how much does output rise?", "Compute the multiplier, and give the change in output.") };
    expect(validateProblems([two], fiscal, [], 3).rejected[0].reason).toBe("two_questions");
    expect(validateProblems([{ ...good, stem: good.stem + " Why does it rise?" }], fiscal, [], 3).rejected[0].reason).toBe("two_questions");
    expect(asksTwoThings("A firm sells 10 units at $5 and pays $20 in costs. Find its profit.")).toBe(false);
    expect(asksTwoThings("Find the quantity and price at equilibrium")).toBe(false);
    expect(asksTwoThings("Find profit and what is the quantity")).toBe(true);
  });

  it("rounds away floating-point noise", () => {
    expect(compute("mult * dg", { mult: 10, dg: 20.000000000000004 })).toEqual({ value: 200 });
    expect(compute("0.1 + 0.2", {})).toEqual({ value: 0.3 });
  });

  it("requires the receipt quote to be in the note", () => {
    expect(validateProblems([{ ...good, quote: "The multiplier is always exactly ten." }], fiscal, [], 3).rejected[0].reason).toBe("quote_not_found");
    expect(validateProblems([{ ...good, quote: "too short" }], fiscal, [], 3).rejected[0].reason).toBe("quote_too_short");
  });

  it("rejects a problem that just reuses the numbers of a worked example in the note", () => {
    const copy = {
      ...good,
      stem: "With a proportional tax rate of 0.25 and MPC of 0.8, what is the multiplier?",
      givens: [{ name: "mpc", value: 0.8, label: "m" }, { name: "t", value: 0.25, label: "t" }],
      steps: [{ name: "mult", label: "Multiplier", expr: "1 / (1 - mpc * (1 - t))", explain: "Taxes shrink the multiplier." }],
    };
    expect(validateProblems([copy], fiscal, [], 3).rejected[0].reason).toBe("copied_from_note");
    const fresh = { ...copy, stem: "With a proportional tax rate of 0.2 and MPC of 0.9, what is the multiplier?", givens: [{ name: "mpc", value: 0.9, label: "m" }, { name: "t", value: 0.2, label: "t" }] };
    expect(validateProblems([fresh], fiscal, [], 3).accepted).toHaveLength(1);
  });

  it("drops duplicates, caps the count, assigns difficulty by steps, and survives junk", () => {
    expect(validateProblems([good], fiscal, [good.stem], 3).rejected[0].reason).toBe("duplicate");
    const many = [0, 1, 2, 3].map((k) => ({ ...good, stem: good.stem.replace("0.9", `0.${k + 1}`).replace("50", `${k + 6}0`) + ` Variant ${"abcd"[k]} of the question about ${["output", "income", "spending", "demand"][k]}.`, givens: [{ name: "mpc", value: Number(`0.${k + 1}`), label: "m" }, { name: "dg", value: Number(`${k + 6}0`), label: "g" }] }));
    expect(validateProblems(many, fiscal, [], 2).accepted).toHaveLength(2);
    const hard = { ...good, steps: Array.from({ length: 5 }, (_, i) => ({ name: `s${i}`, label: "l", expr: i ? `s${i - 1} + 1` : "mpc", explain: "e" })) };
    expect(validateProblems([hard], fiscal, [], 3).accepted[0].difficulty).toBe(3);
    const junk = validateProblems([null, 3, "x", [], {}] as unknown[], fiscal, [], 3);
    expect(junk.accepted).toEqual([]);
    expect(junk.rejected).toHaveLength(5);
  });

  it("builds prompts that ask for programs, new numbers and a verbatim quote", () => {
    const { system, prompt } = buildProblemPrompts(fiscal, { density: "thorough", focus: "taxes", courses: DEFAULT_COURSES });
    expect(system).toContain(`at most ${PROBLEM_TARGET.thorough} problems`);
    expect(system).toContain("Use NEW numbers");
    expect(system).toContain("the app computes every step itself");
    expect(system).toContain("EXACTLY from the note");
    expect(prompt).toContain(fiscal.body);
    expect(prompt).toContain("taxes");
    expect(maxProblems("normal")).toBe(4);
  });
});

describe("the second solve", () => {
  const ps = validateProblems([good], fiscal, [], 3).accepted;
  it("shows the problems but no solution", () => {
    const { prompt, system } = buildProblemSolverPrompts(fiscal, ps);
    expect(prompt).toContain("Problem 1: " + good.stem);
    expect(prompt).not.toContain("1 / (1 - mpc)");
    expect(system).toContain("have not seen any worked solution");
  });
  it("confirms a matching answer and flags every kind of doubt", () => {
    expect(compareSolutions(ps, [{ n: 1, answer: 500 }])).toEqual(["ok"]);
    expect(compareSolutions(ps, [{ n: 1, answer: "500.0" }])).toEqual(["ok"]);
    expect(compareSolutions(ps, [{ n: 1, answer: 250 }])).toEqual(["solve_disagrees"]);
    expect(compareSolutions(ps, [{ n: 1, answer: 500, ambiguous: true }])).toEqual(["ambiguous"]);
    expect(compareSolutions(ps, [{ n: 1, answer: "lots" }])).toEqual(["not_checked"]);
    expect(compareSolutions(ps, [])).toEqual(["not_checked"]);
  });
});

describe("generating for one lecture", () => {
  const solver = (answer: number | string) => (o: { system?: string }) => !!o.system?.includes("have not seen any worked solution") && answer !== undefined;
  const run = (problems: unknown[], answer: number | string | "gibberish"): { runner: Runner; calls: string[] } => {
    const calls: string[] = [];
    const runner: Runner = async (o) => {
      if (solver(answer)(o)) {
        calls.push("solve");
        return { text: answer === "gibberish" ? "Looks right to me." : JSON.stringify([{ n: 1, answer }]), costUsd: 0.01 };
      }
      calls.push("write");
      return { text: JSON.stringify(problems), costUsd: 0.02 };
    };
    return { runner, calls };
  };
  const base = { note: fiscal, courses: DEFAULT_COURSES, density: "normal" as const, existingStems: [] as string[] };

  it("keeps a problem whose blind solve matches the computed answer", async () => {
    const { runner, calls } = run([good], 500);
    const r = await generateProblemsForNote({ runner, ...base });
    expect(calls).toEqual(["write", "solve"]);
    expect(r.accepted).toHaveLength(1);
    expect(r).toMatchObject({ calls: 2, checked: 1, costUsd: 0.03 });
  });

  it("drops a problem when the solver gets something else", async () => {
    const r = await generateProblemsForNote({ runner: run([good], 50).runner, ...base });
    expect(r.accepted).toEqual([]);
    expect(r.rejected.map((x) => x.reason)).toEqual(["solve_disagrees"]);
  });

  it("skips the second solve when nothing passed the gate, and saves nothing if the check can't be read", async () => {
    const none = run([{ ...good, quote: "Totally invented sentence." }], 500);
    expect((await generateProblemsForNote({ runner: none.runner, ...base })).accepted).toEqual([]);
    expect(none.calls).toEqual(["write"]);
    await expect(generateProblemsForNote({ runner: run([good], "gibberish").runner, ...base })).rejects.toBeInstanceOf(ProblemCheckError);
  });

  it("returns nothing for a lecture with no calculation in it", async () => {
    const r = await generateProblemsForNote({ runner: run([], 0).runner, ...base });
    expect(r).toMatchObject({ accepted: [], rejected: [], calls: 1 });
  });
});

describe("the problem bank and a practice session", () => {
  const seeded = () => {
    const db = studyDb(tmp());
    const [p] = validateProblems([good], fiscal, [], 3).accepted;
    addGeneratedProblems(db, { id: "ECON300/a.md", course: "ECON300" }, "v1", [p, { ...p, stem: "A completely different question about the tax cut multiplier with MPC 0.6 and a cut of 30. How much does output change?", givens: [] }]);
    return { db, p };
  };

  it("saves problems with their computed steps and lists them with stats", () => {
    const { db } = seeded();
    const all = listProblems(db, "ECON300");
    expect(all).toHaveLength(2);
    expect(all[0]).toMatchObject({ noteId: "ECON300/a.md", difficulty: 1, asked: 0, right: 0 });
    expect(all[0].answer).toBeCloseTo(500, 9);
    expect(all[0].steps[1]).toMatchObject({ name: "dy", expr: "mult * dg" });
    expect(existingProblemStems(db, "ECON300")).toHaveLength(2);
    expect(problemCounts(db, "ECON300")).toEqual({ total: 2, seen: 0 });
    expect(problemCoverage(db).get("ECON300/a.md")).toEqual({ problems: 2, versions: ["v1"] });
  });

  it("starts a session whose problems carry a hint but no numbers from the solution", () => {
    const { db } = seeded();
    const { problems } = startPractice(db, { course: "ECON300", length: 5 });
    expect(problems).toHaveLength(2);
    const json = JSON.stringify(problems);
    expect(json).not.toMatch(/"answer"|"expr"|"value"|500/);
    expect(problems.find((x) => x.stem.startsWith("In the simple"))!.hint).toEqual({ label: "Spending multiplier", explain: "The simple multiplier is 1 / (1 − MPC)." });
    expect(() => startPractice(db, { course: "ECON301" })).toThrow(/No practice problems yet/);
    expect(() => startPractice(db, { course: "ECON300", noteIds: ["x"] })).toThrow(/None of those lectures/);
  });

  it("checks typed answers within tolerance, then reveals the worked steps", () => {
    const { db, p } = seeded();
    const { runId, problems } = startPractice(db, { course: "ECON300" });
    const id = problems.find((x) => x.stem.startsWith("In the simple"))!.id;
    const right = answerProblem(db, { runId, problemId: id, submitted: "$500" });
    expect(right).toMatchObject({ correct: true, attempt: 1, unit: "", off: null });
    expect(right.steps.map((s) => s.label)).toEqual(["Spending multiplier", "Change in output"]);
    expect(right.quote).toBe(p.quote);
    expect(answerProblem(db, { runId, problemId: id, submitted: "502" }).correct).toBe(true); // within 1%
    const wrong = answerProblem(db, { runId, problemId: id, submitted: 250 });
    expect(wrong).toMatchObject({ correct: false });
    expect(wrong.off).toBeCloseTo(0.5, 9);
    expect(() => answerProblem(db, { runId, problemId: id, submitted: "lots" })).toThrow(/Type a number/);
    expect(() => answerProblem(db, { runId: "x", problemId: id, submitted: 1 })).toThrow(/isn't running/);
    expect(() => answerProblem(db, { runId, problemId: "x", submitted: 1 })).toThrow(/deleted/);
  });

  it("scores first tries, separates unaided from hinted, counts a give-up as a miss, and notes recovery", () => {
    const { db } = seeded();
    const { runId, problems } = startPractice(db, { course: "ECON300" });
    const [a, b] = problems;
    const ans = (id: string) => getProblem(db, id)!.answer;
    answerProblem(db, { runId, problemId: a.id, submitted: ans(a.id), hinted: true }); // right, but with the hint
    answerProblem(db, { runId, problemId: b.id, submitted: null, gaveUp: true }); // gave up
    answerProblem(db, { runId, problemId: b.id, submitted: ans(b.id) }); // right the second time
    const s = finishPractice(db, runId, new Date(Date.now() + 61_000));
    expect(s).toMatchObject({ total: 2, correct: 1, pct: 50, unaided: 0, recovered: 1 });
    expect(s.missed).toHaveLength(1);
    expect(s.seconds).toBeGreaterThanOrEqual(60);
    const stats = listProblems(db, "ECON300").filter((x) => x.asked > 0);
    expect(stats.reduce((n, x) => n + x.asked, 0)).toBe(2);
    expect(problemAccuracy(db, "ECON300")).toEqual({ answers: 2, correct: 1, pct: 50 });
    expect(studyDays(db)).toHaveLength(1);
  });

  it("puts last-missed problems before ones you already know, and deletes with history", () => {
    const { db } = seeded();
    const first = startPractice(db, { course: "ECON300" });
    const [a, b] = first.problems;
    answerProblem(db, { runId: first.runId, problemId: a.id, submitted: getProblem(db, a.id)!.answer });
    answerProblem(db, { runId: first.runId, problemId: b.id, submitted: 1e9 });
    expect(startPractice(db, { course: "ECON300", length: 1 }).problems[0].id).toBe(b.id);
    expect(deleteProblem(db, b.id)).toBe(true);
    expect((db.prepare("SELECT COUNT(*) n FROM problem_attempts WHERE problem_id = ?").get(b.id) as { n: number }).n).toBe(0);
    logProblemGeneration(db, "x", "v", 0, 1);
  });
});

describe("problem generation job", () => {
  it("writes, computes, double-checks and saves problems per lecture, and records usage", async () => {
    const db = studyDb(tmp());
    const calls: string[] = [];
    const runner: Runner = async (o) => {
      const body = o.prompt.split(/<note[^>]*>\n/)[1]?.split("\n</note>")[0] ?? "";
      const title = o.prompt.match(/<note title="([^"]*)"/)![1];
      if (o.system?.includes("have not seen any worked solution")) {
        calls.push("solve");
        return { text: JSON.stringify([{ n: 1, answer: 500 }]), costUsd: 0.01 };
      }
      calls.push("write");
      const words = body.split(/\s+/);
      return {
        text: JSON.stringify([{ ...good, stem: `${good.stem} (${title})`, quote: words.slice(15, 22).join(" ") }]),
        costUsd: 0.02,
      };
    };
    const jobs = new ProblemGenerationJobs(runner, () => () => {});
    jobs.start({ db, notes: econ301, courses: DEFAULT_COURSES, course: "ECON301", density: "normal" });
    for (let i = 0; i < 400 && jobs.isRunning(); i++) await new Promise((r) => setTimeout(r, 10));
    const job = jobs.status()!;
    expect(job.status).toBe("done");
    expect(job.totals).toMatchObject({ created: 3, calls: 6, dropped: 0 });
    expect(listProblems(db, "ECON301")).toHaveLength(3);
    expect(problemCoverage(db).get(econ301[0].id)?.versions).toEqual([noteVersion(econ301[0])]);
    expect(usageSummary(db).byKind.problems).toBe(6);
    expect(calls.filter((c) => c === "solve")).toHaveLength(3);
  });
});
