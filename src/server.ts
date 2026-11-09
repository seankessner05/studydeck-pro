import express from "express";
import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { LOGIN_FIX, checkAuth, checkClaude, friendlyError, runClaude, type Runner } from "./claude.js";
import { DEFAULT_COURSES, PALETTE, PROFILES, activeIdsOf, idsOf } from "./courses.js";
import { MoveError, NOTES_DIR, SAMPLE_DIR, listCourses, loadNotes, moveNote, noteSnippet, readNote, citationLabel, resolveNotesDir } from "./notes.js";
import { PROFILE_INFO } from "./profiles.js";
import { RegistryError, addCourse, loadRegistry, updateCourse } from "./registry.js";
import { type ChatTurn } from "./prompt.js";
import { answerQuestion } from "./answer.js";
import { appendMessage, clearChat, loadChats, studyStreak, type ChatMessage } from "./chats.js";
import { loadSettings, saveSettings, type Settings } from "./settings.js";
import { studyDb } from "./study/db.js";
import { CardError, NEW_PER_DAY, accuracy, addCard, buildSession, counts, deleteCard, forecast, listCards, reviewCard, studyDays } from "./study/cards.js";
import { recordUsage, usageSummary } from "./study/usage.js";
import { runDoctor } from "./doctor.js";
import { DATA_DIR } from "./paths.js";
import { GranolaConnection, GranolaError, NotConnectedError, type GranolaService } from "./granola/api.js";
import { runDirectSync } from "./granola/sync.js";

export interface AppDeps {
  runner: Runner;
  notesDir: string;
  sampleDir: string;
  dataDir: string;
  /** Direct connection to Granola; tests pass a fake. */
  granola?: GranolaService;
}

const HISTORY_TURNS = 6;

function granolaMessage(e: unknown): string {
  if (e instanceof NotConnectedError || e instanceof GranolaError) return e.message;
  const msg = e instanceof Error ? e.message : String(e);
  if (/fetch failed|ENOTFOUND|ECONNREFUSED|network/i.test(msg)) return "Couldn't reach Granola. Check your internet connection and try again.";
  return `Granola sync didn't work: ${msg.slice(0, 300)}`;
}

