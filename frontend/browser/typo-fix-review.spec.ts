/**
 * Review 2 (project lead), F1, F5 and the typo half of F6: after "Fix typos…" on a queried translation a new
 * review is a review of the fix.
 * - "Resolve…" › "Assign a new review…" announces v2 and assigns v2; the reviewer reads the fixed text and
 *   "Typos fixed by the project lead" in Translation details; after the review the row goes on.
 * - History has one line for the fix: who, date and time, what was fixed.
 * - The phone row of an accepted text credits the fix to the lead, not to the reviewer of v1.
 * Driven through the real endpoints at 1440 px and at 390 px; no console errors, no horizontal page scroll.
 */
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { activityLines, documentsReady, documentsTab, openTextCard, rowAction, textCard, textNamePattern, textRow, textVersionItems } from "./documentsHelpers";
import { loginThroughForm } from "./helpers";
import { leadScenario, type LeadPerson, type LeadScenario } from "./leadWorkflowHelpers";

test.setTimeout(240_000);
test.use({ actionTimeout: 15_000 });

const sizes = [["1440", { width: 1440, height: 900 }], ["390", { width: 390, height: 844 }]] as const;
const TIME = String.raw`\d{1,2} [A-Z][a-z]{2}(?: \d{4})?, \d{2}:\d{2}`;
const esc = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Screenshots for human review only (never baselines); ONTOTATOR_SHOTS_DIR overrides the folder. */
async function shot(page: Page, name: string) {
  const dir = process.env.ONTOTATOR_SHOTS_DIR ?? resolve(test.info().config.rootDir, "../../build/typo-fix-review/evidence");
  mkdirSync(dir, { recursive: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth), `${name}: no horizontal scroll`).toBe(true);
  await page.screenshot({ path: resolve(dir, `${name}.png`) });
}

function consoleErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on("console", message => { if (message.type() === "error") errors.push(message.text()); });
  page.on("pageerror", error => errors.push(error.message));
  return errors;
}

async function login(page: Page, s: LeadScenario, who: LeadPerson) {
  // Leave the page first: a request it still sends without the cookies would end in a 401 in the console.
  await page.goto("about:blank");
  await page.context().clearCookies();
  if (who !== "lead") return loginThroughForm(page, s.users[who], s.display_names[who]);
  await loginThroughForm(page, s.users.lead, s.display_names.lead, { lastProject: s.project });
  await expect(page).toHaveURL(new RegExp(`#/projects/${esc(s.project)}/documents`));
  await documentsReady(page);
}

/** The card of a text: from its name in the table, from "Details" in the phone's cards. */
async function openCard(page: Page, caseId: string) {
  const card = textCard(page, caseId, "de");
  if ((page.viewportSize()?.width ?? 1440) >= 700 || await card.isVisible()) return openTextCard(page, caseId, "de");
  await page.getByRole("button", { name: new RegExp(`^Details, ${esc(caseId)}\\s*de`) }).click();
  await expect(card).toBeVisible();
  return card;
}

/** The Documents row of a text: a table row, a card on the phone. */
const documentRow = (page: Page, caseId: string) => ((page.viewportSize()?.width ?? 1440) >= 700 ? textRow(page, caseId, "de")
  : page.locator("article.document-card").filter({ has: page.getByRole("button", { name: new RegExp(`^Details, ${esc(caseId)}\\s*de`) }) }));

/** The lead: "Fix typos…" on the newest version in the card; the fixed word is the proof the reviewer reads. */
async function fixTypos(page: Page, caseId: string, reviewNote: string) {
  const card = await openCard(page, caseId);
  const [v1] = await (await textVersionItems(card, 1)).all();
  await v1.getByRole("button", { name: `Fix typos in v1 of ${caseId} de…`, exact: true }).click();
  const dialog = page.getByRole("dialog", { name: `Fix typos, ${caseId} de v1`, exact: true });
  const editor = dialog.getByRole("textbox", { name: "Corrected text", exact: true });
  await editor.fill((await editor.inputValue()).replace("hypotonia", "Hypotonie"));
  // Issue 547, U2-06: the submitted review is not "nobody worked on it"; it stays with v1, and v2 gets its own.
  await expect(dialog.getByText("Nobody has worked on v1 yet.", { exact: true })).toHaveCount(0);
  await expect(dialog.getByText(reviewNote, { exact: true })).toBeVisible();
  await shot(page, `u2-06-fix-typos-${page.viewportSize()!.width}`);
  await dialog.getByRole("button", { name: "Typo", exact: true }).click();
  await dialog.getByRole("button", { name: "Save as v2", exact: true }).click();
  await expect(dialog).toHaveCount(0);
}

