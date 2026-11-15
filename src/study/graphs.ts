import { compute } from "./problemgen.js";

/**
 * Graphs from computed specs. Claude never draws: it describes each curve as an equation, the app evaluates it,
 * finds where curves cross, checks that everything named is really on the graph, and sends the browser a ready-made
 * figure (sampled points) to draw. The no-notes solver gets a written description of exactly what the student sees.
 *
 * A spec, as Claude writes it:
 *   { "x": {"label": "Output (Y)", "max": 200}, "y": {"label": "Price level (P)", "max": 10},
 *     "curves": [ {"label": "AD", "y": "8 - 0.03*x"}, {"label": "SRAS", "y": "2 + 0.02*x"}, {"label": "LRAS", "x": "120"} ],
 *     "points": [ {"label": "E1", "on": ["AD", "SRAS"]} ],
 *     "values": true }
 * A curve is "y" as a function of x, or "x" as a function of y (so vertical lines and x = f(y) work).
 * A curve may also have "after": the same kind of expression for where it ends up after a change. The app compares
 * the two to work out which way it moved, and where the equilibrium went.
 */

export interface AxisSpec {
  label: string;
  min: number;
  max: number;
}
export interface CurveSpec {
  label: string;
  /** "y": y = f(x); "x": x = f(y) */
  of: "x" | "y";
  expr: string;
  after?: string;
  dashed: boolean;
}
export interface PointSpec {
  label: string;
  on: [string, string];
}
export interface GraphSpec {
  x: AxisSpec;
  y: AxisSpec;
  curves: CurveSpec[];
  points: PointSpec[];
  /** Show the points' coordinates on the axes (dashed guides). Without it the student sees positions only. */
  values: boolean;
}

/** What the browser draws: everything already computed. */
export interface Figure {
  x: AxisSpec;
  y: AxisSpec;
  curves: { label: string; dashed: boolean; after: boolean; segments: [number, number][][]; labelAt: [number, number] }[];
  points: { label: string; x: number; y: number }[];
  values: boolean;
  /** The same graph in words, for screen readers and for the no-notes solver. */
  description: string;
}

export class GraphError extends Error {}

const MAX_CURVES = 6;
const MAX_POINTS = 4;
const SAMPLES = 200;
// Letters (Greek too: δ, π, Δ), digits, subscripts and the symbols economists put in curve names: AD′, L(r,Y), (δ+n+g)k, 45°.
const LABEL = /^[A-Za-z0-9(\u0391-\u03c9][A-Za-z0-9\u0391-\u03c9 ()'’′_₀-₉,./=+*°-]{0,23}$/;

const num = (v: unknown): number | undefined => (typeof v === "number" && Number.isFinite(v) ? v : typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v)) ? Number(v) : undefined);
const text = (v: unknown, max: number) => (typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, max) : "");

function axis(v: unknown, which: string): AxisSpec {
  const a = (v && typeof v === "object" ? v : {}) as Record<string, unknown>;
  const label = text(a.label, 60);
  const min = num(a.min) ?? 0;
  const max = num(a.max);
  if (!label) throw new GraphError(`the ${which} axis has no label`);
  if (max === undefined || !(max > min) || Math.abs(max) > 1e9 || Math.abs(min) > 1e9) throw new GraphError(`the ${which} axis needs a max above its min`);
  return { label, min, max };
}

/** Evaluate one curve expression at t (x for a "y" curve, y for an "x" curve). Only arithmetic in x or y. */
function at(expr: string, of: "x" | "y", t: number): number | undefined {
  const r = compute(expr, { [of === "y" ? "x" : "y"]: t });
  return "value" in r ? r.value : undefined;
}

