/**
 * Issue 590: the acceptance defects of "Ask the lead" (#561).
 * - A pausing question pauses the task at once, as a problem report does, without a reload.
 * - The banner names the question and its way out; "Text problems" does not count it. The asker can resume.
 * - The next question does not quote the previous selection again.
 * - "Questions (n)" follows an answer at once.
 * - Taking a wording whose passage is gone says so.
 * - Export leads to the Questions page for a text paused by a question.
 * - The Questions page is for leads only.
 * Screenshots for human review only (never baselines): ONTOTATOR_SHOTS_DIR, else build/ask-the-lead-pause.
 */
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { loginThroughForm } from "./helpers";
import { leadScenario, type LeadPerson, type LeadScenario } from "./leadWorkflowHelpers";

test.setTimeout(240_000);
test.use({ actionTimeout: 15_000, deviceScaleFactor: 2 });

const QUOTE = "generalized hypotonia";
const WORDING = "generalized muscular hypotonia";
const QUESTION = "I cannot go on without knowing: is muscular hypotonia meant here?";
const SECOND = "Which glossary applies to this text?";

async function shot(page: Page, name: string) {
  const dir = process.env.ONTOTATOR_SHOTS_DIR ?? resolve(test.info().config.rootDir, "../../build/ask-the-lead-pause");
  mkdirSync(dir, { recursive: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth), `${name}: no horizontal scroll`).toBe(true);
  await page.screenshot({ path: resolve(dir, `${name}.png`) });
}

function consoleErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on("console", message => { if (message.type() === "error") errors.push(message.text()); });
  page.on("pageerror", error => errors.push(error.message));
  return errors;
}

async function login(page: Page, s: LeadScenario, who: LeadPerson) {
  await page.goto("about:blank");
  await page.context().clearCookies();
  if (who !== "lead") return loginThroughForm(page, s.users[who], s.display_names[who]);
  await loginThroughForm(page, s.users.lead, s.display_names.lead, { lastProject: s.project });
}

async function openReview(page: Page, assignmentId: number) {
  await page.goto(`/#/tasks/${assignmentId}`);
  await expect(page.getByRole("region", { name: "Translation review" })).toBeVisible();
}

const questions = (page: Page) => page.getByRole("region", { name: "Questions to the lead" });
const status = (page: Page) => page.locator(".translation-save-status");
const banner = (page: Page) => page.locator(".paused-notice");

async function selectPassage(page: Page, quote: string) {
  await page.evaluate(text => {
    const editor = document.getElementById("review-translation") as HTMLTextAreaElement;
    const start = editor.value.indexOf(text);
    editor.focus(); editor.setSelectionRange(start, start + text.length);
  }, quote);
}

async function askPausing(page: Page, question: string, wording?: string) {
  await page.getByRole("button", { name: "Ask the lead", exact: true }).click();
  const ask = page.getByRole("dialog", { name: "Ask the lead" });
  await ask.getByRole("textbox", { name: /Your question/ }).fill(question);
  if (wording) await ask.getByRole("textbox", { name: /Your wording for this passage/ }).fill(wording);
  await ask.getByRole("checkbox", { name: "Pause my task until the lead answers" }).check();
  await expect(ask.locator(".modal-actions")).toContainText("Your task is paused until the lead answers.");
  await ask.getByRole("button", { name: "Send question" }).click();
  await expect(ask).toHaveCount(0);
}

async function expectPausedByQuestion(page: Page) {
  await expect(status(page)).toHaveText("Read-only");
  await expect(page.getByRole("button", { name: "Ask the lead", exact: true })).toHaveCount(0);
  await expect(page.locator("#review-translation")).not.toBeEditable();
  await expect(banner(page)).toContainText("Paused until the lead answers your question");
  // Not a text problem: the header entry offers a new report, with no pause badge.
  await expect(page.getByRole("button", { name: /^Report a text problem/ })).toBeVisible();
  await expect(page.getByRole("button", { name: /^Text problems/ })).toHaveCount(0);
}

