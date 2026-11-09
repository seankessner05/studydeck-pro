import { DefaultScheduler } from "ts-fsrs";

/** 1 again, 2 hard, 3 good, 4 easy. */
export type Grade = 1 | 2 | 3 | 4;
export const GRADES: readonly { grade: Grade; key: "again" | "hard" | "good" | "easy"; label: string }[] = [
  { grade: 1, key: "again", label: "Again" },
  { grade: 2, key: "hard", label: "Hard" },
  { grade: 3, key: "good", label: "Good" },
  { grade: 4, key: "easy", label: "Easy" },
];

/**
 * The scheduler's card state. Only the fields we read are typed; the rest (cardId, learningStep, …) ride along
 * untouched, which is why the whole object is stored as JSON.
 */
export interface FsrsCard {
  dueAt: Date;
  lastReviewAt: Date | null;
  /** 0 new, 1 learning, 2 review, 3 relearning */
  state: number;
  reps: number;
  lapses: number;
  scheduledDays: number;
  stability: number;
  difficulty: number;
  [field: string]: unknown;
}

/** The three scheduler calls we use. The library's own typings disagree between overloads, so this is our boundary. */
interface Scheduler {
  newCard(a: { now: Date }): FsrsCard;
  preview(a: { card: FsrsCard; now: Date }): Iterable<{ grade: number; card: FsrsCard }>;
  review(a: { card: FsrsCard; grade: number; now: Date }): { card: FsrsCard };
}

let scheduler: Promise<Scheduler> | undefined;
/** One shared scheduler with the library's defaults (FSRS-7, 90% target retention). */
const getScheduler = () => (scheduler ??= DefaultScheduler() as unknown as Promise<Scheduler>);

export async function newCard(now = new Date()): Promise<FsrsCard> {
  return (await getScheduler()).newCard({ now });
}

export const serialize = (card: FsrsCard): string => JSON.stringify(card);

/** The library wants real Date objects, which JSON turns into strings; put them back. */
export function deserialize(json: string): FsrsCard {
  const o = JSON.parse(json);
  o.dueAt = new Date(o.dueAt);
  if (o.lastReviewAt) o.lastReviewAt = new Date(o.lastReviewAt);
  return o as FsrsCard;
}

/** "1m", "14h", "5d", "2mo", "1.5y": the label on a rating button. */
export function formatInterval(days: number): string {
  const minutes = days * 1440;
  if (minutes < 1.5) return "1m";
  if (minutes < 60) return `${Math.round(minutes)}m`;
  if (days < 1) return `${Math.round(days * 24)}h`;
  if (days < 30) return `${Math.round(days)}d`;
  if (days < 365) return `${Math.round(days / 30)}mo`;
  return `${(days / 365).toFixed(1).replace(/\.0$/, "")}y`;
}

export interface Preview {
  grade: Grade;
  /** ms epoch the card would be due again */
  dueAt: number;
  days: number;
  label: string;
}

/** What each of the four buttons would schedule, so the UI can show it before you answer. */
export async function preview(card: FsrsCard, now = new Date()): Promise<Preview[]> {
  const items = [...(await getScheduler()).preview({ card, now })];
  return items
    .map((p) => ({ grade: p.grade as Grade, dueAt: new Date(p.card.dueAt).getTime(), days: p.card.scheduledDays, label: formatInterval(p.card.scheduledDays) }))
    .sort((a, b) => a.grade - b.grade);
}

export async function review(card: FsrsCard, grade: Grade, now = new Date()): Promise<{ card: FsrsCard; scheduledDays: number }> {
  const r = (await getScheduler()).review({ card, grade, now });
  return { card: r.card, scheduledDays: r.card.scheduledDays };
}
