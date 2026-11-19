/**
 * Issue 341 a: "Upload a corrected text…" on the newest version row of a translation (decisions 341a-A to 341a-H).
 * - The text is pasted or read from one UTF-8 .txt file; how it was made is asked (provider only for a machine
 *   translation); the changes against the current version are shown before anything is saved.
 * - The new version is a correction of the current one, ready for review with review On; "Accept this version…"
 *   on the same row accepts it. The annotation work on the current version is named before saving.
 * - An open translation review of the version refuses the upload. (A source text has no such action: the unit
 *   tests of the text card and of the route cover it; a source row is not in this scenario's plan.)
 * Every step is checked at 1440 px and at 390 px for horizontal scroll, and the console stays free of errors.
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
const PHONE = { width: 390, height: 844 };

/** The fixture's de text of a case, and a new text that changes two passages of it. */
const oldText = (caseId: string) => `The patient is a 14-month-old girl with developmental delay and recurrent seizures. On examination she shows generalized hypotonia. (${caseId}, de)`;
const newText = (caseId: string) => `The patient is a 14-month-old girl with global developmental delay and recurrent seizures. On examination she shows marked generalized hypotonia. (${caseId}, de)`;

async function noHorizontalScroll(page: Page, name: string) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
  expect(overflow, `${name}: no horizontal scroll at ${page.viewportSize()?.width} px`).toBe(false);
}

