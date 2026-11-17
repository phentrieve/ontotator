/**
 * Issue 341 b and d: the lead's actions on one version of the Translation part.
 * - b: "Correct the translation…" of an accepted version lists the annotation work that stays on it before the
 *   correction starts; the corrected text becomes v2, a correction that is reviewed again (v1 stays accepted).
 * - d: "Accept this version…" accepts exactly that version with a required reason, recorded like other acceptances.
 */
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { documentsReady, openTextCard, textCard, textVersionItems } from "./documentsHelpers";
import { loginThroughForm } from "./helpers";
import { leadScenario, type LeadScenario } from "./leadWorkflowHelpers";

test.setTimeout(240_000);
test.use({ actionTimeout: 15_000, viewport: { width: 1440, height: 900 } });

const TIME = String.raw`\d{1,2} [A-Z][a-z]{2}(?: \d{4})?, \d{2}:\d{2}(?::\d{2})?`;
const esc = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Screenshots for human review only (never baselines). */
async function evidence(page: Page, name: string) {
  const dir = resolve(test.info().config.rootDir, "../../build/translation-versions/evidence");
  mkdirSync(dir, { recursive: true });
  await page.screenshot({ path: resolve(dir, `${name}.png`) });
  const size = page.viewportSize();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: resolve(dir, `${name}-phone.png`) });
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
  expect(overflow, `${name}: no horizontal scroll at 390 px`).toBe(false);
  if (size) await page.setViewportSize(size);
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

test("b: the correction of an accepted version names the annotation work that stays on it", async ({ page }) => {
  const errors = consoleErrors(page);
  const s = await leadScenario(page, "ACCEPTED_TRANSLATION_FOR_LEAD");
  const caseId = s.cases!.accepted;
  await loginLead(page, s);
  const card = await openTextCard(page, caseId, "de");
  const [v1] = await (await textVersionItems(card, 1)).all();
  await expect(v1.getByRole("button", { name: "Accept this version…" })).toHaveCount(0);
  await v1.getByRole("button", { name: `Correct the translation v1 of ${caseId} de…`, exact: true }).click();

  const dialog = page.getByRole("dialog", { name: `Correct the translation, ${caseId} de v1, accepted`, exact: true });
  await expect(dialog).toContainText("You correct the accepted v1 yourself in the translation review and submit it as Accepted with corrections. The corrected text becomes v2.");
  await expect(dialog.getByText("Annotation has work on v1.", { exact: true })).toBeVisible();
  await expect(dialog).toContainText("2 annotations (1 submitted, 1 open) stay on v1. After saving, the row offers Handle text change… once v2 is accepted.");
  await expect(dialog.getByText("v2 starts as a correction with review On.", { exact: true })).toBeVisible();
  await evidence(page, "341-correct-dialog");

  await dialog.getByRole("button", { name: "Open translation review", exact: true }).click();
  await expect(page).toHaveURL(/#\/tasks\/\d+$/);
  const text = page.getByRole("textbox", { name: "Translation (de)", exact: true });
  await expect(text).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText("You are correcting this accepted translation as project lead. The corrected text becomes a new version that is reviewed again.", { exact: true })).toBeVisible();
  await text.fill(`${await text.inputValue()} The second seizure episode is included.`);
  const review = page.getByRole("region", { name: "Translation review", exact: true });
  await expect(review.locator(".translation-save-status")).toHaveText("Saved");
  await page.getByRole("button", { name: "Submit review…", exact: true }).click();
  const confirm = page.getByRole("dialog", { name: "Submit this review?", exact: true });
  await expect(confirm).toContainText("starts as a correction with review On. This version stays accepted");
  await confirm.getByRole("button", { name: "Submit review", exact: true }).click();
  await expect(page.getByText("Your corrected text was saved as a new version. It is reviewed again before annotation.", { exact: true })).toBeVisible();
  await expect(page.getByText("A corrected version v2 was created.", { exact: true })).toBeVisible();

  // Back on Documents: v2 waits for its review, v1 stays accepted with its annotation work.
  await page.getByRole("link", { name: "Back to Documents", exact: true }).click();
  await documentsReady(page);
  const after = await openTextCard(page, caseId, "de");
  const items = await textVersionItems(after, 2);
  const newest = items.filter({ hasText: "Correction of v1" });
  await expect(newest).toContainText("Ready for review");
  await expect(newest.getByRole("button", { name: `Accept v2 of ${caseId} de…`, exact: true })).toBeVisible();
  await expect(items.filter({ hasNotText: "Correction of v1" })).toContainText("Accepted");
  await evidence(page, "341-correct-done");
  await textCard(page, caseId, "de").getByRole("button", { name: "Close", exact: true }).click();
  expect(errors).toEqual([]);
});

