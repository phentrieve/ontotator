/**
 * Issue 651: a reviewer who stays in the task gets the lead's answer without leaving the window.
 * - A pausing question without wording; the lead answers on Questions in another browser context.
 * - Once the reviewer's bell counts the answer (its minute refresh, fast-forwarded here), the task is open again:
 *   the paused banner is gone, the text is editable, and the question reads as answered.
 * - The bell entry for the task the reviewer is in (the same route) changes nothing else and keeps it so.
 * No window focus event is sent: the page never loses focus in this test.
 */
import { expect, test, type Page } from "@playwright/test";
import { loginThroughForm } from "./helpers";
import { leadScenario } from "./leadWorkflowHelpers";

test.setTimeout(240_000);
test.use({ actionTimeout: 15_000 });

const QUESTION = "Stay-in-task question: is the dosage in line 3 meant per day?";
const ANSWER = "Yes, per day.";
const banner = (page: Page) => page.locator(".paused-notice");
const status = (page: Page) => page.locator(".translation-save-status");
const bell = (page: Page) => page.locator(".shell-header").getByRole("button", { name: /^Notifications/ });
const questions = (page: Page) => page.getByRole("region", { name: "Questions to the lead" });

test("a paused reviewer who stays in the task sees the answer and can go on", async ({ page, browser }, info) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const s = await leadScenario(page, "QUESTION_FOR_LEAD");
  const context = await browser.newContext({ baseURL: info.project.use.baseURL, viewport: { width: 1440, height: 900 } });
  try {
    // The reviewer's bell refreshes once a minute on a clock the test moves forward (installed before the app loads).
    await page.goto("about:blank");
    await page.context().clearCookies();
    await page.clock.install();
    await loginThroughForm(page, s.users.ana, s.display_names.ana);
    await page.goto(`/#/tasks/${s.tasks!.ask}`);
    await expect(page.getByRole("region", { name: "Translation review" })).toBeVisible();
    await expect(status(page)).toHaveText("Saved");

    await page.locator(".ask-lead-entry").click();
    const ask = page.getByRole("dialog", { name: "Ask the lead" });
    await ask.getByRole("textbox", { name: /Your question/ }).fill(QUESTION);
    await ask.getByRole("checkbox", { name: "Pause my task until the lead answers" }).check();
    await ask.getByRole("button", { name: "Send question" }).click();
    await expect(ask).toHaveCount(0);
    await expect(banner(page)).toContainText("Paused until the lead answers your question");
    await expect(status(page)).toHaveText("Read-only");
    const before = await bell(page).getAttribute("aria-label");

    // The lead answers in another context; the reviewer's window keeps the focus throughout.
    const lead = await context.newPage();
    await loginThroughForm(lead, s.users.lead, s.display_names.lead, { lastProject: s.project });
    await lead.goto(`/#/projects/${encodeURIComponent(s.project)}/questions`);
    await lead.getByRole("listitem").filter({ hasText: QUESTION }).getByRole("button", { name: "Answer…" }).click();
    const answer = lead.getByRole("dialog", { name: /^Answer / });
    await answer.getByRole("textbox", { name: /Your answer/ }).fill(ANSWER);
    await answer.getByRole("button", { name: "Send answer" }).click();
    await expect(answer).toHaveCount(0);

    // The bell counts the answer; the task follows without a focus event or a reload.
    await page.clock.fastForward("01:05");
    await expect(bell(page)).not.toHaveAttribute("aria-label", before ?? "");
    await expect(banner(page)).toHaveCount(0);
    await expect(status(page)).toHaveText("Saved");
    await expect(page.locator("#review-translation")).toBeEditable();
    await expect(questions(page)).toContainText(ANSWER);
    await expect(questions(page)).not.toContainText("Waiting for the lead's answer");

    // The bell entry for this task (the route the reviewer is on) keeps the task open and the answer in view.
    await bell(page).click();
    await page.getByRole("dialog", { name: "Notifications" }).getByRole("link", { name: /Answer from the lead/ }).first().click();
    await expect(banner(page)).toHaveCount(0);
    await expect(questions(page)).toContainText(ANSWER);
  } finally {
    await context.close();
  }
});
