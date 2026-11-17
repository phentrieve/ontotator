/**
 * The translation review of a version after the first, the lead's reason in the task, a pending source update at
 * submit and the checked-sentence marks next to repeated sentences (user review of 2026-11-17), at 1440 and 390 px.
 *
 * Every test builds a fresh project and drives the lead's part through the API.
 */
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { authenticatedRequest, loginThroughForm, TASKS_HOME } from "./helpers";
import { loginScenarioUser, reviewFlowScenario, type ReviewFlowScenario } from "./reviewFlowHelpers";

test.setTimeout(180_000);
test.use({ actionTimeout: 15_000 });

const WIDE = { width: 1440, height: 900 };
const NARROW = { width: 390, height: 844 };
const sizes = [["1440", WIDE], ["390", NARROW]] as const;

/** Screenshots for human review only (never baselines); SHOTS_DIR overrides the folder. */
const shotsDir = () => process.env.SHOTS_DIR ?? resolve(test.info().config.rootDir, "../../build/review-translation/evidence");
async function shot(page: Page, name: string, fullPage = false) {
  mkdirSync(shotsDir(), { recursive: true });
  await page.screenshot({ path: resolve(shotsDir(), `${name}.png`), fullPage });
}

/** Console errors and page errors of the page; a test ends with none. */
function watchErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on("console", message => { if (message.type() === "error") errors.push(message.text()); });
  page.on("pageerror", error => errors.push(String(error)));
  return errors;
}
const noPageScroll = async (page: Page) =>
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);

async function call<T>(page: Page, path: string, method = "GET", data?: unknown): Promise<T> {
  const response = await authenticatedRequest(page, path, method, data);
  expect(response.ok(), `${method} ${path}: ${response.status()} ${await response.text()}`).toBeTruthy();
  return await response.json() as T;
}
interface Workspace { text: string; draft: { text: string; revision: number }; variant: { document_id: string; text_sha256: string } }
const target = (page: Page) => page.getByRole("textbox", { name: "Translation (de)", exact: true });
const note = (page: Page) => page.locator("#review-translation-note");
const checks = (page: Page) => page.getByRole("region", { name: "Automatic translation checks", exact: true });
const taskRow = (page: Page, id: number) => page.getByTestId("task-row").filter({ has: page.locator(`a[href="#/tasks/${id}"]`) });

/** As the signed-in reviewer: decide and submit the review through the API. */
async function submitReview(page: Page, id: number, form: Record<string, unknown>): Promise<Workspace> {
  const workspace = await call<Workspace>(page, `/api/v1/translation-reviews/${id}`);
  await call(page, `/api/v1/translation-reviews/${id}/draft`, "PUT", { text: workspace.draft.text, form, expected_revision: workspace.draft.revision });
  await call(page, `/api/v1/translation-reviews/${id}/submit`, "POST", { expected_revision: workspace.draft.revision + 1 });
  return workspace;
}
const project = (s: ReviewFlowScenario) => `/api/v1/projects/${encodeURIComponent(s.project)}`;
const ACCEPTED = { decision: "accepted_unchanged", clinical_change: false, categories: [], rationale: "Units checked." };
const REJECTED = { decision: "rejected", clinical_change: true, categories: ["value"], rationale: "The dose is wrong." };

/**
 * Ana rejects ``failed-translation`` v1 (one failed check); the lead uploads v2 as a human translation and assigns
 * its review to Ana. Returns the assignment id of that review; the page ends logged in as Ana.
 */
