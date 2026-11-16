/**
 * The app as the browser tests see it: a throwaway data folder and notes folder, a stand-in for Claude that never
 * leaves this machine, and a small bank of cards, questions and problems. One note, card, question, problem and exam
 * carry hostile text, so the tests can prove that nothing typed into the app can ever run as code.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createApp } from "../src/server.js";
import type { Runner } from "../src/claude.js";
import { studyDb } from "../src/study/db.js";
import { addGeneratedCards } from "../src/study/cards.js";
import { addGeneratedQuestions } from "../src/study/questions.js";
import { addGeneratedProblems } from "../src/study/problems.js";
import { createExam } from "../src/study/exams.js";
import { backupNow } from "../src/study/backup.js";
import type { GeneratedQuestion } from "../src/study/quizgen.js";

export const HOSTILE = `<img src=x onerror="window.__xss=(window.__xss||0)+1">'"><script>window.__xss=99</script>`;

const root = fs.mkdtempSync(path.join(os.tmpdir(), "sd-e2e-"));
const notesDir = path.join(root, "notes");
const dataDir = path.join(root, "data");
fs.mkdirSync(path.join(notesDir, "ECON301"), { recursive: true });
fs.mkdirSync(path.join(notesDir, "ECON300"), { recursive: true });

const note = (course: string, file: string, title: string, date: string, body: string) => {
  fs.writeFileSync(path.join(notesDir, course, file), `---\ntitle: ${title}\ncourse: ${course}\ndate: ${date}\nsample: false\nsource: granola\n---\n\n# ${title}\n\n${body}\n`);
  return { id: `${course}/${file}`, course };
};
const costs = note("ECON301", "2026-10-08_theory-of-costs.md", "Theory of costs", "2026-10-08", "## Marginal cost\n\n- Marginal cost (MC): derivative of the cost function with respect to Q\n- For C(Q) = 25 + 10Q + Q^2, MC = 10 + 2Q\n\n## Fixed and variable cost\n\n- A firm's fixed cost doesn't change with output & is paid even at Q = 0\n- Fixed cost does not change with output\n- Average variable cost is variable cost divided by Q");
const monopoly = note("ECON301", "2026-10-29_monopoly.md", "Monopoly pricing", "2026-10-29", "## Marginal revenue\n\n- A monopolist sets MR = MC, then reads the price off the demand curve\n- With inverse demand P = 40 - Q, revenue is 40Q - Q^2 and MR = 40 - 2Q");
note("ECON301", "2026-11-03_hostile.md", `Hostile ${HOSTILE}`, "2026-11-03", `## Section ${HOSTILE}\n\n- A bullet with **bold ${HOSTILE}** and \`code ${HOSTILE}\`\n\n| Cue | Notes |\n|---|---|\n| cell ${HOSTILE} | javascript:alert(1) |\n\n> quote ${HOSTILE}`);
fs.mkdirSync(path.join(notesDir, "unsorted"), { recursive: true });
note("unsorted", "2026-11-04_pricing-review.md", "Pricing review", "2026-11-04", "## Monopoly\n\n- A monopolist sets MR = MC, then reads the price off the demand curve\n- Marginal cost (MC) is the derivative of the cost function; fixed cost does not change with output\n- Deadweight loss shrinks consumer surplus");
note("unsorted", "2026-11-05_visa.md", "Visa appointment", "2026-11-05", "Bring the passport, two photos and the acceptance letter to the consulate on Tuesday.");
const golden = note("ECON300", "2026-10-13_golden-rule.md", "Golden rule", "2026-10-13", "## Golden rule\n\n- The golden rule level of capital maximizes consumption per worker\n- At the golden rule, MPK = depreciation plus population growth");

const db = studyDb(dataDir);
const q = (stem: string, over: Partial<GeneratedQuestion> = {}): GeneratedQuestion => ({
  kind: "single", stem, options: ["10 + 2Q", "25 + 10Q", "2Q", "10Q + Q^2"], answer: [0], explanation: "Marginal cost is the derivative of the cost function.", quote: "MC = 10 + 2Q", section: "Marginal cost", ...over,
});

await addGeneratedCards(db, costs, "v1", [
  { front: "For C(Q) = 25 + 10Q + Q^2, what is marginal cost?", back: "MC = 10 + 2Q", quote: "MC = 10 + 2Q", section: "Marginal cost" },
  { front: "What does fixed cost do as output rises?", back: "It does not change.", quote: "Fixed cost does not change with output", section: "Fixed and variable cost" },
  { front: `Hostile card ${HOSTILE}`, back: `Back ${HOSTILE}`, quote: `quote ${HOSTILE}`, section: `sec ${HOSTILE}` },
]);
await addGeneratedCards(db, monopoly, "v1", [{ front: "What rule does a monopolist use to pick output?", back: "MR = MC", quote: "A monopolist sets MR = MC", section: "Marginal revenue" }]);
addGeneratedQuestions(db, costs, "v1", [
  q("For C(Q) = 25 + 10Q + Q^2, what is marginal cost?"),
  q("Which cost does not change with output?", { options: ["Fixed cost", "Variable cost", "Marginal cost", "Total cost"], answer: [0], explanation: "Fixed cost stays the same at every output.", quote: "Fixed cost does not change with output", section: "Fixed and variable cost" }),
  q("Average variable cost is variable cost divided by Q.", { kind: "tf", options: ["True", "False"], answer: [0], explanation: "That is the definition.", quote: "Average variable cost is variable cost divided by Q" }),
  q(`Hostile question ${HOSTILE}?`, { options: [`a ${HOSTILE}`, "b", "c", "d"], answer: [1], explanation: `because ${HOSTILE}`, quote: `quote ${HOSTILE}`, section: `sec ${HOSTILE}` }),
]);
addGeneratedQuestions(db, monopoly, "v1", [
  q("With inverse demand P = 40 - Q, what is marginal revenue?", { options: ["40 - 2Q", "40 - Q", "40Q - Q^2", "20 - Q"], answer: [0], explanation: "Revenue is 40Q - Q^2, so MR = 40 - 2Q.", quote: "MR = 40 - 2Q", section: "Marginal revenue" }),
  q("What does a monopolist set equal to choose output?", { options: ["MR and MC", "P and MC", "P and AC", "MR and P"], answer: [0], explanation: "MR = MC.", quote: "A monopolist sets MR = MC", section: "Marginal revenue" }),
]);
// A question with a graph the app draws from equations (Solow steady state: saving meets break-even investment at k = 81).
addGeneratedQuestions(db, golden, "v1", [
  q("On the graph, saving per worker meets break-even investment at point SS. What happens to capital per worker if the economy starts to the left of SS?", {
    options: ["It rises toward SS", "It falls toward zero", "It stays where it is", "It jumps straight to SS"], answer: [0],
    explanation: "Left of SS, saving exceeds break-even investment, so capital per worker grows.", quote: "The golden rule level of capital maximizes consumption per worker", section: "Golden rule",
    graph: { x: { label: "Capital per worker (k)", min: 0, max: 120 }, y: { label: "Investment per worker", min: 0, max: 12 }, curves: [{ label: "sf(k)", of: "y", expr: "0.9*x^0.5", dashed: false }, { label: "(n+d)k", of: "y", expr: "0.1*x", dashed: false }], points: [{ label: "SS", on: ["sf(k)", "(n+d)k"] }], values: true },
  }),
]);
// A two-step problem (the only one in ECON300), for working a problem step by step.
addGeneratedProblems(db, golden, "v1", [
  {
    stem: "Output per worker is y = 3 times the square root of k, with k = 49. Households save s = 0.3 of output. Find saving per worker.",
    givens: [{ name: "k", value: 49, label: "capital per worker" }, { name: "s", value: 0.3, label: "saving rate" }],
    steps: [{ name: "y", label: "Output per worker", expr: "3 * sqrt(k)", explain: "Put k into the production function.", value: 21 }, { name: "sav", label: "Saving per worker", expr: "s * y", explain: "Saving is the saving rate times output.", value: 6.3 }],
    answer: 6.3, unit: "", difficulty: 1, quote: "The golden rule level of capital maximizes consumption per worker", section: "Golden rule",
  },
] as any);
addGeneratedProblems(db, monopoly, "v1", [
  {
    stem: "A monopolist faces inverse demand P = 40 - Q and has marginal cost of 10. Find the profit-maximizing quantity.",
    givens: [{ name: "a", value: 40, label: "demand intercept" }, { name: "mc", value: 10, label: "marginal cost" }],
    steps: [{ name: "q", label: "Quantity", expr: "(a - mc) / 2", explain: "Set MR = 40 - 2Q equal to MC and solve for Q." }],
    answer: 15, unit: "", difficulty: 1, quote: "A monopolist sets MR = MC", section: "Marginal revenue",
  },
  {
    stem: `Hostile problem ${HOSTILE}: a firm sells 4 units at a price of 5. Find revenue in dollars.`,
    givens: [{ name: "n", value: 4, label: `units ${HOSTILE}` }, { name: "p", value: 5, label: "price" }],
    steps: [{ name: "r", label: `Revenue ${HOSTILE}`, expr: "n * p", explain: `Multiply ${HOSTILE}.` }],
    answer: 20, unit: "$", difficulty: 1, quote: `quote ${HOSTILE}`, section: `sec ${HOSTILE}`,
  },
]);
const inDays = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);
createExam(db, { course: "ECON301", name: "Exam 2", date: inDays(5), from: "2026-10-01" });
createExam(db, { course: "ECON301", name: `Hostile ${HOSTILE}`.slice(0, 80), date: inDays(20), from: "2026-10-01" });
backupNow(db, dataDir, new Date(Date.now() - 3_600_000));

/**
 * Stands in for Claude: fixed, harmless answers. A chat question gets a cited answer whose quote contains an
 * apostrophe and an ampersand, the characters that are easiest to get wrong when an answer is escaped for display.
 */
const CITED = `A firm's fixed cost is paid whatever it produces [ECON301 2026-10-08: Theory of costs | "A firm's fixed cost doesn't change with output & is paid even at Q = 0"].`;
const runner: Runner = async (o) => {
  const text = /fixed cost/i.test(o.prompt.split("</note>").pop() ?? "") ? CITED : "Not in your notes.";
  o.onText?.(text);
  return { text, costUsd: 0 };
};

const port = Number(process.env.PORT ?? 3210);
createApp({ runner, notesDir, sampleDir: path.resolve("sample-notes"), dataDir }).listen(port, "127.0.0.1", () => console.log(`e2e server on http://localhost:${port} (${root})`));
