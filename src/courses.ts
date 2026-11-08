export const PROFILES = ["quant-econ", "finance", "accounting", "general"] as const;
export type ProfileId = (typeof PROFILES)[number];

/** Palette names map to Tailwind classes in the front end. "slate" is reserved for Unsorted. */
export const PALETTE = ["indigo", "sky", "emerald", "fuchsia", "amber", "teal", "orange", "rose", "violet", "lime"] as const;
export type ColorName = (typeof PALETTE)[number] | "slate";

export interface Course {
  /** Short code, also the folder name under ./notes (e.g. ECON300). */
  id: string;
  name: string;
  semester?: string;
  profile: ProfileId;
  color: ColorName;
  archived?: boolean;
  /** Words in a meeting title that point at this course when it has no course code. */
  keywords?: string[];
  /** Granola folder that holds this course's meetings (used by sync in a later milestone). */
  granolaFolder?: string;
}

export const UNSORTED: Course = { id: "unsorted", name: "Unsorted", profile: "general", color: "slate" };

/** Seed data: the starting course list, and the fixed list used by demo mode. */
export const DEFAULT_COURSES: Course[] = [
  { id: "ECON300", granolaFolder: "Macroeconomics", name: "Macroeconomics", semester: "Fall 2026", profile: "quant-econ", color: "indigo" },
  { id: "ECON301", granolaFolder: "Microeconomics", name: "Microeconomics", semester: "Fall 2026", profile: "quant-econ", color: "sky" },
  { id: "ECON196", granolaFolder: "Accounting", name: "Accounting", semester: "Fall 2026", profile: "accounting", color: "emerald" },
  { id: "MGMT220", granolaFolder: "Social Innovation", name: "Social Innovation", semester: "Fall 2026", profile: "general", color: "fuchsia" },
  { id: "CLUB", name: "Clubs", profile: "general", color: "amber" },
  { id: "EVENT", name: "Events", profile: "general", color: "teal" },
  { id: "ATHLETICS", name: "Athletics", profile: "general", color: "orange" },
  UNSORTED,
];

export const idsOf = (courses: Course[]) => courses.map((c) => c.id);
export const activeIdsOf = (courses: Course[]) => courses.filter((c) => !c.archived).map((c) => c.id);

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** "ECON300" matches "ECON300", "ECON 300", "econ-300"; "CLUB" matches "CLUB" as a leading word. */
function prefixBody(id: string): string {
  const m = id.match(/^([A-Za-z]+)[-_ ]?(\d+[A-Za-z]?)$/);
  return m ? `${esc(m[1])}\\s*[-_ ]?\\s*${esc(m[2])}` : esc(id);
}

const routable = (courses: Course[]) => courses.filter((c) => c.id !== "unsorted" && !c.archived);

/** Route a meeting title like "ECON 300 - Fiscal policy" to a course id, or "unsorted". */
export function routeTitle(title: string, courses: Course[] = DEFAULT_COURSES): string {
  const t = title.trim();
  const active = routable(courses);
  for (const c of active) if (new RegExp(`^\\[?\\s*${prefixBody(c.id)}\\b`, "i").test(t)) return c.id;
  const hits = active.filter((c) => (c.keywords ?? []).some((k) => k.trim() && new RegExp(`\\b${esc(k.trim())}\\b`, "i").test(t)));
  return hits.length === 1 ? hits[0].id : "unsorted";
}

/** "ECON300: IS-LM" -> "IS-LM" (keeps the title if nothing is left). */
export function stripCoursePrefix(title: string, courses: Course[] = DEFAULT_COURSES): string {
  let t = title.trim();
  for (const c of courses.filter((c) => c.id !== "unsorted")) {
    t = t.replace(new RegExp(`^\\[?\\s*${prefixBody(c.id)}\\]?\\s*[:\\-–—]?\\s*`, "i"), "");
  }
  return t.trim() || title.trim();
}
