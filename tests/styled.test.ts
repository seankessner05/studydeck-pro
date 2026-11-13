import { describe, it, expect, afterAll } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { Note } from "../src/notes";
import type { Runner } from "../src/claude";
import { closeStudyDbs, studyDb } from "../src/study/db";
import {
  applyStyledWritten, blueprintPoints, buildExamPrompts, buildExamSolverPrompts, buildStyledExam, checkSolve, createStyledSitting, getStyled, loadBlueprint,
  pendingStyledWritten, publicExam, submitStyled, totals, validateExamQuestion, type Blueprint, type ExamQuestion, type StyledExam,
} from "../src/study/styled";

afterAll(() => closeStudyDbs());
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "sd-styled-"));

const note: Note = {
  id: "ECON300/2026-11-05_is.md", course: "ECON300", file: "2026-11-05_is.md", date: "2026-11-05", title: "Goods market and the IS curve", sample: false,
  body: "# Goods market\n\n## Keynesian cross\n- Planned expenditure PE = C + I + G\n- Equilibrium when PE = Y\n- A rise in government purchases shifts the IS curve to the right\n\n## Multiplier\n- The spending multiplier is 1 / (1 - MPC), so with MPC = 0.75 it is 4\n- Households save part of a tax cut, so the tax multiplier is smaller",
} as Note;

const blueprint: Blueprint = {
  course: "ECON300", name: "Test format", minutes: 50, instructions: "Answer everything.",
  sections: [
    { title: "Section 1", points: 6, questions: [{ points: 6, shape: "a calculation then an explanation", parts: [{ points: 4, kinds: ["number"] }, { points: 2, kinds: ["written"] }] }] },
    { title: "Section 2", points: 4, questions: [{ points: 4, shape: "a graph", parts: [{ points: 4, kinds: ["graph"] }] }] },
  ],
  style: ["Parts build on each other."],
  examples: "Past exam: Consider the economy Y = 14000, C = 2000 + 0.75(Y - T), I = 2000 - 200r, G = 2000, T = 2000. Calculate the equilibrium real interest rate using the goods market condition.",
};

const q1 = {
  section: 1, number: 1,
  setup: "In the economy of Norland, consumption is C = 300 + 0.8(Y - T), investment is I = 400, government purchases are G = 500 and taxes are T = 250.",
  givens: [{ name: "a", value: 300, label: "autonomous consumption" }, { name: "mpc", value: 0.8, label: "MPC" }, { name: "inv", value: 400, label: "investment" }, { name: "g", value: 500, label: "government purchases" }, { name: "t", value: 250, label: "taxes" }],
  parts: [
    { label: "a", kind: "number", points: 4, prompt: "Find equilibrium output using the Keynesian cross condition PE = Y.", unit: "", steps: [{ name: "auto", label: "Autonomous spending", expr: "a - mpc * t + inv + g", explain: "Everything that doesn't depend on Y." }, { name: "y", label: "Output", expr: "auto / (1 - mpc)", explain: "Divide by 1 - MPC." }] },
    { label: "b", kind: "written", points: 2, prompt: "Explain why a tax cut of the same size as a rise in G would raise output by less.", rubric: [{ text: "Households save part of a tax cut", quote: "Households save part of a tax cut", noteId: note.id }], model: "Part of a tax cut is saved, so first-round spending is smaller." },
  ],
};
const q2 = {
  section: 2, number: 1, setup: "Norland raises government purchases to build new rail lines while the central bank keeps the money supply fixed.", givens: [],
  parts: [{ label: "a", kind: "graph", points: 4, prompt: "Show the effect on an IS-LM graph.", graph: "IS-LM", curves: [{ name: "IS", choices: ["right", "left", "none"], key: "right" }, { name: "LM", choices: ["right", "left", "none"], key: "none" }], effects: [{ name: "output", key: "up" }, { name: "interest rate", key: "up" }], why: "More spending shifts IS right; higher output raises money demand and the interest rate." }],
};