async function uploadedVersion(page: Page): Promise<{ s: ReviewFlowScenario; review: number }> {
  const s = await reviewFlowScenario(page, "REVIEW_FLOW");
  await loginScenarioUser(page, s, "ana");
  const first = await submitReview(page, s.assignments["failed-translation"], REJECTED);
  await page.context().clearCookies();
  await loginScenarioUser(page, s, "lead");
  const versions = `${project(s)}/variants/${encodeURIComponent(first.variant.document_id)}/versions`;
  const text = first.text.replace("Dosis 5 mg", "Dosis 5 Milligramm");
  const preview = await call<{ text_sha256: string }>(page, `${versions}/preview`, "POST", { text });
  const uploaded = await call<{ document_id: string }>(page, versions, "POST", { text, expected_text_sha256: preview.text_sha256,
    method: "human_translation", made_by: "Dr. Roe", note: "Translated again by hand" });
  const assigned = await call<{ created: { id: number }[] }>(page, `${project(s)}/assignments`, "POST",
    { rows: [{ document_id: uploaded.document_id, username: s.users.ana }], task: "translation_review" });
  await page.context().clearCookies();
  await loginScenarioUser(page, s, "ana");
  return { s, review: assigned.created[0].id };
}

for (const [name, viewport] of sizes) {
  test(`a version after the first is reviewed as itself, not as the machine translation (${name})`, async ({ page }) => {
    await page.setViewportSize(viewport);
    const errors = watchErrors(page);
    const { review } = await uploadedVersion(page);
    // My tasks: the failed check of v1 is not counted on the review of v2.
    await page.goto(TASKS_HOME);
    await expect(taskRow(page, review)).toBeVisible();
    await expect(taskRow(page, review)).not.toContainText("automatic check failed");
    await page.goto(`/#/tasks/${review}`);
    await expect(target(page)).toBeVisible();
    await expect(checks(page)).toContainText("The automatic checks ran on v1, not on this version (v2). 1 automatic check failed on v1: Units added in translation.");
    await expect(note(page)).toHaveText("Same as the version you were given (v2). Compare shows what changed since v1.");
    // Translation details: how v2 was made; the run of v1 is named as that.
    await page.getByText("Translation details", { exact: true }).click();
    const details = page.locator(".translation-details dl");
    await expect(details).toContainText("This versionHuman translation");
    await expect(details).toContainText("Uploadedby the project lead on");
    await expect(details).toContainText("Madeby Dr. Roe");
    await expect(details).toContainText("Version beforev1");
    await expect(details).toContainText("Translation run of v1test-mt, model m1, run run-1");
    await expect(details.getByText("Machine translation", { exact: true })).toHaveCount(0);
    await shot(page, `f1-details-${name}`);
    await page.keyboard.press("Escape");
    // Compare defaults to the previous version and marks what changed since it.
    await page.getByRole("button", { name: "Compare with the previous version (v1)", exact: true }).click();
    const comparison = page.getByRole("region", { name: "Comparison", exact: true });
    await expect(page.locator(".translation-column-subtitle")).toHaveText("Changes from v1 to v2");
    await expect(comparison.locator("ins").first()).toHaveText("Milligramm");
    await expect(comparison.locator("del").first()).toHaveText("mg");
    await comparison.scrollIntoViewIfNeeded();
    await shot(page, `f1-compare-${name}`);
    await page.getByRole("button", { name: "Close comparison", exact: true }).click();
    // "Show changes" is about the reviewer's own edits.
    await page.getByRole("checkbox", { name: "Show changes", exact: true }).check();
    await expect(note(page)).toHaveText("Showing your changes against the version you were given (v2). Turn off Show changes to edit. Compare shows what changed since v1.");
    await page.getByRole("checkbox", { name: "Show changes", exact: true }).uncheck();
    // Accepted unchanged needs no rationale for the check of v1.
    await page.getByRole("radio", { name: "Accepted unchanged", exact: true }).check();
    await expect(page.locator(".translation-save-status")).toHaveText("Saved");
    await expect(page.getByText("An automatic check failed.", { exact: false })).toHaveCount(0);
    await page.getByRole("button", { name: "Submit review…", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "Submit this review?", exact: true });
    await expect(dialog).toBeVisible();
    await expect(dialog).not.toContainText("automatic check failed");
    await shot(page, `f1-submit-${name}`);
    await dialog.getByRole("button", { name: "Keep editing", exact: true }).click();
    await noPageScroll(page);
    await shot(page, `f1-review-${name}`, name === "390");
    expect(errors).toEqual([]);
  });
}

