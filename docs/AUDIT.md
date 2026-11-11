# StudyDeck audit (Phase 0)

Date: 2026-11-10. Commit audited: `bc45ca7`. Method: read the server, the Claude runner, the job runner, backups and the UI entry points; ran every check; ran the app on a copy of the real data (port 3001) and walked every screen at 1280px and 375px in light and dark; sent forged requests at it; planted hostile strings in a note, a card and an exam name.

Nothing in the app was changed for this audit.

## 1. Check results

| Check | Result |
|---|---|
| `npm run typecheck` | clean |
| `npm test` | 336 of 336 pass, 34 files, about 5 s |
| `npm run doctor` | 8 ok, 1 warning (yt-dlp not installed) |
| `npm run eval:cards` | 6 sample lectures: 47 cards kept, 1 dropped (duplicate), 7 Claude calls, about 9 s per lecture |
| `npm run eval:quiz` | 6 sample lectures: 27 questions kept, 7 dropped (4 for a number not in the note, 3 for too many true/false), 12 calls; blind second solve agreed on 100%; right option was the longest on 33% of single-answer questions |
| `npm run eval:problems` | 6 sample lectures: 13 problems kept, 1 dropped (a given missing from the text), blind second solve agreed on 100%, 11 calls |
| API speed (local, real data) | every study endpoint answers in under 20 ms |
| Page weight | `app.js` 102 KB, `app.css` 72 KB, unminified JS, no bundler |

## 2. What is solid

- **The receipts design holds up.** Quote, number, one-question and duplicate gates run in code; quiz keys need a blind second solve; problem answers are computed by a restricted calculator; written grading needs evidence from the student's own answer. Failures drop the item and record why.
- **The Claude runner is locked down.** No tools, no user settings, no session files, and the environment is stripped of anything that would switch billing to an API key (`src/claude.ts`).
- **Answer keys stay on the server** until a question is answered (quiz home, exam page).
- **Escaping is consistent on the main paths.** A note, a card and an exam name containing `<img onerror>` and `<script>` rendered as text on every screen I visited (note viewer, notes grid, tutor list, exam list, progress list). A full pass is still owed (section 3.9).
- **The server is fast.** Nothing in the study flow waits on the server; all waiting is Claude.
- **Dark mode and the phone layout work.** No horizontal scrolling at 375px; contrast looked fine on every screen checked.
- **Migrations back up before upgrading**, and daily backups are consistent copies (`VACUUM INTO`).

## 3. What is broken or risky

### 3.1 Any website can read the notes and drive the app (confirmed)
The server binds to 127.0.0.1 but never checks the `Host` or `Origin` header, and sends no security headers.

- A request with `Host: evil.example` to `/api/notes?course=all` returned 200 and the full list. That is the DNS-rebinding case: a hostile page that points its own domain at 127.0.0.1 becomes same-origin with the app and can read every note and chat, and call every route (including the ones that run `claude -p`).
- A cross-site "simple" POST (`Content-Type: text/plain`, `Origin: https://evil.example`) to `/api/study/backup` returned 200 and made a backup. The same shape works for `/api/granola/disconnect`, `/api/sync`, generation cancel, and exam grading. Generation itself is only spared today by accident (an empty body asks for more than 40 lectures and is refused).

Fix: reject any request whose `Host` is not `localhost:<port>` or `127.0.0.1:<port>` (all methods, so reads are covered too); reject state-changing requests whose `Origin` is present and not the app's own; require `Content-Type: application/json` on POST/PATCH/DELETE bodies; add `X-Content-Type-Options`, `X-Frame-Options: DENY`, a tight `Content-Security-Policy`, and drop `X-Powered-By`.

### 3.2 One tap deletes a card, question or problem for good
The `×` on each row calls DELETE immediately: no confirm, no undo, and a card's whole review history goes with it. On the phone that `×` is 27 by 18 px, next to the scroll area. This is the easiest way to lose real study data today.

### 3.3 Backups cannot be restored from the app
They are made and listed, but getting one back means copying files by hand while the server is stopped.

### 3.4 Generation jobs live only in memory
`LectureJobs` keeps its state in a field. A restart mid-job loses the job report (finished lectures are saved, which is good, but the UI can no longer say which lectures finished, failed or never started).

