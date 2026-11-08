# StudyDeck: 5-minute presentation

**Goal of the talk:** show one real problem, prove the fix live, explain how it works in one picture, be honest about the tradeoffs.

**Timing:** Problem 0:45 · Live demo 2:00 · How it works 0:45 · Why it beats NotebookLM 0:45 · What's next 0:30 · Buffer 0:15

---

## Before you walk up (setup checklist)

- [ ] Run `npm start` in the `studydeck` folder and open **http://localhost:3000** in Chrome, full screen (`⌃⌘F`).
- [ ] Sidebar: **Demo mode ON** (uses sample notes, so your real notes never show on the projector).
- [ ] Light mode (🌓 button) for the projector. Zoom the browser to 125% (`⌘+`) so the back row can read it.
- [ ] Clear the demo chats you'll use: open **ECON300**, click **Clear**; do the same for **All courses**.
- [ ] Ask one throwaway question to warm up Claude, then Clear again. (The first call can be slower.)
- [ ] Have the backup open in another tab: `docs/screenshot-chat.png` and `docs/screenshot-not-in-notes.png`. If Wi-Fi dies, the demo can't reach Claude, so switch to the screenshots and keep talking.
- [ ] Close Slack, email and notifications.

---

## 1. The problem (0:00 to 0:45)

> "I'm an Econ major with a full semester: Macro, Micro, Accounting, Social Innovation, plus clubs and athletics. I take every note in Granola. Capturing notes is solved. *Using* them isn't.
>
> Three weeks before a midterm I want to ask: 'what did my professor actually say about the tax multiplier?' AI tools have two problems here. One, I have to upload everything. Two, and worse, when my notes don't cover something they confidently fill the gap with general knowledge. Before an exam, that's dangerous: I need to know what *was* covered, not what *might* be true.
>
> So I built StudyDeck: a NotebookLM for my own semester that only answers from my notes and shows a receipt for every claim."

## 2. Live demo (0:45 to 2:45)

**Click-by-click script.** Say the words in quotes; do the actions in bold.

1. **Point at the sidebar.** "Every class is already here, filled from Granola with no uploading. The yellow badge means I'm in demo mode with sample data. And there's a Notes tab if you want to browse the lectures."
2. **Click `Macroeconomics`.** "Now the chat only reads Macro notes."
3. **Click the Try-asking chip "How does a tax rate change the spending multiplier?"** While it streams: "It's streaming from Claude, running locally through Claude Code."
4. **Point at the numbered circles.** "Every claim has a numbered citation, and the sources are listed underneath."
5. **Hover a numbered circle.** "Hover shows the exact sentence from my notes it relied on."
6. **Click a numbered circle (or a source under the answer).** "Click, and the original note opens, scrolled to and highlighting that passage. That's the receipt."
7. **Press `Esc`. Click the Try-asking chip "What did we learn about the Solow growth model?"** "We haven't covered Solow yet, so watch."
8. **Point at the black "Not in your notes" badge.** "It refuses to make it up. This is the feature I care most about. 'Not in your notes' is a real answer."
9. **Tick "Use general knowledge" and ask the same question by typing it.** "If I *want* outside help, I opt in, and every outside sentence is labeled General knowledge, so I never confuse it with what my professor said."
10. **Untick the toggle. Press `⌘K`, type `every`, press Enter.** "Keyboard shortcut to switch class. Now across everything…"
11. **Click the Try-asking chip "What do I have coming up this week across classes and clubs?"** "…it pulls dated items from Athletics, Clubs and Macro, all cited."
12. **(Optional, if time) Click 🌓** "And yes, there's a dark mode."

> If Claude is slow (over 15 seconds): "It's running the real model on my laptop; this is the tradeoff of no API keys and no cloud." Then switch to the screenshot tab if needed.

## 3. How it works (2:45 to 3:30)

Show the diagram from the README (scroll to **How it works** on GitHub).