export function createApp(deps: AppDeps) {
  const app = express();
  const granola = deps.granola ?? new GranolaConnection(path.join(deps.dataDir, "granola-auth.json"));
  const redirectFor = (req: express.Request) => `${req.protocol}://${req.get("host")}/api/granola/callback`;
  let syncing = false;
  const lastSyncFile = path.join(deps.dataDir, "last-sync.json");
  const readLastSync = () => {
    try {
      return JSON.parse(fs.readFileSync(lastSyncFile, "utf8"));
    } catch {
      return undefined;
    }
  };

  class SyncBusyError extends Error {}
  async function performSync(redirect: string, onProgress?: (m: string) => void) {
    if (syncing) throw new SyncBusyError();
    syncing = true;
    try {
      const result = await granola.withApi(redirect, (api) =>
        runDirectSync({ api, notesDir: deps.notesDir, courses: loadRegistry(deps.dataDir), onProgress }),
      );
      fs.mkdirSync(deps.dataDir, { recursive: true });
      fs.writeFileSync(
        lastSyncFile,
        JSON.stringify({
          at: new Date().toISOString(), scanned: result.scanned, added: result.added.length, updated: result.updated.length,
          moved: result.moved.length, errors: result.errors.length, titles: [...result.added, ...result.updated].slice(0, 30).map((x) => `${x.course}: ${x.title}`),
        }),
      );
      return result;
    } finally {
      syncing = false;
    }
  }
  // Called by main() on a timer; quiet when Granola isn't connected or a sync is already running.
  app.locals.autoSync = (redirect: string) => (granola.isConnected() ? performSync(redirect).catch(() => undefined) : Promise.resolve(undefined));
  app.use(express.json({ limit: "1mb" }));
  app.use(express.static(path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "public")));

  /** Demo mode pins the seed courses; otherwise the user's own registry applies. */
  const current = () => {
    const { demo } = loadSettings(deps.dataDir);
    const courses = demo ? DEFAULT_COURSES : loadRegistry(deps.dataDir);
    return { demo, courses, ...resolveNotesDir(deps.notesDir, deps.sampleDir, demo, idsOf(courses)) };
  };
  const validCourse = (c: unknown): c is string => typeof c === "string" && (c === "all" || idsOf(current().courses).includes(c));
  // Sample-note chats are kept apart from real-note chats so a demo never mixes with real history.
  /** Study progress for whichever notes are showing: sample practice is kept separate from the real thing. */
  const sdb = () => studyDb(deps.dataDir, current().source === "samples");
  const streakNow = () => studyStreak(loadChats(deps.dataDir), new Date(), studyDays(sdb()));
  const paused = () => loadSettings(deps.dataDir).aiPaused;
  const chatKey = (course: string) => (current().source === "samples" ? `sample:${course}` : course);

  app.get("/api/state", (_req, res) => {
    const { demo, dir, source, courses } = current();
    res.json({
      demo, source, editable: !demo, aiPaused: paused(), ...listCourses(dir, courses), streak: streakNow(),
      profiles: PROFILES.map((id) => ({ id, label: PROFILE_INFO[id].label })), palette: PALETTE,
    });
  });

  const registryRoute = (fn: () => unknown, res: express.Response) => {
    if (current().demo) return res.status(409).json({ error: "Demo mode uses a fixed set of sample courses. Turn it off to manage your own." });
    try {
      res.json(fn());
    } catch (e) {
      if (e instanceof RegistryError) return res.status(400).json({ error: e.message });
      throw e;
    }
  };
  app.post("/api/courses", (req, res) => registryRoute(() => addCourse(deps.dataDir, req.body ?? {}), res));
  app.patch("/api/courses/:id", (req, res) => registryRoute(() => updateCourse(deps.dataDir, req.params.id, req.body ?? {}), res));

  app.post("/api/settings", (req, res) => {
    const patch: Partial<Settings> = {};
    if (typeof req.body?.demo === "boolean") patch.demo = req.body.demo;
    if (typeof req.body?.aiPaused === "boolean") patch.aiPaused = req.body.aiPaused;
    res.json({ ok: true, ...saveSettings(deps.dataDir, patch) });
  });

  app.get("/api/notes/:course/:file", (req, res) => {
    const c = current();
    const note = readNote(req.params.course, req.params.file, c.dir, idsOf(c.courses));
    if (!note) return res.status(404).json({ error: "Note not found" });
    res.json({ ...note, label: citationLabel(note) });
  });

  app.get("/api/notes", (req, res) => {
    const c = current();
    const course = String(req.query.course ?? "all");
    if (course !== "all" && !idsOf(c.courses).includes(course)) return res.status(404).json({ error: "Unknown course" });
    const notes = loadNotes(course, c.dir, activeIdsOf(c.courses));
    res.json(
      notes
        .map((n) => ({ id: n.id, course: n.course, file: n.file, date: n.date, title: n.title, sample: n.sample, snippet: noteSnippet(n.body), words: n.body.split(/\s+/).length }))
        .sort((a, b) => b.date.localeCompare(a.date) || a.title.localeCompare(b.title)),
    );
  });

  app.patch("/api/notes/:course/:file", (req, res) => {
    const c = current();
    if (c.source !== "notes") return res.status(409).json({ error: "Only your synced notes can be moved, not the sample notes." });
    try {
      const note = moveNote(c.dir, idsOf(c.courses), req.params.course, req.params.file, String(req.body?.course ?? ""));
      res.json({ ...note, label: citationLabel(note) });
    } catch (e) {
      if (e instanceof MoveError) return res.status(400).json({ error: e.message });
      throw e;
    }
  });

  app.get("/api/chats/:course", (req, res) => {
    res.json(loadChats(deps.dataDir)[chatKey(req.params.course)] ?? []);
  });

  app.delete("/api/chats/:course", (req, res) => {
    clearChat(deps.dataDir, chatKey(req.params.course));
    res.json({ ok: true });
  });

  app.post("/api/chat", async (req, res) => {
    const { course, question, useGeneral } = req.body ?? {};
    if (!validCourse(course) || typeof question !== "string" || !question.trim()) {
      return res.status(400).json({ error: "course and question are required" });
    }
    if (paused()) return res.status(409).json({ error: "AI is paused, so questions are off. Turn it back on in the sidebar." });
    const q = question.trim();
    const general = !!useGeneral;
    const key = chatKey(course);
    const cur = current();

    res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive" });
    const send = (event: string, data: unknown) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);

    const history: ChatTurn[] = (loadChats(deps.dataDir)[key] ?? [])
      .filter((m) => !m.error)
      .slice(-HISTORY_TURNS)
      .map((m) => ({ role: m.role, text: m.text }));

    appendMessage(deps.dataDir, key, { id: randomUUID(), role: "user", text: q, createdAt: new Date().toISOString(), useGeneral: general });

    const abort = new AbortController();
    res.on("close", () => abort.abort());

    try {
      const notes = loadNotes(course, cur.dir, activeIdsOf(cur.courses));
      const r = await answerQuestion({
        runner: deps.runner, notes, courses: cur.courses, question: q, general, history,
        onMeta: (meta) => send("meta", meta),
        onText: (chunk) => send("delta", chunk),
        signal: abort.signal,
      });
      const msg: ChatMessage = {
        id: randomUUID(), role: "assistant", text: r.text, createdAt: new Date().toISOString(),
        citations: r.citations, notesUsed: r.notesUsed, mode: r.mode, useGeneral: general,
      };
      appendMessage(deps.dataDir, key, msg);
      try {
        recordUsage(sdb(), "chat", 1, r.costUsd ?? 0);
      } catch {
        // usage tracking must never break an answer
      }
      send("done", { text: r.text, citations: r.citations });
    } catch (e) {
      const message = friendlyError(e);
      if (!abort.signal.aborted) {
        appendMessage(deps.dataDir, key, { id: randomUUID(), role: "assistant", text: message, createdAt: new Date().toISOString(), error: true });
        send("error", { message });
      }
    }
    res.end();
  });

  app.get("/api/doctor", async (req, res) => {
    const runner: typeof deps.runner = paused()
      ? async () => {
          throw new Error("AI is paused");
        }
      : deps.runner;
    res.json(
      await runDoctor(
        { dataDir: deps.dataDir, notesDir: deps.notesDir, courses: loadRegistry(deps.dataDir), runner, usage: () => ({ ...usageSummary(sdb()), paused: paused() }) },
        { deep: req.query.deep === "1" },
      ),
    );
  });

  // ---- study: flashcards, usage ----
  const scopeOf = (v: unknown): string | undefined => {
    const c = typeof v === "string" && v ? v : "all";
    return validCourse(c) ? c : undefined;
  };
  const studyRoute = (fn: (req: express.Request, res: express.Response) => unknown | Promise<unknown>): express.RequestHandler => async (req, res) => {
    try {
      await fn(req, res);
    } catch (e) {
      if (e instanceof CardError) return void res.status(400).json({ error: e.message });
      res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
    }
  };

  app.get("/api/study/today", studyRoute((req, res) => {
    const course = scopeOf(req.query.course);
    if (!course) return res.status(404).json({ error: "Unknown class" });
    const db = sdb();
    res.json({ counts: counts(db, course), forecast: forecast(db, course), accuracy: accuracy(db, course), streak: streakNow(), newPerDay: NEW_PER_DAY });
  }));

  app.get("/api/study/session", studyRoute(async (req, res) => {
    const course = scopeOf(req.query.course);
    if (!course) return res.status(404).json({ error: "Unknown class" });
    res.json(await buildSession(sdb(), course, new Date(), Math.min(200, Number(req.query.limit) || 50)));
  }));

  app.post("/api/study/review", studyRoute(async (req, res) => {
    const { cardId, grade, msTaken } = req.body ?? {};
    const result = await reviewCard(sdb(), String(cardId ?? ""), Number(grade) as 1 | 2 | 3 | 4, new Date(), Number.isFinite(msTaken) ? Number(msTaken) : undefined);
    res.json({ ...result, streak: streakNow() });
  }));

  app.get("/api/study/cards", studyRoute((req, res) => {
    const course = scopeOf(req.query.course);
    if (!course) return res.status(404).json({ error: "Unknown class" });
    res.json(listCards(sdb(), course));
  }));

  app.post("/api/study/cards", studyRoute(async (req, res) => {
    const b = req.body ?? {};
    if (!idsOf(current().courses).includes(String(b.course))) throw new CardError("Pick one of your classes for this card.");
    res.json(await addCard(sdb(), { course: String(b.course), front: String(b.front ?? ""), back: String(b.back ?? ""), quote: b.quote ? String(b.quote) : null, noteId: b.noteId ? String(b.noteId) : null, section: b.section ? String(b.section) : null }));
  }));

  app.delete("/api/study/cards/:id", studyRoute((req, res) => {
    res.json({ ok: deleteCard(sdb(), String(req.params.id)) });
  }));

  app.get("/api/usage", studyRoute((_req, res) => {
    res.json({ ...usageSummary(sdb()), paused: paused() });
  }));

  app.get("/api/granola/status", (_req, res) => res.json({ connected: granola.isConnected(), syncing, last: readLastSync() }));

  app.post("/api/granola/connect", async (req, res) => {
    try {
      res.json({ authUrl: await granola.startAuth(redirectFor(req)) });
    } catch (e) {
      res.status(500).json({ error: granolaMessage(e) });
    }
  });

  app.get("/api/granola/callback", async (req, res) => {
    const page = (ok: boolean, text: string) =>
      res.status(ok ? 200 : 400).type("html").send(
        `<!doctype html><meta charset="utf-8"><title>StudyDeck</title><body style="font:16px system-ui;display:grid;place-items:center;height:100vh;margin:0;background:#f8fafc;color:#1e293b">` +
          `<div style="text-align:center"><div style="font-size:48px">${ok ? "✅" : "😕"}</div><h2>${text}</h2><p>You can close this tab and go back to StudyDeck.</p></div>` +
          (ok ? `<script>setTimeout(() => window.close(), 1500)</script>` : ""),
      );
    if (req.query.error) return page(false, "Granola sign-in was cancelled");
    try {
      await granola.finishAuth(String(req.query.code ?? ""), req.query.state ? String(req.query.state) : undefined);
      page(true, "Granola is connected");
    } catch (e) {
      page(false, e instanceof GranolaError ? e.message : "Couldn't finish connecting Granola");
    }
  });

  app.post("/api/granola/disconnect", (_req, res) => {
    granola.disconnect();
    res.json({ ok: true });
  });

  /** Streams progress, then a final summary. Copies your whole semester's notes straight from Granola (no AI involved). */
  app.post("/api/sync", async (req, res) => {
    if (syncing) return res.status(409).json({ error: "A sync is already running." });
    if (!granola.isConnected()) return res.status(409).json({ error: "Connect Granola first.", needsConnect: true });
    res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive" });
    const send = (event: string, data: unknown) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    try {
      send("done", await performSync(redirectFor(req), (m) => send("progress", m)));
    } catch (e) {
      send("error", { message: granolaMessage(e), needsConnect: e instanceof NotConnectedError });
    } finally {
      res.end();
    }
  });

  return app;
}

function main() {
  const c = checkClaude();
  if (!c.ok) {
    console.error(`\n✖ ${c.error}\n`);
    process.exit(1);
  }
  const port = Number(process.env.PORT ?? 3000);
  const app = createApp({ runner: runClaude, notesDir: NOTES_DIR, sampleDir: SAMPLE_DIR, dataDir: DATA_DIR });
  const redirect = `http://localhost:${port}/api/granola/callback`;
  app.listen(port, "127.0.0.1", () => {
    // Keep notes fresh without any clicking: shortly after start, then every 30 minutes. Free (no AI involved).
    setTimeout(() => app.locals.autoSync(redirect), 5_000).unref();
    setInterval(() => app.locals.autoSync(redirect), 30 * 60_000).unref();
    console.log(`StudyDeck running at http://localhost:${port}  (${c.version})`);
    if (!checkAuth().loggedIn) console.warn(`\n⚠ Claude Code isn't logged in, so questions will fail until you sign in. ${LOGIN_FIX}\n`);
  });
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) main();