### 3.5 Errors from Claude are raw on most study routes
`friendlyError` exists, but `studyRoute` only translates three app error types; anything else (a usage cap during tutor, grading, "explain it another way", cheat sheet) reaches the UI as a 500 with the raw CLI text. The usage-limit message also says "wait a minute" when a Pro cap can last hours.

### 3.6 Doctor checks the wrong Granola connection
Doctor reports "Granola connector: connected" by reading `claude mcp list`. The app has not used that connector since it got its own direct sign-in (`data/granola-auth.json`). On the dev copy, with no Granola sign-in at all, Doctor still said "connected" while the sidebar correctly showed "Connect Granola".

### 3.7 The daily limit means two different things
The setting says "new cards a day, per class", and each class gets its own allowance. Under "Everything" the same number is applied once to all classes together. With the limit at 30, Everything offers 28 new cards while two classes alone would offer more.

### 3.8 Quiz options carry a length tell on the real bank
In the real question bank, the right option is the longest one on 26 of 45 single-answer questions (58%; chance is 25%). The eval on the sample notes shows 33 to 53% depending on the run, so the sample eval understates it. The per-question gate only rejects extreme cases (right option at least 1.6 times longer). A test-wise student can score well by picking the longest option, which also inflates mastery and readiness.

### 3.9 Smaller items
- `esc()` does not escape single quotes. No single-quoted attribute uses it today, so this is a trap for later, not a live bug.
- No automated front-end tests of any kind. All 336 tests are server-side.
- `docs/SUMMARY.md` and `docs/PRESENTATION.md` describe an early version (34 tests, "no database", flashcards on the roadmap).
- Eval scripts hard-code three class ids and run on the sample notes by default, so they do not measure quality on the real notes unless told to.
- No `--model` is passed to the CLI, so generation quality depends on whatever the CLI's default model is that day.
- 13 notes sit in the Inbox. At least two look like class lectures inside a current exam's date range, so they are invisible to cards, quizzes and the plan until filed.
- Neither `pdftotext` nor `yt-dlp` is installed, which matters for the source library.

## 4. What is confusing or slow as a student

- **There is no single place to start.** Six tabs, each with its own start button. The daily plan lives on the sixth tab (Progress) and is a list of five to seven separate "Go" buttons, most of them "Quiz: one lecture". Starting a study day takes a class pick, a tab pick, a scroll and several choices.
- **A cross-class plan exists but is hidden.** Picking "Everything" and then Progress shows both exams together. Nothing points there.
- **The plan is quiz-heavy and repetitive.** With little practice history it suggests "you haven't been tested on this lecture yet" five times in a row.
- **Readiness reads as a grade.** "48%, confidence low" is honest but looks alarming next to an exam two days out; it needs to say what would move it.
- **Math is plain text.** `C = Q^2 + 20`, `MC = 10 + 2Q` and Greek letters are shown as typed. There are no graphs anywhere, in a subject that is mostly graphs.
- **Cards can only be deleted.** No edit, no suspend button (the column exists), no flag, no undo of a rating.
- **Touch targets are small on the phone.** About 50 controls on the Cards home are under 40 px: sub-tabs at 36 px, the new-cards buttons at 24 px, row deletes at 18 px.
- **Accessibility is thin.** About a dozen `aria-` attributes in total, no `aria-live` region for feedback after an answer, no dialog roles or focus trapping on overlays, emoji used as the only icon on several buttons.
- **Waiting on Claude gives little feedback.** A mock exam's "Building your exam…" and the tutor's turn have no progress, elapsed time or cancel.

## 5. What is not built

Source library (PDF, slides, textbook, YouTube, Granola transcripts); syllabus and Canvas week view; math and graph rendering; cloze, ordering, matching and "spot the error" items; exam-format presets copied from a real exam; subject-aware generators for non-Econ classes; chat tie-ins ("quiz me", "make cards from this answer"); a flag-to-eval feedback loop; eval thresholds as a gate; phone access; backup restore; front-end tests and CI.

## 6. Order of work

Phase 1 (trust and reliability) covers 3.1 to 3.6. Phase 2 (study flow) covers 3.2's undo, 3.7 and most of section 4. Phase 3 covers math, graphs, question kinds and 3.8. Phases 4 to 6 cover section 5 and the rest of 3.9.
