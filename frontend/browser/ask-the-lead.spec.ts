/**
 * Issue 553 (prototype): "Ask the lead" in a translation review instead of Query as a decision.
 * - The reviewer asks with a quoted passage and a proposed wording; the task stays open.
 * - The lead sees the question under Questions, answers and takes the wording into the reviewer's text in one step.
 * - The reviewer reads the answer in the task and sees the wording in the text.
 * - The decisions are Accepted unchanged, Accepted with corrections and Rejected; an old Query review stays readable.
 * Screenshots for human review only (never baselines): ONTOTATOR_SHOTS_DIR, else build/ask-the-lead.
 */
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { activityLines, documentsReady, documentsTab, openTextCard } from "./documentsHelpers";
import { loginThroughForm } from "./helpers";
import { leadScenario, type LeadPerson, type LeadScenario } from "./leadWorkflowHelpers";

test.setTimeout(240_000);
test.use({ actionTimeout: 15_000, deviceScaleFactor: 2 });

const QUOTE = "generalized hypotonia";
const WORDING = "generalized muscular hypotonia";
const QUESTION = "The source says hypotonia. Is muscular hypotonia meant here?";
const ANSWER = "Yes, muscular hypotonia is meant. I put it into your text; please check and submit.";
const esc = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

async function shot(page: Page, name: string) {
  const dir = process.env.ONTOTATOR_SHOTS_DIR ?? resolve(test.info().config.rootDir, "../../build/ask-the-lead");
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

test("1440 px: ask, answer with the proposed wording, read the answer; three decisions; an old Query stays readable", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const errors = consoleErrors(page);
  const s = await leadScenario(page, "QUESTION_FOR_LEAD");
  const tasks = s.tasks!;

  // The reviewer: three decisions, no Query.
  await login(page, s, "ana");
  await openReview(page, tasks.ask);
  const decisions = page.getByRole("group", { name: "Decision" });
  await expect(decisions.getByRole("radio")).toHaveCount(3);
  await expect(decisions).toContainText("Accepted unchanged");
  await expect(decisions).toContainText("Accepted with corrections");
  await expect(decisions).toContainText("Rejected");
  await expect(decisions).not.toContainText("Query");
  await expect(questions(page)).toContainText("Not sure about something? Ask the lead.");
  await decisions.scrollIntoViewIfNeeded();
  await shot(page, "decisions-1440");

  // Select the passage, then "Ask the lead": the quote is filled in.
  await page.evaluate(quote => {
    const editor = document.getElementById("review-translation") as HTMLTextAreaElement;
    const start = editor.value.indexOf(quote);
    editor.focus(); editor.setSelectionRange(start, start + quote.length);
  }, QUOTE);
  // Issue 611: the header button and the one in the rail read the same; the role line names the same role as elsewhere.
  await expect(page.getByRole("button", { name: "Ask the lead…" })).toHaveCount(2);
  await expect(page.getByTestId("current-user").locator(".cell-secondary")).toHaveText("Annotator · translation review");
  await page.locator(".ask-lead-entry").click();
  const ask = page.getByRole("dialog", { name: "Ask the lead" });
  await expect(ask.getByRole("textbox", { name: /Passage you ask about/ })).toHaveValue(QUOTE);
  await ask.getByRole("textbox", { name: /Your question/ }).fill(QUESTION);
  await ask.getByRole("textbox", { name: /Your wording for this passage/ }).fill(WORDING);
  await expect(ask).toContainText("Your task stays open. Keep working while the lead answers; you decide yourself.");
  await expect(ask.getByRole("checkbox", { name: "Pause my task until the lead answers" })).not.toBeChecked();
  await shot(page, "ask-dialog-1440");
  await ask.getByRole("button", { name: "Send question" }).click();
  await expect(ask).toHaveCount(0);
  await expect(questions(page)).toContainText("Question sent. You can keep working.");
  await expect(questions(page)).toContainText("Waiting for the lead's answer");
  await expect(questions(page)).toContainText(QUESTION);
  // Not paused: the text stays editable.
  await expect(page.locator("#review-translation")).toBeEditable();
  await questions(page).scrollIntoViewIfNeeded();
  await shot(page, "task-pending-1440");

  // The lead: Questions in the sidebar, both open questions with their wording.
  await login(page, s, "lead");
  await page.getByRole("link", { name: "Questions, 2 open" }).click();
  await expect(page.getByRole("heading", { name: "Questions", level: 1 })).toBeVisible();
  const list = page.getByRole("list", { name: "2 open questions" });
  const mine = list.getByRole("listitem").filter({ hasText: QUESTION });
  await expect(mine).toContainText(new RegExp(`Ana Weber \\(${esc(s.pseudonyms.ana)}\\) · translation review of ${s.cases!.ask} de`));
  await expect(mine.getByRole("region", { name: /Proposed wording/ }).locator("ins")).toHaveText(/muscular/);
  await shot(page, "lead-questions-1440");
  await mine.getByRole("button", { name: "Answer…" }).click();
  const answer = page.getByRole("dialog", { name: /^Answer Ana Weber/ });
  await answer.getByRole("textbox", { name: /Your answer/ }).fill(ANSWER);
  await answer.getByRole("checkbox", { name: /Take the proposed wording/ }).check();
  await shot(page, "lead-answer-dialog-1440");
  await answer.getByRole("button", { name: "Answer and take the wording" }).click();
  await expect(answer).toHaveCount(0);
  await expect(page.getByText("Answer sent. The proposed wording was put into the reviewer's saved text.")).toBeVisible();
  await expect(page.getByRole("list", { name: "1 open question" })).toBeVisible();

  // The reviewer reads the answer; the wording is in the text.
  await login(page, s, "ana");
  await openReview(page, tasks.ask);
  await expect(questions(page)).toContainText(`Answer from the lead: ${ANSWER}`);
  await expect(questions(page)).toContainText("The lead put your wording into your text.");
  await expect(questions(page)).not.toContainText("Question sent.");
  await expect(page.locator("#review-translation")).toHaveValue(new RegExp(esc(WORDING)));
  await questions(page).scrollIntoViewIfNeeded();
  await shot(page, "task-answered-1440");

  // An old review submitted as Query: read-only, with its label and the lead's answer.
  await openReview(page, tasks.old_query);
  const submitted = page.getByRole("region", { name: "Submitted review" });
  await expect(submitted).toContainText("Query (No longer offered. Questions now go to the lead with Ask the lead.)");
  await submitted.scrollIntoViewIfNeeded();
  await shot(page, "old-query-review-1440");

  // The lead's History of that text still names the query decision.
  await login(page, s, "lead");
  await documentsReady(page);
  await documentsTab(page, "All").click();
  const card = await openTextCard(page, s.cases!.old_query, "de");
  await card.getByRole("button", { name: /^History \(\d+\)$/ }).click();
  await expect(activityLines(card).filter({ hasText: "query decided" })).toContainText("v1 accepted as it is");
  await shot(page, "old-query-history-1440");
  expect(errors).toEqual([]);
});

test("390 px: the ask dialog on a phone", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const errors = consoleErrors(page);
  const s = await leadScenario(page, "QUESTION_FOR_LEAD");
  await login(page, s, "ana");
  await openReview(page, s.tasks!.ask);
  await page.locator(".ask-lead-entry").click();
  const ask = page.getByRole("dialog", { name: "Ask the lead" });
  await ask.getByRole("textbox", { name: /Your question/ }).fill(QUESTION);
  await ask.getByRole("textbox", { name: /Passage you ask about/ }).fill(QUOTE);
  await ask.getByRole("textbox", { name: /Your wording for this passage/ }).fill(WORDING);
  await shot(page, "ask-dialog-390");
  await ask.getByRole("button", { name: "Send question" }).click();
  await expect(ask).toHaveCount(0);
  await expect(questions(page)).toContainText("Waiting for the lead's answer");
  expect(errors).toEqual([]);
});