const CORRECTION_REASON = "Bitte Dosis in Absatz 2 noch einmal prüfen.";
const REOPEN_REASON = "Please look at paragraph 3 again; the unit is mg in my copy.";
const leadReason = (page: Page) => page.getByRole("note", { name: "From the lead", exact: true });

for (const [name, viewport] of sizes) {
  test(`the lead's reason for a second review and for a reopen is in My tasks and in the review (${name})`, async ({ page }) => {
    await page.setViewportSize(viewport);
    const errors = watchErrors(page);
    const s = await reviewFlowScenario(page, "REVIEW_FLOW");
    const second = s.assignments["second-translation"], failed = s.assignments["failed-translation"];
    await loginScenarioUser(page, s, "ana");
    const accepted = await submitReview(page, second, ACCEPTED);
    await submitReview(page, failed, REJECTED);
    await page.context().clearCookies();
    await loginScenarioUser(page, s, "lead");
    // "Request correction…" of the accepted version, to the reviewer who accepted it; "Reopen…" of the rejected one.
    await call(page, `${project(s)}/documents/${encodeURIComponent(accepted.variant.document_id)}/translation-correction-assignment`, "POST",
      { username: s.users.ana, expected_text_sha256: accepted.variant.text_sha256, reason: CORRECTION_REASON });
    await call(page, `/api/v1/assignments/${failed}/reopen`, "POST", { reason: REOPEN_REASON });
    await page.context().clearCookies();
    await loginScenarioUser(page, s, "ana");
    await page.goto(TASKS_HOME);
    // My tasks: one line under the task name; the Reopened badge gives the same reason, never "No reason given."
    const row = taskRow(page, second);
    await expect(row.locator(".task-lead-reason")).toHaveText(new RegExp(`^Second review requested by the lead on .+: ${CORRECTION_REASON}$`));
    await expect(taskRow(page, failed).locator(".task-lead-reason")).toHaveCount(0);
    if (name === "1440") {
      await row.getByRole("button", { name: "Reopened, why", exact: true }).click();
      const why = page.getByRole("dialog", { name: "Why reopened", exact: true });
      await expect(why).toHaveText(new RegExp(`^Second review requested by the lead on .+: ${CORRECTION_REASON}$`));
      await page.keyboard.press("Escape");
      await expect(why).toHaveCount(0);
    } else {
      // Phone: status and reasons are stacked under the task. The second-review reason stands there once, with a
      // plain Reopened badge; the reopened review writes its reason out below its badge.
      await expect(row.getByText(CORRECTION_REASON, { exact: false })).toHaveCount(1);
      await expect(row.getByText("Reopened", { exact: true })).toBeVisible();
      await expect(taskRow(page, failed)).toContainText(REOPEN_REASON);
      // The reason line uses the width of the stacked cell: it does not wrap word by word.
      const line = await row.locator(".task-lead-reason").boundingBox();
      expect(line!.width).toBeGreaterThan(180);
      expect(line!.height).toBeLessThan(110);
    }
    await expect(page.getByRole("main")).not.toContainText("No reason given");
    await noPageScroll(page);
    await shot(page, `f2-mytasks-${name}`, true);
    // The review: the reason stands above Decision.
    await page.goto(`/#/tasks/${second}`);
    await expect(target(page)).toBeVisible();
    await expect(leadReason(page)).toHaveText(new RegExp(`^Second review requested by the lead on .+: ${CORRECTION_REASON}$`));
    const reasonBox = await leadReason(page).boundingBox(), decision = await page.locator("[data-decision-legend]").boundingBox();
    expect(reasonBox!.y + reasonBox!.height).toBeLessThanOrEqual(decision!.y);
    await leadReason(page).scrollIntoViewIfNeeded();
    await noPageScroll(page);
    await shot(page, `f2-second-review-${name}`);
    // A reopened review names the reopen reason in the task as well.
    await page.goto(`/#/tasks/${failed}`);
    await expect(target(page)).toBeVisible();
    await expect(leadReason(page)).toHaveText(new RegExp(`^Reopened by the lead on .+: ${REOPEN_REASON.replace("?", "\\?")}$`));
    await leadReason(page).scrollIntoViewIfNeeded();
    await noPageScroll(page);
    await shot(page, `f2-reopened-${name}`);
    expect(errors).toEqual([]);
  });
}