/** Screenshots for human review only (never baselines), at the current size and at the other one. */
async function evidence(page: Page, name: string) {
  const dir = process.env.ONTOTATOR_SHOTS_DIR ?? resolve(test.info().config.rootDir, "../../build/translation-versions/evidence");
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

const uploadDialog = (page: Page, caseId: string) => page.getByRole("dialog", { name: `Upload a corrected text, ${caseId} de v1`, exact: true });

test("a pasted machine translation becomes v2, a correction that is ready for review and accepted by its own step", async ({ page }) => {
  const errors = consoleErrors(page);
  const s = await leadScenario(page, "ACCEPTED_TRANSLATION_FOR_LEAD");
  const caseId = s.cases!.accepted;
  await loginLead(page, s);
  const card = await openTextCard(page, caseId, "de");
  const [v1] = await (await textVersionItems(card, 1)).all();
  // 341a-A: next to the other version actions of the newest version.
  await expect(v1.getByRole("button", { name: `Correct v1 of ${caseId} de myself…`, exact: true })).toBeVisible();
  const open = v1.getByRole("button", { name: `Upload a corrected text for v1 of ${caseId} de…`, exact: true });
  await expect(open).toHaveText("Upload a corrected text…");
  await evidence(page, "341a-row-before");
  await open.click();

  const dialog = uploadDialog(page, caseId);
  await expect(dialog.getByText("The text becomes v2, a correction of v1.", { exact: true })).toBeVisible();
  // 341a-E: the work on v1, as in the lead correction, before anything is saved.
  await expect(dialog.getByText("Annotation has work on v1.", { exact: true })).toBeVisible();
  await expect(dialog).toContainText("2 annotations (1 submitted, 1 open) stay on v1. After saving, the row offers Handle text change… once v2 is accepted.");
  await expect(dialog.getByText("v2 starts as a correction with review On.", { exact: true })).toBeVisible();
  await evidence(page, "341a-dialog-empty");

  // 341a-D: only "How was this text made?" is required, the provider for a machine translation.
  const check = dialog.getByRole("button", { name: "Check changes", exact: true });
  // Incomplete: the button says so (aria-disabled) and a click names what is missing.
  await expect(check).toHaveAttribute("aria-disabled", "true");
  await check.click({ force: true });
  await expect(dialog.getByText("Paste the text.", { exact: true })).toBeVisible();
  await expect(dialog.getByText("Choose how the text was made.", { exact: true })).toBeVisible();
  await dialog.getByLabel(/^New text/).fill(newText(caseId));
  await dialog.getByRole("radio", { name: "Machine translation", exact: true }).check();
  await check.click({ force: true });
  await expect(dialog.getByText("Enter the provider, for example DeepL.", { exact: true })).toBeVisible();
  await dialog.getByLabel("Made by", { exact: true }).scrollIntoViewIfNeeded();
  await evidence(page, "341a-dialog-required");
  await dialog.getByLabel(/^Provider/).fill("DeepL");
  await dialog.getByLabel("Model or tool", { exact: true }).fill("deepl-2026-10");
  await dialog.getByLabel("Made on", { exact: true }).fill("2026-11-12");
  await dialog.getByLabel("Made by", { exact: true }).fill("Dr. Roe");
  await dialog.getByLabel("Note", { exact: true }).fill("Checked against the source");
  await evidence(page, "341a-dialog-filled");

  // 341a-B: the changes against v1 before saving.
  await check.click();
  await expect(dialog.getByText("Changes to v1", { exact: true })).toBeVisible();
  await expect(dialog).toContainText("2 passages changed");
  const changes = dialog.getByRole("region", { name: "Text changes", exact: true });
  await expect(changes.locator("ins")).toHaveCount(2);
  await expect(changes.locator("ins").first()).toContainText("global");
  await expect(dialog.getByText("Annotation has work on v1.", { exact: true })).toBeVisible();
  await evidence(page, "341a-dialog-changes");
  await dialog.getByRole("button", { name: "Save as v2", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.locator(".ui-toast .ui-toast-message")).toHaveText(`${caseId} de v2 saved as a correction of v1. It is ready for review.`);

  // 341a-C: v2 is a correction of v1, ready for review; v1 stays accepted with its work.
  const after = await openTextCard(page, caseId, "de");
  const items = await textVersionItems(after, 2);
  const newest = items.filter({ hasText: "Correction of v1" });
  await expect(newest).toContainText("Ready for review");
  await expect(newest).toContainText("Machine translation, DeepL, deepl-2026-10");
  await expect(newest).toContainText(new RegExp(`Uploaded by Project Lead \\(${esc(s.pseudonyms.lead)}, you\\), ${TIME} · Made on 12 Nov 2026 by Dr\\. Roe · Checked against the source`));
  await expect(items.filter({ hasNotText: "Correction of v1" })).toContainText("Accepted");
  // The older version offers no upload any more.
  await expect(items.filter({ hasNotText: "Correction of v1" }).getByRole("button", { name: /^Upload a corrected text/ })).toHaveCount(0);
  await expect(newest.getByRole("button", { name: `Upload a corrected text for v2 of ${caseId} de…`, exact: true })).toBeVisible();
  await evidence(page, "341a-row-after");

  // Accepting is the separate, audited step on the same row.
  await newest.getByRole("button", { name: `Accept v2 of ${caseId} de…`, exact: true }).click();
  const accept = page.getByRole("dialog", { name: "Accept de v2", exact: true });
  await accept.getByLabel(/^Reason/).fill("Reviewed by Dr. Roe against the source");
  await accept.getByRole("button", { name: "Accept v2", exact: true }).click();
  await expect(accept).toHaveCount(0);
  const accepted = (await textVersionItems(await openTextCard(page, caseId, "de"), 2)).filter({ hasText: "Correction of v1" });
  await expect(accepted).toContainText("Accepted: reviewed outside Ontotator");
  await evidence(page, "341a-row-accepted");
  await textCard(page, caseId, "de").getByRole("button", { name: "Close", exact: true }).click();
  expect(errors).toEqual([]);
});

test("at 390 px: a .txt file fills the text; a text without changes saves nothing", async ({ page }) => {
  const errors = consoleErrors(page);
  const s = await leadScenario(page, "ACCEPTED_TRANSLATION_FOR_LEAD");
  const caseId = s.cases!.unreviewed;
  await loginLead(page, s);
  const card = await openTextCard(page, caseId, "de");
  const [v1] = await (await textVersionItems(card, 1)).all();
  await page.setViewportSize(PHONE);
  await noHorizontalScroll(page, "row");
  const open = v1.getByRole("button", { name: `Upload a corrected text for v1 of ${caseId} de…`, exact: true });
  await open.scrollIntoViewIfNeeded();
  await open.click();

  const dialog = uploadDialog(page, caseId);
  // Nothing on v1: no consequence block (341a-E), only the hint.
  await expect(dialog.getByText("v2 starts as a correction with review On.", { exact: true })).toBeVisible();
  await expect(dialog.getByText(/has work/)).toHaveCount(0);
  await dialog.getByRole("radio", { name: "Choose file", exact: true }).check({ force: true });
  await expect(dialog.getByText("One UTF-8 text file (.txt). The file name does not matter here.", { exact: true })).toBeVisible();
  const file = dialog.getByLabel(/^Text file/);
  // Not UTF-8, then not a text file: refused in words, nothing is read.
  await file.setInputFiles({ name: "latin1.txt", mimeType: "text/plain", buffer: Buffer.from([0x4d, 0xe4, 0x64, 0x63, 0x68, 0x65, 0x6e]) });
  await expect(dialog.getByText("This file is not UTF-8 text. Save it as UTF-8 and choose it again.", { exact: true })).toBeVisible();
  await noHorizontalScroll(page, "file refused");
  await file.setInputFiles({ name: "bundle.json", mimeType: "application/json", buffer: Buffer.from("{}") });
  await expect(dialog.getByText("Choose a text file (.txt).", { exact: true })).toBeVisible();
  // The same text as v1 (a file ends with a line break): no new version.
  await file.setInputFiles({ name: "same.txt", mimeType: "text/plain", buffer: Buffer.from(`${oldText(caseId)}\n`, "utf8") });
  await expect(dialog.getByText(/^same\.txt · \d+ B$/)).toBeVisible();
  await dialog.getByRole("radio", { name: "Human translation", exact: true }).check();
  await expect(dialog.getByLabel(/^Provider/)).toHaveCount(0);
  const check = dialog.getByRole("button", { name: "Check changes", exact: true });
  await check.click();
  await expect(dialog.getByText("No changes to v1. Nothing is saved.", { exact: true })).toBeVisible();
  await evidence(page, "341a-dialog-unchanged");
  await page.setViewportSize(PHONE);

  await file.setInputFiles({ name: `${caseId}_de_agency.txt`, mimeType: "text/plain", buffer: Buffer.from(`\ufeff${newText(caseId)}\r\n`, "utf8") });
  await expect(dialog.getByText(new RegExp(`^${esc(caseId)}_de_agency\\.txt · \\d+ B$`))).toBeVisible();
  await expect(dialog.getByText("No changes to v1. Nothing is saved.", { exact: true })).toHaveCount(0);
  await evidence(page, "341a-dialog-file");
  await page.setViewportSize(PHONE);
  await check.click();
  await expect(dialog.getByText("Changes to v1", { exact: true })).toBeVisible();
  await expect(dialog).toContainText("2 passages changed");
  await noHorizontalScroll(page, "changes");
  await evidence(page, "341a-dialog-file-changes");
  await page.setViewportSize(PHONE);
  // Back keeps the file and the choice.
  await dialog.getByRole("button", { name: "Back", exact: true }).click();
  await expect(dialog.getByRole("radio", { name: "Human translation", exact: true })).toBeChecked();
  await dialog.getByRole("button", { name: "Check changes", exact: true }).click();
  await dialog.getByRole("button", { name: "Save as v2", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.locator(".ui-toast .ui-toast-message")).toHaveText(`${caseId} de v2 saved as a correction of v1. It is ready for review.`);
  await noHorizontalScroll(page, "saved");

  await page.setViewportSize({ width: 1440, height: 900 });
  const items = await textVersionItems(await openTextCard(page, caseId, "de"), 2);
  const newest = items.filter({ hasText: "Correction of v1" });
  await expect(newest).toContainText("Human translation");
  await expect(newest).toContainText("Ready for review");
  await expect(newest.getByRole("button", { name: `Accept v2 of ${caseId} de…`, exact: true })).toBeVisible();
  await evidence(page, "341a-row-after-file");
  expect(errors).toEqual([]);
});

test("an open translation review refuses the upload", async ({ page }) => {
  const errors = consoleErrors(page);
  const s = await leadScenario(page, "ACCEPTED_TRANSLATION_FOR_LEAD");
  const caseId = s.cases!.in_review;
  await loginLead(page, s);
  // 341a-G: the same rule and words as correcting and accepting.
  const card = await openTextCard(page, caseId, "de");
  const [v1] = await (await textVersionItems(card, 1)).all();
  await v1.getByRole("button", { name: `Upload a corrected text for v1 of ${caseId} de…`, exact: true }).click();
  const dialog = uploadDialog(page, caseId);
  await expect(dialog.getByText("A translation review of this version is open. Withdraw it with Remove… in the reviewer’s row of the Translation part before you upload a new version.", { exact: true })).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Check changes", exact: true })).toHaveCount(0);
  await expect(dialog.getByRole("textbox")).toHaveCount(0);
  await evidence(page, "341a-dialog-review-open");
  await dialog.locator(".modal-actions").getByRole("button", { name: "Close", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  expect(errors).toEqual([]);
});
