# StudyDeck: one-page summary

**Answers from your notes. Only.**
A local study assistant that answers questions about my class notes, cites every claim, and says "Not in your notes" instead of guessing.

**Sean Kessner** · Economics major, Entrepreneurship minor · Hobart and William Smith Colleges
**Code:** github.com/seankessner05/studydeck (MIT license)

---

### The problem
- My semester's notes live in Granola across 4 courses plus clubs, events and athletics.
- AI study tools make me **upload** everything, and when my notes don't cover a topic they **fill the gap with general knowledge**, which is risky before an exam.

### The solution
- **Knows my semester:** a one-time Granola sign-in copies the whole semester into class folders (using my Granola folders) and keeps it fresh automatically.
- **Cited, verified answers:** every claim links to its source note; the app checks each quoted passage word-for-word.
- **Honest by default:** "Not in your notes" is a first-class answer; outside knowledge is opt-in and labeled.
- **One click to the receipt:** the source opens scrolled to the exact highlighted passage.

### How it works
Granola (direct MCP connection) → `./notes/<course>/*.md` → keyword + recency retrieval → **Claude Code CLI** (`claude -p`, locked down: no tools, strict prompt) → citation validator → streamed to the browser.
Node + TypeScript + Express · plain JS + Tailwind · local markdown files · no database, no API key.

### Results
- Works end-to-end on my real Granola account (12 meetings found, 11 notes synced and auto-sorted).
- Every cited quote in my test answers verified against its note.
- Locked-down CLI calls cut per-question overhead from about 60k to about 2.5k tokens.
- 34 automated tests; laptop, phone and dark-mode layouts.

### vs. NotebookLM
| | StudyDeck | NotebookLM |
|---|---|---|
| Notes in | Auto-sync from Granola | Manual upload |
| Citations | Linked + re-verified word-for-word | Linked to passages |
| "Not in your notes" | Explicit badge, default | Usually says so |
| Data | Local files | Cloud |
| Flashcards / audio | Roadmap | Yes |

### Next
**Exam mode** (flashcards, quizzes, cheat sheet) · **Weak-spot tracking** · **Syllabus gap check** · move notes in the app · semantic search

### Honest limits
Needs Claude Code installed (each question uses my Claude plan, 3 to 15 s) · keyword retrieval, not semantic · sync relies on the model copying notes verbatim · course auto-routing for unprefixed titles can guess wrong.
