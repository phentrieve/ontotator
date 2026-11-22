/**
 * Issue 509: after "Fix typos…" a task from tool proposals that nobody opened follows the new version only when no
 * proposal waits for a check. Scenario TYPO_FIX_PROPOSALS (tests/browser_lead_workflow_scenarios.py): an accepted de
 * text with the typo "hypotnia" and tool proposals on "seizures" and "hypotnia"; Ben Roth's task is from proposals and
 * nobody opened it, Cy Annotator opened a task.
 * - Fixing "hypotnia": the proposal on it waits for a check, so the dialog names both tasks that stay with the reason,
 *   and the rule for tasks from proposals behind the (?) of "After saving" (issue 556).
 * - A fix elsewhere: both proposals move, Ben's task continues on v2; Cy's stays as opened. Checked at 1440 px and
 *   390 px for horizontal scroll.
 */
import { expect, test, type Page } from "@playwright/test";
import { documentsReady, editTranslation, openTextCard, showSegment, textVersionItems } from "./documentsHelpers";
import { loginThroughForm } from "./helpers";
import { leadScenario } from "./leadWorkflowHelpers";

test.setTimeout(240_000);
test.use({ actionTimeout: 15_000, viewport: { width: 1440, height: 900 } });

const CASE = "case-0509";
const PHONE = { width: 390, height: 844 };
const RULE = "A task from tool proposals continues on v2 only when nobody opened it and no proposal waits for a check.";
const esc = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

async function noHorizontalScroll(page: Page, name: string) {
  for (const viewport of [{ width: 1440, height: 900 }, PHONE]) {
    await page.setViewportSize(viewport);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
    expect(overflow, `${name}: no horizontal scroll at ${viewport.width} px`).toBe(false);
  }
  await page.setViewportSize({ width: 1440, height: 900 });
}