for (const [name, viewport] of sizes) {
  test(`${name} px: a new review after Fix typos… on a queried translation is a review of v2, and the row goes on`, async ({ page }) => {
    await page.setViewportSize(viewport);
    const errors = consoleErrors(page);
    const s = await leadScenario(page, "REJECTED_TRANSLATION_FOR_LEAD");
    const caseId = s.cases!.queried;
    await login(page, s, "lead");
    await fixTypos(page, caseId, "A submitted translation review stays with the version it reviewed. To have v2 reviewed, use Resolve… › Assign a new review… on this row after saving.");
    await expect(page.locator(".ui-toast .ui-toast-message")).toHaveText(`Typos fixed: v2 of ${caseId} de saved. It stays Queried.`);
    await textCard(page, caseId, "de").getByRole("button", { name: "Close", exact: true }).click();

    // Resolve…: the reviewer's question is still shown; her review of v1 is not reopened, the fix is reviewed.
    await rowAction(page, "Resolve…", caseId, "de").click();
    const options = page.getByRole("group", { name: textNamePattern("Resolve queried translation, ", caseId, "de") });
    await expect(options).toContainText("Ana Weber asked a question about this translation.");
    await expect(options.getByRole("button")).toHaveText(["Accept the reviewer’s text…", "Answer and accept the version as it is…", "Assign a new review…", "Correct the translation…", "Discard the de translation…", "Cancel"]);
    await shot(page, `f1-resolve-${name}`);
    await options.getByRole("button", { name: "Assign a new review…", exact: true }).click();
    const assign = page.getByRole("dialog", { name: "Assign translation review", exact: true });
    await expect(assign.locator(".assign-context strong").first()).toHaveText(new RegExp(`^${esc(caseId)}\\s*de\\s*v2$`));
    // Issue 547, U2-07: Ana's review of v1 is named as such, not as an assignment of v2; "assigned" once.
    await expect(assign.locator(".assign-muted", { hasText: /^Nobody assigned yet/ })).toHaveText(new RegExp(`^Nobody assigned yet · Earlier: Ana Weber \\(${esc(s.pseudonyms.ana)}\\) reviewed v1$`));
    await assign.getByRole("radio", { name: /^Ben Roth/ }).check();
    await shot(page, `f1-assign-dialog-${name}`);
    await assign.getByRole("button", { name: /^Assign/ }).last().click();
    await expect(assign).toHaveCount(0);

    // The card: Ben reviews v2; History has the line of the fix.
    const card = await openCard(page, caseId);
    const reviewers = card.getByRole("list", { name: "Translation reviewers", exact: true });
    await expect(reviewers.getByRole("listitem").filter({ hasText: "Ben Roth" })).toContainText("Review of v2");
    await shot(page, `f1-card-review-of-v2-${name}`);
    await card.getByRole("button", { name: /^History \(\d+\)$/ }).click();
    await expect(activityLines(card).filter({ hasText: "typos fixed" })).toHaveText(
      new RegExp(`typos fixed in v2 by you, ${TIME}: Typo$`));
    await shot(page, `f6-history-${name}`);
    await card.getByRole("button", { name: "Close", exact: true }).click();

    // Ben reads the fixed text, sees how v2 was made, and accepts it.
    await login(page, s, "ben");
    await page.getByTestId("task-row").filter({ hasText: caseId }).getByRole("link").first().click();
    const text = page.getByRole("textbox", { name: "Translation (de)", exact: true });
    await expect(text).toHaveValue(/generalized Hypotonie\./);
    await page.getByText("Translation details", { exact: true }).click();
    const details = page.locator(".translation-details dl");
    await expect(details).toContainText("This versionTypos fixed by the project lead on");
    await expect(details).toContainText("What was fixedTypo");
    await expect(details).toContainText("Version beforev1");
    await shot(page, `f1-reviewer-details-${name}`);
    await page.keyboard.press("Escape");
    await page.getByRole("radio", { name: "Accepted unchanged", exact: true }).check();
    await expect(page.locator(".translation-save-status")).toHaveText("Saved");
    await page.getByRole("button", { name: "Submit review…", exact: true }).click();
    await page.getByRole("dialog", { name: "Submit this review?", exact: true }).getByRole("button", { name: /^Submit/ }).click();
    await expect(page.getByRole("status").filter({ hasText: `${caseId} de v2 corrected submitted.` })).toBeVisible();

    // The row has its next step: the annotation of the accepted v2 is assigned.
    await login(page, s, "lead");
    await documentsTab(page, "To assign").click();
    const row = documentRow(page, caseId);
    await expect(row).toContainText(/accepted/i);
    await expect(rowAction(page, "Assign annotation…", caseId, "de")).toBeVisible();
    await expect(rowAction(page, "Resolve…", caseId, "de")).toHaveCount(0);
    await shot(page, `f1-row-after-review-${name}`);
    const after = await openCard(page, caseId);
    const items = await textVersionItems(after, 2);
    await expect(items.filter({ hasText: "Correction of v1" })).toContainText("Accepted");
    await shot(page, `f1-card-after-review-${name}`);
    expect(errors).toEqual([]);
  });

  test(`${name} px: the row of an accepted text says the lead fixed typos, not the reviewer of v1`, async ({ page }) => {
    await page.setViewportSize(viewport);
    const errors = consoleErrors(page);
    const s = await leadScenario(page, "ACCEPTED_TRANSLATION_FOR_LEAD");
    const caseId = s.cases!.accepted;
    await login(page, s, "lead");
    await fixTypos(page, caseId, "A submitted translation review stays with the version it reviewed.");
    await textCard(page, caseId, "de").getByRole("button", { name: "Close", exact: true }).click();
    const row = documentRow(page, caseId);
    if (name === "390") {
      await expect(row).toContainText("typos fixed by you, v1 → v2");
      await expect(row).not.toContainText("with corrections");
      await expect(row).not.toContainText("Ana Weber");
    } else await expect(row).toContainText("v2 corrected");
    await shot(page, `f5-row-${name}`);
    expect(errors).toEqual([]);
  });
}
