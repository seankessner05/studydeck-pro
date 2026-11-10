import { describe, it, expect, afterAll } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { closeStudyDbs, studyDb } from "../src/study/db";
import { addGeneratedCards, reviewCard, studyDays, counts, listCards } from "../src/study/cards";
import { addGeneratedQuestions, answerQuestion, listQuestions, startQuiz } from "../src/study/questions";
import { addGeneratedProblems, answerProblem, listProblems, startPractice } from "../src/study/problems";
import { ExamError, createExam, dayStart, daysUntil, deleteExam, getExam, inScope, listExams } from "../src/study/exams";
import { buildPlan, collectEvidence, insights, lectureProgress, masteryOf, readiness, weakSpots, type Evidence, type NoteRef } from "../src/study/mastery";

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "sd-mast-"));
const day = (n: number) => new Date(2026, 10, n, 12, 0, 0); // November n, noon
afterAll(() => closeStudyDbs());

const ev = (score: number, daysAgo = 0, weight = 1, now = day(10)): Evidence => ({ course: "ECON301", noteId: "n", section: "s", score, weight, at: now.getTime() - daysAgo * 86_400_000, source: "quiz" });

describe("mastery", () => {
  it("says it doesn't know until there is enough evidence, and doesn't trust one lucky answer", () => {
    expect(masteryOf([], day(10))).toMatchObject({ score: null, level: "unknown", answers: 0 });
    expect(masteryOf([ev(1)], day(10))).toMatchObject({ score: 0.7, level: "shaky" });
    expect(masteryOf([1, 1, 1, 1, 1].map((s) => ev(s)), day(10))).toMatchObject({ level: "solid" });
    expect(masteryOf([0, 0, 0, 0, 0].map((s) => ev(s)), day(10))).toMatchObject({ level: "weak" });
  });

  it("lets old answers fade: a pile of misses from two months ago is no longer evidence", () => {
    expect(masteryOf([0, 0, 0, 0, 0, 0].map((s) => ev(s, 60)), day(10)).level).toBe("unknown");
    // but one recent answer outweighs an older one
    const m = masteryOf([ev(0, 28), ev(1, 0)], day(10));
    expect(m.score!).toBeGreaterThan(0.6);
  });

  it("weights problems more than a flip, and counts a hinted success as half", () => {
    expect(masteryOf([ev(1, 0, 1.5)], day(10)).evidence).toBe(1.5);
    expect(masteryOf([ev(0.5, 0, 1.5), ev(0.5, 0, 1.5), ev(0.5, 0, 1.5)], day(10)).score!).toBeCloseTo(0.5, 1);
  });
});