describe("checking a written exam question", () => {
  it("accepts a good question and computes every number itself", () => {
    const v = validateExamQuestion(q1, blueprint, [note]);
    expect(v.rejected).toBeUndefined();
    const p = v.question!.parts[0];
    expect(p.kind === "number" && p.answer).toBe((300 - 0.8 * 250 + 400 + 500) / 0.2);
    expect(v.question!.parts.map((x) => x.id)).toEqual(["1.1.a", "1.1.b"]);
  });

  it("takes point labels out of the text, since the app shows each part's points itself", () => {
    const labelled = { ...q1, setup: "Question 1 (6 points). " + q1.setup, parts: [{ ...q1.parts[0], prompt: "(4 points) " + q1.parts[0].prompt }, { ...q1.parts[1], prompt: "b) explain: (3 points total for b) " + q1.parts[1].prompt }] };
    const v = validateExamQuestion(labelled, blueprint, [note]).question!;
    expect(v.setup).toBe(q1.setup);
    expect(v.parts.map((p) => p.prompt)).toEqual([q1.parts[0].prompt, q1.parts[1].prompt]);
  });

  it("lets later parts use earlier parts' results, and labels split parts apart", () => {
    const chained = { ...q1, parts: [q1.parts[0], { label: "a", kind: "number", points: 1, prompt: "By how much does output rise if G rises by 100?", unit: "", steps: [{ name: "dy", label: "Change", expr: "100 / (1 - mpc)", explain: "" }] }, { ...q1.parts[1], points: 1 }] };
    const v = validateExamQuestion(chained, blueprint, [note]);
    expect(v.question!.parts.map((x) => x.id)).toEqual(["1.1.a", "1.1.a2", "1.1.b"]);
  });

  it("rejects what can't be checked or shouldn't be on the exam", () => {
    const reason = (over: object) => validateExamQuestion({ ...q1, ...over }, blueprint, [note]).rejected?.reason;
    expect(reason({ parts: [q1.parts[0]] })).toBe("points"); // 4 of 6
    expect(reason({ setup: q1.setup + " Use the graph above." })).toBe("not_self_contained");
    expect(reason({ setup: q1.setup + " The government's revenue is area D." })).toBe("not_self_contained");
    expect(reason({ parts: [{ ...q1.parts[0], steps: [{ name: "y", label: "", expr: "a / zeta", explain: "" }] }, q1.parts[1]] })).toBe("bad_program");
    expect(reason({ setup: "In Norland, consumption is C = 300 + 0.8(Y - T), G = 500 and T = 250." })).toBe("given_not_in_text"); // investment 400 never stated
    expect(reason({ parts: [q1.parts[0], { ...q1.parts[1], rubric: [{ text: "x", quote: "words that are nowhere in any note", noteId: note.id }] }] })).toBe("quote_not_found");
    expect(validateExamQuestion({ ...q2, parts: [{ ...q2.parts[0], curves: [{ name: "IS", choices: ["right", "left"], key: "sideways" }] }] }, blueprint, [note]).rejected?.reason).toBe("bad_graph");
  });

  it("lets a question repeat the professor's standard instructions, which are his format", () => {
    const withHatch = { ...q1, parts: [{ ...q1.parts[0], prompt: "Find equilibrium output using the Keynesian cross condition PE = Y. If you can't figure out the calculation, describe the solution in words for partial credit. Please show your work." }, q1.parts[1]] };
    const pastWithHatch = { ...blueprint, examples: blueprint.examples + " (a) Please calculate the optimal number of workers. If you can't figure out the calculation, describe the solution in words for partial credit. Please show your work." };
    expect(validateExamQuestion(withHatch, pastWithHatch, [note]).rejected).toBeUndefined();
  });

  it("rejects a question that reuses the past exam's wording or numbers", () => {
    const copy = { ...q1, setup: "Consider the economy Y = 14000, C = 2000 + 0.75(Y - T), I = 2000 - 200r, G = 2000, T = 2000. Calculate the equilibrium real interest rate using the goods market condition." };
    expect(validateExamQuestion(copy, blueprint, [note]).rejected).toMatchObject({ reason: "copies_past_exam", detail: expect.stringContaining("consider the economy") });
    const sameNumbers = { ...q1, setup: "Output is 14000, taxes 2000, investment 2000 and spending 2000 with MPC 0.8 and autonomous consumption 300.", givens: [{ name: "a", value: 300, label: "" }, { name: "mpc", value: 0.8, label: "" }, { name: "inv", value: 2000, label: "" }, { name: "g", value: 14000, label: "" }, { name: "t", value: 2000, label: "" }] };
    expect(validateExamQuestion(sameNumbers, blueprint, [note]).rejected).toMatchObject({ reason: "copies_past_exam", detail: "same numbers" });
  });
});

