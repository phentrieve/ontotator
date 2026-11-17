/**
 * Error paths of the translation review screen (issue 170): a failed request leaves a retry on the screen, and the
 * retry brings the screen to the state it would have had.
 *
 * - "Reload source updates": the list of source updates of a review does not load.
 * - "Retry corrected version metadata": the review is submitted, but the corrected version it created cannot be read.
 *   An ordinary reviewer leaves the screen right after a submit (issue 125), so this is the lead's own correction
 *   of a rejected translation, which stays on the screen.
 *
 * The server never fails here by itself: one request is answered with an error by the test, the next one passes.
 * The empty lead restart of a translation review ("Translation draft kept from before the restart") is in
 * problem-reports-lead.spec.ts.
 */
import { expect, test, type Page } from "@playwright/test";
import { documentsReady, rowAction, textNamePattern } from "./documentsHelpers";
import { loginExisting, loginThroughForm } from "./helpers";
import { leadScenario } from "./leadWorkflowHelpers";

test.setTimeout(120_000);
test.use({ actionTimeout: 15_000 });

const esc = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const unavailable = { status: 503, contentType: "application/json", body: JSON.stringify({ code: "PROJECT_BUSY", message: "The project is busy. Try again." }) };
const translation = (page: Page) => page.getByRole("textbox", { name: "Translation (de)", exact: true });

test("Reload source updates: a failed list of source updates can be loaded again", async ({ page }) => {
  const created = await page.request.post("/__test_translation_review__?assignment=target&unequal=false");
  expect(created.ok(), await created.text()).toBeTruthy();
  const s = await created.json() as { assignment_id: number; users: { reviewer: string }; texts: { target: string } };
  await loginExisting(page, s.users.reviewer);

  // The first request for the source updates fails; later ones reach the server.
  let requests = 0;
  await page.route(url => url.pathname === `/api/v1/translation-reviews/${s.assignment_id}/source-obligations`, async route => {
    requests += 1;
    if (requests === 1) await route.fulfill(unavailable); else await route.continue();
  });
  await page.locator(`a[href="#/tasks/${s.assignment_id}"]`).click();
  await expect(translation(page)).toHaveValue(s.texts.target);
  const updates = page.getByRole("region", { name: "Source updates to review", exact: true });
  await expect(updates.getByRole("alert")).toBeVisible();
  // The review itself stays usable while the list is missing.
  await expect(translation(page)).toBeEditable();

  const reloaded = page.waitForResponse(response => new URL(response.url()).pathname.endsWith("/source-obligations") && response.ok());
  await updates.getByRole("button", { name: "Reload source updates", exact: true }).click();
  expect(await (await reloaded).json()).toEqual([]);
  // This translation has no source update: with the list loaded the section is gone, and so is the error.
  await expect(updates).toHaveCount(0);
  expect(requests).toBe(2);
  await expect(translation(page)).toHaveValue(s.texts.target);
});

test("Retry corrected version metadata: the submitted correction names its new version after the retry", async ({ page }) => {
  const s = await leadScenario(page, "REJECTED_TRANSLATION_FOR_LEAD");
  const caseId = s.cases!.rejected;
  await loginThroughForm(page, s.users.lead, s.display_names.lead, { lastProject: s.project });
  await expect(page).toHaveURL(new RegExp(`#/projects/${esc(s.project)}/documents`));
  await documentsReady(page);

  // Resolve… › Correct the translation… › Open translation review: the lead's own correction of v1.
  await rowAction(page, "Resolve…", caseId, "de").click();
  const area = page.locator(".documents-row-notice-slot");
  await area.getByRole("group", { name: textNamePattern("Resolve rejected translation, ", caseId, "de") }).getByRole("button", { name: "Correct the translation…", exact: true }).click();
  await area.getByRole("group", { name: textNamePattern("Correct the translation, ", caseId, "de") }).getByRole("button", { name: "Open translation review", exact: true }).click();
  await expect(page).toHaveURL(/#\/tasks\/\d+$/);
  await expect(translation(page)).toBeVisible({ timeout: 30_000 });
  await translation(page).fill(`${await translation(page).inputValue()} The second seizure episode is included.`);
  const review = page.getByRole("region", { name: "Translation review", exact: true });
  await expect(review.locator(".translation-save-status")).toHaveText("Saved");

  // From the submit on, reading a version's metadata fails until the test lets it through again.
  let failing = true, refused = 0;
  await page.route(url => /^\/api\/v1\/projects\/[^/]+\/documents\/[^/]+\/variant$/.test(url.pathname), async route => {
    if (!failing || route.request().method() !== "GET") { await route.continue(); return; }
    refused += 1;
    await route.fulfill(unavailable);
  });
  const submitted = page.waitForResponse(response => response.request().method() === "POST" && /\/translation-reviews\/\d+\/submit$/.test(new URL(response.url()).pathname));
  await page.getByRole("button", { name: "Submit review…", exact: true }).click();
  const confirm = page.getByRole("dialog", { name: "Submit this review?", exact: true });
  await confirm.getByRole("button", { name: "Submit review", exact: true }).click();
  const record = await (await submitted).json() as { created_variant_id: string | null };
  expect(record.created_variant_id).toBeTruthy();

  // The review is submitted; only the version number of the corrected text is missing.
  const retry = page.getByRole("button", { name: "Retry corrected version metadata", exact: true });
  await expect(retry).toBeVisible();
  await expect(review.getByText("Review submitted", { exact: true })).toBeVisible();
  await expect(page.getByText(/^A corrected version v\d+ was created\.$/)).toHaveCount(0);
  expect(refused).toBe(1);
  await expect(translation(page)).toHaveAttribute("readonly", "");

  // A retry that fails again keeps the button; one that passes names the version and removes it.
  const again = page.waitForResponse(response => new URL(response.url()).pathname.endsWith(`/documents/${encodeURIComponent(record.created_variant_id!)}/variant`));
  await retry.click();
  expect((await again).status()).toBe(503);
  await expect(retry).toBeVisible();
  failing = false;
  await retry.click();
  await expect(page.getByText("A corrected version v2 was created.", { exact: true })).toBeVisible();
  await expect(retry).toHaveCount(0);
  expect(refused).toBe(2);
});