describe("evidence from real answers", () => {
  const A: NoteRef = { id: "ECON301/a.md", course: "ECON301", title: "Costs", date: "2026-10-08" };
  const B: NoteRef = { id: "ECON301/b.md", course: "ECON301", title: "Monopoly", date: "2026-10-29" };
  const C: NoteRef = { id: "ECON301/c.md", course: "ECON301", title: "Untouched", date: "2026-11-03" };
  const q = (stem: string, section: string) => ({ kind: "single" as const, stem, options: ["a", "b", "c", "d"], answer: [1], explanation: "e", quote: "q q q", section });

  async function seeded() {
    const db = studyDb(tmp());
    // lecture A: cards rated well, quiz mostly right
    await addGeneratedCards(db, A, "v1", [{ front: "f1", back: "b1", quote: "q q q", section: "Cost curves" }, { front: "f2", back: "b2", quote: "q q q", section: "Cost curves" }], day(1));
    for (const c of listCards(db, "ECON301")) await reviewCard(db, c.id, 4, day(9));
    // lecture B: quiz mostly wrong in one section
    addGeneratedQuestions(db, B, "v1", [q("B1?", "Marginal revenue"), q("B2?", "Marginal revenue"), q("B3?", "Marginal revenue"), q("B4?", "Demand")], day(1));
    const run = startQuiz(db, { course: "ECON301" }, day(9));
    for (const x of run.questions) answerQuestion(db, { runId: run.runId, questionId: x.id, picked: [x.section === "Marginal revenue" ? 0 : 1] }, day(9));
    return db;
  }

  it("collects card ratings, quiz first tries and problem attempts, with their topic", async () => {
    const db = await seeded();
    const e = collectEvidence(db, "ECON301");
    expect(e.filter((x) => x.source === "card").map((x) => x.score)).toEqual([1, 1]);
    expect(e.filter((x) => x.source === "quiz")).toHaveLength(4);
    expect(e.find((x) => x.source === "quiz" && x.section === "Demand")!.score).toBe(1);
    expect(collectEvidence(db, "ECON300")).toEqual([]);
    expect(collectEvidence(db, "all")).toHaveLength(6);
  });

  it("ignores a miss that was fixed on the second try, but keeps the first-try miss", async () => {
    const db = await seeded();
    const run = startQuiz(db, { course: "ECON301", noteIds: [B.id], length: 4 }, day(9));
    const first = run.questions[0];
    answerQuestion(db, { runId: run.runId, questionId: first.id, picked: [0] }, day(9)); // wrong, attempt 1
    answerQuestion(db, { runId: run.runId, questionId: first.id, picked: [1] }, day(9)); // right, attempt 2
    expect(collectEvidence(db, "ECON301").filter((x) => x.source === "quiz")).toHaveLength(5); // 4 earlier + 1 first try
  });

  it("counts problems, halving a success that used the hint", async () => {
    const db = await seeded();
    const step = { name: "x", label: "l", expr: "1", explain: "e", value: 1 };
    addGeneratedProblems(db, B, "v1", [1, 2].map((k) => ({ stem: `Problem ${k} about different things entirely ${k}`, givens: [], steps: [step], answer: 1, unit: "", difficulty: 1 as const, quote: "q q q", section: "Calc" })), day(1));
    const run = startPractice(db, { course: "ECON301" }, day(9));
    answerProblem(db, { runId: run.runId, problemId: run.problems[0].id, submitted: 1, hinted: true }, day(9));
    answerProblem(db, { runId: run.runId, problemId: run.problems[1].id, submitted: 1 }, day(9));
    const p = collectEvidence(db, "ECON301").filter((x) => x.source === "problem");
    expect(p.map((x) => x.score).sort()).toEqual([0.5, 1]);
    expect(p.every((x) => x.weight === 1.5)).toBe(true);
    expect(listProblems(db, "ECON301")).toHaveLength(2);
  });

  it("builds progress per lecture and per section, weakest first, with material counts", async () => {
    const db = await seeded();
    const l = lectureProgress(db, [A, B, C], day(10));
    const byId = Object.fromEntries(l.map((x) => [x.id, x]));
    expect(byId[A.id].material).toEqual({ cards: 2, questions: 0, problems: 0 });
    expect(byId[B.id].material).toEqual({ cards: 0, questions: 4, problems: 0 });
    expect(byId[C.id].mastery.level).toBe("unknown");
    expect(byId[B.id].sections.map((s) => s.name)).toEqual(["Marginal revenue", "Demand"]);
    expect(byId[B.id].sections[0].mastery).toMatchObject({ level: "weak", answers: 3 });
    expect(byId[A.id].mastery.score!).toBeGreaterThan(0.7);
  });

  it("lists weak spots only where there is real evidence, worst first", async () => {
    const db = await seeded();
    const spots = weakSpots(lectureProgress(db, [A, B, C], day(10)));
    expect(spots.map((s) => [s.title, s.section])).toEqual([["Monopoly", "Marginal revenue"]]);
    expect(spots[0].mastery.answers).toBe(3);
  });

  it("estimates readiness honestly: unpracticed lectures count as a coin flip, and confidence stays low", async () => {
    const db = await seeded();
    const r = readiness(lectureProgress(db, [A, B, C], day(10)));
    expect(r).toMatchObject({ practiced: 2, lectures: 3, confidence: "low" });
    expect(r.score).toBeGreaterThan(0.3);
    expect(r.score).toBeLessThan(0.7);
    expect(readiness([])).toMatchObject({ lectures: 0, confidence: "low" });
  });

  it("writes plain insights from the data", async () => {
    const db = await seeded();
    const l = lectureProgress(db, [A, B, C], day(14));
    const texts = insights(db, l, studyDays(db), day(14)).map((i) => i.kind + ": " + i.text);
    expect(texts.some((t) => t.startsWith("idle:") && t.includes("5 days"))).toBe(true);
    expect(texts.some((t) => t.startsWith("nomaterial:") && t.includes("1 lecture has no cards"))).toBe(true);
    expect(insights(studyDb(tmp()), [], [], day(14))[0].kind).toBe("tip");
    // a question missed twice in a row is called out
    const run1 = startQuiz(db, { course: "ECON301", noteIds: [B.id], length: 4 }, day(10));
    const target = listQuestions(db, "ECON301").find((x) => x.stem === "B1?")!;
    answerQuestion(db, { runId: run1.runId, questionId: target.id, picked: [0] }, day(10));
    const out = insights(db, lectureProgress(db, [A, B, C], day(14)), studyDays(db), day(14)).filter((i) => i.kind === "missed");
    expect(out[0].text).toContain("B1?");
  });
});

