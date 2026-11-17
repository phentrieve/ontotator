/**
 * Issue 453: "Editorial correction…" on the newest version row of a translation.
 * - The lead edits the text in the translation editor and gives a reason; the guards (a number changes, the
 *   change is too large) refuse in words before anything is saved.
 * - The changes and what happens to the work on the version are shown before saving. The new version is a
 *   correction with the status of the version it corrects: an accepted text stays accepted, without a review.
 * - An open translation review of the version refuses the correction.
 * Every step is checked at 1440 px and at 390 px for horizontal scroll, and the console stays free of errors.
 */
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { documentsReady, openTextCard, textCard, textVersionItems } from "./documentsHelpers";
import { TEST_PASSWORD } from "./helpers";
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
  await page.goto("/");
  await page.evaluate(([key, value]) => window.localStorage.setItem(key, value), [`ontotator.lastProject.v1:${s.users.lead}`, s.project]);
  const form = page.getByRole("form", { name: "Log in to Ontotator" });
  await form.getByLabel("Username", { exact: true }).fill(s.users.lead);
  await form.getByLabel("Password", { exact: true }).fill(TEST_PASSWORD);
  await form.getByRole("button", { name: "Log in", exact: true }).click();
  await expect(page.getByTestId("current-user")).toContainText(s.display_names.lead);
  await expect(page).toHaveURL(new RegExp(`#/projects/${esc(s.project)}/documents`));
  await documentsReady(page);
}

const correctionDialog = (page: Page, caseId: string) => page.getByRole("dialog", { name: `Editorial correction, ${caseId} de v1`, exact: true });