/** Check a spec Claude wrote and return it in the app's own shape. Throws GraphError with a reason. */
export function parseGraph(raw: unknown): GraphSpec {
  const g = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const x = axis(g.x, "horizontal");
  const y = axis(g.y, "vertical");
  const rawCurves = Array.isArray(g.curves) ? g.curves : [];
  if (!rawCurves.length || rawCurves.length > MAX_CURVES) throw new GraphError(`a graph needs 1 to ${MAX_CURVES} curves`);
  const curves: CurveSpec[] = [];
  for (const c of rawCurves) {
    const cc = (c && typeof c === "object" ? c : {}) as Record<string, unknown>;
    const label = text(cc.label, 24);
    if (!LABEL.test(label) || curves.some((k) => k.label === label)) throw new GraphError(`curve label “${label}” is missing, too long or repeated`);
    const of: "x" | "y" | undefined = typeof cc.y === "string" || typeof cc.y === "number" ? "y" : typeof cc.x === "string" || typeof cc.x === "number" ? "x" : undefined;
    if (!of) throw new GraphError(`curve ${label} has no "y" or "x" equation`);
    const expr = String(of === "y" ? cc.y : cc.x).trim();
    const after = cc.after === undefined || cc.after === null || cc.after === "" ? undefined : String(cc.after).trim();
    const dom = of === "y" ? x : y;
    for (const e of after === undefined ? [expr] : [expr, after]) {
      const mid = (dom.min + dom.max) / 2;
      const r = compute(e, { [of === "y" ? "x" : "y"]: mid });
      if ("error" in r) throw new GraphError(`curve ${label}: ${r.error}`);
    }
    curves.push({ label, of, expr, after, dashed: cc.dashed === true });
  }
  const rawPoints = Array.isArray(g.points) ? g.points : [];
  if (rawPoints.length > MAX_POINTS) throw new GraphError(`at most ${MAX_POINTS} labelled points`);
  const points: PointSpec[] = [];
  for (const p of rawPoints) {
    const pp = (p && typeof p === "object" ? p : {}) as Record<string, unknown>;
    const label = text(pp.label, 12);
    const on = Array.isArray(pp.on) ? pp.on.map((s) => text(s, 24)) : [];
    if (!LABEL.test(label) || points.some((k) => k.label === label) || curves.some((k) => k.label === label)) throw new GraphError(`point label “${label}” is missing or repeated`);
    if (on.length !== 2 || on[0] === on[1] || !on.every((l) => curves.some((k) => k.label === l))) throw new GraphError(`point ${label} must sit on two of the graph's curves`);
    points.push({ label, on: [on[0], on[1]] });
  }
  const spec: GraphSpec = { x, y, curves, points, values: g.values === true };
  // Draw it once now, so a curve that never shows or a point that isn't really on the graph is caught before saving.
  buildFigure(spec);
  return spec;
}

/** Where a curve is, as points (x, y), sampled across the graph. "after" picks the moved position. */
function sample(c: CurveSpec, g: GraphSpec, after = false): [number, number][] {
  const expr = after ? c.after ?? c.expr : c.expr;
  const dom = c.of === "y" ? g.x : g.y;
  const out: [number, number][] = [];
  for (let i = 0; i <= SAMPLES; i++) {
    const t = dom.min + ((dom.max - dom.min) * i) / SAMPLES;
    const v = at(expr, c.of, t);
    if (v === undefined) continue;
    out.push(c.of === "y" ? [t, v] : [v, t]);
  }
  return out;
}

const inside = (g: GraphSpec, [px, py]: [number, number], slack = 0) =>
  px >= g.x.min - slack * (g.x.max - g.x.min) && px <= g.x.max + slack * (g.x.max - g.x.min) && py >= g.y.min - slack * (g.y.max - g.y.min) && py <= g.y.max + slack * (g.y.max - g.y.min);

/** The visible pieces of a curve, clipped to the graph. */
function segments(pts: [number, number][], g: GraphSpec): [number, number][][] {
  const segs: [number, number][][] = [];
  let cur: [number, number][] = [];
  for (const p of pts) {
    if (inside(g, p)) cur.push(p);
    else if (cur.length) { segs.push(cur); cur = []; }
  }
  if (cur.length) segs.push(cur);
  return segs.filter((s) => s.length >= 2);
}

/**
 * Where two curves cross inside the graph. Exactly one crossing is required: a point that is off the graph, missing,
 * or ambiguous is an error, not something to guess about.
 */
