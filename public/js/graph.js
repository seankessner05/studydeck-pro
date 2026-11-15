// ---- Graphs: draw a figure the server already computed (src/study/graphs.ts) as an inline SVG ----
// The server samples every curve and finds every crossing; this only maps numbers to pixels. Colours follow the theme
// through currentColor, and the SVG carries the same description the no-notes solver read, for screen readers.
import { esc } from "./core.js";

const W = 420, H = 300;
const M = { left: 56, right: 64, top: 30, bottom: 44 };
// Literal class names so Tailwind keeps them. A moved curve (AD′) uses its original's colour, dashed.
const COLOURS = ["text-brand-500", "text-rose-500", "text-emerald-600 dark:text-emerald-400", "text-amber-500", "text-sky-500", "text-fuchsia-500"];

const fmt = (v) => String(Number(Number(v).toPrecision(4)));

/** An SVG string for a figure. `caption` is shown under it (optional). */
export function figureSvg(fig, caption = "") {
  if (!fig || !Array.isArray(fig.curves)) return "";
  const px = (x) => M.left + ((x - fig.x.min) / (fig.x.max - fig.x.min)) * (W - M.left - M.right);
  const py = (y) => H - M.bottom - ((y - fig.y.min) / (fig.y.max - fig.y.min)) * (H - M.top - M.bottom);
  const x0 = px(fig.x.min), y0 = py(fig.y.min), x1 = px(fig.x.max), y1 = py(fig.y.max);
  const colourOf = new Map();
  for (const c of fig.curves) {
    const base = c.after ? c.label.replace(/′$/, "") : c.label;
    if (!colourOf.has(base)) colourOf.set(base, COLOURS[colourOf.size % COLOURS.length]);
  }
  const parts = [];
  // axes
  parts.push(`<path d="M${x0} ${y1 - 6}V${y0}H${x1 + 6}" fill="none" stroke="currentColor" stroke-width="1.5" class="text-slate-500 dark:text-slate-400"/>`);
  parts.push(`<text x="${x0}" y="${y1 - 12}" font-size="12" font-weight="700" fill="currentColor">${esc(fig.y.label)}</text>`);
  parts.push(`<text x="${x1 + 6}" y="${y0 + 32}" font-size="12" font-weight="700" fill="currentColor" text-anchor="end">${esc(fig.x.label)}</text>`);
  if (fig.x.min === 0 && fig.y.min === 0) parts.push(`<text x="${x0 - 6}" y="${y0 + 14}" font-size="11" fill="currentColor" text-anchor="end">0</text>`);
  // Text is placed so labels never sit on top of each other: each label tries a few spots and takes the first free one.
  const boxes = [];
  const textW = (t, size) => String(t).length * size * 0.62;
  const place = (x, y, t, size, tries) => {
    const w = textW(t, size);
    for (const [dx, dy, anchor] of tries) {
      const l = x + dx - (anchor === "end" ? w : anchor === "middle" ? w / 2 : 0);
      const b = { l, r: l + w, t: y + dy - size, b: y + dy + 2 };
      if (!boxes.some((o) => b.l < o.r && b.r > o.l && b.t < o.b && b.b > o.t) && b.l >= 0 && b.r <= W && b.t >= 0) { boxes.push(b); return { x: x + dx, y: y + dy, anchor }; }
    }
    const [dx, dy, anchor] = tries[0];
    return { x: x + dx, y: y + dy, anchor };
  };
  const text = (pos, t, size, weight, cls = "") =>
    `<text x="${pos.x.toFixed(1)}" y="${pos.y.toFixed(1)}" font-size="${size}"${weight ? ` font-weight="${weight}"` : ""} fill="currentColor"${pos.anchor !== "start" ? ` text-anchor="${pos.anchor}"` : ""} class="graph-text${cls ? ` ${cls}` : ""}">${esc(t)}</text>`;
  boxes.push({ l: x1 + 6 - textW(fig.x.label, 12), r: x1 + 6, t: y0 + 20, b: y0 + 34 }, { l: x0, r: x0 + textW(fig.y.label, 12), t: y1 - 24, b: y1 - 10 });
  for (const p of fig.points) boxes.push({ l: px(p.x) - 5, r: px(p.x) + 5, t: py(p.y) - 5, b: py(p.y) + 5 });

  // guides to the axes for points whose values are shown; close values are staggered
  if (fig.values) {
    for (const p of fig.points) {
      parts.push(`<path d="M${px(p.x)} ${py(p.y)}V${y0}M${px(p.x)} ${py(p.y)}H${x0}" stroke="currentColor" stroke-dasharray="3 3" stroke-width="1" class="text-slate-400"/>`);
      parts.push(text(place(px(p.x), y0 + 15, fmt(p.x), 11, [[0, 0, "middle"], [0, 12, "middle"], [0, 24, "middle"]]), fmt(p.x), 11));
      parts.push(text(place(x0 - 6, py(p.y) + 4, fmt(p.y), 11, [[0, 0, "end"], [0, -11, "end"], [0, 11, "end"], [-26, 0, "end"]]), fmt(p.y), 11));
    }
  }
  // curves (drawn first, labelled after the points so point labels get the best spots)
  const curveLabels = [];
  for (const c of fig.curves) {
    const base = c.after ? c.label.replace(/′$/, "") : c.label;
    const d = c.segments.map((seg) => seg.map(([x, y], i) => `${i ? "L" : "M"}${px(x).toFixed(1)} ${py(y).toFixed(1)}`).join("")).join("");
    parts.push(`<path d="${d}" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"${c.dashed ? ' stroke-dasharray="7 5"' : ""} class="${colourOf.get(base)}"/>`);
    curveLabels.push([c, colourOf.get(base)]);
  }
  // labelled points: up-right first, then the other corners
  for (const p of fig.points) {
    parts.push(`<circle cx="${px(p.x)}" cy="${py(p.y)}" r="4" fill="currentColor"/>`);
    parts.push(text(place(px(p.x), py(p.y), p.label, 12, [[7, -7, "start"], [-7, -7, "end"], [7, 16, "start"], [-7, 16, "end"], [9, 4, "start"], [-9, 4, "end"]]), p.label, 12, 800));
  }
  // curve labels at the end of each curve, moved up or down when something is already there
  for (const [c, cls] of curveLabels) {
    const [lx, ly] = c.labelAt;
    const atBottom = py(ly) > y0 - 6;
    const x = Math.min(px(lx) + 5, W - 4), y = atBottom ? y0 - 8 : Math.max(py(ly) + (py(ly) < M.top + 8 ? 12 : -4), 12);
    const anchor = x > W - 40 ? "end" : "start";
    const pos = place(x, y, c.label, 12, [0, -14, 14, -28, 28, -42].map((dy) => [0, dy, anchor]));
    parts.push(text(pos, c.label, 12, 800, cls));
  }
  return `<figure class="no-math mx-auto my-3 w-full max-w-md text-slate-800 dark:text-slate-100">
      <svg viewBox="0 0 ${W} ${H}" class="h-auto w-full" role="img" aria-label="${esc(fig.description || "Graph")}" font-family="inherit">${parts.join("")}</svg>
      ${caption ? `<figcaption class="mt-1 text-center text-xs text-slate-500 dark:text-slate-400">${esc(caption)}</figcaption>` : ""}
    </figure>`;
}
