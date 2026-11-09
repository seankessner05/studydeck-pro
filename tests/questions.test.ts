import { describe, it, expect, afterAll } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { closeStudyDbs, studyDb } from "../src/study/db";
import { studyDays } from "../src/study/cards";
import {
  QuizError, addGeneratedQuestions, answerQuestion, deleteQuestion, existingStems, finishQuiz, getQuestion, listQuestions, logQuestionGeneration, questionCoverage, quizAccuracy, quizCounts, startQuiz,
} from "../src/study/questions";
import type { GeneratedQuestion } from "../src/study/quizgen";

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "sd-quiz-"));
const noon = (d = 9) => new Date(2026, 10, d, 12, 0, 0);
afterAll(() => closeStudyDbs());

const q = (stem: string, over: Partial<GeneratedQuestion> = {}): GeneratedQuestion => ({
  kind: "single", stem, options: ["one", "two", "three", "four"], answer: [1], explanation: "Because two.", quote: "a quote from the note", section: "Notes", ...over,
});
const note = (id: string, course = "ECON301") => ({ id, course });
const fresh = () => studyDb(tmp());

describe("the question bank", () => {
  it("saves questions in order and reads them back with their options and key", () => {
    const db = fresh();
    expect(addGeneratedQuestions(db, note("ECON301/a.md"), "v1", [q("First?"), q("Second?", { kind: "multi", options: ["a", "b", "c", "d", "e"], answer: [0, 3] }), q("Third.", { kind: "tf", options: ["True", "False"], answer: [1] })], noon())).toBe(3);
    const all = listQuestions(db, "ECON301");
    expect(all.map((x) => x.stem)).toEqual(["First?", "Second?", "Third."]);
    expect(all[1]).toMatchObject({ kind: "multi", options: ["a", "b", "c", "d", "e"], answer: [0, 3], noteId: "ECON301/a.md", section: "Notes", asked: 0, right: 0 });
    expect(existingStems(db, "ECON301")).toEqual(["First?", "Second?", "Third."]);
    expect(existingStems(db, "ECON300")).toEqual([]);
    expect(listQuestions(db, "all")).toHaveLength(3);
  });

  it("deletes a question and its history", () => {
    const db = fresh();
    addGeneratedQuestions(db, note("ECON301/a.md"), "v1", [q("Gone?")]);
    const { runId, questions } = startQuiz(db, { course: "ECON301" });
    answerQuestion(db, { runId, questionId: questions[0].id, picked: [1] });
    expect(deleteQuestion(db, questions[0].id)).toBe(true);
    expect(deleteQuestion(db, questions[0].id)).toBe(false);
    expect(getQuestion(db, questions[0].id)).toBeUndefined();
    expect((db.prepare("SELECT COUNT(*) n FROM quiz_answers").get() as { n: number }).n).toBe(0);
  });

  it("knows which lectures have questions, and from which version of the note", () => {
    const db = fresh();
    addGeneratedQuestions(db, note("ECON301/a.md"), "v1", [q("A?"), q("B?")]);
    logQuestionGeneration(db, "ECON301/b.md", "v7", 0, 2); // processed, nothing new kept
    const cov = questionCoverage(db);
    expect(cov.get("ECON301/a.md")).toEqual({ questions: 2, versions: ["v1"] });
    expect(cov.get("ECON301/b.md")).toEqual({ questions: 0, versions: ["v7"] });
    expect(cov.has("ECON301/c.md")).toBe(false);
  });
});