test("a comma added to an accepted translation becomes an accepted v2; a changed number and a large change are refused in words", async ({ page }) => {
  const errors = consoleErrors(page);
  const s = await leadScenario(page, "ACCEPTED_TRANSLATION_FOR_LEAD");
  const caseId = s.cases!.accepted;
  await loginLead(page, s);
  const card = await openTextCard(page, caseId, "de");
  const [v1] = await (await textVersionItems(card, 1)).all();
  // Next to the other version actions of the newest version.
  await expect(v1.getByRole("button", { name: `Correct the translation v1 of ${caseId} de…`, exact: true })).toBeVisible();
  await expect(v1.getByRole("button", { name: `Upload new version of v1 of ${caseId} de…`, exact: true })).toBeVisible();
  const open = v1.getByRole("button", { name: `Editorial correction of v1 of ${caseId} de…`, exact: true });
  await expect(open).toHaveText("Editorial correction…");
  await evidence(page, "453-row-before");
  await open.click();

  const dialog = correctionDialog(page, caseId);
  await expect(dialog.getByText("Fix spacing, typos or grammar. The corrected text becomes v2 and keeps the status of v1 (Accepted); it is not reviewed again.", { exact: true })).toBeVisible();
  // The translation editor starts with the text of v1.
  const editor = dialog.getByRole("textbox", { name: "Corrected text", exact: true });
  await expect(editor).toHaveValue(oldText(caseId));
  await expect(dialog.getByText("Changed words are marked. At most 20 characters may change, and every number stays as it is. A larger change belongs in a translation review.", { exact: true })).toBeVisible();
  await evidence(page, "453-dialog-text");

  // Nothing changed and no reason: the button says so and a click names what is missing.
  const check = dialog.getByRole("button", { name: "Check changes", exact: true });
  await expect(check).toHaveAttribute("aria-disabled", "true");
  await check.click({ force: true });
  await expect(dialog.getByText("Change the text first.", { exact: true })).toBeVisible();
  await expect(dialog.getByText("Enter the reason.", { exact: true })).toBeVisible();
  const reason = dialog.getByLabel(/^Reason/);
  await reason.fill("Comma after the introductory phrase");

  // Guard: the digits of the text stay as they are.
  await editor.fill(oldText(caseId).replace("14-month", "15-month"));
  await check.click();
  await expect(dialog.getByText("A number would change. An editorial correction leaves every digit as it is; change numbers in a translation review.", { exact: true })).toBeVisible();
  await evidence(page, "453-dialog-number-refused");
  // Guard: the size cap.
  await editor.fill(`${oldText(caseId)} She was admitted to the ward afterwards.`);
  await expect(dialog.getByText(/A number would change/)).toHaveCount(0);
  await check.click();
  await expect(dialog.getByText("This change is too large for an editorial correction (41 characters changed, at most 20 here). Make it in a translation review with Correct the translation… or Request correction….", { exact: true })).toBeVisible();
  await evidence(page, "453-dialog-size-refused");
  await expect(dialog.getByRole("button", { name: "Save as v2", exact: true })).toHaveCount(0);

  // The fix: the changes and what happens to the work on v1, before anything is saved.
  await editor.fill(fixedText(caseId));
  await check.click();
  await expect(dialog.getByText("Changes to v1", { exact: true })).toBeVisible();
  await expect(dialog).toContainText("1 character changed, at most 20");
  const changes = dialog.getByRole("region", { name: "Text changes", exact: true });
  await expect(changes.locator("ins")).toHaveCount(1);
  await expect(changes.locator("ins")).toHaveText(",");
  await expect(dialog).toContainText("Reason · Comma after the introductory phrase");
  await expect(dialog.getByText("What happens to the work on v1", { exact: true })).toBeVisible();
  // v2 is accepted at once, so the text-change steps wait for nothing.
  await expect(dialog).toContainText("2 annotations (1 submitted, 1 open) stay on v1. After saving, the row offers Handle text change….");
  await expect(dialog.getByText("v2 keeps the status of v1: Accepted. No translation review is started.", { exact: true })).toBeVisible();
  await evidence(page, "453-dialog-changes");
  // Back keeps the text and the reason.
  await dialog.getByRole("button", { name: "Back", exact: true }).click();
  await expect(dialog.getByRole("textbox", { name: "Corrected text", exact: true })).toHaveValue(fixedText(caseId));
  await expect(dialog.getByLabel(/^Reason/)).toHaveValue("Comma after the introductory phrase");
  await dialog.getByRole("button", { name: "Check changes", exact: true }).click();
  await dialog.getByRole("button", { name: "Save as v2", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.locator(".ui-toast .ui-toast-message")).toHaveText(`${caseId} de v2 saved as an editorial correction of v1. It stays Accepted.`);

  // v2 is a correction of v1 and accepted; v1 stays accepted with its work.
  const after = await openTextCard(page, caseId, "de");
  const items = await textVersionItems(after, 2);
  const newest = items.filter({ hasText: "Correction of v1" });
  await expect(newest).toContainText("Accepted");
  await expect(newest).toContainText(new RegExp(`Editorial correction by Project Lead \\(${esc(s.pseudonyms.lead)}, you\\), ${TIME} · Comma after the introductory phrase`));
  // No review was started and none is asked for.
  await expect(newest.getByRole("button", { name: `Accept v2 of ${caseId} de…`, exact: true })).toHaveCount(0);
  const older = items.filter({ hasNotText: "Correction of v1" });
  await expect(older).toContainText("Accepted");
  await expect(older.getByRole("button", { name: /^Editorial correction/ })).toHaveCount(0);
  await expect(newest.getByRole("button", { name: `Editorial correction of v2 of ${caseId} de…`, exact: true })).toBeVisible();
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
  const open = v1.getByRole("button", { name: `Editorial correction of v1 of ${caseId} de…`, exact: true });
  await open.scrollIntoViewIfNeeded();
  await open.click();

  const dialog = correctionDialog(page, caseId);
  await expect(dialog.getByText("Fix spacing, typos or grammar. The corrected text becomes v2 and keeps the status of v1 (Ready for review); it is not reviewed again.", { exact: true })).toBeVisible();
  const editor = dialog.getByRole("textbox", { name: "Corrected text", exact: true });
  await expect(editor).toHaveValue(oldText(caseId));
  await noHorizontalScroll(page, "dialog");
  await editor.fill(fixedText(caseId));
  await dialog.getByLabel(/^Reason/).fill("Comma after the introductory phrase");
  await evidence(page, "453-phone-dialog-text");
  await page.setViewportSize(PHONE);
  await dialog.getByRole("button", { name: "Check changes", exact: true }).click();
  await expect(dialog.getByText("Changes to v1", { exact: true })).toBeVisible();
  // Nothing on v1: no consequence block, only the status line.
  await expect(dialog.getByText("What happens to the work on v1", { exact: true })).toHaveCount(0);
  await expect(dialog.getByText("v2 keeps the status of v1: Ready for review. No translation review is started.", { exact: true })).toBeVisible();
  await noHorizontalScroll(page, "changes");
  await evidence(page, "453-phone-dialog-changes");
  await page.setViewportSize(PHONE);
  await dialog.getByRole("button", { name: "Save as v2", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.locator(".ui-toast .ui-toast-message")).toHaveText(`${caseId} de v2 saved as an editorial correction of v1. It stays Ready for review.`);
  await noHorizontalScroll(page, "saved");

  const items = await textVersionItems(await openTextCard(page, caseId, "de"), 2);
  const newest = items.filter({ hasText: "Correction of v1" });
  await expect(newest).toContainText("Ready for review");
  await expect(newest).toContainText("Editorial correction by Project Lead");
  // It is accepted like any newest version.
  await expect(newest.getByRole("button", { name: `Accept v2 of ${caseId} de…`, exact: true })).toBeVisible();
  await noHorizontalScroll(page, "row after");
  await evidence(page, "453-phone-row-after");
  expect(errors).toEqual([]);
});

test("an open translation review refuses the editorial correction", async ({ page }) => {
  const errors = consoleErrors(page);
  const s = await leadScenario(page, "ACCEPTED_TRANSLATION_FOR_LEAD");
  const caseId = s.cases!.in_review;
  await loginLead(page, s);
  const card = await openTextCard(page, caseId, "de");
  const [v1] = await (await textVersionItems(card, 1)).all();
  await v1.getByRole("button", { name: `Editorial correction of v1 of ${caseId} de…`, exact: true }).click();
  const dialog = correctionDialog(page, caseId);
  await expect(dialog.getByText("A translation review of this version is open. Withdraw it with Remove… in the reviewer’s row of the Translation part, or make the fix in that review.", { exact: true })).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Check changes", exact: true })).toHaveCount(0);
  await expect(dialog.getByRole("textbox")).toHaveCount(0);
  await evidence(page, "453-dialog-review-open");
  await dialog.locator(".modal-actions").getByRole("button", { name: "Close", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  expect(errors).toEqual([]);
});