test("1440 px: a pausing question pauses at once, names itself, can be resumed; the lead's views follow", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const errors = consoleErrors(page);
  const s = await leadScenario(page, "QUESTION_FOR_LEAD");
  const tasks = s.tasks!;

  // The reviewer asks about a passage and pauses the task: it is paused at once, without a reload.
  await login(page, s, "ana");
  await openReview(page, tasks.ask);
  await expect(status(page)).toHaveText("Saved");
  await selectPassage(page, QUOTE);
  await askPausing(page, QUESTION, WORDING);
  await expect(questions(page)).toContainText("Question sent. Your task is paused until the lead answers.");
  await expectPausedByQuestion(page);
  await shot(page, "after-1-paused-at-once-1440");
  await banner(page).getByRole("button", { name: "Show more" }).click();
  await expect(banner(page)).toContainText("choose “Resume my task…” under “Questions to the lead”");
  await expect(banner(page)).not.toContainText("Text problems");
  await shot(page, "after-2-banner-more-1440");

  // After a reload the state is the same.
  await page.reload();
  await expect(page.getByRole("region", { name: "Translation review" })).toBeVisible();
  await expectPausedByQuestion(page);

  // The asker resumes: the task opens at once, the question stays open.
  const mine = questions(page).getByRole("listitem").filter({ hasText: QUESTION });
  await expect(mine).toContainText("Waiting for the lead's answer. Your task is paused.");
  await mine.getByRole("button", { name: "Resume my task…" }).click();
  await mine.getByRole("textbox", { name: /Why can you continue/ }).fill("I can check the other passages meanwhile.");
  await mine.scrollIntoViewIfNeeded();
  await shot(page, "after-3-resume-1440");
  await mine.getByRole("button", { name: "Resume my task", exact: true }).click();
  await expect(questions(page)).toContainText("Resumed. Your question stays open.");
  await expect(mine).toContainText("Waiting for the lead's answer");
  await expect(mine).not.toContainText("Your task is paused");
  await expect(banner(page)).toHaveCount(0);
  await expect(page.locator("#review-translation")).toBeEditable();
  await expect(status(page)).toHaveText("Saved");

  // The reviewer edits the passage away, so the lead cannot take the wording later.
  const editor = page.locator("#review-translation");
  const text = await editor.inputValue();
  await editor.fill(text.replace(QUOTE, "generalised hypotonia"));
  await expect(status(page)).toHaveText("Saved", { timeout: 15_000 });

  // A second question does not quote the earlier selection again; it pauses the task again.
  await page.getByRole("button", { name: "Ask the lead", exact: true }).click();
  const ask = page.getByRole("dialog", { name: "Ask the lead" });
  await expect(ask.getByRole("textbox", { name: /Passage you ask about/ })).toHaveValue("");
  await ask.getByRole("button", { name: "Cancel" }).click();
  await askPausing(page, SECOND);
  await expectPausedByQuestion(page);

  // A reviewer cannot open the Questions page by its address.
  await page.goto(`/#/projects/${encodeURIComponent(s.project)}/questions`);
  await expect(page.getByText("The Questions page is for project leads.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Answer…" })).toHaveCount(0);
  await shot(page, "after-4-reviewer-questions-url-1440");

  // The lead: taking the wording of a passage that is gone says what to do.
  await login(page, s, "lead");
  await page.getByRole("link", { name: "Questions, 3 open" }).click();
  const first = page.getByRole("list", { name: "3 open questions" }).getByRole("listitem").filter({ hasText: QUESTION });
  await first.getByRole("button", { name: "Answer…" }).click();
  const answer = page.getByRole("dialog", { name: /^Answer Ana Weber/ });
  await answer.getByRole("textbox", { name: /Your answer/ }).fill("Yes, muscular hypotonia is meant.");
  await answer.getByRole("checkbox", { name: /Take the proposed wording/ }).check();
  await answer.getByRole("button", { name: "Answer and take the wording" }).click();
  await expect(answer).toContainText("The quoted passage is no longer in the reviewer's text, so the wording cannot be taken.");
  await shot(page, "after-5-quote-gone-1440");
  await answer.getByRole("checkbox", { name: /Take the proposed wording/ }).uncheck();
  await answer.getByRole("button", { name: "Send answer" }).click();
  await expect(answer).toHaveCount(0);
  // The sidebar count follows the Open tab at once.
  await expect(page.getByRole("list", { name: "2 open questions" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Questions, 2 open" })).toBeVisible();
  await shot(page, "after-6-count-follows-1440");

  // Export: the text paused by the second question leads to the Questions page.
  await page.goto(`/#/projects/${encodeURIComponent(s.project)}/export`);
  const waiting = page.getByRole("row").filter({ hasText: `Waiting for your answer to a question: ${SECOND}` });
  await expect(waiting).toBeVisible({ timeout: 30_000 });
  await expect(waiting.getByRole("link", { name: /^Open Questions/ })).toHaveAttribute("href", `#/projects/${encodeURIComponent(s.project)}/questions`);
  await waiting.scrollIntoViewIfNeeded();
  await shot(page, "after-7-export-1440");
  await waiting.getByRole("link", { name: /^Open Questions/ }).click();
  await expect(page.getByRole("heading", { name: "Questions", level: 1 })).toBeVisible();
  // The only failed request is the refused answer with the wording (409, quote_not_found).
  expect(errors).toEqual(["Failed to load resource: the server responded with a status of 409 (Conflict)"]);
});

test("390 px: a pausing question pauses at once on a phone", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const errors = consoleErrors(page);
  const s = await leadScenario(page, "QUESTION_FOR_LEAD");
  await login(page, s, "ana");
  await openReview(page, s.tasks!.ask);
  await page.getByRole("button", { name: "Ask the lead", exact: true }).click();
  const ask = page.getByRole("dialog", { name: "Ask the lead" });
  await ask.getByRole("textbox", { name: /Your question/ }).fill(QUESTION);
  await ask.getByRole("checkbox", { name: "Pause my task until the lead answers" }).check();
  await shot(page, "after-8-ask-dialog-390");
  await ask.getByRole("button", { name: "Send question" }).click();
  await expect(ask).toHaveCount(0);
  await expectPausedByQuestion(page);
  await page.evaluate(() => window.scrollTo(0, 0));
  await shot(page, "after-9-paused-390");
  expect(errors).toEqual([]);
});
