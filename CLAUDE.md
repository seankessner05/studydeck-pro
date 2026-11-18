# Working on StudyDeck

## Check your change in the browser

After you change anything a person clicks (the Chat, Notes, or Study tabs, a Study screen, cards, quizzes, practice problems, exams, or chat), run the smoke tests before you treat the change as done:

```bash
npx playwright install chromium   # once per machine
npm run test:e2e:smoke
```

Read the Playwright report and fix from that. When the suite covers the flow, that report is the check.

`npm run test:e2e:smoke` covers: the app loads and Chat, Notes, and Study open; every Study screen renders; a card added by hand can be flipped and rated; a quick mock exam can be handed in; a chat answer comes back with a citation. It finishes in well under a minute.

`npm run test:e2e` is the full browser suite (desktop and phone), including those checks plus undo, restore, hostile text, math, and graphs. Run it when you change shared study UI, security, or rendering. `npm test` is the unit and API suite and does not need a browser. `npm run typecheck` checks types.

## These tests never call Claude

Playwright starts the app itself (`e2e/server.ts` on port 3210) with made-up notes and a stand-in for the Claude runner. Do not point the tests at `npm run dev`. Do not set an API key. Do not commit `.env` or anything under `notes/` or `data/`.

GitHub Actions runs `npm run typecheck`, `npm test`, and `npm run test:e2e` on every pull request. No secrets are used.
