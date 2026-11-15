import type { Course } from "./courses.js";
import type { Note } from "./notes.js";
import { tokenize } from "./retrieval.js";

/**
 * Suggest a class for an unfiled note, with no AI: compare the note's distinctive words with each class's notes
 * (TF-IDF and cosine similarity), plus a nudge when the title names the class. It says nothing when unsure.
 */

export interface Suggestion {
  course: string;
  /** "likely": a clear winner. "maybe": the best guess, but close to another class or weakly matched. */
  confidence: "likely" | "maybe";
  /** 0..1, for ordering */
  score: number;
}

type Vec = Map<string, number>;

function counts(words: string[]): Vec {
  const v: Vec = new Map();
  for (const w of words) v.set(w, (v.get(w) ?? 0) + 1);
  return v;
}

function cosine(a: Vec, b: Vec): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (const [, x] of a) na += x * x;
  for (const [, y] of b) nb += y * y;
  for (const [w, x] of a) {
    const y = b.get(w);
    if (y) dot += x * y;
  }
  return na && nb ? dot / Math.sqrt(na * nb) : 0;
}

// Calibrated on Sean's 67 filed notes (2026-11-14): notes match their own class at 0.23 or more in 95% of cases, while
// non-class notes (career talks, a visa appointment) reached about 0.25 against the nearest class. So a suggestion
// needs a match as strong as a real class note, and "likely" needs a clear lead over the runner-up.
export const LIKELY = { score: 0.3, margin: 0.05 };
export const MAYBE = 0.22;

export class Suggester {
  private readonly idf = new Map<string, number>();
  private readonly profiles = new Map<string, Vec>();

  constructor(filed: Note[], private readonly courses: Course[]) {
    const docs = filed.map((n) => new Set(tokenize(`${n.title} ${n.body}`)));
    const df = new Map<string, number>();
    for (const d of docs) for (const w of d) df.set(w, (df.get(w) ?? 0) + 1);
    for (const [w, n] of df) this.idf.set(w, Math.log((1 + docs.length) / (1 + n)) + 1);
    for (const n of filed) {
      const p = this.profiles.get(n.course) ?? new Map();
      for (const [w, c] of this.weigh(`${n.title} ${n.body}`)) p.set(w, (p.get(w) ?? 0) + c);
      this.profiles.set(n.course, p);
    }
  }

  private weigh(text: string): Vec {
    const v = counts(tokenize(text));
    for (const [w, c] of v) v.set(w, (1 + Math.log(c)) * (this.idf.get(w) ?? Math.log(2) + 1));
    return v;
  }

  /** The best class for this note, or undefined when nothing matches well enough. */
  suggest(note: Note): Suggestion | undefined {
    const v = this.weigh(`${note.title} ${note.title} ${note.body}`);
    const title = note.title.toLowerCase();
    const scored = [...this.profiles]
      .filter(([course]) => course !== "unsorted" && this.courses.some((c) => c.id === course && !c.archived))
      .map(([course, p]) => {
        const c = this.courses.find((x) => x.id === course)!;
        const named = title.includes(c.id.toLowerCase()) || (c.name.length > 3 && title.includes(c.name.toLowerCase()));
        return { course, score: cosine(v, p) + (named ? 0.25 : 0) }; // the title naming the class alone earns a "maybe"
      })
      .sort((a, b) => b.score - a.score);
    const [best, second] = scored;
    if (!best || best.score < MAYBE) return undefined;
    const margin = best.score - (second?.score ?? 0);
    return { course: best.course, score: Math.round(best.score * 1000) / 1000, confidence: best.score >= LIKELY.score && margin >= LIKELY.margin ? "likely" : "maybe" };
  }
}