const examOf = (): StyledExam => {
  const questions = [validateExamQuestion(q1, blueprint, [note]).question!, validateExamQuestion(q2, blueprint, [note]).question!];
  return { title: "Mock", minutes: 50, instructions: "", sections: blueprint.sections.map((s) => ({ title: s.title, instructions: "", choose: null, points: s.points })), questions };
};

describe("the second solve without notes", () => {
  it("passes a question only when every number and graph part agrees", () => {
    const [a, b] = examOf().questions;
    const y = (a.parts[0] as { answer: number }).answer;
    const ok = checkSolve([a, b], [{ id: "1.1.a", answer: y * 1.004 }, { id: "1.1.b", unanswerable: false }, { id: "2.1.a", curves: { IS: "right", LM: "none" }, effects: { output: "up", "interest rate": "up" } }]);
    expect([...ok.values()]).toEqual(["ok", "ok"]);
    const bad = checkSolve([a, b], [{ id: "1.1.a", answer: y * 1.2 }, { id: "2.1.a", curves: { IS: "right", LM: "right" }, effects: { output: "up", "interest rate": "up" } }]);
    expect([...bad.values()]).toEqual(["solve_disagrees", "solve_disagrees"]);
    expect(checkSolve([a], [{ id: "1.1.a", answer: y }, { id: "1.1.b", unanswerable: true }]).get("1.1")).toBe("unanswerable");
    expect(checkSolve([a], []).get("1.1")).toBe("not_checked");
  });

  it("sends the solver the exam only: no notes, keys, steps or rubrics", () => {
    const { system, prompt } = buildExamSolverPrompts("Macroeconomics", examOf().questions);
    expect(system).toContain("You have not seen any answer key");
    expect(prompt).toContain("[1.1.a]");
    expect(prompt).toContain("\"IS\": right/left/none");
    expect(prompt).not.toContain("Households save part of a tax cut"); // a rubric/quote
    expect(prompt).not.toContain("Divide by 1 - MPC"); // a step explanation
    expect(prompt).not.toContain(note.body);
  });

  it("gives the writer the blueprint, the past exam for style, and the lectures", () => {
    const { system, prompt } = buildExamPrompts(blueprint, [note]);
    expect(system).toContain("never reuse its questions");
    expect(system).toContain("NEVER refer to a graph");
    expect(prompt).toContain("Question 1 (6 points)");
    expect(prompt).toContain("a) 4 pts as number; b) 2 pts as written");
    expect(prompt).toContain(note.body);
    expect(prompt).toContain("PAST EXAM (style only, never reuse)");
    expect(buildExamPrompts(blueprint, [note], [{ section: 2, number: 1 }]).prompt).not.toContain("Question 1 (6 points)");
  });
});

describe("building a whole exam", () => {
  it("keeps what the no-notes solve confirms and rewrites the rest once", async () => {
    let round = 0;
    const calls: string[] = [];
    const runner: Runner = async (o) => {
      if (o.system?.includes("You have not seen any answer key")) {
        calls.push("solve");
        const y = (300 - 0.8 * 250 + 400 + 500) / 0.2;
        // first round: the graph answer disagrees; second round: it agrees
        return { text: JSON.stringify([{ id: "1.1.a", answer: y }, { id: "2.1.a", curves: { IS: "right", LM: round === 1 ? "right" : "none" }, effects: { output: "up", "interest rate": "up" } }]), costUsd: 0.01 };
      }
      calls.push("write");
      round++;
      return { text: JSON.stringify(round === 1 ? [q1, q2] : [q2]), costUsd: 0.05 };
    };
    const r = await buildStyledExam({ runner, blueprint, notes: [note], courseName: "Macroeconomics", title: "Mock" });
    expect(calls).toEqual(["write", "solve", "write", "solve"]);
    expect(r.exam.questions.map((q) => q.id)).toEqual(["1.1", "2.1"]);
    expect(r.rejected).toMatchObject([{ section: 2, number: 1, reason: "solve_disagrees" }]);
    expect(r.missing).toEqual([]);
    expect(r.calls).toBe(4);
  });

  it("makes a shorter exam rather than keep anything unchecked", async () => {
    const runner: Runner = async (o) => (o.system?.includes("You have not seen any answer key") ? { text: "not json at all" } : { text: JSON.stringify([q1, q2]) });
    await expect(buildStyledExam({ runner, blueprint, notes: [note], courseName: "Macroeconomics", title: "Mock" })).rejects.toThrow(/No question passed/);
  });
});

