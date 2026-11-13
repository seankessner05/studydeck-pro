import { test, expect, type Page } from "@playwright/test";

/** Collects anything that should never happen on any screen: script errors and blocked-by-policy resources. */
function watch(page: Page) {
  const problems: string[] = [];
  page.on("pageerror", (e) => problems.push(`error: ${e.message}`));
  page.on("console", (m) => {
    if (m.type() === "error") problems.push(`console: ${m.text()}`);
  });
  return problems;
}

const api = async (page: Page, url: string) => (await page.request.get(url)).json();

async function openStudy(page: Page, sub?: string) {
  await page.goto("/");
  await page.locator('[data-view="study"]').click();
  await expect(page.locator("#studyBody [data-sub='cards']")).toBeVisible();
  if (sub) await page.locator(`#studyBody [data-sub="${sub}"]`).click();
}

/** The hostile text must show up as text. If it ever ran, it set window.__xss; if it ever became markup, there is an <img src="x">. */
async function expectNothingRan(page: Page, where: string) {
  const state = await page.evaluate(() => ({ ran: (window as any).__xss ?? null, imgs: document.querySelectorAll('img[src="x"]').length, scripts: [...document.querySelectorAll("script")].filter((s) => s.textContent?.includes("__xss")).length }));
  expect(state, where).toEqual({ ran: null, imgs: 0, scripts: 0 });
}

test.describe("the five things that must always work", () => {
  test("flip a card and rate it", async ({ page }) => {
    const problems = watch(page);
    // Its own fresh card, so this works whatever the tests before it have already studied.
    const made = await page.request.post("/api/study/cards", { data: { course: "ECON301", front: `What is opportunity cost? (${Date.now()})`, back: "The value of the next best alternative." } });
    expect(made.ok()).toBe(true);
    await openStudy(page);
    const before = (await api(page, "/api/study/today?course=all")).accuracy.reviews;
    await page.locator("#startStudy").click();
    await expect(page.locator("#revealBtn")).toBeVisible();
    await expect(page.locator("[data-grade]")).toHaveCount(0);
    await page.locator("#revealBtn").click();
    await expect(page.locator("[data-grade]")).toHaveCount(4);
    await page.locator('[data-grade="3"]').click();
    await expect.poll(async () => (await api(page, "/api/study/today?course=all")).accuracy.reviews).toBe(before + 1);
    expect(problems).toEqual([]);
  });

  test("take a quiz to the end", async ({ page }) => {
    const problems = watch(page);
    await openStudy(page, "quiz");
    await page.locator("#startQuiz").click();
    await expect(page.locator("#exitQuiz")).toBeVisible();
    let answered = 0;
    // the results screen has no options and no "next" button
    for (let i = 0; i < 40 && (await page.locator("#studyBody [data-opt], #nextQ").count()); i++) {
      if (await page.locator("#nextQ").isVisible()) { await page.locator("#nextQ").click(); await page.waitForFunction(() => !document.querySelector("#nextQ")); continue; }
      await page.locator("#studyBody [data-opt]").first().click();
      if (await page.locator("#checkAnswer").isVisible()) await page.locator("#checkAnswer").click();
      await expect(page.locator("#nextQ")).toBeVisible();
      answered++;
    }
    expect(answered).toBeGreaterThan(2);
    // the quiz ended on its results screen, and the answers were recorded
    await expect(page.locator("#studyBody [data-opt]")).toHaveCount(0);
    const home = await api(page, "/api/study/quiz/home?course=all");
    expect(home.questions.filter((x: any) => x.asked > 0).length).toBeGreaterThan(2);
    expect(problems).toEqual([]);
  });

  test("answer a practice problem and see the worked steps", async ({ page }) => {
    const problems = watch(page);
    await openStudy(page, "problems");
    await page.locator("#startPractice").click();
    await expect(page.locator("#problemInput")).toBeVisible();
    const stem = await page.locator("#studyBody").innerText();
    await page.locator("#problemInput").fill(stem.includes("monopolist") ? "15" : "20");
    await page.locator("#checkProblem").click();
    await expect(page.locator("#nextP")).toBeVisible();
    await expect(page.locator("#studyBody")).toContainText(/correct|right/i);
    expect(problems).toEqual([]);
  });

  test("sit a mock exam and hand it in", async ({ page }) => {
    const problems = watch(page);
    await openStudy(page, "exam");
    await page.locator('[data-ex-preset="quick"]').click();
    await page.locator("[data-ex-start]").first().click();
    await expect(page.locator("#examHandIn")).toBeVisible({ timeout: 15_000 });
    // the exam page must never be sent an answer key
    const sent = await page.evaluate(() => JSON.stringify((window as any).EXM?.sitting ?? {}));
    expect(sent).not.toMatch(/"answer"|"explanation"|"steps"/);
    const firstOptions = page.locator("#studyBody [data-ex-opt]");
    if (await firstOptions.count()) await firstOptions.first().click();
    page.once("dialog", (d) => d.accept());
    await page.locator("#examHandIn").click();
    await expect(page.locator("#examHandIn")).toHaveCount(0);
    await expect(page.locator("#studyBody")).toContainText(/\d+\s*(of|\/)\s*\d+|%/);
    expect(problems).toEqual([]);
  });

  test("open the plan and start its first step", async ({ page }) => {
    const problems = watch(page);
    await openStudy(page, "progress");
    await expect(page.getByText("Today's plan")).toBeVisible();
    await expect(page.locator("[data-plan-go]").first()).toBeVisible();
    await page.locator("[data-plan-go]").first().click();
    // whatever the step is, it takes you out of the Progress screen into doing something
    await expect(page.getByText("Today's plan")).toHaveCount(0);
    expect(problems).toEqual([]);
  });
});