for (const [name, viewport] of sizes) {
  test(`an open source update is named when the review is submitted, and its dialog marks the differences (${name})`, async ({ page }) => {
    await page.setViewportSize(viewport);
    const errors = watchErrors(page);
    const response = await page.request.post("/__test_translation_review__?assignment=target&source_update=true");
    expect(response.ok()).toBeTruthy();
    const s = await response.json() as { users: { reviewer: string }; assignment_id: number };
    await loginThroughForm(page, s.users.reviewer);
    await page.goto(`/#/tasks/${s.assignment_id}`);
    await expect(target(page)).toBeVisible();
    const updates = page.getByRole("region", { name: "Source updates to review", exact: true });
    await expect(updates.getByRole("button", { name: /^Review source update to / })).toBeVisible();
    await page.getByRole("radio", { name: "Accepted unchanged", exact: true }).check();
    await expect(page.locator(".translation-save-status")).toHaveText("Saved");
    // The ordinary submit names the open source update and leads to it; it is no longer the focused default.
    await page.getByRole("button", { name: "Submit review…", exact: true }).click();
    const confirm = page.getByRole("dialog", { name: "Submit this review?", exact: true });
    const warning = confirm.getByRole("alert");
    await expect(warning).toContainText("1 source update is not reviewed.");
    await expect(warning).toContainText("leaves the update open");
    await expect(confirm.getByRole("button", { name: "Submit without the source update", exact: true })).not.toBeFocused();
    await noPageScroll(page);
    await shot(page, `f3-submit-dialog-${name}`);
    await warning.getByRole("button", { name: "Review source update", exact: true }).click();
    await expect(confirm).toHaveCount(0);
    const dialog = page.getByRole("dialog", { name: "Review source update", exact: true });
    await expect(dialog).toBeVisible();
    // The updated source marks what the update added with the review's word diff.
    const updated = dialog.getByRole("region", { name: "Updated source", exact: true });
    await expect(updated.locator("ins")).toContainText(["Updated source: additional clinical detail."]);
    await expect(dialog).toContainText("In the updated source, added text is underlined and removed text is struck through.");
    await updated.locator("ins").first().scrollIntoViewIfNeeded();
    await noPageScroll(page);
    await shot(page, `f3-source-update-dialog-${name}`);
    await dialog.getByRole("button", { name: "Submit review and resolve source update", exact: true }).click();
    await expect(dialog).toHaveCount(0);
    // The submit leaves the task (next task or My tasks); then look at the submitted review.
    await page.waitForURL(url => !url.hash.endsWith(`/tasks/${s.assignment_id}`));
    // Resolved with this review: nothing is left that "cannot be resolved" afterwards.
    await page.goto(`/#/tasks/${s.assignment_id}`);
    await expect(page.getByText("Submitted review", { exact: true })).toBeVisible();
    await expect(page.getByText("This submitted review cannot resolve another source update.", { exact: false })).toHaveCount(0);
    expect(errors).toEqual([]);
  });
}

