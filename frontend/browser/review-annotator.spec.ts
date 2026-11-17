/**
 * Findings of the user review, annotator screens and My tasks:
 * - "Continue from this submission" while the text is being consolidated: the task owner is told when the
 *   dialog opens, in their words; a refusal that still comes from the server is in view and focused on a phone;
 *   a task from proposals gives its reason.
 *
 * Every test builds its own project. With REVIEW_ANNOTATOR_SHOTS=<directory> the states are saved as screenshots.
 */
import { expect, test, type Locator, type Page } from "@playwright/test";
import { loginExisting, moreAction } from "./helpers";
import { loginScenarioUser as loginCheckUser, proposalCheckScenario } from "./proposalCheckHelpers";

test.setTimeout(240_000);
test.use({ actionTimeout: 15_000 });

const DESKTOP = { width: 1440, height: 900 } as const;
const PHONE = { width: 390, height: 844 } as const;
const SMALL_PHONE = { width: 375, height: 667 } as const;
type Size = { width: number; height: number };

const shots = process.env.REVIEW_ANNOTATOR_SHOTS;
async function shot(page: Page, name: string): Promise<void> {
  if (shots) await page.screenshot({ path: `${shots}/${name}.png` });
}

/** Console errors of the page; `allowed` names the refusals a test provokes on purpose. */
function consoleErrors(page: Page, allowed: RegExp[] = []): string[] {
  const errors: string[] = [];
  const keep = (text: string) => { if (!allowed.some(pattern => pattern.test(text))) errors.push(text); };
  page.on("console", message => { if (message.type() === "error") keep(message.text()); });
  page.on("pageerror", error => keep(error.message));
  return errors;
}
const noSidewaysScroll = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);

/** True when the element's centre is inside the window and the element itself (or a descendant) is on top there. */
const onTop = (locator: Locator) => locator.evaluate(element => {
  const box = element.getBoundingClientRect();
  const x = box.left + box.width / 2, y = box.top + box.height / 2;
  if (x < 0 || y < 0 || x > window.innerWidth || y > window.innerHeight) return false;
  const top = document.elementFromPoint(x, y);
  return !!top && (top === element || element.contains(top));
});

const CONSOLIDATED = "Your submission is being consolidated, so you cannot continue from it now. Ask your project lead.";
const FROM_PROPOSALS = "In a task from tool proposals you cannot continue from a submission yourself. Ask your project lead to start a new round.";
const LEAD_WORDING = "finish or withdraw";

interface ConsolidationScenario { users: Record<string, string>; pseudonyms: Record<string, string> }

/** A text whose consolidation is open; returns the username of one of its two annotators. */
async function consolidatedAnnotator(page: Page): Promise<string> {
  const response = await page.request.post("/__test_consolidation__", { params: { started: "true" }, timeout: 120_000 });
  expect(response.ok(), await response.text()).toBeTruthy();
  const scenario = await response.json() as ConsolidationScenario;
  return scenario.users["ann-0002"];
}

async function openWorkRounds(page: Page): Promise<Locator> {
  await page.getByRole("link", { name: "View", exact: true }).first().click();
  await expect(page.locator(".text-container")).toBeVisible();
  await moreAction(page, "Work rounds");
  const dialog = page.getByRole("dialog", { name: /^Work rounds/ });
  await expect(dialog.getByRole("heading", { name: "Start a new round", exact: true })).toBeVisible();
  return dialog;
}

for (const [name, size] of [["1440", DESKTOP], ["390", PHONE], ["375x667", SMALL_PHONE]] as [string, Size][]) {
  test(`${name}: a submission being consolidated says so when Work rounds opens, with no button to try`, async ({ page }) => {
    const errors = consoleErrors(page);
    await page.setViewportSize(size);
    await loginExisting(page, await consolidatedAnnotator(page));
    const dialog = await openWorkRounds(page);
    const reason = dialog.getByText(CONSOLIDATED, { exact: true });
    await reason.scrollIntoViewIfNeeded();
    expect(await onTop(reason)).toBe(true);
    await expect(dialog.getByRole("radio")).toHaveCount(0);
    await expect(dialog.getByRole("button", { name: "Continue from this submission", exact: true })).toHaveCount(0);
    await expect(dialog.getByRole("button", { name: "Reload task state", exact: true })).toHaveCount(0);
    await expect(dialog).not.toContainText(LEAD_WORDING);
    // Blinding: the reason names nobody.
    await expect(dialog).not.toContainText(/ann-\d{4}/);
    expect(await noSidewaysScroll(page)).toBe(true);
    await shot(page, `continue-consolidated-${name}`);
    expect(errors).toEqual([]);
  });

  test(`${name}: a refusal that still comes from the server is in view and focused`, async ({ page }) => {
    const errors = consoleErrors(page, [/409/]);
    await page.setViewportSize(size);
    await loginExisting(page, await consolidatedAnnotator(page));
    // The consolidation opened after the dialog loaded: the sources still offered the submission.
    await page.route("**/api/v1/assignments/*/round-sources", async route => {
      const response = await route.fetch();
      const sources = await response.json() as Record<string, unknown>[];
      await route.fulfill({ response, json: sources.map(source => ({ ...source, refused_by: null })) });
    });
    const dialog = await openWorkRounds(page);
    await dialog.getByRole("radio").first().check();
    await shot(page, `continue-offered-${name}`);
    await dialog.getByRole("button", { name: "Continue from this submission", exact: true }).click();
    const refusal = dialog.getByRole("alert");
    await expect(refusal).toHaveText(CONSOLIDATED);
    await expect.poll(() => onTop(refusal)).toBe(true);
    await expect(refusal.locator("xpath=..")).toBeFocused();
    await expect(dialog).not.toContainText(LEAD_WORDING);
    await expect(dialog.getByRole("button", { name: "Continue from this submission", exact: true })).toHaveCount(0);
    await expect(dialog.getByRole("button", { name: "Reload task state", exact: true })).toHaveCount(0);
    expect(await noSidewaysScroll(page)).toBe(true);
    await shot(page, `continue-refused-${name}`);
    expect(errors).toEqual([]);
  });
}

for (const [name, size] of [["1440", DESKTOP], ["390", PHONE]] as [string, Size][]) {
  test(`${name}: a submitted task from proposals says why no submission can be continued`, async ({ page }) => {
    const errors = consoleErrors(page);
    await page.setViewportSize(size);
    const scenario = await proposalCheckScenario(page, "CHECKED");
    await loginCheckUser(page, scenario, "tom");
    const dialog = await openWorkRounds(page);
    const reason = dialog.getByText(FROM_PROPOSALS, { exact: true });
    await reason.scrollIntoViewIfNeeded();
    expect(await onTop(reason)).toBe(true);
    await expect(dialog).not.toContainText("No submission can be continued right now.");
    await expect(dialog.getByRole("button", { name: "Reload task state", exact: true })).toHaveCount(0);
    expect(await noSidewaysScroll(page)).toBe(true);
    await shot(page, `continue-proposals-${name}`);
    expect(errors).toEqual([]);
  });
}
