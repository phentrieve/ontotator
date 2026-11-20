/**
 * Issue 453: "Fix typos…" (an editorial correction) on the newest version row of a translation.
 * - One dialog page: the lead edits the text in the translation editor, sees the changes below it, chooses
 *   the reason by click and saves. A changed number is pointed out in place and blocks nothing.
 * - What happens to the work on the version is quiet unless started or submitted work stays on it. The new
 *   version is a correction with the status of the version it corrects: an accepted text stays accepted, a
 *   rejected one stays rejected, without a review.
 * - An open translation review of the version refuses the correction.
 * Every step is checked at 1440 px and at 390 px for horizontal scroll, and the console stays free of errors.
 */
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { expect, test, type Locator, type Page } from "@playwright/test";
import { documentsReady, openTextCard, textCard, textVersionItems } from "./documentsHelpers";
import { loginThroughForm } from "./helpers";
import { leadScenario, type LeadScenario } from "./leadWorkflowHelpers";

test.setTimeout(240_000);
test.use({ actionTimeout: 15_000, viewport: { width: 1440, height: 900 } });

const TIME = String.raw`\d{1,2} [A-Z][a-z]{2}(?: \d{4})?, \d{2}:\d{2}(?::\d{2})?`;
const esc = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const PHONE = { width: 390, height: 844 };

/** The fixture's de text of a case, and the same text with a comma added (one character). */
const oldText = (caseId: string) => `The patient is a 14-month-old girl with developmental delay and recurrent seizures. On examination she shows generalized hypotonia. (${caseId}, de)`;
const fixedText = (caseId: string) => oldText(caseId).replace("On examination she", "On examination, she");

async function noHorizontalScroll(page: Page, name: string) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
  expect(overflow, `${name}: no horizontal scroll at ${page.viewportSize()?.width} px`).toBe(false);
}

