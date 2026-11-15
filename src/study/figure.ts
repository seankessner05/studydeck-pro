import { buildFigure, type Figure, type GraphSpec } from "./graphs.js";

/** A stored graph spec as the figure the browser draws, or null when there is none (or it no longer draws). */
export function figureOf(json: string | null | undefined, opts: { showAfter?: boolean } = {}): Figure | null {
  if (!json) return null;
  try {
    return buildFigure(JSON.parse(json) as GraphSpec, opts);
  } catch {
    return null;
  }
}