export function crossing(a: CurveSpec, b: CurveSpec, g: GraphSpec, after = false): { x: number; y: number } {
  const ea = after ? a.after ?? a.expr : a.expr;
  const eb = after ? b.after ?? b.expr : b.expr;
  // Parametrise along x if either curve is y = f(x), else along y. h(t) = 0 where they meet.
  const alongX = a.of === "y" || b.of === "y";
  const dom = alongX ? g.x : g.y;
  const pointAt = (t: number): { x: number; y: number } | undefined => {
    if (alongX) {
      const yc = a.of === "y" ? a : b; // a y-curve gives y at this x
      const ey = yc === a ? ea : eb;
      const yv = at(ey, "y", t);
      return yv === undefined ? undefined : { x: t, y: yv };
    }
    const yv = t;
    const xv = at(ea, "x", yv);
    return xv === undefined ? undefined : { x: xv, y: yv };
  };
  const h = (t: number): number | undefined => {
    if (alongX) {
      if (a.of === "y" && b.of === "y") {
        const ya = at(ea, "y", t), yb = at(eb, "y", t);
        return ya === undefined || yb === undefined ? undefined : ya - yb;
      }
      // one y-curve, one x-curve: does the x-curve's x at this y equal t?
      const [ey, ex] = a.of === "y" ? [ea, eb] : [eb, ea];
      const yv = at(ey, "y", t);
      if (yv === undefined) return undefined;
      const xv = at(ex, "x", yv);
      return xv === undefined ? undefined : xv - t;
    }
    const xa = at(ea, "x", t), xb = at(eb, "x", t);
    return xa === undefined || xb === undefined ? undefined : xa - xb;
  };
  const roots: number[] = [];
  const steps = 800;
  let prevT = dom.min;
  let prev = h(prevT);
  if (prev === 0) roots.push(prevT);
  for (let i = 1; i <= steps; i++) {
    const t = dom.min + ((dom.max - dom.min) * i) / steps;
    const v = h(t);
    if (v !== undefined && prev !== undefined) {
      if (v === 0) roots.push(t);
      else if (Math.sign(v) !== Math.sign(prev) && prev !== 0) {
        let lo = prevT, hi = t, flo = prev;
        for (let k = 0; k < 80; k++) {
          const mid = (lo + hi) / 2;
          const fm = h(mid);
          if (fm === undefined) break;
          if (Math.sign(fm) === Math.sign(flo)) { lo = mid; flo = fm; } else hi = mid;
        }
        roots.push((lo + hi) / 2);
      }
    }
    prevT = t;
    prev = v;
  }
  const found = roots.map(pointAt).filter((p): p is { x: number; y: number } => !!p && inside(g, [p.x, p.y], 1e-9));
  // the same crossing found twice (touching a sample exactly) counts once
  const distinct = found.filter((p, i) => found.findIndex((q) => Math.abs(q.x - p.x) <= 1e-6 * (g.x.max - g.x.min) && Math.abs(q.y - p.y) <= 1e-6 * (g.y.max - g.y.min)) === i);
  const name = `${a.label}${after && (a.after || b.after) ? "′" : ""} and ${b.label}${after && (a.after || b.after) ? "′" : ""}`;
  if (!distinct.length) throw new GraphError(`${name} don't cross on the graph`);
  // A crossing on the edge of the axes (the origin of a Solow diagram, where both curves start) is not the point
  // anyone labels: when exactly one crossing is inside the graph, that is the one.
  const onEdge = (p: { x: number; y: number }) =>
    [g.x.min, g.x.max].some((v) => Math.abs(p.x - v) <= 1e-6 * (g.x.max - g.x.min)) || [g.y.min, g.y.max].some((v) => Math.abs(p.y - v) <= 1e-6 * (g.y.max - g.y.min));
  const interior = distinct.filter((p) => !onEdge(p));
  const chosen = distinct.length === 1 ? distinct : interior.length === 1 ? interior : [];
  if (!chosen.length) throw new GraphError(`${name} cross more than once on the graph`);
  return { x: round(chosen[0].x), y: round(chosen[0].y) };
}

/** Coordinates as a student would read them off the graph: 4 significant figures. */
export const round = (v: number) => (Math.abs(v) < 1e-9 ? 0 : Number(v.toPrecision(4)));
const fmt = (v: number) => String(round(v));

function slopeWord(pts: [number, number][]): string {
  if (pts.length < 2) return "";
  const [x0, y0] = pts[0];
  const [x1, y1] = pts[pts.length - 1];
  if (Math.abs(x1 - x0) < 1e-12) return "vertical";
  if (Math.abs(y1 - y0) < 1e-12) return "horizontal";
  const s = (y1 - y0) / (x1 - x0);
  // straight or curved: compare the middle sample with the chord
  const mid = pts[Math.floor(pts.length / 2)];
  const chordY = y0 + s * (mid[0] - x0);
  const bent = Math.abs(mid[1] - chordY) > 0.02 * Math.max(1e-9, Math.abs(y1 - y0)) ? " curve" : "";
  return `${s > 0 ? "upward" : "downward"}-sloping${bent}`;
}

