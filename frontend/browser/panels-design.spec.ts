/**
 * Issues 554, 555 and 556 (design rule "Panels and actions", docs/design.md): ranked actions instead of overloaded
 * panels, in the real app.
 * - Resolve… opens a dialog: what the reviewer said first, one primary action (two for a query), the rest under
 *   "Other ways…" with one line each; a query shows the proposed text on demand before the decision.
 * - "Edit the translation…" is the one edit action of an accepted version; it asks what changes, with the
 *   consequence of each answer, before the typo-fix or correction dialog opens. No hint line under the buttons.
 * Keyboard: focus on the primary action, the menu by arrow keys, Escape back. At 1440 px (deviceScaleFactor 2), at
 * 390 px and in the dark theme: no console errors, no horizontal page scroll, no axe violations in the dialogs.
 */
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { documentsReady, openTextCard, rowAction, textNamePattern, textVersionItems } from "./documentsHelpers";
import { loginThroughForm } from "./helpers";
import { leadScenario, type LeadScenario } from "./leadWorkflowHelpers";

test.setTimeout(180_000);
test.use({ actionTimeout: 15_000, deviceScaleFactor: 2 });

const WIDE = { width: 1440, height: 900 };
const PHONE = { width: 390, height: 844 };
const esc = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Screenshots for the design sign-off only (never baselines); ONTOTATOR_SHOTS_DIR overrides the folder. */
async function shot(page: Page, name: string) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth), `${name}: no horizontal scroll`).toBe(true);
  const dir = process.env.ONTOTATOR_SHOTS_DIR ?? resolve(test.info().config.rootDir, "../../build/panels-design/evidence");
  mkdirSync(dir, { recursive: true });
  await page.screenshot({ path: resolve(dir, `${name}.png`) });
}

function consoleErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on("console", message => { if (message.type() === "error") errors.push(message.text()); });
  page.on("pageerror", error => errors.push(error.message));
  return errors;
}

async function loginLead(page: Page, s: LeadScenario) {
  await loginThroughForm(page, s.users.lead, s.display_names.lead, { lastProject: s.project });
  await expect(page).toHaveURL(new RegExp(`#/projects/${esc(s.project)}/documents`));
  await documentsReady(page);
}

async function axe(page: Page): Promise<string[]> {
  const results = await new AxeBuilder({ page }).include(".ui-dialog").analyze();
  return results.violations.flatMap(v => v.nodes.map(n => `${v.id} ${n.target.join(" ")}`));
}

test("1440 px: Resolve… on a rejected translation is a dialog with one primary action and Other ways…", async ({ page }) => {
  await page.setViewportSize(WIDE);
  const errors = consoleErrors(page);
  const s = await leadScenario(page, "REJECTED_TRANSLATION_FOR_LEAD");
  const caseId = s.cases!.rejected;
  await loginLead(page, s);
  await rowAction(page, "Resolve…", caseId, "de").click();
  const dialog = page.getByRole("dialog", { name: textNamePattern("Resolve rejected translation, ", caseId, "de") });
  // What the reviewer said comes first; nothing is explained under the buttons.
  await expect(dialog).toContainText("Ana Weber rejected this translation.");
  await expect(dialog.locator(".field-hint, .form-hint, .action-reason")).toHaveCount(0);
  const primary = dialog.getByRole("button", { name: "Correct it myself (counts as accepted)…", exact: true });
  await expect(primary).toBeFocused();
  await expect(primary).toHaveClass(/btn-primary/);
  expect(await axe(page)).toEqual([]);
  await shot(page, "resolve-rejected-1440");

  // Other ways… by keyboard: Shift+Tab twice (Cancel, Other ways…), ArrowDown opens at the first item.
  await page.keyboard.press("Shift+Tab");
  await page.keyboard.press("Shift+Tab");
  const other = dialog.getByRole("button", { name: textNamePattern("Other ways to resolve ", caseId, "de") });
  await expect(other).toBeFocused();
  await page.keyboard.press("ArrowDown");
  const menu = page.getByRole("menu");
  await expect(menu.getByRole("menuitem").first()).toBeFocused();
  await expect(menu.getByRole("menuitem", { name: "Reopen Ana Weber's review…", exact: true })).toHaveAccessibleDescription("Ana Weber reviews v1 again, from its current text.");
  await expect(menu.getByRole("menuitem", { name: "Assign a new review…", exact: true })).toHaveAccessibleDescription("Another reviewer reviews v1.");
  await expect(menu.getByRole("menuitem", { name: "Discard the de translation…", exact: true })).toHaveAccessibleDescription("Its versions are marked as discarded. Nothing is deleted.");
  expect(await axe(page)).toEqual([]);
  await shot(page, "resolve-rejected-other-ways-1440");
  // Escape closes the menu, focus goes back to Other ways…; a second Escape closes the dialog, focus back on the row.
  await page.keyboard.press("Escape");
  await expect(menu).toHaveCount(0);
  await expect(other).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(rowAction(page, "Resolve…", caseId, "de")).toBeFocused();
  expect(errors).toEqual([]);
});