test.describe("deleting and restoring", () => {
  test("a deleted card can be brought back with Undo", async ({ page }) => {
    await openStudy(page);
    const total = async () => (await api(page, "/api/study/today?course=all")).counts.total;
    const before = await total();
    await page.locator("[data-del-card]").first().click();
    await expect(page.locator("#toast")).toContainText("moved to trash");
    expect(await total()).toBe(before - 1);
    await page.locator("[data-toast-action]").click();
    await expect(page.locator("#toast")).toContainText("put back");
    expect(await total()).toBe(before);
  });

  test("the Trash list restores, keeps focus inside, and closes with Escape", async ({ page }) => {
    await openStudy(page);
    await page.locator("[data-del-card]").first().click();
    await expect(page.locator("#toast")).toContainText("moved to trash");
    const opener = page.locator("[data-trash-open]");
    await opener.click();
    const dialog = page.getByRole("dialog", { name: "Trash" });
    await expect(dialog).toBeVisible();
    await expect(dialog.locator("[data-trash-restore]")).toHaveCount(1);
    for (let i = 0; i < 6; i++) await page.keyboard.press("Tab");
    expect(await page.evaluate(() => !!document.activeElement?.closest("#dialogPanel"))).toBe(true);
    await dialog.locator("[data-trash-restore]").click();
    await expect(dialog).toContainText("The trash is empty");
    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
    await expect(opener).toBeFocused();
  });

  test("a backup can be looked into without changing anything, then restored", async ({ page }) => {
    await openStudy(page, "progress");
    await page.locator("[data-restore-open]").click();
    const dialog = page.getByRole("dialog", { name: "Restore a backup" });
    await dialog.locator("[data-restore-look]").last().click();
    await expect(dialog.getByRole("table")).toContainText("Flashcards");
    const before = (await api(page, "/api/study/backups")).length;
    await dialog.locator("[data-restore-go]").click();
    await page.waitForLoadState("load");
    await expect.poll(async () => (await api(page, "/api/study/backups")).length).toBe(before + 1);
    await expect(page.locator('[data-view="study"]')).toBeVisible();
  });
});