/** Turn a checked spec into the figure the browser draws. Throws GraphError when something named isn't visible. */
export function buildFigure(spec: GraphSpec, opts: { showAfter?: boolean } = {}): Figure {
  const curves: Figure["curves"] = [];
  const lines: string[] = [];
  const draw = (c: CurveSpec, after: boolean) => {
    const segs = segments(sample(c, spec, after), spec);
    const label = after ? `${c.label}′` : c.label;
    const shown = segs.reduce((n, s) => n + s.length, 0);
    if (shown < 0.15 * SAMPLES) throw new GraphError(`curve ${label} is mostly off the graph`);
    const last = segs[segs.length - 1];
    const first = segs[0][0];
    const end = last[last.length - 1];
    curves.push({ label, dashed: c.dashed || after, after, segments: segs.map((s) => s.map(([a, b]) => [round(a), round(b)] as [number, number])), labelAt: [round(end[0]), round(end[1])] });
    const shape = slopeWord(segs.flat());
    const where = shape === "vertical" ? `vertical at ${spec.x.label} = ${fmt(first[0])}` : shape === "horizontal" ? `horizontal at ${spec.y.label} = ${fmt(first[1])}` : `${shape}, from (${fmt(first[0])}, ${fmt(first[1])}) to (${fmt(end[0])}, ${fmt(end[1])})`;
    lines.push(`${label}${c.dashed || after ? " (dashed)" : ""}: ${where}`);
  };
  for (const c of spec.curves) draw(c, false);
  if (opts.showAfter) for (const c of spec.curves) if (c.after) draw(c, true);

  const byLabel = new Map(spec.curves.map((c) => [c.label, c]));
  const points = spec.points.map((p) => ({ label: p.label, ...crossing(byLabel.get(p.on[0])!, byLabel.get(p.on[1])!, spec) }));
  const pointWords = points.map((p, i) => {
    const on = `where ${spec.points[i].on.join(" meets ")}`;
    if (spec.values) return `${p.label} ${on}, at ${spec.x.label} = ${fmt(p.x)}, ${spec.y.label} = ${fmt(p.y)}`;
    if (i === 0) return `${p.label} ${on}`;
    const ref = points[0];
    const dx = p.x > ref.x ? "right of" : p.x < ref.x ? "left of" : "level with";
    const dy = p.y > ref.y ? "above" : p.y < ref.y ? "below" : "level with";
    return `${p.label} ${on}, ${dx} and ${dy} ${ref.label}`;
  });
  const description = [
    `Graph: horizontal axis ${spec.x.label} (${fmt(spec.x.min)} to ${fmt(spec.x.max)}), vertical axis ${spec.y.label} (${fmt(spec.y.min)} to ${fmt(spec.y.max)}).`,
    `Curves: ${lines.join("; ")}.`,
    points.length ? `Points: ${pointWords.join("; ")}.` : "",
  ].filter(Boolean).join(" ");
  return { x: spec.x, y: spec.y, curves, points, values: spec.values, description };
}

/** The numbers a student can read off the graph, so answers may use them. Only shown values count. */
export function shownNumbers(spec: GraphSpec): string[] {
  if (!spec.values) return [];
  const fig = buildFigure(spec);
  return fig.points.flatMap((p) => [fmt(p.x), fmt(p.y)]);
}

/** Labels the student can see on this graph: these may be named in a question ("point E1", "curve AD"). */
export const graphLabels = (spec: GraphSpec): string[] => [...spec.curves.map((c) => c.label), ...spec.points.map((p) => p.label)];

// ---------- what a change does: worked out by the app, never taken from Claude ----------

export type Move = "right" | "left" | "up" | "down" | "steeper" | "flatter" | "none";

