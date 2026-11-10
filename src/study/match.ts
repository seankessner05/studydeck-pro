import type { Db } from "../library/db.js";
import { QuizError } from "./questions.js";

export interface MatchPair {
  id: string;
  term: string;
  definition: string;
  lecture: string | null;
}

const MAX_TERM = 90;
const MAX_DEFINITION = 85;

/** A card's answer, cut to its first sentence, if that is short enough to sit on a tile. Otherwise it isn't a match-game card. */
export function tileText(back: string): string | undefined {
  const first = back.split("\n")[0].replace(/\s+/g, " ").trim();
  const sentence = first.match(/^.*?[.!?](?=\s|$)/)?.[0] ?? first;
  const text = sentence.replace(/[.!?]$/, "").trim();
  return text.length >= 2 && text.length <= MAX_DEFINITION ? text : undefined;
}

/**
 * Pick pairs for the Match game: cards with a short question and a short answer, spread over different lectures, and the
 * ones you know least well first. Needs at least three usable cards.
 */
export function matchPairs(db: Db, course: string, count = 6, rand: () => number = Math.random): MatchPair[] {
  const n = Math.max(3, Math.min(10, Math.floor(count)));
  const rows = db
    .prepare(
      `SELECT c.id, c.front, c.back, c.note_id, c.lapses, c.state FROM cards c WHERE c.suspended = 0 ${course === "all" ? "" : "AND c.course = ?"}`,
    )
    .all(...(course === "all" ? [] : [course])) as { id: string; front: string; back: string; note_id: string | null; lapses: number; state: number }[];
  const usable = rows
    .map((r) => ({ ...r, tile: tileText(r.back) }))
    .filter((r): r is typeof r & { tile: string } => !!r.tile && r.front.length <= MAX_TERM);
  // distinct answers only, or two tiles could both be right
  const seen = new Set<string>();
  const distinct = usable.filter((r) => (seen.has(r.tile.toLowerCase()) ? false : (seen.add(r.tile.toLowerCase()), true)));
  if (distinct.length < 3) throw new QuizError("The Match game needs at least 3 flashcards with short answers. Make some cards from your lectures first.");

  const shuffle = <T>(a: T[]): T[] => {
    const x = [...a];
    for (let i = x.length - 1; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1));
      [x[i], x[j]] = [x[j], x[i]];
    }
    return x;
  };
  // Weakest first (relearning, then most lapses), then spread across lectures.
  const ranked = shuffle(distinct).sort((a, b) => (b.state === 3 ? 1 : 0) - (a.state === 3 ? 1 : 0) || b.lapses - a.lapses);
  const byLecture = new Map<string, typeof ranked>();
  for (const r of ranked) (byLecture.get(r.note_id ?? "") ?? byLecture.set(r.note_id ?? "", []).get(r.note_id ?? "")!).push(r);
  const queues = shuffle([...byLecture.values()]);
  const out: typeof ranked = [];
  while (out.length < n && queues.some((q) => q.length)) {
    for (const q of queues) {
      const next = q.shift();
      if (next) out.push(next);
      if (out.length >= n) break;
    }
  }
  return out.map((r) => ({ id: r.id, term: r.front, definition: r.tile, lecture: r.note_id }));
}