> "Four steps. **Sync:** a script asks Claude, through Granola's connector, for my last 14 days of meetings. My code, not the AI, names the files and drops each one in the right course folder. **Retrieve:** if a course's notes fit in Claude's context I send them all; if not, I rank them by keywords and recency. **Answer:** the server runs the Claude Code CLI in a locked-down mode, with no tools and no web access, plus strict rules: only use these notes, cite everything, say 'Not in your notes'. **Verify:** my code checks every citation: does that note exist, and does that quote appear word for word? If not, the chip turns red.
>
> Everything is local markdown files. No database, no API key, nothing in the cloud except the call to Claude itself."

## 4. Why it's better than NotebookLM, for me (3:30 to 4:15)

> "NotebookLM is great, and to be fair it cites sources too. StudyDeck wins on three things that matter for a student:
>
> 1. **It knows my semester.** Notes flow in from Granola and land in the right course. No notebooks to build, nothing to upload.
> 2. **Honesty is the default.** Citations are *re-checked* by my own code after every answer, and 'Not in your notes' is a first-class answer. Outside knowledge is opt-in and labeled.
> 3. **My notes stay mine.** They're plain files on my laptop.
>
> Where NotebookLM still wins: audio overviews, PDFs and YouTube as sources, and flashcards today. That's my roadmap."

## 5. What I'd build next (4:15 to 4:45)

> "Exam mode: flashcards, practice quizzes and a one-page cheat sheet per course, all cited. Weak-spot tracking: remember which concepts I miss and quiz me on those first. And a gap check: compare my notes to the syllabus and flag topics I might have missed in class."

**Close (4:45 to 5:00):**
> "StudyDeck: answers from your notes, only. The code is open source at github.com/seankessner05/studydeck. Thanks!"

---

## Likely Q&A

**Q: Isn't this just ChatGPT with my notes pasted in?**
A: Three differences. The notes arrive automatically and organized by course. The model is constrained to answer only from them, with an explicit "Not in your notes". And my code verifies every citation after the answer comes back, which no chat window does.

**Q: How do you know it's not hallucinating?**
A: Two layers. The prompt forbids outside knowledge and requires a verbatim quote for each claim. Then the server checks that each quote really appears in the cited note, and flags it red if not. The honest limit: it can't catch a real quote attached to a claim the quote doesn't fully support. That's why the source is one click away.

**Q: Why not use the Claude API directly?**
A: A constraint I set: no API keys and no paid services beyond what I already have. The Claude Code CLI uses my existing login, and headless mode (`claude -p`) is scriptable. I measured the overhead and locked it down with flags, cutting each call from about 60k tokens of setup to about 2.5k.

**Q: What happens when you have hundreds of notes?**
A: Under about 200k characters per scope, everything is sent. Above that, it ranks notes by keyword overlap plus a recency boost and sends the best ones, and the UI tells you which notes it read. Semantic search is on the roadmap.

**Q: What about privacy? These are your notes.**
A: Notes are local markdown files, git-ignored so they never reach GitHub. They go to Claude through my own account, the same as if I pasted them myself. The server only listens on my laptop.

**Q: How does it know which course a meeting belongs to?**
A: If the Granola title starts with a course code, that wins. Otherwise Claude suggests a course from a fixed list, and my code rejects anything that isn't a real course. Uncertain ones go to "unsorted". Honestly, on my first real sync it put one note in a course I wouldn't have picked, which is why "move note" is on the roadmap.

**Q: What was the hardest part?**
A: Making citations trustworthy, and clickable down to the exact sentence. I changed the citation format to include a short verbatim quote so the app can both verify it and scroll to it.

**Q: How did you test it?**
A: 34 automated tests (note loading, retrieval, citation parsing, sync routing, the API) with a fake Claude so they run in under a second, plus manual end-to-end runs against the real CLI and my real Granola account.

**Q: Could other students use it?**
A: Yes. It's MIT-licensed on GitHub. They need Node and Claude Code, and they'd edit the course list in `src/courses.ts`.
