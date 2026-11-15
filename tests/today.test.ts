import { describe, it, expect, afterAll } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { closeStudyDbs, studyDb } from "../src/study/db";
import { addGeneratedQuestions } from "../src/study/questions";
import { addGeneratedCards } from "../src/study/cards";
import { createExam } from "../src/study/exams";
import { buildPlan, cramFor, lectureProgress, readinessNext } from "../src/study/mastery";
import type { GeneratedQuestion } from "../src/study/quizgen";

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "sd-today-"));
afterAll(() => closeStudyDbs());
const day = (d: number) => new Date(2026, 10, d, 10);
const q = (stem: string): GeneratedQuestion => ({ kind: "single", stem, options: ["a", "b", "c", "d"], answer: [0], explanation: "x", quote: "y", section: "S" });

describe("cram mode", () => {
  it("is on only for an exam within three days, and picks the soonest", () => {
    const db = studyDb(tmp());
    const macro = createExam(db, { course: "ECON300", name: "Exam 2", date: "2026-11-17", from: "2026-10-13" }, day(1));
    const micro = createExam(db, { course: "ECON301", name: "Final", date: "2026-12-10", from: "2026-11-01" }, day(1));
    expect(cramFor([macro, micro], day(10))).toBeUndefined();
    expect(cramFor([macro, micro], day(14))).toMatchObject({ examId: macro.id, course: "ECON300", daysLeft: 3 });
    expect(cramFor([macro, micro], day(17))).toMatchObject({ daysLeft: 0 });
    expect(cramFor([macro, micro], day(18))).toBeUndefined(); // the exam is over
  });

  it("puts the cram exam first, practice before due cards, and drops material-making", async () => {
    const db = studyDb(tmp());
    const notes = [
      { id: "ECON300/a.md", course: "ECON300", title: "IS-LM", date: "2026-11-05" },
      { id: "ECON300/b.md", course: "ECON300", title: "No material yet", date: "2026-11-10" },
      { id: "ECON301/c.md", course: "ECON301", title: "Monopoly", date: "2026-11-05" },
    ];
    addGeneratedQuestions(db, { id: "ECON300/a.md", course: "ECON300" }, "v1", [q("One?"), q("Two?")], day(1));
    await addGeneratedCards(db, { id: "ECON301/c.md", course: "ECON301" }, "v1", [{ front: "F", back: "B", quote: "q", section: "S" }], day(1));
    const macro = createExam(db, { course: "ECON300", name: "Exam 2", date: "2026-11-17", from: "2026-10-13" }, day(1));
    const micro = createExam(db, { course: "ECON301", name: "Final", date: "2026-11-16", from: "2026-11-01" }, day(1));
    // without cram (a week out) material-making leads
    const calm = buildPlan({ db, exams: [macro], notes, minutes: 120, now: day(9), dueCards: () => 5 });
    expect(calm.cram).toBeNull();
    expect(calm.items[0].kind).toBe("generate");
    // two days before Micro's final and three before Macro: Micro's comes first (soonest), no generate step anywhere in it
    const cram = buildPlan({ db, exams: [macro, micro], notes, minutes: 120, now: day(14), dueCards: () => 5 });
    expect(cram.cram).toMatchObject({ course: "ECON301", daysLeft: 2 });
    expect(cram.plans[0].exam.id).toBe(micro.id);
    expect(cram.plans[0].items.some((i) => i.kind === "generate")).toBe(false);
    const cardsStep = cram.plans[0].items.find((i) => i.kind === "cards")!;
    expect(cardsStep.minutes).toBeLessThanOrEqual(15);
    expect(cardsStep.detail).toMatch(/^Cram mode/);
  });

  it("says what would raise readiness the most", async () => {
    const db = studyDb(tmp());
    const notes = [{ id: "ECON300/a.md", course: "ECON300", title: "IS-LM", date: "2026-11-05" }, { id: "ECON300/b.md", course: "ECON300", title: "AD-AS", date: "2026-11-06" }];
    addGeneratedQuestions(db, { id: "ECON300/a.md", course: "ECON300" }, "v1", [q("One?")], day(1));
    const next = readinessNext(lectureProgress(db, notes, day(14)));
    expect(next).toContain("“IS-LM”");
    expect(next).toMatch(/haven't practiced/);
    expect(readinessNext(lectureProgress(db, [notes[1]], day(14)))).toMatch(/no cards or questions yet/);
  });

  it("includes new cards in the plan, not only due ones", async () => {
    const db = studyDb(tmp());
    const notes = [{ id: "ECON300/a.md", course: "ECON300", title: "IS-LM", date: "2026-11-05" }];
    const exam = createExam(db, { course: "ECON300", name: "Exam 2", date: "2026-11-30", from: "2026-10-13" }, day(1));
    const onlyNew = buildPlan({ db, exams: [exam], notes, minutes: 120, now: day(14), dueCards: () => 0, newCards: () => 30 });
    expect(onlyNew.items.find((i) => i.kind === "cards")).toMatchObject({ title: "Learn 30 new cards" });
    const both = buildPlan({ db, exams: [exam], notes, minutes: 120, now: day(14), dueCards: () => 5, newCards: () => 10 });
    expect(both.items.find((i) => i.kind === "cards")).toMatchObject({ title: "Study 15 cards", detail: expect.stringContaining("5 due now, 10 new") });
    expect(buildPlan({ db, exams: [exam], notes, minutes: 120, now: day(14), dueCards: () => 0, newCards: () => 0 }).items.some((i) => i.kind === "cards")).toBe(false);
  });
});
