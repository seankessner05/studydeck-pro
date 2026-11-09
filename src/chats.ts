import fs from "node:fs";
import path from "node:path";
import type { Citation } from "./citations.js";

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  text: string;
  createdAt: string;
  citations?: Citation[];
  notesUsed?: { id: string; label: string }[];
  mode?: "all" | "ranked";
  useGeneral?: boolean;
  error?: boolean;
}

export type ChatStore = Record<string, ChatMessage[]>;

export function chatsFile(dataDir: string) {
  return path.join(dataDir, "chats.json");
}

export function loadChats(dataDir: string): ChatStore {
  try {
    return JSON.parse(fs.readFileSync(chatsFile(dataDir), "utf8"));
  } catch {
    return {};
  }
}

export function saveChats(dataDir: string, store: ChatStore) {
  fs.mkdirSync(dataDir, { recursive: true });
  const tmp = chatsFile(dataDir) + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(store, null, 2));
  fs.renameSync(tmp, chatsFile(dataDir));
}

export function appendMessage(dataDir: string, course: string, msg: ChatMessage) {
  const store = loadChats(dataDir);
  (store[course] ??= []).push(msg);
  saveChats(dataDir, store);
}

export function clearChat(dataDir: string, course: string) {
  const store = loadChats(dataDir);
  delete store[course];
  saveChats(dataDir, store);
}

/** Consecutive days (ending today or yesterday) on which you studied: asked a question or reviewed a card. */
export function studyStreak(store: ChatStore, today = new Date(), extraDays: Iterable<string> = []): number {
  const days = new Set<string>(extraDays);
  for (const msgs of Object.values(store)) {
    for (const m of msgs) if (m.role === "user") days.add(localDay(new Date(m.createdAt)));
  }
  const d = new Date(today);
  if (!days.has(localDay(d))) d.setDate(d.getDate() - 1); // streak survives until you skip a full day
  let streak = 0;
  while (days.has(localDay(d))) {
    streak++;
    d.setDate(d.getDate() - 1);
  }
  return streak;
}

function localDay(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
