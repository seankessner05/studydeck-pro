import type { Db } from "../library/db.js";

/** Anki wants one note per line, with tabs between fields. Newlines become <br>, and HTML in the text is escaped. */
const field = (s: string) =>
  s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\t/g, " ")
    .replace(/\r?\n/g, "<br>")
    .trim();

/** Anki tags can't contain spaces: "Cost curves" → "Cost_curves". */
const tag = (s: string) => s.replace(/[\s,;]+/g, "_").replace(/[^\w:.À-ɏ-]/g, "").slice(0, 60);

const HEADER = ["#separator:tab", "#html:true", "#tags column:3"];

export interface AnkiExport {
  text: string;
  count: number;
  filename: string;
}

/**
 * Your flashcards as an Anki text file (File → Import in Anki). The Back field carries the receipt quote from your note.
 * Tags are the class and the lecture section, so you can study one topic at a time in Anki.
 */
export function exportCards(db: Db, course: string): AnkiExport {
  const rows = db
    .prepare(`SELECT course, section, front, back, quote FROM cards WHERE suspended = 0 ${course === "all" ? "" : "AND course = ?"} ORDER BY course, note_id, created_at`)
    .all(...(course === "all" ? [] : [course])) as { course: string; section: string | null; front: string; back: string; quote: string | null }[];
  const lines = rows.map((r) => {
    const back = field(r.back) + (r.quote ? `<br><br><i>From your notes: “${field(r.quote)}”</i>` : "");
    const tags = [tag(r.course), r.section ? `${tag(r.course)}::${tag(r.section)}` : ""].filter(Boolean).join(" ");
    return [field(r.front), back, tags].join("\t");
  });
  return { text: [...HEADER, ...lines].join("\n") + "\n", count: rows.length, filename: `studydeck-cards-${course}.txt` };
}

/** Quiz questions as Anki cards: the question and its options on the front, the answer and explanation on the back. */
export function exportQuestions(db: Db, course: string): AnkiExport {
  const rows = db
    .prepare(`SELECT course, section, kind, stem, options, answer, explanation, quote FROM questions ${course === "all" ? "" : "WHERE course = ?"} ORDER BY course, note_id, created_at`)
    .all(...(course === "all" ? [] : [course])) as { course: string; section: string | null; kind: string; stem: string; options: string; answer: string; explanation: string; quote: string | null }[];
  const lines = rows.map((r) => {
    const options: string[] = JSON.parse(r.options);
    const answer: number[] = JSON.parse(r.answer);
    const letters = "ABCDE";
    const front = r.kind === "tf" ? `${field(r.stem)}<br><br>True or false?` : `${field(r.stem)}<br><br>${options.map((o, i) => `${letters[i]}. ${field(o)}`).join("<br>")}${r.kind === "multi" ? "<br><i>(select all that apply)</i>" : ""}`;
    const right = r.kind === "tf" ? options[answer[0]] : answer.map((i) => `${letters[i]}. ${options[i]}`).join("<br>");
    const back = `${r.kind === "tf" ? field(right) : right.split("<br>").map(field).join("<br>")}<br><br>${field(r.explanation)}${r.quote ? `<br><br><i>From your notes: “${field(r.quote)}”</i>` : ""}`;
    const tags = [tag(r.course), "quiz", r.section ? `${tag(r.course)}::${tag(r.section)}` : ""].filter(Boolean).join(" ");
    return [front, back, tags].join("\t");
  });
  return { text: [...HEADER, ...lines].join("\n") + "\n", count: rows.length, filename: `studydeck-quiz-${course}.txt` };
}
