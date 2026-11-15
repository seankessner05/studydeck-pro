import { describe, expect, it } from "vitest";
import { GraphError, axisFor, buildFigure, crossing, curveMove, equilibriumShift, parseGraph, shownNumbers } from "../src/study/graphs.js";

const adas = {
  x: { label: "Output (Y)", max: 200 },
  y: { label: "Price level (P)", max: 10 },
  curves: [
    { label: "AD", y: "8 - 0.03*x" },
    { label: "SRAS", y: "2 + 0.02*x" },
    { label: "LRAS", x: "120" },
  ],
  points: [{ label: "E1", on: ["AD", "SRAS"] }],
  values: true,
};

describe("parseGraph", () => {
  it("accepts a good spec and computes where curves cross", () => {
    const g = parseGraph(adas);
    expect(g.curves.map((c) => [c.label, c.of])).toEqual([["AD", "y"], ["SRAS", "y"], ["LRAS", "x"]]);
    expect(crossing(g.curves[0], g.curves[1], g)).toEqual({ x: 120, y: 4.4 });
    expect(crossing(g.curves[0], g.curves[2], g)).toEqual({ x: 120, y: 4.4 });
    expect(shownNumbers(g)).toEqual(["120", "4.4"]);
  });

  it("refuses specs that can't be drawn honestly", () => {
    const bad = (over: object, msg: RegExp) => expect(() => parseGraph({ ...adas, ...over })).toThrow(msg);
    bad({ x: { label: "Y" } }, /max above its min/);
    bad({ curves: [] }, /1 to 6 curves/);
    bad({ curves: [{ label: "AD", y: "8 - 0.03*x" }, { label: "AD", y: "1" }] }, /repeated/);
    bad({ curves: [{ label: "AD", y: "8 - 0.03*z" }] }, /unknown name/);
    bad({ curves: [{ label: "AD", y: "process.exit()" }] }, /AD/);
    bad({ curves: [{ label: "AD", y: "50 + x" }], points: [] }, /mostly off the graph/);
    bad({ points: [{ label: "E1", on: ["AD", "MS"] }] }, /two of the graph's curves/);
    // parallel lines never cross; a parabola meets a line twice
    bad({ curves: [{ label: "A", y: "2 + 0.01*x" }, { label: "B", y: "4 + 0.01*x" }], points: [{ label: "E", on: ["A", "B"] }] }, /don't cross/);
    bad({ curves: [{ label: "A", y: "0.001*(x-100)^2 + 2" }, { label: "B", y: "5" }], points: [{ label: "E", on: ["A", "B"] }] }, /more than once/);
    expect(() => parseGraph(null)).toThrow(GraphError);
  });

  it("ignores a crossing on the edge of the axes when one real crossing is inside (the Solow diagram)", () => {
    const solow = parseGraph({ x: { label: "k", max: 120 }, y: { label: "i", max: 12 }, curves: [{ label: "sf(k)", y: "0.9*x^0.5" }, { label: "(n+d)k", y: "0.1*x" }], points: [{ label: "SS", on: ["sf(k)", "(n+d)k"] }], values: true });
    expect(buildFigure(solow).points).toEqual([{ label: "SS", x: 81, y: 8.1 }]);
    // labels economists use: a 45° line, a starred equilibrium
    expect(() => parseGraph({ ...adas, curves: [...adas.curves, { label: "45°", y: "x / 20" }], points: [] })).not.toThrow();
  });
});

describe("buildFigure", () => {
  it("samples curves inside the axes and describes the graph in words", () => {
    const f = buildFigure(parseGraph(adas));
    expect(f.curves).toHaveLength(3);
    for (const c of f.curves) for (const seg of c.segments) for (const [x, y] of seg) {
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThanOrEqual(200);
      expect(y).toBeGreaterThanOrEqual(0);
      expect(y).toBeLessThanOrEqual(10);
    }
    expect(f.points).toEqual([{ label: "E1", x: 120, y: 4.4 }]);
    expect(f.description).toContain("AD: downward-sloping, from (0, 8) to (200, 2)");
    expect(f.description).toContain("LRAS: vertical at Output (Y) = 120");
    expect(f.description).toContain("E1 where AD meets SRAS, at Output (Y) = 120, Price level (P) = 4.4");
  });

  it("without values, says where points are relative to each other, not their numbers", () => {
    const g = parseGraph({ ...adas, curves: [...adas.curves, { label: "AD2", y: "9 - 0.03*x" }], points: [{ label: "E1", on: ["AD", "SRAS"] }, { label: "E2", on: ["AD2", "SRAS"] }], values: false });
    const f = buildFigure(g);
    expect(f.description).toContain("E2 where AD2 meets SRAS, right of and above E1");
    expect(f.description).not.toContain("4.4");
    expect(shownNumbers(g)).toEqual([]);
  });

  it("draws the moved curves only when asked", () => {
    const g = parseGraph({ ...adas, curves: [{ label: "AD", y: "8 - 0.03*x", after: "9 - 0.03*x" }, adas.curves[1]] });
    expect(buildFigure(g).curves.map((c) => c.label)).toEqual(["AD", "SRAS"]);
    const both = buildFigure(g, { showAfter: true });
    expect(both.curves.map((c) => [c.label, c.dashed])).toEqual([["AD", false], ["SRAS", false], ["AD′", true]]);
  });
});

describe("what a change does, worked out by the app", () => {
  it("knows a downward-sloping curve moving up has also moved right, and where equilibrium goes", () => {
    const g = parseGraph({ ...adas, curves: [{ label: "AD", y: "8 - 0.03*x", after: "9 - 0.03*x" }, adas.curves[1]] });
    expect([...curveMove(g.curves[0], g)].sort()).toEqual(["right", "up"]);
    expect([...curveMove(g.curves[1], g)]).toEqual(["none"]);
    const eq = equilibriumShift(g)!;
    expect(eq).toMatchObject({ x: "up", y: "up", before: { x: 120, y: 4.4 }, after: { x: 140, y: 4.8 } });
  });

  it("an upward-sloping curve moving up has moved left; a vertical line moves right; slopes change", () => {
    const g = parseGraph({
      x: { label: "Real money balances (M/P)", max: 100 }, y: { label: "Interest rate (r)", max: 20 },
      curves: [{ label: "SRAS", y: "2 + 0.1*x", after: "4 + 0.1*x" }, { label: "MS", x: "50", after: "60" }, { label: "L", y: "15 - 0.1*x", after: "15 - 0.2*x" }],
      points: [{ label: "E", on: ["L", "MS"] }], values: false,
    });
    expect([...curveMove(g.curves[0], g)].sort()).toEqual(["left", "up"]);
    expect([...curveMove(g.curves[1], g)]).toEqual(["right"]);
    expect(curveMove(g.curves[2], g).has("steeper")).toBe(true);
    expect(equilibriumShift(g)).toMatchObject({ x: "up", y: "down" });
  });

  it("matches a variable name to an axis loosely, and only when there is one match", () => {
    const g = parseGraph(adas);
    expect(axisFor("output", g)).toBe("x");
    expect(axisFor("Y", g)).toBe("x");
    expect(axisFor("price level", g)).toBe("y");
    expect(axisFor("interest rate", g)).toBeUndefined();
  });
});

describe("graphs on generated questions and problems", async () => {
  const path = await import("node:path");
  const fs = await import("node:fs");
  const os = await import("node:os");
  const { loadNotes } = await import("../src/notes");
  const { validateQuestions, buildSolverPrompts } = await import("../src/study/quizgen");
  const { validateProblems, buildProblemSolverPrompts } = await import("../src/study/problemgen");
  const { studyDb, closeStudyDbs } = await import("../src/study/db");
  const { addGeneratedQuestions, getQuestion } = await import("../src/study/questions");
  const fiscal = loadNotes("all", path.resolve("sample-notes")).find((n) => n.file.includes("fiscal-multipliers"))!;
  const quote = "With MPC = 0.8 the multiplier is 1 / (1 − 0.8) = 5.";
  const shifted = { ...adas, curves: [adas.curves[0], adas.curves[1], { label: "AD2", y: "9 - 0.03*x", dashed: true }], points: [{ label: "E1", on: ["AD", "SRAS"] }, { label: "E2", on: ["AD2", "SRAS"] }] };
  const q = (over: object) => ({
    kind: "single", stem: "Government spending rises, moving demand from curve AD to curve AD2 on the graph. Where is the new short-run equilibrium?",
    options: ["At point E2", "At point E1", "Where AD2 meets LRAS", "Where AD meets LRAS"], answer: ["A"],
    explanation: "Output rises from 120 to 140 as the economy moves along SRAS to point E2.", quote, graph: shifted, ...over,
  });

  it("a question may name its own graph's labels and use the values marked on it", () => {
    const r = validateQuestions([q({})], fiscal, [], 5, () => 0.999);
    expect(r.rejected).toEqual([]);
    expect(r.accepted[0].graph?.curves.map((c) => c.label)).toEqual(["AD", "SRAS", "AD2"]);
  });

  it("without the graph, the same question points at something unseen; with a broken graph it is rejected", () => {
    const noGraph = validateQuestions([q({ graph: undefined, stem: "Demand moves from AD to AD2. Where is the new equilibrium, point E or point F?" })], fiscal, [], 5);
    expect(noGraph.rejected[0].reason).toBe("not_self_contained");
    const broken = validateQuestions([q({ graph: { ...shifted, points: [{ label: "E1", on: ["AD", "AD2"] }] } })], fiscal, [], 5);
    expect(broken.rejected[0]).toMatchObject({ reason: "bad_graph", detail: "AD and AD2 don't cross on the graph" });
  });

  it("numbers in the answer must be marked on the graph or in the stem", () => {
    const hidden = validateQuestions([q({ graph: { ...shifted, values: false } })], fiscal, [], 5);
    expect(hidden.rejected[0]).toMatchObject({ reason: "number_not_in_note" });
  });

  it("the no-notes solver reads the graph in words", () => {
    const { accepted } = validateQuestions([q({})], fiscal, [], 5, () => 0.999);
    const { prompt } = buildSolverPrompts(fiscal, accepted);
    expect(prompt).toContain("[Graph: horizontal axis Output (Y)");
    expect(prompt).toContain("E2 where AD2 meets SRAS, at Output (Y) = 140");
  });

  it("a practice problem can take its givens from values marked on the graph", () => {
    const p = { stem: "The graph shows an economy's AD and SRAS curves. If prices rise by 10% from the equilibrium price level, what is the new price level?", givens: [{ name: "p0", value: 4.4, label: "equilibrium price level" }, { name: "g", value: 10, label: "percent rise" }], steps: [{ name: "p1", label: "new price level", expr: "p0 * (1 + g/100)", explain: "Raise by 10%." }], unit: "", quote, graph: adas };
    const ok = validateProblems([p], fiscal, [], 3);
    expect(ok.rejected).toEqual([]);
    expect(ok.accepted[0].answer).toBeCloseTo(4.84);
    expect(buildProblemSolverPrompts(fiscal, ok.accepted).prompt).toContain("Price level (P) = 4.4");
    const hidden = validateProblems([{ ...p, graph: { ...adas, values: false } }], fiscal, [], 3);
    expect(hidden.rejected[0].reason).toBe("given_not_in_stem");
  });

  it("is saved with the question and comes back as a drawn figure", () => {
    const db = studyDb(fs.mkdtempSync(path.join(os.tmpdir(), "sd-graph-")));
    const { accepted } = validateQuestions([q({})], fiscal, [], 5, () => 0.999);
    addGeneratedQuestions(db, { id: fiscal.id, course: fiscal.course }, "v1", accepted);
    const id = (db.prepare("SELECT id FROM questions").get() as { id: string }).id;
    const row = getQuestion(db, id)!;
    expect(row.figure?.points.map((p) => p.label)).toEqual(["E1", "E2"]);
    expect(row.figure?.description).toContain("AD2 (dashed)");
    closeStudyDbs();
  });
});