test("the typo fix dialog names each task that stays and why, and lets an unopened task from proposals follow", async ({ page }) => {
  const s = await leadScenario(page, "TYPO_FIX_PROPOSALS");
  const cy = s.display_names.annotator, ben = s.display_names.ben;
  await loginThroughForm(page, s.users.lead, s.display_names.lead, { lastProject: s.project });
  await expect(page).toHaveURL(new RegExp(`#/projects/${esc(s.project)}/documents`));
  await documentsReady(page);
  const [v1] = await (await textVersionItems(await openTextCard(page, CASE, "de"), 1)).all();
  // The version is accepted: "Edit the translation…" holds the typo fix (issue 555, #571).
  await editTranslation(page, v1, CASE, "typos");
  const dialog = page.getByRole("dialog", { name: `Fix typos (no review), ${CASE} de v1`, exact: true });
  const editor = dialog.getByRole("textbox", { name: "Corrected text", exact: true });
  const original = await editor.inputValue();
  const after = dialog.getByRole("region", { name: "After saving", exact: true });
  const help = after.getByRole("button", { name: "Help: After saving", exact: true });

  // Before the text changes: whether Ben's task continues is not known yet; the rule is behind (?) (issue 556).
  await expect(after).toContainText(`Once you change the text, this says whether the task from tool proposals of ${ben} continues on v2.`);
  await expect(after.getByText(RULE, { exact: true })).toBeHidden();
  await help.click();
  await expect(help).toHaveAttribute("aria-expanded", "true");
  await expect(after.getByText(RULE, { exact: true })).toBeVisible();
  await help.press("Escape");
  await expect(help).toHaveAttribute("aria-expanded", "false");
  await expect(dialog).toBeVisible();

  // The typo: the proposal on "hypotnia" waits for a check, so Ben's task stays too: one line each.
  await editor.fill(original.replace("hypotnia", "hypotonia"));
  await expect(after).toContainText(`${ben}: task stays on v1 (from tool proposals, and a proposal waits for a check). Move it later with Handle text change…`);
  await expect(after).toContainText(`${cy}: task stays on v1 (already opened). Move it later with Handle text change…`);
  await expect(after).not.toContainText("other annotation");
  await noHorizontalScroll(page, "a proposal waits for a check");

  // A fix elsewhere: both proposals move, so Ben's task continues on v2.
  await editor.fill(original.replace("On examination", "At examination"));
  await expect(after).toContainText("1 waiting task continues on v2.");
  await expect(after).toContainText(`${cy}: task stays on v1 (already opened).`);
  await expect(after).not.toContainText(ben);
  await noHorizontalScroll(page, "every proposal moves");
  await dialog.getByRole("button", { name: "Grammar", exact: true }).click();
  await dialog.getByRole("button", { name: "Save as v2 (stays Accepted)", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.locator(".ui-toast .ui-toast-message")).toHaveText(`Typos fixed: v2 of ${CASE} de saved. It stays Accepted.`);
});

// Issue 584: one line per reason in "After saving" (issue 556), the rule set apart behind its (?); Cy's opened task reads Opened in the card.
test("the reasons a task stays are a list, and the opened task reads Opened in the lead's card", async ({ page }) => {
  const s = await leadScenario(page, "TYPO_FIX_PROPOSALS");
  const cy = s.display_names.annotator, ben = s.display_names.ben;
  await loginThroughForm(page, s.users.lead, s.display_names.lead, { lastProject: s.project });
  await documentsReady(page);
  const card = await openTextCard(page, CASE, "de");
  await showSegment(card, "Annotation");
  const annotators = card.getByRole("list", { name: "Annotators", exact: true });
  await expect(annotators.getByRole("listitem").filter({ hasText: cy })).toContainText("Opened");
  await expect(annotators.getByRole("listitem").filter({ hasText: cy })).not.toContainText("Not started");
  await expect(annotators.getByRole("listitem").filter({ hasText: ben })).toContainText("Not started");
  await card.screenshot({ path: test.info().outputPath("584-card-opened-1440.png") });

  const [v1] = await (await textVersionItems(card, 1)).all();
  // The version is accepted: "Edit the translation…" holds the typo fix (issue 555, #571).
  await editTranslation(page, v1, CASE, "typos");
  const dialog = page.getByRole("dialog", { name: `Fix typos (no review), ${CASE} de v1`, exact: true });
  const editor = dialog.getByRole("textbox", { name: "Corrected text", exact: true });
  await editor.fill((await editor.inputValue()).replace("hypotnia", "hypotonia"));
  const stays = dialog.getByRole("region", { name: "After saving", exact: true });
  const items = stays.getByRole("list").getByRole("listitem");
  await expect(items.filter({ hasText: "stays on v1" })).toHaveText([
    `⚠${ben}: task stays on v1 (from tool proposals, and a proposal waits for a check). Move it later with Handle text change…`,
    `⚠${cy}: task stays on v1 (already opened). Move it later with Handle text change…`,
  ]);
  // The rule stands apart, outside the list, behind the (?) of "After saving".
  await stays.getByRole("button", { name: "Help: After saving", exact: true }).click();
  await expect(stays.locator("p", { hasText: RULE })).toBeVisible();
  await expect(stays.getByRole("list").getByText(RULE)).toHaveCount(0);
  for (const [viewport, name] of [[{ width: 1440, height: 900 }, "1440"], [PHONE, "390"]] as const) {
    await page.setViewportSize(viewport);
    // Each reason starts on a line of its own, below the one before.
    const tops = await items.evaluateAll(nodes => nodes.map(node => node.getBoundingClientRect().top));
    expect(tops.every((top, index) => index === 0 || top > tops[index - 1]), `one line per reason at ${name} px`).toBe(true);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
    expect(overflow, `no horizontal scroll at ${name} px`).toBe(false);
    await stays.scrollIntoViewIfNeeded();
    await stays.screenshot({ path: test.info().outputPath(`584-stays-list-${name}.png`) });
  }
});