test("1440 px: Resolve… on a legacy queried translation shows the question and the proposed text before the two decisions", async ({ page }) => {
  await page.setViewportSize(WIDE);
  const errors = consoleErrors(page);
  const s = await leadScenario(page, "QUERIED_TRANSLATION_FOR_LEAD");
  const caseId = s.cases!.take_text;
  await loginLead(page, s);
  await rowAction(page, "Resolve…", caseId, "de").click();
  const dialog = page.getByRole("dialog", { name: textNamePattern("Resolve queried translation, ", caseId, "de") });
  await expect(dialog).toContainText("Ana Weber asked a question about this translation.");
  await expect(dialog.locator(".modal-actions").getByRole("button")).toHaveText(["Other ways…", "Cancel", "Accept v1 as it is…", "Accept the reviewer’s text as v2…"]);
  await dialog.getByText("Show the proposed text (1 passage changed)", { exact: true }).click();
  await expect(dialog.getByRole("region", { name: "Ana Weber’s proposed text, changes to v1", exact: true }).locator("ins")).toHaveText(/muscular/);
  expect(await axe(page)).toEqual([]);
  await shot(page, "resolve-queried-1440");
  expect(errors).toEqual([]);
});

test("1440 px: Edit the translation… asks what changes, then opens the way that fits", async ({ page }) => {
  await page.setViewportSize(WIDE);
  const errors = consoleErrors(page);
  const s = await leadScenario(page, "ACCEPTED_TRANSLATION_FOR_LEAD");
  const caseId = s.cases!.accepted;
  await loginLead(page, s);
  const card = await openTextCard(page, caseId, "de");
  const [v1] = await (await textVersionItems(card, 1)).all();
  await expect(v1.locator(".text-version-actions").getByRole("button")).toHaveText(["Edit the translation…", "Other ways…", "Translation reviews"]);
  await expect(v1.locator(".text-version-hint")).toHaveCount(0);
  await shot(page, "version-row-1440");

  const edit = v1.getByRole("button", { name: `Edit the translation v1 of ${caseId} de…`, exact: true });
  await edit.click();
  const choice = page.getByRole("dialog", { name: `Edit the translation, ${caseId} de v1`, exact: true });
  const typos = choice.getByRole("radio", { name: "Only spelling, spacing or grammar", exact: true });
  const meaning = choice.getByRole("radio", { name: "The meaning changes", exact: true });
  await expect(typos).toHaveAccessibleDescription("The meaning stays. No review; submitted annotations move to v2.");
  await expect(meaning).toHaveAccessibleDescription("v2 is reviewed again. Annotations stay on v1; you handle the text change after.");
  // Nothing is chosen for the lead; Continue without a choice says so in place.
  await choice.getByRole("button", { name: "Continue", exact: true }).click();
  await expect(choice.getByText("Choose what changes.", { exact: true })).toBeVisible();
  expect(await axe(page)).toEqual([]);
  // Keyboard: the radios by arrow keys, Continue opens the way.
  await typos.focus();
  await page.keyboard.press("Space");
  await expect(typos).toBeChecked();
  await shot(page, "edit-choice-1440");
  await choice.getByRole("button", { name: "Continue", exact: true }).click();
  const fix = page.getByRole("dialog", { name: `Fix typos, ${caseId} de v1`, exact: true });
  await expect(fix.getByRole("textbox", { name: "Corrected text", exact: true })).toBeVisible();
  await fix.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(fix).toHaveCount(0);
  // Focus goes back to the button that started it.
  await expect(edit).toBeFocused();

  await edit.click();
  await choice.getByRole("radio", { name: "The meaning changes", exact: true }).check();
  await choice.getByRole("button", { name: "Continue", exact: true }).click();
  await expect(page.getByRole("dialog", { name: `Correct it myself, ${caseId} de v1, accepted`, exact: true })).toContainText("The corrected text becomes v2.");
  expect(errors).toEqual([]);
});

test("390 px: the Resolve dialog and its menu fit the phone", async ({ page }) => {
  await page.setViewportSize(PHONE);
  const errors = consoleErrors(page);
  const s = await leadScenario(page, "QUERIED_TRANSLATION_FOR_LEAD");
  const caseId = s.cases!.take_text;
  await loginLead(page, s);
  await rowAction(page, "Resolve…", caseId, "de").click();
  const dialog = page.getByRole("dialog", { name: textNamePattern("Resolve queried translation, ", caseId, "de") });
  await expect(dialog).toContainText("Ana Weber asked a question about this translation.");
  await expect(dialog.getByRole("button", { name: "Accept the reviewer’s text as v2…", exact: true })).toBeVisible();
  const box = (await dialog.boundingBox())!;
  expect(box.x + box.width).toBeLessThanOrEqual(PHONE.width);
  await shot(page, "resolve-queried-390");
  await dialog.getByRole("button", { name: textNamePattern("Other ways to resolve ", caseId, "de") }).click();
  const menu = (await page.getByRole("menu").boundingBox())!;
  expect(menu.x).toBeGreaterThanOrEqual(0);
  expect(menu.x + menu.width).toBeLessThanOrEqual(PHONE.width);
  await shot(page, "resolve-queried-other-ways-390");
  expect(errors).toEqual([]);
});

test("dark theme: the Resolve dialog keeps its contrast", async ({ page }) => {
  await page.setViewportSize(WIDE);
  await page.emulateMedia({ colorScheme: "dark" });
  const errors = consoleErrors(page);
  const s = await leadScenario(page, "QUERIED_TRANSLATION_FOR_LEAD");
  const caseId = s.cases!.take_text;
  await loginLead(page, s);
  await rowAction(page, "Resolve…", caseId, "de").click();
  const dialog = page.getByRole("dialog", { name: textNamePattern("Resolve queried translation, ", caseId, "de") });
  await dialog.getByText("Show the proposed text (1 passage changed)", { exact: true }).click();
  await expect(dialog.getByRole("region", { name: "Ana Weber’s proposed text, changes to v1", exact: true })).toBeVisible();
  expect(await axe(page)).toEqual([]);
  await shot(page, "resolve-queried-dark-1440");
  expect(errors).toEqual([]);
});
