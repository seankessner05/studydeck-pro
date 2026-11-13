import { normalize } from "../citations.js";

/**
 * Checks that a generated question can be answered on its own and isn't a copy of the notes.
 *
 * Why these exist: a question like "Under a tariff, which area of the welfare graph represents government revenue?
 * Rectangle D / Triangle C / Area B / Triangle E" passed every earlier check (its quote was really in the note, and a
 * second solver that could read the note agreed with the key), yet nobody can answer it without the graph from class.
 * And most questions simply restated one sentence of the note, which tests memory of that sentence, not understanding.
 */

// Labels that only mean something on a figure the student can't see: "rectangle D", "point E", "area B".
// The letter must be a capital on its own ("line A" yes, "line about" no).
const FIGURE_LABEL = /\b(?:areas?|rectangles?|triangles?|trapezoids?|regions?|points?|curves?|lines?|panels?|segments?|boxes|box|shaded areas?)\s+([A-H])(?![\w'’])/gi;
// Sums of lettered areas, as in "A + B + C" (A to F only, so the macro identity "C + I + G" is not caught).
const LETTER_SUM = /(?<![\w.])[A-F]\s*\+\s*[A-F](?:\s*\+\s*[A-F])*(?![\w.])/;
// Pointers to material the question doesn't contain.
const POINTER = [
  /\b(?:the|this|that)\s+(?:[\w-]+\s+)?(?:graph|figure|diagram|table|chart|worksheet|slide|handout)\s+(?:above|below|shown|from (?:class|lecture)|in (?:class|lecture))\b/i,
  /\b(?:above|below|following|accompanying|shown)\s+(?:graph|figure|diagram|table|chart)\b/i,
  /\bwelfare (?:graph|diagram)\b/i,
];
const CLASS_CONTEXT = /\b(?:the professor|your professor|the instructor|in class|in lecture|from class|from lecture|the lecture|the notes?|your notes|the slides?|problem set\s*\d|PS\s?\d|homework\s*\d|the worksheet|the textbook example)\b/i;

/**
 * The part of this text that points at something not shown, or undefined if it stands on its own.
 * `allowClassContext` lets an explanation say "your notes" (it is read after answering), but never a figure label.
 */
export function unseenReference(text: string, allowClassContext = false): string | undefined {
  for (const m of text.matchAll(FIGURE_LABEL)) {
    // only a capital letter counts as a label
    if (m[1] === m[1].toUpperCase()) return m[0];
  }
  const sum = text.match(LETTER_SUM);
  if (sum) return sum[0];
  for (const re of POINTER) {
    const m = text.match(re);
    if (m) return m[0];
  }
  if (!allowClassContext) {
    const m = text.match(CLASS_CONTEXT);
    if (m) return m[0];
  }
  return undefined;
}

const STOP = new Set(
  "the a an of to and or in on for is are be by with that this it as at from which what when how why does do under than its their they them there these those was were will would can could should into about between more less most least also not no".split(" "),
);
const contentWords = (s: string) => normalize(s).split(" ").filter((w) => w.length > 2 && !STOP.has(w));

/** The longest run of consecutive words two texts share (case and punctuation ignored), and the run itself. */
export function sharedRun(a: string, b: string): { length: number; words: string } {
  const x = normalize(a).split(" ").filter(Boolean);
  const y = normalize(b).split(" ").filter(Boolean);
  let best = 0;
  let end = 0;
  let prev = new Array(y.length + 1).fill(0);
  for (let i = 1; i <= x.length; i++) {
    const cur = new Array(y.length + 1).fill(0);
    for (let j = 1; j <= y.length; j++) {
      if (x[i - 1] === y[j - 1]) {
        cur[j] = prev[j - 1] + 1;
        if (cur[j] > best) { best = cur[j]; end = i; }
      }
    }
    prev = cur;
  }
  return { length: best, words: x.slice(end - best, end).join(" ") };
}

export const longestSharedRun = (a: string, b: string): number => sharedRun(a, b).length;

// Exam instructions a professor repeats on every exam ("show your work", "describe it in words for partial credit").
// Reusing those is following his format, not copying his questions.
const INSTRUCTION = /partial credit|show your work|show (?:all )?(?:of )?your work|label (?:your|the) graph|(?:which|what) curves? (?:is |are )?shift|explain (?:intuitively|in your own words)|in your own words|no calculations? (?:are |is )?needed|no explanation (?:is )?needed|if you (?:couldn'?t|can'?t|could not|cannot)|make up an?\b|do not (?:simply|spend)|anything reasonable|you will need to use calculus|answered entirely in words|please (?:discuss|explain|show|calculate|label|answer)|use your time efficiently|points? (?:total|each)|\(\d+ points?\)/i;

/** The text with exam-instruction sentences taken out, so only the content is compared. */
export function withoutInstructions(text: string): string {
  return text
    .split(/(?<=[.!?])\s+|\n+/)
    .filter((sentence) => !INSTRUCTION.test(sentence))
    .join(" ");
}

/** Copying 8 or more words in a row from the note is a restatement, not a new question. */
export const MAX_SHARED_RUN = 7;
/** If the question and its answer reuse this share of the receipt quote's meaningful words, it is the note's sentence reworded. */
export const MAX_QUOTE_OVERLAP = 0.7;

/**
 * Why this question counts as a copy of the note, or undefined if it doesn't.
 * `stem` is the question itself (for true/false, the statement). `answers` is the text of the correct option(s).
 * Long copied runs count anywhere; the reworded-sentence test looks at the stem only, because a good answer is often
 * just the name of the idea ("crowding out"), which naturally shares words with the place the idea is taught.
 */
export function copiesNote(stem: string, answers: string, quote: string, noteBody: string): string | undefined {
  const run = longestSharedRun(`${stem} ${answers}`, noteBody);
  if (run > MAX_SHARED_RUN) return `${run} words in a row copied from the note`;
  const q = [...new Set(contentWords(quote))];
  if (q.length >= 4) {
    const have = new Set(contentWords(stem));
    const share = q.filter((w) => have.has(w)).length / q.length;
    if (share >= MAX_QUOTE_OVERLAP) return `rewords the note's sentence (${Math.round(share * 100)}% of its words)`;
  }
  return undefined;
}

/** Why a saved question fails today's rules, or undefined if it passes. Used to clean up questions made under older rules. */
export function auditQuestion(q: { kind: string; stem: string; options: string[]; answer: number[]; explanation: string; quote: string | null }, noteBody: string | undefined): string | undefined {
  const unseen = unseenReference(q.stem) ?? q.options.map((o) => unseenReference(o)).find(Boolean) ?? unseenReference(q.explanation, true);
  if (unseen) return `points at something it doesn't show (“${unseen}”)`;
  if (noteBody && q.quote) {
    const copied = copiesNote(q.stem, q.kind === "tf" ? "" : q.answer.map((i) => q.options[i] ?? "").join(" "), q.quote, noteBody);
    if (copied) return `copies the notes (${copied})`;
  }
  return undefined;
}
