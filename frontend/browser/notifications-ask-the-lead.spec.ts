/**
 * The header bell for Ask the lead (issues 553 and 557): a reviewer asks, every lead's bell names the question, the
 * entry opens that question on Questions; the lead answers, the reviewer's bell names the answer, the entry opens the
 * task with the answer. Neither entry carries the question or the answer.
 *
 * Built on ``QUESTION_FOR_LEAD`` (``/__test_lead_workflow__``): Ana has an open translation review of
 * ``cases.ask`` with nothing asked yet.
 * With ``NOTIFICATIONS_SHOTS=<dir>`` the test also saves screenshots there (for review, never baselines).
 */
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Locator, type Page } from "@playwright/test";
import { loginThroughForm } from "./helpers";
import { leadScenario, type LeadPerson, type LeadScenario } from "./leadWorkflowHelpers";

test.setTimeout(240_000);
test.use({ actionTimeout: 15_000 });
if (process.env.NOTIFICATIONS_SHOTS) test.use({ deviceScaleFactor: 2 });

const QUESTION = "Is the short form of the term meant in this sentence?";
const ANSWER = "Yes, keep the short form.";
const esc = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const bell = (page: Page) => page.locator(".shell-header").getByRole("button", { name: /^Notifications/ });
const panel = (page: Page) => page.getByRole("dialog", { name: "Notifications" });
const questions = (page: Page) => page.getByRole("region", { name: "Questions to the lead" });

async function shot(page: Page, name: string): Promise<void> {
  const dir = process.env.NOTIFICATIONS_SHOTS;
  if (!dir) return;
  mkdirSync(dir, { recursive: true });
  await page.screenshot({ path: resolve(dir, `${name}.png`) });
}

async function login(page: Page, s: LeadScenario, who: LeadPerson): Promise<void> {
  await page.goto("about:blank");
  await page.context().clearCookies();
  if (who !== "lead") return loginThroughForm(page, s.users[who], s.display_names[who]);
  await loginThroughForm(page, s.users.lead, s.display_names.lead, { lastProject: s.project });
}

async function axeViolations(page: Page, include: string): Promise<string[]> {
  const results = await new AxeBuilder({ page }).include(include).analyze();
  return results.violations.flatMap(v => v.nodes.map(n => `${v.id} ${n.target.join(" ")}: ${n.failureSummary ?? ""}`));
}

/**
 * Open the bell and find the entry; at 1440 × 900 and 390 × 844, light and dark, with axe on the list.
 * Ends at 1440 × 900, light, with the list open.
 */
async function openBellEverywhere(page: Page, name: RegExp, hidden: string, prefix: string): Promise<Locator> {
  const sizes = [["desktop", 1440, 900], ["phone", 390, 844]] as const;
  for (const [device, width, height] of sizes) {
    await page.setViewportSize({ width, height });
    for (const scheme of ["light", "dark"] as const) {
      await page.emulateMedia({ colorScheme: scheme });
      if (!await panel(page).isVisible()) await bell(page).click();
      await expect(panel(page).getByRole("link", { name })).toBeVisible();
      // No clinical text: the question and the answer stay in the question.
      await expect(panel(page)).not.toContainText(hidden);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), `${device} ${scheme}: no sideways scroll`).toBe(true);
      expect(await axeViolations(page, device === "phone" ? ".ui-popover-sheet" : ".ui-popover"), `${device} ${scheme}`).toEqual([]);
      await shot(page, `${prefix}-${device}-${scheme}`);
    }
    await page.keyboard.press("Escape");
    await expect(panel(page)).toHaveCount(0);
  }
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.emulateMedia({ colorScheme: "light" });
  await bell(page).click();
  const entry = panel(page).getByRole("link", { name });
  await expect(entry).toBeVisible();
  return entry;
}

test("a reviewer asks, the lead's bell opens the question; the lead answers, the reviewer's bell opens the answer", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const s = await leadScenario(page, "QUESTION_FOR_LEAD");
  const task = s.tasks!.ask, caseId = s.cases!.ask;

  // The reviewer asks the lead, without pausing.
  await login(page, s, "ana");
  await page.goto(`/#/tasks/${task}`);
  await expect(page.getByRole("region", { name: "Translation review" })).toBeVisible();
  await page.locator(".ask-lead-entry").click();
  const ask = page.getByRole("dialog", { name: "Ask the lead" });
  await ask.getByRole("textbox", { name: /Your question/ }).fill(QUESTION);
  await ask.getByRole("button", { name: "Send question" }).click();
  await expect(ask).toHaveCount(0);
  await expect(questions(page)).toContainText("Waiting for the lead's answer");

  // The lead: "Question from Ana Weber (…): <case> de", which opens that question on Questions.
  await login(page, s, "lead");
  await expect(bell(page)).toHaveAccessibleName(/^Notifications, \d+ unread$/);
  const asked = new RegExp(`^Unread: Question from ${esc(s.display_names.ana)} \\(${esc(s.pseudonyms.ana)}\\): ${esc(caseId)} de`);
  const question = await openBellEverywhere(page, asked, QUESTION, "1-question");
  await question.click();
  await expect(page).toHaveURL(/#\/projects\/[^/]+\/questions\?question=/);
  await expect(panel(page)).toHaveCount(0);
  const target = page.locator(".lead-question--target");
  await expect(target).toContainText(QUESTION);
  await expect(target).toBeFocused();
  await expect(page.getByRole("tab", { name: /^Open/ })).toHaveAttribute("aria-selected", "true");
  await shot(page, "1-question-opened-desktop-light");
  // Opened, so read: the bell no longer counts it.
  await bell(page).click();
  await expect(panel(page).getByRole("link", { name: new RegExp(`^Question from ${esc(s.display_names.ana)}`) })).toBeVisible();
  await page.keyboard.press("Escape");

  await target.getByRole("button", { name: "Answer…" }).click();
  const answer = page.getByRole("dialog", { name: /^Answer Ana Weber/ });
  await answer.getByRole("textbox", { name: /Your answer/ }).fill(ANSWER);
  await answer.getByRole("button", { name: "Send answer" }).click();
  await expect(answer).toHaveCount(0);
  await expect(page.getByText("Answer sent.")).toBeVisible();
  // The tab stays on Open after the answer.
  await expect(page.getByRole("tab", { name: /^Open/ })).toHaveAttribute("aria-selected", "true");

  // The reviewer: "Answer from the lead: <case> de", which opens the task with the answer.
  await login(page, s, "ana");
  await expect(bell(page)).toHaveAccessibleName(/^Notifications, \d+ unread$/);
  const answered = new RegExp(`^Unread: Answer from the lead: ${esc(caseId)} de`);
  const entry = await openBellEverywhere(page, answered, ANSWER, "2-answer");
  await entry.click();
  await expect(page).toHaveURL(new RegExp(`#/tasks/${task}$`));
  await expect(questions(page)).toContainText(`Answer from the lead: ${ANSWER}`);
  await questions(page).scrollIntoViewIfNeeded();
  await shot(page, "2-answer-opened-desktop-light");
  await bell(page).click();
  await expect(panel(page).getByRole("link", { name: `Answer from the lead: ${caseId} de` })).toBeVisible();
});