/** Screenshots for human review only (never baselines), at the current size and at the other one. */
async function evidence(page: Page, name: string) {
  const dir = process.env.ONTOTATOR_SHOTS_DIR ?? resolve(test.info().config.rootDir, "../../build/editorial-correction/evidence");
  mkdirSync(dir, { recursive: true });
  const size = page.viewportSize() ?? { width: 1440, height: 900 };
  for (const [suffix, viewport] of [["", { width: 1440, height: 900 }], ["-phone", PHONE]] as const) {
    await page.setViewportSize(viewport);
    await noHorizontalScroll(page, name);
    await page.screenshot({ path: resolve(dir, `${name}${suffix}.png`) });
  }
  await page.setViewportSize(size);
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

const correctionDialog = (page: Page, caseId: string) => page.getByRole("dialog", { name: `Fix typos, ${caseId} de v1`, exact: true });
const fixAction = (item: Locator, caseId: string, v = 1) => item.getByRole("button", { name: `Fix typos in v${v} of ${caseId} de…`, exact: true });

test("a comma added to an accepted translation becomes an accepted v2 on one page; a changed number is pointed out", async ({ page }) => {
  const errors = consoleErrors(page);
  const s = await leadScenario(page, "ACCEPTED_TRANSLATION_FOR_LEAD");
  const caseId = s.cases!.accepted;
  await loginLead(page, s);
  const card = await openTextCard(page, caseId, "de");
  const [v1] = await (await textVersionItems(card, 1)).all();
  // Next to the other version actions of the newest version, with a hint that tells it apart.
  await expect(v1.getByRole("button", { name: `Correct v1 of ${caseId} de myself…`, exact: true })).toBeVisible();
  await expect(v1.getByRole("button", { name: `Upload a corrected text for v1 of ${caseId} de…`, exact: true })).toBeVisible();
  const open = fixAction(v1, caseId);
  await expect(open).toHaveText("Fix typos…");
  await expect(open).toHaveAttribute("title", "Spacing, typos, grammar. Keeps the status; no review.");
  await evidence(page, "453-row-before");
  await open.click();

  const dialog = correctionDialog(page, caseId);
  // The translation editor starts with the text of v1; there is no second step.
  const editor = dialog.getByRole("textbox", { name: "Corrected text", exact: true });
  await expect(editor).toHaveValue(oldText(caseId));
  await expect(dialog.getByRole("button", { name: "Check changes", exact: true })).toHaveCount(0);
  // Started and submitted annotations stay on v1: the highlighted block says what to do next.
  await expect(dialog.getByText("Work stays on v1", { exact: true })).toBeVisible();
  await expect(dialog).toContainText("2 annotations stay on v1. After saving, use Handle text change… and Carry to v2… on this row to move them.");
  await expect(dialog.getByText("v2 keeps the status of v1: Accepted. No translation review is started.", { exact: true })).toBeVisible();
  await evidence(page, "453-dialog-open");

  // Nothing changed and no reason: the button says so and a click names what is missing.
  const save = dialog.getByRole("button", { name: "Save as v2", exact: true });
  await expect(save).toHaveAttribute("aria-disabled", "true");
  await save.click({ force: true });
  await expect(dialog.getByText("Change the text first.", { exact: true })).toBeVisible();
  await expect(dialog.getByText("Choose what you fixed or write a note.", { exact: true })).toBeVisible();

  // A changed number is pointed out in place; it blocks nothing.
  await editor.fill(oldText(caseId).replace("14-month", "15-month"));
  await expect(dialog.getByText("Changes a number: 14 → 15. Check that this is intended.", { exact: true })).toBeVisible();
  await expect(dialog.getByText("Change the text first.", { exact: true })).toHaveCount(0);
  await evidence(page, "453-dialog-number-notice");

  // The fix: the changes below the field, the count from the server, the reason by click.
  await editor.fill(fixedText(caseId));
  const changes = dialog.getByRole("region", { name: "Text changes", exact: true });
  await expect(changes.locator("ins")).toHaveCount(1);
  await expect(changes.locator("ins")).toHaveText(",");
  await expect(dialog).toContainText("Changes to v1 · 1 character changed");
  await expect(dialog.getByText(/^Changes a number/)).toHaveCount(0);
  await dialog.getByRole("button", { name: "Grammar", exact: true }).click();
  await expect(dialog.getByRole("button", { name: "Grammar", exact: true })).toHaveAttribute("aria-pressed", "true");
  await dialog.getByLabel("Note", { exact: true }).fill("Comma after the introductory phrase");
  await expect(save).not.toHaveAttribute("aria-disabled", "true");
  await evidence(page, "453-dialog-changes");
  await save.click();
  await expect(dialog).toHaveCount(0);
  await expect(page.locator(".ui-toast .ui-toast-message")).toHaveText(`Typos fixed: v2 of ${caseId} de saved. It stays Accepted. 1 annotation moved to v2.`);

  // v2 is a correction of v1 and accepted; v1 stays accepted with its work.
  const after = await openTextCard(page, caseId, "de");
  const items = await textVersionItems(after, 2);
  const newest = items.filter({ hasText: "Correction of v1" });
  await expect(newest).toContainText("Accepted");
  await expect(newest).toContainText(new RegExp(`Typo fix by Project Lead \\(${esc(s.pseudonyms.lead)}, you\\), ${TIME} · Grammar: Comma after the introductory phrase`));
  // No review was started and none is asked for.
  await expect(newest.getByRole("button", { name: `Accept v2 of ${caseId} de…`, exact: true })).toHaveCount(0);
  const older = items.filter({ hasNotText: "Correction of v1" });
  await expect(older).toContainText("Accepted");
  await expect(older.getByRole("button", { name: /^Fix typos/ })).toHaveCount(0);
  await expect(fixAction(newest, caseId, 2)).toBeVisible();
  await evidence(page, "453-row-after");
  await textCard(page, caseId, "de").getByRole("button", { name: "Close", exact: true }).click();
  expect(errors).toEqual([]);
});

test("at 390 px: an unreviewed translation is corrected and stays ready for review", async ({ page }) => {
  const errors = consoleErrors(page);
  const s = await leadScenario(page, "ACCEPTED_TRANSLATION_FOR_LEAD");
  const caseId = s.cases!.unreviewed;
  await loginLead(page, s);
  const card = await openTextCard(page, caseId, "de");
  const [v1] = await (await textVersionItems(card, 1)).all();
  await page.setViewportSize(PHONE);
  await noHorizontalScroll(page, "row");
  const open = fixAction(v1, caseId);
  await open.scrollIntoViewIfNeeded();
  await open.click();

  const dialog = correctionDialog(page, caseId);
  const editor = dialog.getByRole("textbox", { name: "Corrected text", exact: true });
  await expect(editor).toHaveValue(oldText(caseId));
  // Nothing on v1: one quiet sentence, no highlighted block.
  await expect(dialog.getByText("Nobody has annotated v1 yet.", { exact: true })).toBeVisible();
  await expect(dialog.getByText("Work stays on v1", { exact: true })).toHaveCount(0);
  await expect(dialog.getByText("v2 keeps the status of v1: Ready for review. No translation review is started.", { exact: true })).toBeVisible();
  await noHorizontalScroll(page, "dialog");
  await editor.fill(fixedText(caseId));
  await expect(dialog).toContainText("Changes to v1 · 1 character changed");
  await dialog.getByRole("button", { name: "Spacing", exact: true }).click();
  await dialog.getByRole("button", { name: "Typo", exact: true }).click();
  await noHorizontalScroll(page, "changes");
  await evidence(page, "453-phone-dialog");
  await page.setViewportSize(PHONE);
  await dialog.getByRole("button", { name: "Save as v2", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.locator(".ui-toast .ui-toast-message")).toHaveText(`Typos fixed: v2 of ${caseId} de saved. It stays Ready for review.`);
  await noHorizontalScroll(page, "saved");

  const items = await textVersionItems(await openTextCard(page, caseId, "de"), 2);
  const newest = items.filter({ hasText: "Correction of v1" });
  await expect(newest).toContainText("Ready for review");
  await expect(newest).toContainText("· Spacing; Typo");
  // It is accepted like any newest version.
  await expect(newest.getByRole("button", { name: `Accept v2 of ${caseId} de…`, exact: true })).toBeVisible();
  await noHorizontalScroll(page, "row after");
  await evidence(page, "453-phone-row-after");
  expect(errors).toEqual([]);
});

test("a rejected translation is corrected and stays rejected", async ({ page }) => {
  const errors = consoleErrors(page);
  const s = await leadScenario(page, "REJECTED_TRANSLATION_FOR_LEAD");
  const caseId = s.cases!.rejected;
  await loginLead(page, s);
  const card = await openTextCard(page, caseId, "de");
  const [v1] = await (await textVersionItems(card, 1)).all();
  await expect(v1).toContainText("Rejected in review");
  await evidence(page, "453-rejected-row-before");
  await fixAction(v1, caseId).click();
  const dialog = correctionDialog(page, caseId);
  await expect(dialog.getByText("v2 keeps the status of v1: Rejected in review. No translation review is started.", { exact: true })).toBeVisible();
  const editor = dialog.getByRole("textbox", { name: "Corrected text", exact: true });
  await editor.fill(`${await editor.inputValue()}.`);
  await dialog.getByLabel("Note", { exact: true }).fill("Full stop at the end");
  await dialog.getByRole("button", { name: "Save as v2", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.locator(".ui-toast .ui-toast-message")).toHaveText(`Typos fixed: v2 of ${caseId} de saved. It stays Rejected in review.`);
  const items = await textVersionItems(await openTextCard(page, caseId, "de"), 2);
  const newest = items.filter({ hasText: "Correction of v1" });
  await expect(newest).toContainText("Rejected in review");
  await expect(newest).toContainText("Typo fix by Project Lead");
  await expect(newest).toContainText("· Full stop at the end");
  await evidence(page, "453-rejected-row-after");
  expect(errors).toEqual([]);
});

test("an open translation review refuses the correction", async ({ page }) => {
  const errors = consoleErrors(page);
  const s = await leadScenario(page, "ACCEPTED_TRANSLATION_FOR_LEAD");
  const caseId = s.cases!.in_review;
  await loginLead(page, s);
  const card = await openTextCard(page, caseId, "de");
  const [v1] = await (await textVersionItems(card, 1)).all();
  await fixAction(v1, caseId).click();
  const dialog = correctionDialog(page, caseId);
  await expect(dialog.getByText("A translation review of this version is open. Withdraw it with Remove… in the reviewer’s row of the Translation part, or make the fix in that review.", { exact: true })).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Save as v2", exact: true })).toHaveCount(0);
  await expect(dialog.getByRole("textbox")).toHaveCount(0);
  await evidence(page, "453-dialog-review-open");
  await dialog.locator(".modal-actions").getByRole("button", { name: "Close", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  expect(errors).toEqual([]);
});