describe("exams", () => {
  it("creates, validates, lists soonest first, and deletes", () => {
    const db = studyDb(tmp());
    const e2 = createExam(db, { course: "ECON301", name: "Exam 2", date: "2026-11-12", from: "2026-10-06" }, day(10));
    const mac = createExam(db, { course: "ECON300", name: "Exam 2", date: "2026-11-17", from: "2026-10-13", to: "2026-11-05" }, day(10));
    expect(listExams(db, "all", day(10)).map((e) => e.course)).toEqual(["ECON301", "ECON300"]);
    expect(listExams(db, "ECON300", day(10))).toHaveLength(1);
    expect(listExams(db, "all", day(13)).map((e) => e.course)).toEqual(["ECON300"]); // Micro's is over
    expect(listExams(db, "all", day(13), true)).toHaveLength(2);
    expect(daysUntil(e2, day(10))).toBe(2);
    expect(daysUntil(mac, day(10))).toBe(7);
    expect(getExam(db, e2.id)).toMatchObject({ name: "Exam 2", from: "2026-10-06", to: null, dateMs: dayStart("2026-11-12") });
    const bad = (o: object) => () => createExam(db, { course: "ECON301", name: "x", date: "2026-11-12", from: "2026-10-06", ...o });
    expect(bad({ name: " " })).toThrow(ExamError);
    expect(bad({ date: "soon" })).toThrow(/exam date/);
    expect(bad({ from: "" })).toThrow(/first lecture/);
    expect(bad({ to: "2026-09-01" })).toThrow(/before the first/);
    expect(() => createExam(db, { course: "all", name: "x", date: "2026-11-12", from: "2026-10-06" })).toThrow(/one class/);
    expect(deleteExam(db, e2.id)).toBe(true);
    expect(deleteExam(db, e2.id)).toBe(false);
  });

  it("covers the lectures from the first date through the last, or through the exam day", () => {
    const db = studyDb(tmp());
    const e = createExam(db, { course: "ECON301", name: "Exam 2", date: "2026-11-12", from: "2026-10-06" }, day(10));
    const notes = ["2026-10-01", "2026-10-06", "2026-11-05", "2026-11-12", "2026-11-13"].map((date) => ({ course: "ECON301", date }))
      .concat([{ course: "ECON300", date: "2026-10-20" }]);
    expect(inScope(e, notes).map((n) => n.date)).toEqual(["2026-10-06", "2026-11-05", "2026-11-12"]);
    const capped = createExam(db, { course: "ECON301", name: "x", date: "2026-11-12", from: "2026-10-06", to: "2026-11-05" });
    expect(inScope(capped, notes).map((n) => n.date)).toEqual(["2026-10-06", "2026-11-05"]);
  });
});

