import type { Course, ProfileId } from "./courses.js";

export interface ProfileInfo {
  label: string;
  /** Extra answer rules added to the system prompt for courses of this type. */
  guidance: string;
}

export const PROFILE_INFO: Record<ProfileId, ProfileInfo> = {
  "quant-econ": {
    label: "Quantitative economics",
    guidance:
      "Keep the professor's notation and formulas exactly as written in the notes. Put each formula on its own line, define its symbols, " +
      "and walk through a numeric example only when the notes contain one.",
  },
  finance: {
    label: "Finance",
    guidance:
      "Keep formulas and notation from the notes (for example NPV, WACC, CAPM) and show calculations step by step only as they appear in the notes. " +
      "You explain concepts and calculations from the notes; never give personalized investment advice or tell the student to buy or sell anything.",
  },
  accounting: {
    label: "Accounting",
    guidance:
      "Keep account names and Dr/Cr layouts exactly as written in the notes. Show journal entries as small tables with Debit and Credit columns.",
  },
  general: {
    label: "General",
    guidance: "Keep the professor's framing and vocabulary, and quote key definitions word for word when the notes give them.",
  },
};

/** One line per profile in play, so an all-courses question gets the right rules for each course's notes. */
export function profileGuidance(courses: Course[], courseIdsInPlay: string[]): string {
  const byProfile = new Map<ProfileId, string[]>();
  for (const id of courseIdsInPlay) {
    const c = courses.find((x) => x.id === id);
    if (!c) continue;
    byProfile.set(c.profile, [...(byProfile.get(c.profile) ?? []), id]);
  }
  return [...byProfile.entries()]
    .map(([p, ids]) => `- For notes from ${ids.join(", ")} (${PROFILE_INFO[p].label}): ${PROFILE_INFO[p].guidance}`)
    .join("\n");
}

export type MaterialKind = "cards" | "quiz" | "problems";

/**
 * How to write study material for each kind of class. The answer rules above shape how things are written; these
 * shape WHAT gets asked, so an accounting quiz drills journal entries and a management quiz drills cases, not formulas.
 */
export const MATERIAL_GUIDANCE: Record<ProfileId, Record<MaterialKind, string>> = {
  "quant-econ": {
    cards: "Favour cards that make the student state a formula, a condition (MR = MC, MPL = W/P), which curve shifts for a given change, or the direction of an effect.",
    quiz: "Favour questions that apply a model to a new situation: predict directions, pick which curve shifts, read a graph, compare two policies, and choose which model or graph fits a situation.",
    problems: "Write problems like the course's problem sets: a model with numbers, solved in steps that use the note's formulas (optima from derivatives, equilibria, multipliers, elasticities, surplus).",
  },
  finance: {
    cards: "Favour cards on formulas (NPV, WACC, CAPM), what each input means, and which way a value moves when an input changes.",
    quiz: "Favour questions that apply a valuation or risk idea to a new firm or project and ask which way a value moves or which choice is better. Never ask what to buy or sell personally.",
    problems: "Write valuation and return problems with every cash flow, rate and period given; one number asked.",
  },
  accounting: {
    cards: "Favour cards on which accounts a transaction debits and credits, what kind of account something is (asset, liability, equity, revenue, expense), and how an inventory or depreciation method works.",
    quiz: "Favour questions that give a NEW business transaction and ask for the correct journal entry (which account is debited and which credited, with the amount), how it changes the accounting equation, or which statement it appears on; and questions that compare methods (FIFO vs. LIFO, straight-line vs. declining balance) on new numbers.",
    problems: "Write problems on new transactions and figures: cost of goods sold and ending inventory under FIFO, LIFO or average cost, depreciation for a year, a balance after several entries, or a ratio. Every amount is given; one number asked.",
  },
  general: {
    cards: "Favour cards on key terms, frameworks and the professor's examples: what a concept means and how to recognise it.",
    quiz: "Favour short NEW cases (an organisation, a founder, a policy) and ask which concept or framework applies, what a stakeholder would do, or which approach fits best. No arithmetic.",
    problems: "This course rarely works calculations. Write a problem only if the note itself works one; otherwise reply with an empty array [].",
  },
};

/** The subject guidance for writing one kind of material for one class. */
export function materialGuidance(courses: Course[], courseId: string, kind: MaterialKind): string {
  const c = courses.find((x) => x.id === courseId);
  return c ? MATERIAL_GUIDANCE[c.profile][kind] : "";
}