for (const [name, viewport] of sizes) {
  test(`a changed checked sentence stays marked as changed at its place; the equal sentence after it is not checked (${name})`, async ({ page }) => {
    await page.setViewportSize(viewport);
    const errors = watchErrors(page);
    const s = await reviewFlowScenario(page, "REVIEW_FLOW");
    const review = s.assignments["second-translation"];
    await loginScenarioUser(page, s, "ana");
    await page.goto(`/#/tasks/${review}`);
    await expect(target(page)).toBeVisible();
    const marking = page.getByRole("checkbox", { name: "Mark checked sentences", exact: true });
    const translation = page.getByRole("region", { name: "Translation (de)", exact: true });
    const sentence = (index: number) => translation.locator(`[data-sentence="${index}"]`);
    // "Absatz 1. Dosis 5 mg." is one sentence; then the text repeats one sentence many times.
    await marking.check();
    await expect(sentence(1)).toHaveText(/^Die Patientin beschreibt Symptome und die Ärztin prüft jede Angabe\./);
    await expect(sentence(2)).toHaveText(/^Die Patientin beschreibt Symptome und die Ärztin prüft jede Angabe\./);
    await sentence(1).click();
    await expect(sentence(1)).toHaveAttribute("aria-pressed", "true");
    // Change the checked sentence (the first of the equal ones).
    await marking.uncheck();
    const text = await target(page).inputValue();
    await target(page).fill(text.replace("Die Patientin beschreibt Symptome", "Die Patientin beschreibt keine Symptome"));
    await marking.check();
    await expect(sentence(1)).toHaveText(/^Die Patientin beschreibt keine Symptome/);
    await expect(sentence(1)).toHaveClass(/is-stale/);
    await expect(sentence(1)).toContainText("changed since checked");
    await expect(sentence(2)).toHaveAttribute("aria-pressed", "false");
    await expect(sentence(2)).not.toHaveClass(/is-checked|is-stale/);
    await expect(translation.locator(".is-checked")).toHaveCount(0);
    await expect(page.locator(".sentence-count").last()).toContainText("0 of");
    await expect(page.locator(".sentence-count").last()).toContainText("1 changed");
    await sentence(1).scrollIntoViewIfNeeded();
    await noPageScroll(page);
    await shot(page, `f4-changed-sentence-${name}`);
    // Stored that way: the same after a reload.
    await expect(page.locator(".translation-save-status")).toHaveText("Saved");
    await page.waitForTimeout(900);
    await page.reload();
    await expect(sentence(1)).toHaveClass(/is-stale/);
    await expect(sentence(2)).toHaveAttribute("aria-pressed", "false");
    await expect(translation.locator(".is-checked")).toHaveCount(0);
    expect(errors).toEqual([]);
  });
}

test("a version made with Fix typos… is named as that in Translation details and carries no failed check", async ({ page }) => {
  await page.setViewportSize(WIDE);
  const errors = watchErrors(page);
  const s = await reviewFlowScenario(page, "REVIEW_FLOW");
  await loginScenarioUser(page, s, "ana");
  const first = await submitReview(page, s.assignments["failed-translation"], REJECTED);
  await page.context().clearCookies();
  await loginScenarioUser(page, s, "lead");
  const fixed = await call<{ document_id: string; version: number }>(page, `${project(s)}/documents/${encodeURIComponent(first.variant.document_id)}/editorial-correction`, "POST",
    { text: first.text.replace("Dosis 5 mg", "Dosis 5\u00a0mg"), expected_text_sha256: first.variant.text_sha256, reason: "Spacing: non-breaking space before the unit" });
  expect(fixed.version).toBe(2);
  const assigned = await call<{ created: { id: number }[] }>(page, `${project(s)}/assignments`, "POST",
    { rows: [{ document_id: fixed.document_id, username: s.users.ana }], task: "translation_review" });
  await page.context().clearCookies();
  await loginScenarioUser(page, s, "ana");
  await page.goto(`/#/tasks/${assigned.created[0].id}`);
  await expect(target(page)).toBeVisible();
  await expect(checks(page)).toContainText("The automatic checks ran on v1, not on this version (v2).");
  await page.getByText("Translation details", { exact: true }).click();
  const details = page.locator(".translation-details dl");
  await expect(details).toContainText("This versionTypos fixed by the project lead on");
  await expect(details).toContainText("What was fixedSpacing: non-breaking space before the unit");
  await expect(details).toContainText("Version beforev1");
  await expect(details.getByText("Correction", { exact: true })).toHaveCount(0);
  await shot(page, "f1-fix-typos-details-1440");
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Compare with the previous version (v1)", exact: true }).click();
  await expect(page.locator(".translation-column-subtitle")).toHaveText("Changes from v1 to v2");
  await expect(page.getByRole("region", { name: "Comparison", exact: true }).locator("ins, del").first()).toBeVisible();
  expect(errors).toEqual([]);
});
