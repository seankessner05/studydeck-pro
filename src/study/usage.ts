import type { Db } from "../library/db.js";

const DAY = 86_400_000;
const startOfDay = (ms: number) => new Date(new Date(ms).setHours(0, 0, 0, 0)).getTime();

export type UsageKind = "chat" | "cards" | "quiz" | "problems" | "exam" | "cheatsheet" | "tutor";

/** Remember that Claude was asked something. Cost is what Claude reports at API rates, not a charge on a subscription. */
export function recordUsage(db: Db, kind: UsageKind, calls = 1, costUsd = 0, now = new Date()) {
  db.prepare("INSERT INTO ai_usage (at, kind, calls, cost_usd) VALUES (?, ?, ?, ?)").run(now.getTime(), kind, calls, costUsd);
}

export interface UsageWindow {
  calls: number;
  costUsd: number;
}

export interface UsageSummary {
  today: UsageWindow;
  week: UsageWindow;
  byKind: Record<string, number>;
}

export function usageSummary(db: Db, now = new Date()): UsageSummary {
  const since = (ms: number): UsageWindow => {
    const r = db.prepare("SELECT COALESCE(SUM(calls), 0) c, COALESCE(SUM(cost_usd), 0) u FROM ai_usage WHERE at >= ?").get(ms) as { c: number; u: number };
    return { calls: Number(r.c), costUsd: Math.round(Number(r.u) * 1000) / 1000 };
  };
  const weekStart = startOfDay(now.getTime()) - 6 * DAY;
  const byKind: Record<string, number> = {};
  for (const r of db.prepare("SELECT kind, SUM(calls) c FROM ai_usage WHERE at >= ? GROUP BY kind").all(weekStart) as { kind: string; c: number }[]) byKind[r.kind] = Number(r.c);
  return { today: since(startOfDay(now.getTime())), week: since(weekStart), byKind };
}