test.describe("text typed into the app can never run as code", () => {
  test("hostile text in a note, card, question, problem and exam name is shown as text on every screen", async ({ page }) => {
    const problems = watch(page);
    await openStudy(page);
    await expect(page.locator("#studyBody")).toContainText("Hostile card");
    await expectNothingRan(page, "cards home");

    // every card, front and back
    await page.locator("#startStudy").click();
    await expect(page.locator("#revealBtn")).toBeVisible();
    let cards = 0;
    let sawHostileCard = false;
    for (let i = 0; i < 12 && (await page.locator("#revealBtn").isVisible()); i++) {
      await page.locator("#revealBtn").click();
      await expect(page.locator("[data-grade]")).toHaveCount(4);
      sawHostileCard ||= (await page.locator("#studyBody").innerText()).includes("Hostile card");
      await expectNothingRan(page, `card ${i} answer`);
      await page.locator('[data-grade="4"]').click();
      // Wait for what comes next (the next card, or the end of the session) instead of a fixed pause,
      // which was too short on a slower machine.
      await page.waitForFunction(() => !!document.querySelector("#revealBtn") || !document.querySelector("[data-grade]"));
      cards++;
    }
    expect(cards).toBeGreaterThan(1);
    expect(sawHostileCard).toBe(true);
    await expectNothingRan(page, "after the card session");

    // every question with its feedback
    await openStudy(page, "quiz");
    await expectNothingRan(page, "quiz home");
    await page.locator('[data-qlen="20"]').click();
    await page.locator("#startQuiz").click();
    await expect(page.locator("#exitQuiz")).toBeVisible();
    let sawHostileQuestion = false;
    for (let i = 0; i < 60 && (await page.locator("#studyBody [data-opt], #nextQ").count()); i++) {
      if (await page.locator("#nextQ").isVisible()) { await page.locator("#nextQ").click(); await page.waitForFunction(() => !document.querySelector("#nextQ")); continue; }
      sawHostileQuestion ||= (await page.locator("#studyBody").innerText()).includes("Hostile question");
      await page.locator("#studyBody [data-opt]").last().click();
      if (await page.locator("#checkAnswer").isVisible()) await page.locator("#checkAnswer").click();
      await expect(page.locator("#nextQ")).toBeVisible();
      await expectNothingRan(page, `quiz feedback ${i}`);
    }
    expect(sawHostileQuestion).toBe(true);

    // every problem with its worked solution
    await openStudy(page, "problems");
    await expectNothingRan(page, "problems home");
    await page.locator('[data-pr-len="10"]').click();
    await page.locator("#startPractice").click();
    await expect(page.locator("#giveUp")).toBeVisible();
    let sawHostileProblem = false;
    for (let i = 0; i < 6 && (await page.locator("#giveUp").isVisible()); i++) {
      sawHostileProblem ||= (await page.locator("#studyBody").innerText()).includes("Hostile problem");
      await page.locator("#hintBtn").click();
      await page.locator("#giveUp").click();
      await expect(page.locator("#nextP")).toBeVisible();
      await expectNothingRan(page, `problem solution ${i}`);
      await page.locator("#nextP").click();
      // the next problem, or the end of the practice set
      await page.waitForFunction(() => !!document.querySelector("#giveUp") || !document.querySelector("#nextP"));
    }
    expect(sawHostileProblem).toBe(true);

    for (const sub of ["tutor", "exam", "progress"]) {
      await openStudy(page, sub);
      // wait until the screen has loaded (the loading dots are gone), so the check below looks at real content
      await page.waitForFunction(() => !document.querySelector("#studyBody .dots") && document.querySelector("#studyBody")!.textContent!.length > 200);
      await expectNothingRan(page, sub);
    }
    await expect(page.locator("#studyBody")).toContainText("Hostile");

    // the note list and the note itself
    await page.locator('[data-view="notes"]').click();
    await page.locator('[data-open*="hostile"]').click();
    await expect(page.locator("#sourceBody")).toContainText("javascript:alert(1)");
    await expectNothingRan(page, "note viewer");
    expect(await page.locator("#sourceBody a").count()).toBe(0);

    // the trash list and the undo message carry the card's text too
    await page.keyboard.press("Escape");
    await openStudy(page);
    await page.locator("[data-del-card]").first().click();
    await expect(page.locator("#toast")).toContainText("moved to trash");
    await page.locator("[data-trash-open]").click();
    await expectNothingRan(page, "trash list");
    await page.getByRole("dialog").locator("[data-trash-restore]").first().click();
    expect(problems).toEqual([]);
  });

  test("a cited answer still links to its passage when the quote has an apostrophe and an ampersand", async ({ page }) => {
    const problems = watch(page);
    await page.goto("/");
    await page.locator("#q").fill("What is fixed cost?");
    await page.locator("#send").click();
    const chip = page.locator("#messages button.cite").first();
    await expect(chip).toBeVisible();
    await expect(chip).toHaveText("1");
    await expect(chip).toHaveAttribute("data-quote", "A firm's fixed cost doesn't change with output & is paid even at Q = 0");
    await chip.click();
    await expect(page.locator("#sourceBody .hl")).toContainText("A firm's fixed cost doesn't change with output & is paid even at Q = 0");
    expect(problems).toEqual([]);
  });
});

test.describe("the browser enforces the security rules too", () => {
  test("the page runs no inline script and loads nothing from elsewhere", async ({ page }) => {
    const blocked: string[] = [];
    await page.exposeFunction("__reportViolation", (d: string) => blocked.push(d));
    await page.addInitScript(() => document.addEventListener("securitypolicyviolation", (e) => (window as any).__reportViolation(`${e.violatedDirective} ${e.blockedURI}`)));
    const outside: string[] = [];
    page.on("request", (r) => {
      if (!r.url().startsWith("http://localhost:") && !r.url().startsWith("data:")) outside.push(r.url());
    });
    await openStudy(page, "progress");
    await page.locator('[data-view="notes"]').click();
    await page.locator('[data-view="chat"]').click();
    expect(blocked).toEqual([]);
    expect(outside).toEqual([]);
    // an injected inline script is refused by the policy
    await page.evaluate(() => {
      const s = document.createElement("script");
      s.textContent = "window.__inline = 1";
      document.head.appendChild(s);
    });
    expect(await page.evaluate(() => (window as any).__inline ?? null)).toBeNull();
  });

  test("the server refuses a body that isn't JSON, even from its own page", async ({ page }) => {
    await page.goto("/");
    const status = await page.evaluate(async () => (await fetch("/api/settings", { method: "POST", headers: { "content-type": "text/plain" }, body: '{"newPerDay":99}' })).status);
    expect(status).toBe(415);
  });
});
