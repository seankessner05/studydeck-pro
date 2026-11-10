import { randomUUID } from "node:crypto";
import type { Db } from "../library/db.js";

const DAY = 86_400_000;
const startOfDay = (ms: number) => new Date(new Date(ms).setHours(0, 0, 0, 0)).getTime();
const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

export class ExamError extends Error {}

/** A test you are studying for: which class, when, and which lectures (by date range) it covers. */
export interface Exam {
  id: string;
  course: string;
  name: string;
  /** ms epoch of the start of the exam day (local time) */
  dateMs: number;
  /** First lecture date covered, YYYY-MM-DD */
  from: string;
  /** Last lecture date covered, YYYY-MM-DD (or null: everything up to the exam) */
  to: string | null;
}

const toExam = (r: any): Exam => ({ id: r.id, course: r.course, name: r.name, dateMs: r.date_ms, from: r.from_date, to: r.to_date });

/** "2026-11-12" → the start of that day in local time. */
export function dayStart(iso: string): number {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d, 0, 0, 0, 0).getTime();
}

export function createExam(db: Db, input: { course: string; name: string; date: string; from: string; to?: string | null }, now = new Date()): Exam {
  const name = String(input.name ?? "").trim().slice(0, 80);
  if (!input.course || input.course === "all") throw new ExamError("Pick one class for this exam.");
  if (!name) throw new ExamError("Give the exam a name, like “Exam 2”.");
  if (!ISO_DAY.test(String(input.date))) throw new ExamError("Pick the exam date.");
  if (!ISO_DAY.test(String(input.from))) throw new ExamError("Pick the first lecture date the exam covers.");
  if (input.to && !ISO_DAY.test(String(input.to))) throw new ExamError("The last lecture date isn't a valid date.");
  if (input.to && input.to < input.from) throw new ExamError("The last lecture date is before the first.");
  const id = randomUUID();
  db.prepare("INSERT INTO exams (id, course, name, date_ms, from_date, to_date, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)").run(id, input.course, name, dayStart(input.date), input.from, input.to || null, now.getTime());
  return getExam(db, id)!;
}

export function getExam(db: Db, id: string): Exam | undefined {
  const r = db.prepare("SELECT * FROM exams WHERE id = ?").get(id);
  return r ? toExam(r) : undefined;
}

/** Exams for a class (or every class), soonest first. Past exams are included only when asked for. */
export function listExams(db: Db, course: string, now = new Date(), includePast = false): Exam[] {
  const rows = db
    .prepare(`SELECT * FROM exams WHERE ${course === "all" ? "1=1" : "course = ?"} AND date_ms >= ? ORDER BY date_ms, name`)
    .all(...(course === "all" ? [] : [course]), includePast ? 0 : startOfDay(now.getTime())) as any[];
  return rows.map(toExam);
}

export function deleteExam(db: Db, id: string): boolean {
  return db.prepare("DELETE FROM exams WHERE id = ?").run(id).changes > 0;
}

export function daysUntil(exam: Exam, now = new Date()): number {
  return Math.round((exam.dateMs - startOfDay(now.getTime())) / DAY);
}

const localIso = (ms: number) => {
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

/** The lectures an exam covers: same class, lecture date from the first date to the last (or, with no last date, to the exam day). */
export function inScope<T extends { course: string; date: string }>(exam: Exam, notes: T[]): T[] {
  const last = exam.to ?? localIso(exam.dateMs);
  return notes.filter((n) => n.course === exam.course && n.date >= exam.from && n.date <= last);
}