describe("the daily plan", () => {
  const notes: NoteRef[] = [
    { id: "ECON301/a.md", course: "ECON301", title: "Costs", date: "2026-10-08" },
    { id: "ECON301/b.md", course: "ECON301", title: "Monopoly", date: "2026-10-29" },
    { id: "ECON301/c.md", course: "ECON301", title: "Labor", date: "2026-11-03" },
    { id: "ECON300/m.md", course: "ECON300", title: "Growth", date: "2026-10-15" },
  ];
  const q = (stem: string, section: string) => ({ kind: "single" as const, stem, options: ["a", "b", "c", "d"], answer: [1], explanation: "e", quote: "q q q", section });

  it("starts with making material when lectures have none, then cards, then the weakest lecture", async () => {
    const db = studyDb(tmp());
    createExam(db, { course: "ECON301", name: "Exam 2", date: "2026-11-12", from: "2026-10-06" }, day(10));
    // only Monopoly has material, and it's weak
    addGeneratedQuestions(db, notes[1], "v1", [q("M1?", "MR"), q("M2?", "MR"), q("M3?", "MR")], day(1));
    const run = startQuiz(db, { course: "ECON301" }, day(9));
    for (const x of run.questions) answerQuestion(db, { runId: run.runId, questionId: x.id, picked: [0] }, day(9));
    const plan = buildPlan({ db, exams: listExams(db, "all", day(10)), notes, now: day(10), dueCards: () => 12, minutes: 120 });
    const kinds = plan.items.map((i) => i.kind);
    expect(kinds.slice(0, 3)).toEqual(["generate", "cards", "quiz"]);
    expect(plan.items[0].noteIds).toEqual(["ECON301/a.md", "ECON301/c.md"]);
    expect(plan.items[2]).toMatchObject({ title: "Quiz: Monopoly", noteIds: ["ECON301/b.md"] });
    expect(kinds).toContain("tutor");
    expect(kinds).toContain("exam"); // two days out
    expect(plan.plans[0]).toMatchObject({ daysLeft: 2, inScope: 3 });
    expect(plan.plans[0].readiness.confidence).toBe("low");
  });

  it("trims to the time you have and puts the sooner exam first, sharing due cards within a class", () => {
    const db = studyDb(tmp());
    createExam(db, { course: "ECON300", name: "Exam 2", date: "2026-11-17", from: "2026-10-13" }, day(10));
    createExam(db, { course: "ECON301", name: "Exam 2", date: "2026-11-12", from: "2026-10-06" }, day(10));
    createExam(db, { course: "ECON301", name: "Quiz", date: "2026-11-20", from: "2026-11-03" }, day(10));
    const roomy = buildPlan({ db, exams: listExams(db, "all", day(10)), notes, now: day(10), dueCards: () => 30, minutes: 120 });
    expect(roomy.plans.map((p) => p.exam.name + p.exam.course)).toEqual(["Exam 2ECON301", "Exam 2ECON300", "QuizECON301"]);
    expect(roomy.items.filter((i) => i.kind === "cards")).toHaveLength(2); // one per class, not one per exam
    const plan = buildPlan({ db, exams: listExams(db, "all", day(10)), notes, now: day(10), dueCards: () => 30, minutes: 20 });
    expect(plan.totalMinutes).toBeLessThanOrEqual(20);
    expect(plan.items[0].course).toBe("ECON301");
    // never empty when there is something to do, even with a tiny budget
    expect(buildPlan({ db, exams: listExams(db, "all", day(10)), notes, now: day(10), dueCards: () => 30, minutes: 1 }).items.length).toBeGreaterThan(0);
  });

  it("has nothing to plan without an exam", () => {
    const db = studyDb(tmp());
    const plan = buildPlan({ db, exams: [], notes, now: day(10), dueCards: () => 5 });
    expect(plan).toMatchObject({ plans: [], items: [], totalMinutes: 0 });
  });

  it("knows due cards even when the exam is far away: no mock exam yet", () => {
    const db = studyDb(tmp());
    createExam(db, { course: "ECON301", name: "Final", date: "2026-12-15", from: "2026-10-06" }, day(10));
    addGeneratedQuestions(db, notes[0], "v1", [q("A1?", "s")], day(1));
    const plan = buildPlan({ db, exams: listExams(db, "all", day(10)), notes, now: day(10), dueCards: () => 0, minutes: 200 });
    expect(plan.items.map((i) => i.kind)).not.toContain("exam");
    expect(counts(db, "ECON301").total).toBe(0);
  });
});
