import { describe, expect, it } from "vitest";
import { formulas, mathProblem, plainMath, repairLatexEscapes } from "../src/study/mathtext.js";
import { parseJsonList } from "../src/study/cardgen.js";

describe("repairLatexEscapes", () => {
  it("leaves valid JSON exactly as it was", () => {
    const ok = '[{"stem":"Line one\\nLine two \\"quoted\\" \\\\(x\\\\) caf\\u00e9 a\\/b","n":1}]';
    expect(repairLatexEscapes(ok)).toBe(ok);
    expect(JSON.parse(repairLatexEscapes(ok))[0].stem).toBe('Line one\nLine two "quoted" \\(x\\) café a/b');
  });

  it("rescues single-backslash LaTeX that would break or silently corrupt JSON.parse", () => {
    const raw = '[{"stem":"If \\(MPC = 0.8\\), the multiplier is \\(\\frac{1}{1 - MPC}\\) and \\(a \\times b \\neq \\theta\\), \\[\\Delta Y\\]"}]';
    expect(() => JSON.parse(raw)).toThrow(); // "\(" is not a JSON escape
    const stem = (JSON.parse(repairLatexEscapes(raw)) as { stem: string }[])[0].stem;
    expect(stem).toBe("If \\(MPC = 0.8\\), the multiplier is \\(\\frac{1}{1 - MPC}\\) and \\(a \\times b \\neq \\theta\\), \\[\\Delta Y\\]");
    expect(stem).not.toMatch(/[\f\t\b]/);
  });

  it("keeps a real newline before an ordinary word", () => {
    const raw = '{"a":"first\\nnext \\(\\nu\\)\\tTab"}';
    expect(JSON.parse(repairLatexEscapes(raw)).a).toBe("first\nnext \\(\\nu\\)\tTab");
  });

  it("is used by the shared reply parser", () => {
    const reply = 'Here you go:\n```json\n[{"front":"What is \\(\\frac{a}{b}\\)?"}]\n```';
    expect(parseJsonList(reply, "cards", "cards")).toEqual([{ front: "What is \\(\\frac{a}{b}\\)?" }]);
  });
});

