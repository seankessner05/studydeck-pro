# StudyDeck improvement plan

Written after the Phase 0 audit ([AUDIT.md](AUDIT.md)) and Sean's answers on 2026-11-10. Phases run in order. Each ends with: typecheck and tests green, screens checked at 1280px and 375px in light and dark, a short report, commits, and a go-live.

## Decisions already made

| Question | Answer |
|---|---|
| When do phases go live | As soon as each is ready, including during exam week |
| Adding PDFs and slides | Upload in the app, plus an optional watched folder per class |
| Deadlines | Canvas calendar feed (link pasted into the app later) plus pasted syllabi |
| Phone access | Not now |
| Exam format | Sean adds Exam 1 PDFs once the source library exists |
| Icons | Replace emoji with drawn icons; emoji stay only in playful text |
| Inbox | The app suggests a class, Sean confirms (one by one or all at once) |

Decisions I made (say so if you disagree):

- **Front-end split comes before new screens.** Order: browser tests that pin today's behavior, then split `app.js` and `study-more.js` into ES modules with no behavior change, then build new screens on the modules.
- **PDF text comes from `pdfjs-dist`** (an npm package, free, nothing to install on the Mac). YouTube uses `yt-dlp` when present and a paste box otherwise.
- **Deleting becomes "move to trash"** with undo, for cards, questions and problems.
- **No framework.** Vanilla JS modules, no bundler.

## How the work is kept away from the live app

The live app serves its screen files straight from the repo folder, so editing there changes what you see mid-study.

- All work happens in a second checkout: `~/Documents/GitHub/studydeck-work`, a git worktree on branch `improve`. The repo folder and `main` are not touched while a phase is in progress.
- Development runs on port 3001 against copies of `data/` and `notes/` (the copy has no Granola sign-in, so it cannot disturb the real one).
- **Go-live for a phase:** tests and browser checks pass in the worktree, then: tag `main` as `before-phase-N`, back up the study database, fast-forward `main` to the phase, restart the app on port 3000, and smoke-test it. Rollback is `git reset --hard before-phase-N` plus the backup made a moment earlier.
- Nothing is pushed to GitHub without asking.

## Phase 1: Trust, safety and reliability

| Change | Files | Why |
|---|---|---|
| Host and Origin guard, JSON-only bodies, security headers | new `src/security.ts`, `src/server.ts`, new `tests/security.test.ts` | Closes the hole where any web page can read notes or drive the app (audit 3.1) |
| Trash with undo instead of instant delete | migration 8 (`deleted_at` on cards, questions, problems), `src/study/cards.ts`, `questions.ts`, `problems.ts`, routes, UI rows, tests | One tap currently destroys a card and its history (3.2) |
| Restore a backup | `src/study/backup.ts` (verify with `PRAGMA integrity_check`, back up current first, swap, reopen), routes, Progress screen, tests that corrupt and restore a copy | Backups cannot be used today (3.3) |
| Jobs survive a restart | migration 8 (`gen_jobs`, `gen_job_items`), `src/study/jobs.ts`, status routes, tests | A restart loses the job report (3.4) |
| Clear Claude errors everywhere | `src/claude.ts` (usage cap with reset time, not logged in, missing CLI, timeout), `studyRoute` in `src/server.ts`, UI error card with the fix and a Doctor link, tests | Raw CLI text reaches the UI (3.5) |
| Doctor checks the real Granola sign-in | `src/doctor.ts`, `tests/doctor.test.ts` | It reports "connected" when the app is not (3.6) |
| Escaping audit | `esc()` also escapes `'`; a test page that renders hostile strings through every render function | Proves 3.9 rather than assuming it |
| Browser tests (Playwright) for the five critical flows, on demo data | new `e2e/`, `playwright.config.ts`, `package.json` | Safety net before the front-end split |
| CI | new `.github/workflows/ci.yml` (typecheck and unit tests, no secrets) | Catches regressions on every push |

Risk: the guard could block the Granola sign-in callback or the app itself if the port differs. Mitigation: the callback is allowed explicitly, and tests cover `localhost`, `127.0.0.1` and a custom `PORT`.

## Phase 2: A study flow that needs no thinking