test("b: Request correction… is refused while the lead's own correction of the version is open", async ({ page }) => {
  const errors = consoleErrors(page);
  const s = await leadScenario(page, "ACCEPTED_TRANSLATION_FOR_LEAD");
  const caseId = s.cases!.accepted;
  await loginLead(page, s);
  const card = await openTextCard(page, caseId, "de");
  const [v1] = await (await textVersionItems(card, 1)).all();
  await v1.getByRole("button", { name: `Correct the translation v1 of ${caseId} de…`, exact: true }).click();
  await page.getByRole("dialog", { name: `Correct the translation, ${caseId} de v1, accepted`, exact: true })
    .getByRole("button", { name: "Open translation review", exact: true }).click();
  await expect(page.getByRole("textbox", { name: "Translation (de)", exact: true })).toBeVisible({ timeout: 30_000 });

  // The correction is open: a second review of the accepted v1 is refused, in words.
  await page.goBack();
  await documentsReady(page);
  const again = await openTextCard(page, caseId, "de");
  const [version] = await (await textVersionItems(again, 1)).all();
  await version.getByRole("button", { name: "Request correction…", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: /^Request translation correction/ });
  await dialog.getByLabel("Translation reviewer").selectOption({ index: 1 });
  await dialog.getByLabel("Reason for another review").fill("Dose missing");
  await dialog.getByRole("button", { name: "Assign correction review", exact: true }).click();
  await expect(dialog).toContainText("A lead is correcting this version. Request the correction after that correction is submitted");
  await evidence(page, "341-request-refused");
  // The refusal is an expected 409: the browser logs the failed request, nothing else.
  expect(errors.filter(text => !/409/.test(text))).toEqual([]);
});

test("d: Accept this version… accepts exactly that version with a reason", async ({ page }) => {
  const errors = consoleErrors(page);
  const s = await leadScenario(page, "ACCEPTED_TRANSLATION_FOR_LEAD");
  const caseId = s.cases!.unreviewed;
  await loginLead(page, s);
  const card = await openTextCard(page, caseId, "de");
  const [v1] = await (await textVersionItems(card, 1)).all();
  await expect(v1.getByRole("button", { name: /^Correct the translation/ })).toHaveCount(0);
  await expect(v1.getByRole("link", { name: `View text v1 of ${caseId} de`, exact: true })).toBeVisible();
  await evidence(page, "341-accept-button");
  await v1.getByRole("button", { name: `Accept v1 of ${caseId} de…`, exact: true }).click();

  const dialog = page.getByRole("dialog", { name: "Accept de v1", exact: true });
  await expect(dialog.getByText("The acceptance is recorded with your name, the reason and the time.", { exact: true })).toBeVisible();
  const accept = dialog.getByRole("button", { name: "Accept v1", exact: true });
  await expect(accept).toHaveAttribute("aria-disabled", "true");
  const reason = "Checked against the DeepL output";
  await dialog.getByLabel(/^Reason/).fill(reason);
  await expect(accept).not.toHaveAttribute("aria-disabled", "true");
  await evidence(page, "341-accept-dialog");
  await accept.click();
  await expect(dialog).toHaveCount(0);
  await expect(page.locator(".ui-toast .ui-toast-message")).toHaveText(`${caseId} de v1 accepted as reviewed outside Ontotator.`);

  const after = await openTextCard(page, caseId, "de");
  const [accepted] = await (await textVersionItems(after, 1)).all();
  await expect(accepted).toContainText(new RegExp(`Accepted: reviewed outside Ontotator\\W+Project Lead \\(${esc(s.pseudonyms.lead)}, you\\)\\W+${TIME}\\W+${esc(reason)}`));
  await expect(accepted.getByRole("button", { name: /^Accept v1/ })).toHaveCount(0);
  await evidence(page, "341-accept-done");
  expect(errors).toEqual([]);
});