describe("mathProblem", () => {
  it("accepts text without math, dollar amounts and good formulas", () => {
    expect(mathProblem("A $5 tax on a $20 good")).toBeUndefined();
    expect(mathProblem("The multiplier is \\(\\frac{1}{1 - c(1 - t)}\\) and \\[Y = C + I + G\\]")).toBeUndefined();
  });

  it("rejects unmatched delimiters, empty formulas and LaTeX KaTeX can't typeset", () => {
    expect(mathProblem("\\(x + 1")).toMatch(/unmatched/);
    expect(mathProblem("x + 1\\)")).toMatch(/unmatched/);
    expect(mathProblem("\\( \\)")).toBe("empty formula");
    expect(mathProblem("\\(\\frac{1}{\\)")).toMatch(/can't typeset/);
    expect(mathProblem("\\(\\notacommand{x}\\)")).toMatch(/can't typeset/);
  });
});

describe("plainMath", () => {
  it("writes formulas out as plain text for the word and number checks", () => {
    expect(plainMath("so \\(\\frac{1}{1 - 0.8} = 5\\)")).toBe("so (1)/(1 - 0.8) = 5");
    expect(plainMath("\\(\\Delta Y = \\frac{\\Delta G}{1 - MPC}\\)")).toBe("ΔY = (ΔG)/(1 - MPC)");
    expect(plainMath("\\(Q^{2} + \\bar{K} \\times L_{t}\\)")).toBe("Q^2 + K × L_t");
    expect(plainMath("\\(\\frac{\\frac{1}{2}}{3}\\)")).toBe("((1)/(2))/(3)");
    expect(plainMath("\\(\\text{GDP} \\geq 100\\%\\)")).toBe("GDP ≥ 100%");
    expect(plainMath("no math, $5")).toBe("no math, $5");
  });

  it("lists the formulas with their kind", () => {
    expect(formulas("a \\(x\\) b \\[y\\]")).toEqual([{ tex: "x", display: false }, { tex: "y", display: true }]);
  });
});

describe("every generator checks its math in code", async () => {
  const path = await import("node:path");
  const { loadNotes } = await import("../src/notes");
  const { validateQuestions } = await import("../src/study/quizgen");
  const { validateCards } = await import("../src/study/cardgen");
  const { validateProblems } = await import("../src/study/problemgen");
  const fiscal = loadNotes("all", path.resolve("sample-notes")).find((n) => n.file.includes("fiscal-multipliers"))!;
  const quote = "With MPC = 0.8 the multiplier is 1 / (1 − 0.8) = 5.";
  const question = (stem: string) => ({
    kind: "single", stem, options: ["\\(5\\)", "\\(2.5\\)", "\\(0.8\\)", "\\(1.25\\)"], answer: ["A"],
    explanation: "The multiplier is \\(\\frac{1}{1 - 0.8} = 5\\).", quote,
  });

  it("quiz questions: good LaTeX passes and its numbers are still checked; broken LaTeX is rejected", () => {
    const ok = validateQuestions([question("A country's households spend \\(MPC = 0.8\\) of extra income. What is the simple spending multiplier \\(\\frac{1}{1 - MPC}\\)?")], fiscal, [], 5, () => 0.999);
    expect(ok.rejected).toEqual([]);
    expect(ok.accepted[0].stem).toContain("\\(MPC = 0.8\\)");
    const broken = validateQuestions([question("Households spend \\(MPC = 0.8\\) of extra income. What is \\(\\frac{1}{1 - MPC\\)?")], fiscal, [], 5);
    expect(broken.rejected[0].reason).toBe("bad_math");
    const stray = validateQuestions([{ ...question("Households spend \\(MPC = 0.8\\) of extra income. What is the simple spending multiplier?"), explanation: "It is \\(\\frac{1}{0.2} = 5.75\\)." }], fiscal, [], 5);
    expect(stray.rejected[0]).toMatchObject({ reason: "number_not_in_note", detail: "0.2, 5.75" });
  });

  it("flashcards reject broken formulas", () => {
    const r = validateCards([{ front: "What is the multiplier when \\(MPC = 0.8\\)?", back: "\\(\\frac{1}{1 - 0.8\\)", quote }], fiscal, [], 5);
    expect(r.rejected[0].reason).toBe("bad_math");
    const ok = validateCards([{ front: "What is the multiplier when \\(MPC = 0.8\\)?", back: "\\(\\frac{1}{1 - 0.8} = 5\\)", quote }], fiscal, [], 5);
    expect(ok.accepted).toHaveLength(1);
  });

  it("practice problems read givens through the formulas, and reject broken ones", () => {
    const problem = (stem: string) => ({ stem, givens: [{ name: "mpc", value: 0.6, label: "MPC" }, { name: "dg", value: 40, label: "spending" }], steps: [{ name: "m", label: "multiplier", expr: "1/(1-mpc)", explain: "The multiplier is \\(\\frac{1}{1 - MPC}\\)." }, { name: "dy", label: "change in GDP", expr: "m*dg", explain: "Multiply." }], unit: "", quote });
    const ok = validateProblems([problem("An economy has \\(MPC = 0.6\\). Government spending rises by \\(\\Delta G = 40\\). By how much does GDP rise?")], fiscal, [], 3);
    expect(ok.rejected).toEqual([]);
    expect(ok.accepted[0].answer).toBeCloseTo(100);
    const bad = validateProblems([problem("An economy has \\(MPC = 0.6\\). Spending rises by 40. By how much does \\(\\Delta Y\\ rise?")], fiscal, [], 3);
    expect(bad.rejected[0].reason).toBe("bad_math");
  });
});