| Change | Files |
|---|---|
| Split the front end into modules (no behavior change) | `public/js/*.js` replacing `app.js` and `study-more.js`; `src/routes/*.ts` replacing the single `server.ts` |
| Today screen across all classes with one Start button that walks the plan (due cards, weak-topic quiz, problems, teach-back, mock exam when close), resumable, with a finish summary | new `src/study/today.ts`, migration 9 (`plan_runs`), `mastery.ts` (plan steps become runnable units), new Today module |
| Cram mode within 3 days of an exam | `mastery.ts`, `settings.ts`, Today module |
| Card edit, suspend, flag, undo last rating | `cards.ts`, `fsrs.ts` (restore the prior state), migration 9, player UI |
| Cloze cards with the same receipts (the blank must be a word-for-word span of the quote) | `cardgen.ts`, `cards.ts`, player UI, eval cases |
| One meaning for the daily limit (per class, summed under Everything) | `cards.ts`, tests |
| Readiness that says what would move it | `mastery.ts`, Progress and Today modules |
| Inbox: suggested class with confirm and "file all" | `src/notes.ts` (scoring from the course registry), Inbox UI |
| Drawn icons, 44px touch targets, labels, focus order, live regions, reduced motion | `public/icons.svg`, all modules, `input.css` |

Risk: the module split is the largest refactor. Mitigation: the Phase 1 browser tests must pass unchanged before and after.

## Phase 3: Economics-grade content

| Change | Files |
|---|---|
| Math rendering with a vendored KaTeX (no CDN) in cards, questions, problems, notes and chat | `public/vendor/katex/`, a shared render helper, generator prompts; receipts compare against the raw note text |
| Graphs from computed specs: curves as equations, the app evaluates them, finds intersections and draws the SVG; blind solver must agree | new `src/study/graphs.ts`, `problemgen.ts`, `quizgen.ts`, a graph module in the UI, migration 10 |
| New item kinds: ordering, matching, fill-in, step-by-step partial credit, spot-the-error, trap questions from notes where the professor flagged one | `quizgen.ts`, `questions.ts`, `problemgen.ts`, quiz UI |
| Fix the length tell (58% on the real bank): reject or rebalance at the batch level, tighter prompt, eval threshold | `quizgen.ts`, `src/eval/quiz.ts` |
| Mock exams that copy a real exam's shape | `sittings.ts`, exam UI (uses Exam 1 PDFs from Phase 4 when present, a typed format until then) |
| Subject-aware generators chosen from the course profile, including journal entries checked by debits equal credits | `cardgen.ts`, `problemgen.ts`, `profiles.ts` |
| Evals run on real notes, no hard-coded class ids, at least 10 cases per new kind | `src/eval/*.ts` |

## Phase 4: Source library

| Change | Files |
|---|---|
| Sources: PDF upload and watched folder, pasted text, YouTube transcript, Granola transcripts | new `src/sources/` (extract, chunk, store), migration 11 (`sources`, `source_chunks` with page or timestamp), Sources screen |
| Citations and receipts that point at a page or timestamp and open the source there | `citations.ts`, `answer.ts`, generators, source viewer |
| BM25 ranking over chunks, with a 30-question retrieval eval | `retrieval.ts`, `src/eval/retrieval.ts` |
| Chat: "quiz me on this", "make cards from this answer" (through the receipts pipeline), save as note, search past chats | `answer.ts`, `chats.ts`, chat module |

## Phase 5: Syllabus and Canvas

| Change | Files |
|---|---|
| Calendar feed reader (stored only in `data/`, never logged) with recurring, all-day and time-zone cases | new `src/calendar/ics.ts`, settings, fixtures and tests |
| Pasted syllabus to dated items, each with a quote from the paste | new `src/calendar/syllabus.ts` |
| Week view; exams created from the calendar after you confirm scope; deadlines feed the plan | `exams.ts`, `mastery.ts`, new Week module |

## Phase 6: Quality loop and engineering health

Flags stored, reviewed, and promotable to eval cases; generation quality over time; eval thresholds that fail on regression; speed budgets; README, docs and screenshots brought up to date; dead code removed. The audio review and installable-app ideas are asked about again at that point.

## Use of your Claude allowance

Evals and browser checks of AI features use real `claude -p` calls. Phase 0 used 30. Each later phase is capped at about 40 unless you say otherwise, and none run while a generation job of yours is in progress.

## What will need you

- Go-live restarts (a few seconds each; I do them and tell you).
- Exam 1 PDFs for Micro and Macro (Phase 3 and 4).
- The folder to watch for PDFs, if you want one per class (Phase 4).
- The Canvas calendar link (Phase 5).
- Permission before any push to GitHub.
