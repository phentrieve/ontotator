/**
 * Issue 465: after "Fix typos…" a submitted annotation moves to the new version by itself when every finding is
 * placed on the new text and no number changed. Scenario TYPO_FIX_CARRY (tests/browser_lead_workflow_scenarios.py):
 * an accepted de text with the typo "hypotnia" and two submitted annotations, Cy Annotator's on "seizures" and Ben
 * Roth's on "hypotnia".
 * - The dialog's preview says per person whose annotation moves and whose does not, and why: with a changed number
 *   nobody's; without it Cy's moves and Ben's needs a check.
 * - After saving: the History of the text names the move; Cy's My tasks has one submitted task, on v2, and its
 *   view shows the v2 text with the finding. Checked at 1440 px and 390 px for horizontal scroll.
 */
import { expect, test, type Page } from "@playwright/test";
import { activityLines, documentsReady, openCardHistory, openTextCard, textCard, textVersionItems } from "./documentsHelpers";
import { loginThroughForm, TASKS_HOME } from "./helpers";
import { leadScenario } from "./leadWorkflowHelpers";

test.setTimeout(240_000);
test.use({ actionTimeout: 15_000, viewport: { width: 1440, height: 900 } });

const CASE = "case-0465";
const PHONE = { width: 390, height: 844 };
const esc = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

async function noHorizontalScroll(page: Page, name: string) {
  for (const viewport of [{ width: 1440, height: 900 }, PHONE]) {
    await page.setViewportSize(viewport);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
    expect(overflow, `${name}: no horizontal scroll at ${viewport.width} px`).toBe(false);
  }
  await page.setViewportSize({ width: 1440, height: 900 });
}

function consoleErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on("console", message => { if (message.type() === "error") errors.push(message.text()); });
  page.on("pageerror", error => errors.push(error.message));
  return errors;
}

test("a typo fix moves one submitted annotation by itself; the other stays, and the preview says why", async ({ page }) => {
  const errors = consoleErrors(page);
  const s = await leadScenario(page, "TYPO_FIX_CARRY");
  const cy = s.display_names.annotator, ben = s.display_names.ben;
  await loginThroughForm(page, s.users.lead, s.display_names.lead, { lastProject: s.project });
  await expect(page).toHaveURL(new RegExp(`#/projects/${esc(s.project)}/documents`));
  await documentsReady(page);
  const [v1] = await (await textVersionItems(await openTextCard(page, CASE, "de"), 1)).all();
  await v1.getByRole("button", { name: `Fix typos in v1 of ${CASE} de…`, exact: true }).click();
  const dialog = page.getByRole("dialog", { name: `Fix typos, ${CASE} de v1`, exact: true });
  const editor = dialog.getByRole("textbox", { name: "Corrected text", exact: true });
  const original = await editor.inputValue();
  const fixed = original.replace("hypotnia", "hypotonia");

  // A changed number keeps both annotations on v1.
  await editor.fill(fixed.replace("14-month", "15-month"));
  await expect(dialog).toContainText(`Not moved by themselves, the fix changes a number: ${ben} and ${cy}.`);
  await expect(dialog).toContainText("2 annotations stay on v1.");
  await noHorizontalScroll(page, "number changed");

  // The typo alone: Cy's finding is on a passage the fix leaves as it is, Ben's on the corrected word.
  await editor.fill(fixed);
  await expect(dialog).toContainText(`Moves to v2 by itself, nobody submits again: the annotation of ${cy}.`);
  await expect(dialog).toContainText(`Not moved by itself, a finding marks words you changed: ${ben}.`);
  await expect(dialog).toContainText("1 annotation stays on v1. After saving, use Carry to v2… on this row to move it.");
  await noHorizontalScroll(page, "preview");
  await dialog.getByRole("button", { name: "Typo", exact: true }).click();
  await dialog.getByRole("button", { name: "Save as v2", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.locator(".ui-toast .ui-toast-message")).toHaveText(`Typos fixed: v2 of ${CASE} de saved. It stays Accepted. 1 annotation moved to v2.`);

  // History names the move, by nobody's click.
  await textCard(page, CASE, "de").getByRole("button", { name: "Close", exact: true }).click();
  const card = await openCardHistory(page, CASE, "de");
  await expect(activityLines(card).filter({ hasText: "moved to v2 by itself after the typo fix" }))
    .toHaveText([new RegExp(`^Annotation: annotation of ${esc(cy)} \\(${esc(s.pseudonyms.annotator)}\\) moved to v2 by itself after the typo fix, `)]);
  await noHorizontalScroll(page, "history");
  expect(errors).toEqual([]);

  // Cy: one task for the text, on v2, submitted; its view shows the corrected text with the finding.
  await page.context().clearCookies();
  await loginThroughForm(page, s.users.annotator, cy);
  await page.goto(TASKS_HOME);
  await expect(page.getByRole("heading", { level: 1, name: "My tasks", exact: true })).toBeVisible();
  const rows = page.getByRole("row").filter({ hasText: CASE });
  await expect(rows).toHaveCount(1);
  await expect(rows).toContainText(`${CASE} de v2`);
  await expect(rows).toContainText("Submitted");
  await noHorizontalScroll(page, "my tasks");
  await rows.getByRole("link", { name: "View", exact: true }).click();
  const text = page.locator(".text-container");
  await expect(text).toBeVisible();
  await expect(text).toContainText("generalized hypotonia");
  await expect(text).not.toContainText("hypotnia");
  await expect(page.getByRole("heading", { level: 1, name: `${CASE} de v2 corrected`, exact: true })).toBeVisible();
  // Cy's finding, placed on the corrected text.
  await expect(page.getByRole("button", { name: /^Seizure HP:0001250 1 mention/ })).toBeVisible();
  await noHorizontalScroll(page, "task view");
  expect(errors).toEqual([]);
});