describe("sitting and grading", () => {
  it("never sends keys, steps, rubrics or model answers before hand-in", () => {
    const text = JSON.stringify(publicExam(examOf()));
    for (const secret of ['"answer"', '"steps"', '"rubric"', '"model"', '"key"', '"why"', "Households save part"]) expect(text).not.toContain(secret);
    expect(text).toContain('"choices"');
  });

  it("grades numbers and graphs at once, then written answers by evidence in the student's own words", () => {
    const db = studyDb(tmp());
    const exam = examOf();
    const id = createStyledSitting(db, { course: "ECON300", examId: null, exam });
    expect(JSON.stringify(getStyled(db, id))).not.toContain('"steps"');
    const y = (exam.questions[0].parts[0] as { answer: number }).answer;
    const done = submitStyled(db, id, { "1.1.a": String(y), "1.1.b": "People save some of a tax cut, so less is spent.", "2.1.a": { curves: { IS: "right", LM: "right" }, effects: { output: "up", "interest rate": "up" } } });
    // number right (4), graph 3 of 4 fields (3), written waiting
    expect(done.results!.map((r) => [r.id, r.earned, r.graded])).toEqual([["1.1.a", 4, true], ["1.1.b", 0, false], ["2.1.a", 3, true]]);
    expect(done.totals).toMatchObject({ earned: 7, max: 10 });
    expect(() => submitStyled(db, id, {})).toThrow(/already handed in/);

    const pending = pendingStyledWritten(db, id);
    expect(pending).toHaveLength(1);
    expect(pending[0].input.answer).toBe("People save some of a tax cut, so less is spent.");
    const graded = applyStyledWritten(db, id, pending, new Map([[1, { points: [{ id: "p1", text: "", met: true, evidence: "save some of a tax cut", check: "" }], earned: 1, max: 1, remark: "Good." }]]));
    expect(graded.totals).toMatchObject({ earned: 9, max: 10 });
    expect(graded.pendingWritten).toBe(false);
  });

  it("counts only the best N questions in an 'answer any N' section", () => {
    const exam = examOf();
    exam.sections[0] = { ...exam.sections[0], choose: 1 };
    const second: ExamQuestion = { ...exam.questions[0], id: "1.2", number: 2, parts: exam.questions[0].parts.map((p) => ({ ...p, id: p.id.replace("1.1", "1.2") })) };
    exam.questions.splice(1, 0, second);
    const results = new Map([["1.1.a", { id: "1.1.a", earned: 4, max: 4, answered: true, graded: true }], ["1.2.a", { id: "1.2.a", earned: 0, max: 4, answered: true, graded: true }]]);
    const t = totals(exam, results);
    expect(t.sections[0]).toMatchObject({ earned: 4, max: 6 });
  });

  it("reads a blueprint from the private data folder", () => {
    const dir = tmp();
    expect(loadBlueprint(dir, "ECON300")).toBeUndefined();
    fs.mkdirSync(path.join(dir, "blueprints"));
    fs.writeFileSync(path.join(dir, "blueprints", "ECON300.json"), JSON.stringify(blueprint));
    expect(loadBlueprint(dir, "ECON300")?.name).toBe("Test format");
    expect(blueprintPoints(blueprint)).toBe(10);
    expect(loadBlueprint(dir, "../ECON300")?.name).toBe("Test format"); // the course id can't leave the folder
  });
});