describe("a quiz sitting", () => {
  const seeded = () => {
    const db = fresh();
    addGeneratedQuestions(db, note("ECON301/a.md"), "v1", ["A1", "A2", "A3"].map((s) => q(s + "?", { section: "Alpha" })));
    addGeneratedQuestions(db, note("ECON301/b.md"), "v1", ["B1", "B2"].map((s) => q(s + "?", { section: "Beta" })));
    addGeneratedQuestions(db, note("ECON300/c.md", "ECON300"), "v1", [q("C1?", { section: "Gamma" })]);
    return db;
  };

  it("never sends the key, the explanation or the quote with a question", () => {
    const db = seeded();
    const { questions } = startQuiz(db, { course: "ECON301", length: 10 });
    expect(questions).toHaveLength(5);
    for (const x of questions) expect(Object.keys(x).sort()).toEqual(["course", "id", "kind", "noteId", "options", "section", "stem"]);
  });

  it("limits to the class, the lectures and the length asked for", () => {
    const db = seeded();
    expect(startQuiz(db, { course: "ECON301", length: 2 }).questions).toHaveLength(2);
    expect(startQuiz(db, { course: "all", length: 50 }).questions).toHaveLength(6);
    const onlyB = startQuiz(db, { course: "ECON301", noteIds: ["ECON301/b.md"] }).questions;
    expect(onlyB.map((x) => x.noteId)).toEqual(["ECON301/b.md", "ECON301/b.md"]);
    expect(() => startQuiz(db, { course: "ECON301", noteIds: ["ECON301/zzz.md"] })).toThrow(/None of those lectures/);
    expect(() => startQuiz(fresh(), { course: "all" })).toThrow(QuizError);
  });

  it("asks what you have never seen first, then what you last got wrong, then the rest", () => {
    const db = seeded();
    const first = startQuiz(db, { course: "ECON301", length: 10 }, noon(1));
    const byStem = new Map(first.questions.map((x) => [x.stem, x.id]));
    answerQuestion(db, { runId: first.runId, questionId: byStem.get("A1?")!, picked: [1] }, noon(1)); // right
    answerQuestion(db, { runId: first.runId, questionId: byStem.get("A2?")!, picked: [0] }, noon(1)); // wrong
    // A3, B1, B2 are still unseen; with length 4 the unseen three come first and then the one missed
    const next = startQuiz(db, { course: "ECON301", length: 4 }, noon(2));
    expect(new Set(next.questions.map((x) => x.stem))).toEqual(new Set(["A3?", "B1?", "B2?", "A2?"]));
    // with length 3 the missed one is only taken after the unseen ones, so it isn't in
    expect(startQuiz(db, { course: "ECON301", length: 3 }, noon(2)).questions.map((x) => x.stem)).not.toContain("A2?");
  });

  it("grades single, multi-select (all or nothing) and true/false answers and reveals the key", () => {
    const db = fresh();
    addGeneratedQuestions(db, note("ECON301/a.md"), "v1", [
      q("Single?"),
      q("Multi?", { kind: "multi", options: ["a", "b", "c", "d", "e"], answer: [0, 3] }),
      q("Statement.", { kind: "tf", options: ["True", "False"], answer: [0] }),
    ]);
    const { runId, questions } = startQuiz(db, { course: "ECON301" });
    const id = (stem: string) => questions.find((x) => x.stem === stem)!.id;
    expect(answerQuestion(db, { runId, questionId: id("Single?"), picked: [1] })).toMatchObject({ correct: true, attempt: 1, answer: [1], explanation: "Because two.", quote: "a quote from the note", noteId: "ECON301/a.md" });
    expect(answerQuestion(db, { runId, questionId: id("Multi?"), picked: [3, 0] }).correct).toBe(true); // order doesn't matter
    expect(answerQuestion(db, { runId, questionId: id("Statement."), picked: [1] }).correct).toBe(false);
    // the multi answer needs every right option and no wrong one
    const m = startQuiz(db, { course: "ECON301", noteIds: ["ECON301/a.md"], length: 3 });
    const mid = m.questions.find((x) => x.stem === "Multi?")!.id;
    expect(answerQuestion(db, { runId: m.runId, questionId: mid, picked: [0] }).correct).toBe(false);
    expect(answerQuestion(db, { runId: m.runId, questionId: mid, picked: [0, 3, 4] }).correct).toBe(false);
  });

  it("refuses answers that make no sense", () => {
    const db = fresh();
    addGeneratedQuestions(db, note("ECON301/a.md"), "v1", [q("One?")]);
    const { runId, questions } = startQuiz(db, { course: "ECON301" });
    const questionId = questions[0].id;
    expect(() => answerQuestion(db, { runId, questionId, picked: [] })).toThrow(/Pick an answer/);
    expect(() => answerQuestion(db, { runId, questionId, picked: [9] })).toThrow(/Pick an answer/);
    expect(() => answerQuestion(db, { runId, questionId, picked: [0, 1] })).toThrow(/Pick one/);
    expect(() => answerQuestion(db, { runId, questionId, picked: "B" })).toThrow(/Pick an answer/);
    expect(() => answerQuestion(db, { runId: "nope", questionId, picked: [0] })).toThrow(/isn't running/);
    expect(() => answerQuestion(db, { runId, questionId: "nope", picked: [0] })).toThrow(/deleted/);
  });

  it("scores first tries only, and counts a miss answered correctly the second time as recovered", () => {
    const db = seeded();
    const { runId, questions } = startQuiz(db, { course: "ECON301", length: 4 }, noon(3));
    const [a, b, c, d] = questions;
    answerQuestion(db, { runId, questionId: a.id, picked: [1] }, noon(3));
    answerQuestion(db, { runId, questionId: b.id, picked: [1] }, noon(3));
    answerQuestion(db, { runId, questionId: c.id, picked: [0] }, noon(3)); // miss
    answerQuestion(db, { runId, questionId: d.id, picked: [0] }, noon(3)); // miss
    expect(answerQuestion(db, { runId, questionId: c.id, picked: [1] }, noon(3)).attempt).toBe(2); // asked again: right now
    answerQuestion(db, { runId, questionId: d.id, picked: [2] }, noon(3)); // asked again: still wrong
    const s = finishQuiz(db, runId, new Date(noon(3).getTime() + 95_000));
    expect(s).toMatchObject({ total: 4, correct: 2, pct: 50, recovered: 1, seconds: 95 });
    expect(s.missed.map((x) => x.id).sort()).toEqual([c.id, d.id].sort());
    expect(s.bySection.reduce((n, x) => n + x.asked, 0)).toBe(4);
    // finishing twice changes nothing
    expect(finishQuiz(db, runId, new Date(noon(3).getTime() + 999_000)).seconds).toBe(95);
    // per-question stats count first tries only
    const stats = listQuestions(db, "ECON301").filter((x) => x.asked > 0);
    expect(stats.reduce((n, x) => n + x.asked, 0)).toBe(4);
    expect(stats.reduce((n, x) => n + x.right, 0)).toBe(2);
  });

  it("orders sections from weakest to strongest", () => {
    const db = fresh();
    addGeneratedQuestions(db, note("ECON301/a.md"), "v1", [q("S1?", { section: "Strong" }), q("S2?", { section: "Strong" }), q("W1?", { section: "Weak" })]);
    const { runId, questions } = startQuiz(db, { course: "ECON301" });
    for (const x of questions) answerQuestion(db, { runId, questionId: x.id, picked: [x.section === "Strong" ? 1 : 0] });
    expect(finishQuiz(db, runId).bySection.map((s) => [s.section, s.asked, s.right])).toEqual([["Weak", 1, 0], ["Strong", 2, 2]]);
  });

  it("reports counts and first-try accuracy for the dashboard, and counts quiz days toward the streak", () => {
    const db = seeded();
    expect(quizCounts(db, "ECON301")).toEqual({ total: 5, seen: 0 });
    expect(quizAccuracy(db, "all", noon(9))).toEqual({ answers: 0, correct: 0, pct: null });
    expect(studyDays(db)).toEqual([]);
    const { runId, questions } = startQuiz(db, { course: "ECON301", length: 2 }, noon(9));
    answerQuestion(db, { runId, questionId: questions[0].id, picked: [1] }, noon(9));
    answerQuestion(db, { runId, questionId: questions[1].id, picked: [0] }, noon(9));
    expect(quizCounts(db, "ECON301")).toEqual({ total: 5, seen: 2 });
    expect(quizAccuracy(db, "ECON301", noon(9))).toEqual({ answers: 2, correct: 1, pct: 50 });
    expect(quizAccuracy(db, "ECON300", noon(9)).answers).toBe(0);
    expect(quizAccuracy(db, "all", noon(20)).answers).toBe(0); // older than a week
    expect(studyDays(db)).toEqual(["2026-11-09"]);
  });
});
