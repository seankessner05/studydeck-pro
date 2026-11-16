import { describe, expect, it } from "vitest";
import { DEFAULT_COURSES } from "../src/courses";
import type { Note } from "../src/notes";
import { MATERIAL_GUIDANCE, materialGuidance } from "../src/profiles";
import { buildCardPrompts } from "../src/study/cardgen";
import { buildQuestionPrompts } from "../src/study/quizgen";
import { buildProblemPrompts } from "../src/study/problemgen";

const note = (course: string): Note => ({ id: `${course}/x.md`, course, file: "x.md", date: "2026-11-01", title: "Lecture", sample: false, body: "# Lecture\n- Something taught" } as Note);

describe("subject-aware material", () => {
  it("has guidance for every kind of class and every kind of material", () => {
    for (const p of Object.values(MATERIAL_GUIDANCE)) for (const k of ["cards", "quiz", "problems"] as const) expect(p[k].length).toBeGreaterThan(40);
  });

  it("gives each class its own subject guidance in every generator", () => {
    const acc = buildQuestionPrompts(note("ECON196"), { density: "normal", courses: DEFAULT_COURSES }).system;
    expect(acc).toContain("SUBJECT");
    expect(acc).toContain("journal entry");
    const econ = buildQuestionPrompts(note("ECON300"), { density: "normal", courses: DEFAULT_COURSES }).system;
    expect(econ).toContain("which model or graph fits");
    expect(econ).not.toContain("journal entry");
    expect(buildCardPrompts(note("MGMT220"), { density: "normal", courses: DEFAULT_COURSES }).system).toContain("frameworks");
    expect(buildProblemPrompts(note("MGMT220"), { density: "normal", courses: DEFAULT_COURSES }).system).toContain("empty array []");
    expect(buildProblemPrompts(note("ECON196"), { density: "normal", courses: DEFAULT_COURSES }).system).toContain("FIFO");
  });

  it("says nothing for an unknown class", () => {
    expect(materialGuidance(DEFAULT_COURSES, "NOPE", "quiz")).toBe("");
  });
});