/** How a curve moved between its spec and its "after", as every word that truthfully describes it. */
export function curveMove(c: CurveSpec, g: GraphSpec): Set<Move> {
  const moves = new Set<Move>();
  if (!c.after) return new Set(["none"]);
  const span = (d: AxisSpec) => d.max - d.min;
  const tolX = 1e-6 * span(g.x), tolY = 1e-6 * span(g.y);
  const dom = c.of === "y" ? g.x : g.y;
  const mid = (dom.min + dom.max) / 2;
  const v0 = at(c.expr, c.of, mid), v1 = at(c.after, c.of, mid);
  if (v0 === undefined || v1 === undefined) return moves;
  // the direct shift: a "y" curve moves up/down at the same x; an "x" curve moves right/left at the same y
  const d = v1 - v0;
  if (c.of === "y") { if (d > tolY) moves.add("up"); else if (d < -tolY) moves.add("down"); }
  else { if (d > tolX) moves.add("right"); else if (d < -tolX) moves.add("left"); }
  // the other direction: a sloped curve that moves up also moves sideways (a downward-sloping curve moving up moves right)
  const h = 1e-3 * (dom.max - dom.min);
  const slope0 = ((at(c.expr, c.of, mid + h) ?? v0) - (at(c.expr, c.of, mid - h) ?? v0)) / (2 * h);
  const slope1 = ((at(c.after, c.of, mid + h) ?? v1) - (at(c.after, c.of, mid - h) ?? v1)) / (2 * h);
  if (Math.abs(slope0) > 1e-12 && Math.abs(d) > 1e-12) {
    // at the same value of the curve, how far along the domain did it move?
    const along = -d / slope0;
    const tol = c.of === "y" ? tolX : tolY;
    if (c.of === "y") { if (along > tol) moves.add("right"); else if (along < -tol) moves.add("left"); }
    else { if (along > tol) moves.add("up"); else if (along < -tol) moves.add("down"); }
  }
  // steepness on the page: |dy/dx|
  const steep = (s: number) => (c.of === "y" ? Math.abs(s) : s === 0 ? Infinity : Math.abs(1 / s));
  const s0 = steep(slope0), s1 = steep(slope1);
  if (Number.isFinite(s0) && Number.isFinite(s1) && Math.abs(s1 - s0) > 0.02 * Math.max(s0, s1, 1e-12)) moves.add(s1 > s0 ? "steeper" : "flatter");
  if (!moves.size) moves.add("none");
  return moves;
}

export type Effect = "up" | "down" | "same";

/** Where the first labelled point (the equilibrium) goes when the curves move: what happens to each axis variable. */
export function equilibriumShift(g: GraphSpec): { x: Effect; y: Effect; before: { x: number; y: number }; after: { x: number; y: number } } | undefined {
  const p = g.points[0];
  if (!p) return undefined;
  const byLabel = new Map(g.curves.map((c) => [c.label, c]));
  const a = byLabel.get(p.on[0])!, b = byLabel.get(p.on[1])!;
  const before = crossing(a, b, g);
  const after = crossing(a, b, g, true);
  const dir = (v0: number, v1: number, span: number): Effect => (v1 - v0 > 1e-4 * span ? "up" : v1 - v0 < -1e-4 * span ? "down" : "same");
  return { x: dir(before.x, after.x, g.x.max - g.x.min), y: dir(before.y, after.y, g.y.max - g.y.min), before, after };
}

/** "Output (Y)", "output", "real output Y" all name the same axis: compare loosely. */
const key = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
export function axisFor(name: string, g: GraphSpec): "x" | "y" | undefined {
  const n = key(name);
  if (!n) return undefined;
  const hits = (["x", "y"] as const).filter((ax) => {
    const l = key(g[ax].label);
    const sym = /\(([^)]+)\)/.exec(g[ax].label)?.[1];
    return l === n || l.startsWith(`${n} `) || n.startsWith(`${l} `) || l.includes(` ${n} `) || l.endsWith(` ${n}`) || (sym !== undefined && key(sym) === n);
  });
  return hits.length === 1 ? hits[0] : undefined;
}

/** Graph text for prompts: the rules Claude follows to describe a graph. */
export const GRAPH_SPEC_RULE =
  'GRAPH SPEC: {"x":{"label":"Output (Y)","max":200},"y":{"label":"Price level (P)","max":10},"curves":[{"label":"AD","y":"8 - 0.03*x"},{"label":"SRAS","y":"2 + 0.02*x"},{"label":"LRAS","x":"120"}],"points":[{"label":"E1","on":["AD","SRAS"]}],"values":true}. Axes start at 0 unless you give "min". Each curve is "y" as an arithmetic expression in x, or "x" as an expression in y (a vertical line is {"x":"120"}). Use + - * / ^ ( ) and numbers only. Curve labels are short (AD, SRAS, MS, L(r,Y), IS, LM). Every curve must be clearly visible inside the axes, and every point must be where its two curves cross exactly once inside the axes. Set "values": true only if the student should read numbers off the graph (the points\' coordinates are then marked on the axes).';
