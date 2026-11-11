import fs from "node:fs";
import path from "node:path";

export interface Settings {
  demo: boolean;
  /** When on, nothing asks Claude anything (chat and, later, generation and grading are all off). */
  aiPaused: boolean;
  /** How many brand-new flashcards you are shown per day, per class. Raise it when an exam is close. */
  newPerDay: number;
}

export const DEFAULT_NEW_PER_DAY = 20;
export const MIN_NEW_PER_DAY = 5;
export const MAX_NEW_PER_DAY = 100;

/** A usable daily limit, or undefined when the value isn't a whole number in range. */
export function validNewPerDay(v: unknown): number | undefined {
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" ? Number(v) : NaN;
  return Number.isInteger(n) && n >= MIN_NEW_PER_DAY && n <= MAX_NEW_PER_DAY ? n : undefined;
}

const file = (dataDir: string) => path.join(dataDir, "settings.json");

export function loadSettings(dataDir: string): Settings {
  const defaults: Settings = { demo: process.env.STUDYDECK_DEMO === "1", aiPaused: false, newPerDay: DEFAULT_NEW_PER_DAY };
  try {
    const saved = { ...defaults, ...JSON.parse(fs.readFileSync(file(dataDir), "utf8")) };
    // A hand-edited or old file with a bad limit falls back to the default rather than breaking the Study tab.
    return { ...saved, newPerDay: validNewPerDay(saved.newPerDay) ?? DEFAULT_NEW_PER_DAY };
  } catch {
    return defaults;
  }
}

/** Update some settings, keeping the rest. */
export function saveSettings(dataDir: string, patch: Partial<Settings>): Settings {
  const next = { ...loadSettings(dataDir), ...patch };
  fs.mkdirSync(dataDir, { recursive: true });
  fs.writeFileSync(file(dataDir), JSON.stringify(next, null, 2));
  return next;
}
