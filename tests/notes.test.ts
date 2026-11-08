import { describe, it, expect } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { parseNote, loadNotes, listCourses, readNote, resolveNotesDir, noteSnippet, moveNote, MoveError } from "../src/notes";

describe("notes", () => {
  it("parses frontmatter and falls back to the filename", () => {
    const n = parseNote("ECON300", "2026-10-14_sample-fiscal.md", "---\ntitle: Fiscal Multipliers\nsample: true\n---\nbody here");
    expect(n).toMatchObject({ title: "Fiscal Multipliers", date: "2026-10-14", sample: true, body: "body here", id: "ECON300/2026-10-14_sample-fiscal.md" });
    const bare = parseNote("CLUB", "2026-01-02_pitch-night.md", "no frontmatter");
    expect(bare).toMatchObject({ title: "pitch night", date: "2026-01-02", sample: false });
  });

  it("loads real sample notes: 3 per course, 21 total", () => {
    const { courses, total } = listCourses(path.resolve("sample-notes"));
    expect(total).toBe(21);
    for (const id of ["ECON300", "ECON301", "ECON196", "MGMT220", "CLUB", "EVENT", "ATHLETICS"]) {
      expect(courses.find((c) => c.id === id)?.count).toBe(3);
    }
    expect(loadNotes("all", path.resolve("sample-notes")).every((n) => n.sample)).toBe(true);
  });

  it("rejects path traversal and unknown courses", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sd-"));
    fs.mkdirSync(path.join(dir, "CLUB"));
    fs.writeFileSync(path.join(dir, "CLUB", "2026-01-01_a.md"), "hi");
    expect(readNote("CLUB", "2026-01-01_a.md", dir)?.body).toBe("hi");
    expect(readNote("CLUB", "../CLUB/2026-01-01_a.md", dir)).toBeNull();
    expect(readNote("../etc", "passwd.md", dir)).toBeNull();
  });

  it("falls back to sample notes when ./notes is empty, and demo mode forces samples", () => {
    const empty = fs.mkdtempSync(path.join(os.tmpdir(), "sd-empty-"));
    const real = fs.mkdtempSync(path.join(os.tmpdir(), "sd-real-"));
    fs.mkdirSync(path.join(real, "ECON300"));
    fs.writeFileSync(path.join(real, "ECON300", "2026-10-01_real.md"), "real note");
    expect(resolveNotesDir(empty, "S", false)).toEqual({ dir: "S", source: "samples" });
    expect(resolveNotesDir(real, "S", false)).toEqual({ dir: real, source: "notes" });
    expect(resolveNotesDir(real, "S", true)).toEqual({ dir: "S", source: "samples" });
  });

  it("reports each course's latest note date", () => {
    const { courses } = listCourses(path.resolve("sample-notes"));
    expect(courses.find((c) => c.id === "ECON300")?.latest).toBe("2026-10-21");
    expect(courses.find((c) => c.id === "unsorted")?.latest).toBeUndefined();
  });

  it("makes a plain-text preview without headings, tables or markdown", () => {
    const body = "# Title\n\n### Chapter 7 Cost Review\n\n- Short run vs. **long run** cost recap\n  - Fixed costs\n\n| Cue | Notes |\n|---|---|\n| A | B |";
    expect(noteSnippet(body)).toBe("Chapter 7 Cost Review — Short run vs. long run cost recap — Fixed costs — A: B");
    expect(noteSnippet("> **SAMPLE DATA** — fake\n\n# T\n\nHello world")).toBe("Hello world");
    expect(noteSnippet("x".repeat(400), 50)).toHaveLength(50);
    expect(noteSnippet("")).toBe("");
  });

  it("moves a note to another course and rewrites its course line", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sd-move-"));
    fs.mkdirSync(path.join(dir, "unsorted"));
    fs.writeFileSync(path.join(dir, "unsorted", "2026-10-21_x.md"), "---\ntitle: X\ncourse: unsorted\ngranola_id: g1\n---\n\nbody course: keep");
    const ids = ["ECON301", "unsorted"];
    const n = moveNote(dir, ids, "unsorted", "2026-10-21_x.md", "ECON301");
    expect(n).toMatchObject({ id: "ECON301/2026-10-21_x.md", course: "ECON301", granolaId: "g1" });
    expect(fs.existsSync(path.join(dir, "unsorted", "2026-10-21_x.md"))).toBe(false);
    const raw = fs.readFileSync(path.join(dir, "ECON301", "2026-10-21_x.md"), "utf8");
    expect(raw).toContain("course: ECON301");
    expect(raw).toContain("body course: keep");
  });

  it("refuses bad moves", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sd-move-"));
    fs.mkdirSync(path.join(dir, "A"));
    fs.mkdirSync(path.join(dir, "B"));
    fs.writeFileSync(path.join(dir, "A", "2026-01-01_n.md"), "---\ncourse: A\n---\nx");
    fs.writeFileSync(path.join(dir, "B", "2026-01-01_n.md"), "---\ncourse: B\n---\ny");
    expect(() => moveNote(dir, ["A", "B"], "A", "2026-01-01_n.md", "B")).toThrow(/already has a note/);
    expect(() => moveNote(dir, ["A", "B"], "A", "2026-01-01_n.md", "NOPE")).toThrow(MoveError);
    expect(() => moveNote(dir, ["A", "B"], "A", "../x.md", "B")).toThrow(/not found/);
    expect(() => moveNote(dir, ["A", "B"], "A", "missing.md", "B")).toThrow(/not found/);
  });
});
