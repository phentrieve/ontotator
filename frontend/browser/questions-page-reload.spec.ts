/**
 * Issue 619: the lead is already on Questions when a reviewer asks (two browser contexts).
 * The scenario has one open question on another text already.
 * - The bell entry "Question from …" loads the list again: the new question is listed, marked and focused, and the Open
 *   tab counts what the sidebar's "Questions (n)" counts.
 * - The sidebar link Questions, used while the page is open, loads the list and the count again.
 * Issue 629: without opening the bell, the page follows the bell's count (its minute refresh, fast-forwarded here).
 * With QUESTIONS_SHOTS=<dir> the test also saves screenshots there at 1440 × 900 and 390 × 844 (never baselines).
 */
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { loginThroughForm } from "./helpers";
import { leadScenario } from "./leadWorkflowHelpers";

test.setTimeout(240_000);
test.use({ actionTimeout: 15_000 });

const esc = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const bell = (page: Page) => page.locator(".shell-header").getByRole("button", { name: /^Notifications/ });
const panel = (page: Page) => page.getByRole("dialog", { name: "Notifications" });
const sidebarQuestions = (page: Page) => page.getByRole("navigation").getByRole("link", { name: /^Questions/ });
const items = (page: Page) => page.locator(".lead-question");

async function shot(page: Page, name: string): Promise<void> {
  const dir = process.env.QUESTIONS_SHOTS;
  if (!dir) return;
  mkdirSync(dir, { recursive: true });
  for (const [device, width, height] of [["desktop", 1440, 900], ["phone", 390, 844]] as const) {
    await page.setViewportSize({ width, height });
    await page.screenshot({ path: resolve(dir, `${name}-${device}.png`) });
  }
  await page.setViewportSize({ width: 1440, height: 900 });
}

async function ask(page: Page, question: string): Promise<void> {
  await page.getByRole("button", { name: "Ask the lead", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Ask the lead" });
  await dialog.getByRole("textbox", { name: /Your question/ }).fill(question);
  await dialog.getByRole("button", { name: "Send question" }).click();
  await expect(dialog).toHaveCount(0);
}

/** The Open tab and the sidebar both count `n` open questions. */
async function counts(page: Page, n: number): Promise<void> {
  await expect(page.getByRole("tab", { name: `Open, ${n}` })).toBeVisible();
  await expect(sidebarQuestions(page)).toHaveAccessibleName(`Questions, ${n} open`);
  await expect(items(page)).toHaveCount(n);
}

test("on Questions, the bell entry and the sidebar link show a question asked meanwhile", async ({ page, browser }, info) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const s = await leadScenario(page, "QUESTION_FOR_LEAD");
  const context = await browser.newContext({ baseURL: info.project.use.baseURL, viewport: { width: 1440, height: 900 } });
  try {
    const lead = await context.newPage();
    // The reviewer asks a first question; the lead opens Questions: Open 1.
    await loginThroughForm(page, s.users.ana, s.display_names.ana);
    await page.goto(`/#/tasks/${s.tasks!.ask}`);
    await expect(page.getByRole("region", { name: "Translation review" })).toBeVisible();
    await ask(page, "First question about this text?");
    await loginThroughForm(lead, s.users.lead, s.display_names.lead, { lastProject: s.project });
    await lead.goto(`/#/projects/${encodeURIComponent(s.project)}/questions`);
    await counts(lead, 2);  // The scenario has one question on another text.

    // A second question while the lead stays on Questions; the lead opens its bell entry.
    await ask(page, "Second question about this text?");
    await bell(lead).click();
    const entry = panel(lead).getByRole("link", { name: new RegExp(`^Unread: Question from ${esc(s.display_names.ana)}`) }).first();
    await entry.click();
    await expect(lead).toHaveURL(/#\/projects\/[^/]+\/questions\?question=/);
    const target = lead.locator(".lead-question--target");
    await expect(target).toContainText("Second question about this text?");
    await expect(target).toBeFocused();
    await expect(lead.getByRole("tab", { name: /^Open/ })).toHaveAttribute("aria-selected", "true");
    await counts(lead, 3);
    await shot(lead, "1-bell-entry-on-questions");

    // The sidebar link, once to leave the question and once while plain Questions is open.
    await sidebarQuestions(lead).click();
    await expect(lead).toHaveURL(/#\/projects\/[^/]+\/questions$/);
    await counts(lead, 3);
    await ask(page, "Third question about this text?");
    await sidebarQuestions(lead).click();
    await expect(lead.getByText("Third question about this text?")).toBeVisible();
    await counts(lead, 4);
    await shot(lead, "2-sidebar-link-on-questions");
  } finally {
    await context.close();
  }
});

test("on Questions, a question asked meanwhile shows once the bell's count goes up", async ({ page, browser }, info) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const s = await leadScenario(page, "QUESTION_FOR_LEAD");
  const context = await browser.newContext({ baseURL: info.project.use.baseURL, viewport: { width: 1440, height: 900 } });
  try {
    const lead = await context.newPage();
    await loginThroughForm(page, s.users.ana, s.display_names.ana);
    await page.goto(`/#/tasks/${s.tasks!.ask}`);
    await expect(page.getByRole("region", { name: "Translation review" })).toBeVisible();
    // The bell's minute refresh runs on a clock the test can move forward (installed before the app loads).
    await lead.clock.install();
    await loginThroughForm(lead, s.users.lead, s.display_names.lead, { lastProject: s.project });
    await lead.goto(`/#/projects/${encodeURIComponent(s.project)}/questions`);
    await counts(lead, 1);
    const before = await bell(lead).getAttribute("aria-label");

    await ask(page, "A question while the lead is on Questions?");
    await lead.clock.fastForward("01:05");
    await expect(bell(lead)).not.toHaveAttribute("aria-label", before ?? "");
    await expect(lead.getByText("A question while the lead is on Questions?")).toBeVisible();
    await counts(lead, 2);
    await shot(lead, "3-bell-count-on-questions");
  } finally {
    await context.close();
  }
});
