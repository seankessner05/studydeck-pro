import { expect, test, type Locator, type Page } from "@playwright/test";

/**
 * Fast check for a coding agent after a UI change. `npm run test:e2e:smoke`.
 * The server in e2e/server.ts is the real app with made-up notes and a stand-in for Claude,
 * so these tests never call the Claude CLI or any paid API.
 */

function watch(page: Page) {
  const problems: string[] = [];
  const outside: string[] = [];
  page.on("pageerror", (e) => problems.push(`error: ${e.message}`));
  page.on("console", (m) => {
    if (m.type() === "error") problems.push(`console: ${m.text()}`);
  });
  page.on("request", (r) => {
    const url = r.url();
    if (url.startsWith("data:") || url.startsWith("http://localhost:") || url.startsWith("http://127.0.0.1:")) return;
    outside.push(url);
  });
  return { problems, outside };
}

function expectClean(seen: { problems: string[]; outside: string[] }) {
  expect(seen.problems, seen.problems.join("\n")).toEqual([]);
  expect(seen.outside, seen.outside.join("\n")).toEqual([]);
}

async function openStudy(page: Page) {
  await page.goto("/");
  await page.locator('[data-view="study"]').click();
  await expect(page.getByRole("heading", { name: "Today's plan" })).toBeVisible();
}

async function showStudyScreen(page: Page, sub: string, landmark: Locator) {
  await page.locator(`#studyBody [data-sub="${sub}"]`).click();
  await expect(page.locator(`#studyBody [data-sub="${sub}"]`)).toHaveAttribute("aria-current", "page");
  await expect(landmark).toBeVisible();
}

test.describe("smoke", () => {
  test("the app loads, and Chat, Notes, and Study each open", async ({ page }) => {
    const seen = watch(page);
    await page.goto("/");
    await expect(page).toHaveTitle("StudyDeck");
    await expect(page.locator("#q")).toBeVisible();
    await expect(page.locator("#send")).toBeEnabled();

    await page.locator('[data-view="notes"]').click();
    await expect(page.locator("#notesSearch")).toBeVisible();
    const costs = page.locator('[data-open="ECON301/2026-10-08_theory-of-costs.md"]');
    await expect(costs).toBeVisible();
    await costs.click();
    await expect(page.locator("#sourceBody")).toContainText("Marginal cost");
    await page.locator("#closeSource").click();
    await expect(page.locator("#source")).toBeHidden();

    await page.locator('[data-view="study"]').click();
    await expect(page.getByRole("heading", { name: "Today's plan" })).toBeVisible();
    for (const sub of ["today", "cards", "quiz", "problems", "tutor", "exam", "progress"]) {
      await expect(page.locator(`#studyBody [data-sub="${sub}"]`)).toBeVisible();
    }

    await page.locator('[data-view="chat"]').click();
    await expect(page.locator("#q")).toBeVisible();
    expectClean(seen);
  });

  test("every Study screen renders its own controls", async ({ page }) => {
    const seen = watch(page);
    await openStudy(page);
    const screens: [string, Locator][] = [
      ["today", page.getByRole("heading", { name: "Today's plan" })],
      ["cards", page.getByText("Add a card by hand")],
      ["quiz", page.locator("#startQuiz")],
      ["problems", page.locator("#startPractice")],
      ["tutor", page.getByRole("heading", { name: "Explain it first. Find the gap." })],
      ["exam", page.getByRole("heading", { name: "Your next exams" })],
      ["progress", page.getByText("Weak spots", { exact: true })],
    ];
    for (const [sub, landmark] of screens) await showStudyScreen(page, sub, landmark);
    expectClean(seen);
  });

  test("a card added by hand can be flipped and rated", async ({ page }) => {
    const seen = watch(page);
    const front = `Smoke card ${Date.now()}`;
    await openStudy(page);
    await showStudyScreen(page, "cards", page.getByText("Add a card by hand"));
    if (await page.locator("#cardCourse").count()) await page.locator("#cardCourse").selectOption("ECON301");
    await page.locator("#cardFront").fill(front);
    await page.locator("#cardBack").fill("The next best thing you gave up.");
    await page.locator("#cardForm").getByRole("button", { name: "Add card" }).click();
    await expect(page.locator("#studyBody")).toContainText(front);

    await page.locator("#startStudy").click();
    await expect(page.locator("#revealBtn")).toBeVisible();
    await expect(page.locator("[data-grade]")).toHaveCount(0);
    await page.locator("#revealBtn").click();
    await expect(page.locator("[data-grade]")).toHaveCount(4);
    await page.locator('[data-grade="3"]').click();
    await expect(page.locator("#revealBtn")).toBeVisible();
    expectClean(seen);
  });

  test("a quick mock exam can be handed in, and the page never receives the key", async ({ page }) => {
    const seen = watch(page);
    await openStudy(page);
    await showStudyScreen(page, "exam", page.getByRole("heading", { name: "Your next exams" }));
    await page.locator('[data-ex-preset="quick"]').click();
    const started = page.waitForResponse((r) => r.url().includes("/api/study/exam/start") && r.request().method() === "POST");
    await page.locator("#studyBody div.space-y-3", { has: page.getByText("Exam 2", { exact: true }) }).locator("[data-ex-start]").click();
    const body = await (await started).text();
    expect(body).toContain('"items"');
    expect(body).not.toMatch(/"answer"|"explanation"|"steps"|"rubric"/);

    await expect(page.locator("#examHandIn")).toBeVisible();
    const choice = page.locator("#studyBody [data-ex-opt]").first();
    if (await choice.count()) await choice.click();
    page.once("dialog", (d) => d.accept());
    await page.locator("#examHandIn").click();
    await expect(page.locator("#examHandIn")).toHaveCount(0);
    await expect(page.locator("#studyBody")).toContainText(/\d+%|\d+ of \d+ points/);
    expectClean(seen);
  });

  test("a chat question is answered from the notes, with a citation", async ({ page }) => {
    const seen = watch(page);
    await page.goto("/");
    await page.locator("#q").fill("What is fixed cost?");
    await page.locator("#send").click();
    const chip = page.locator("#messages button.cite").first();
    await expect(chip).toBeVisible();
    await expect(page.locator("#messages")).toContainText(/fixed cost/i);
    await chip.click();
    await expect(page.locator("#sourceBody")).toContainText("fixed cost");
    expectClean(seen);
  });
});
