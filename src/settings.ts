import fs from "node:fs";
import path from "node:path";

export interface Settings {
  demo: boolean;
  /** When on, nothing asks Claude anything (chat and, later, generation and grading are all off). */
  aiPaused: boolean;
}

const file = (dataDir: string) => path.join(dataDir, "settings.json");

export function loadSettings(dataDir: string): Settings {
  const defaults: Settings = { demo: process.env.STUDYDECK_DEMO === "1", aiPaused: false };
  try {
    return { ...defaults, ...JSON.parse(fs.readFileSync(file(dataDir), "utf8")) };
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
