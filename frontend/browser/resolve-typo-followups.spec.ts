/**
 * Issue 613 (acceptance 0.12.1, case study 1): Resolve and Fix typos follow-ups in the real app.
 * 1. Fix typos after a decided query does not point to a Resolve… the row no longer has.
 * 2. Focus after Fix typos saves stays in the card; after Ask the reviewer it is on Close.
 * 3. "Changes to v1" in Accept the reviewer's text as v2… opens at the change (1280 × 720).
 * 4. Correct it myself… without a qualification says so up front; Open is unavailable.
 * 5. Ask a reviewer to correct…: focus on the reviewer, the primary in the footer with what is missing.
 * 6. The Annotation state of a text with a rejected translation reads alike in the table, the card and on a phone.
 * 7. One selected text: More actions offers Pause text… (singular).
 * Screenshots for human review only (never baselines): ONTOTATOR_SHOTS_DIR, else build/resolve-typo-followups.
 */
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { expect, test, type Locator, type Page } from "@playwright/test";
import { documentsReady, editTranslation, openTextCard, otherVersionAction, rowAction, rowBox, rowCell, showSegment, textNamePattern, textRow, textVersionItems } from "./documentsHelpers";
import { authenticatedRequest, loginThroughForm } from "./helpers";
import { leadScenario, type LeadScenario } from "./leadWorkflowHelpers";

test.setTimeout(180_000);
test.use({ actionTimeout: 15_000 });

const WIDE = { width: 1440, height: 900 };
const LAPTOP = { width: 1280, height: 720 };
const esc = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

async function shot(page: Page, name: string) {
  const dir = process.env.ONTOTATOR_SHOTS_DIR ?? resolve(test.info().config.rootDir, "../../build/resolve-typo-followups");
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

/** True when the first change of `region` lies inside its visible part. */
async function changeInView(region: Locator): Promise<boolean> {
  return region.evaluate(view => {
    const mark = view.querySelector('[data-diff-op="insert"],[data-diff-op="delete"]');
    if (!mark) return false;
    const box = view.getBoundingClientRect(), change = mark.getBoundingClientRect();
    return change.top >= box.top && change.bottom <= box.bottom && change.bottom <= window.innerHeight;
  });
}

/** Fix typos on the given version: changes one character and saves. */
async function fixTypo(page: Page, item: Locator, caseId: string, version: number) {
  await editTranslation(page, item, caseId, "typos", version);
  const fix = page.getByRole("dialog", { name: `Fix typos (no review), ${caseId} de v${version}`, exact: true });
  const text = fix.getByRole("textbox", { name: "Corrected text", exact: true });
  await text.fill(`${await text.inputValue()} `);
  await fix.getByLabel("Note", { exact: true }).fill("Space at the end");
  return fix;
}

test("1440 px: Fix typos keeps the focus in the card; Ask a reviewer to correct… opens at the reviewer and ends on Close; one text pauses in the singular", async ({ page }) => {
  await page.setViewportSize(WIDE);
  const errors = consoleErrors(page);
  const s = await leadScenario(page, "ACCEPTED_TRANSLATION_FOR_LEAD");
  const caseId = s.cases!.accepted;
  await loginLead(page, s);

  // 2: after Save as v2 the focus is in the card, not on <body>.
  const card = await openTextCard(page, caseId, "de");
  const [v1] = await (await textVersionItems(card, 1)).all();
  const fix = await fixTypo(page, v1, caseId, 1);
  await fix.getByRole("button", { name: "Save as v2 (stays Accepted)", exact: true }).click();
  await expect(fix).toHaveCount(0);
  await expect(page.locator(".ui-toast")).toContainText("Typos fixed: v2");
  await expect.poll(() => page.evaluate(() => {
    const active = document.activeElement;
    return !!active && active !== document.body && !!active.closest(".ui-dialog.text-card");
  })).toBe(true);
  await shot(page, "1-focus-after-fix-typos-1440");

  // 5: Ask a reviewer to correct… from the card.
  await showSegment(card, "Translation");
  const [v2] = await (await textVersionItems(card, 2)).all();
  await otherVersionAction(page, v2, `v2 of ${caseId} de`, "Ask a reviewer to correct…");
  const ask = page.getByRole("dialog", { name: /^Ask a reviewer to correct, / });
  const reviewer = ask.getByLabel("Translation reviewer", { exact: true });
  await expect(reviewer).toBeFocused();
  const footer = ask.locator(".modal-actions");
  const primary = footer.getByRole("button", { name: "Ask the reviewer", exact: true });
  await expect(primary).toHaveClass(/btn-primary/);
  await expect(primary).toHaveAttribute("aria-disabled", "true");
  await expect(primary).toHaveAccessibleDescription("Choose a reviewer and enter a reason.");
  await shot(page, "2-ask-reviewer-1440");
  await reviewer.selectOption({ index: 1 });
  await ask.getByLabel("Reason for another review", { exact: true }).fill("Check the dose again");
  await expect(primary).not.toHaveAttribute("aria-disabled", "true");
  await primary.click();
  await expect(ask).toContainText("was asked to correct the translation.");
  await expect(footer.getByRole("button", { name: "Close", exact: true })).toBeFocused();
  await footer.getByRole("button", { name: "Close", exact: true }).click();
  await expect(ask).toHaveCount(0);
  await page.keyboard.press("Escape");
  await expect(card).toHaveCount(0);

  // 7: one selected text, the menu entries in the singular.
  await rowBox(page, caseId, "de").check();
  await page.getByRole("button", { name: "More actions" }).click();
  const menu = page.getByRole("menu", { name: "More actions" });
  await expect(menu.getByRole("menuitem", { name: "Pause text…", exact: true })).toBeVisible();
  await expect(menu.getByRole("menuitem", { name: /^Release text…/ })).toBeVisible();
  await expect(menu.getByRole("menuitem", { name: /^Pause texts…/ })).toHaveCount(0);
  expect(errors).toEqual([]);
});

test("1280 px: Changes to v1 in Accept the reviewer's text as v2… opens at the change", async ({ page }) => {
  await page.setViewportSize(LAPTOP);
  const errors = consoleErrors(page);
  const s = await leadScenario(page, "QUERIED_LONG_TRANSLATION_FOR_LEAD");
  const caseId = s.cases!.take_text;
  await loginLead(page, s);
  await rowAction(page, "Resolve…", caseId, "de").click();
  const options = page.getByRole("dialog", { name: textNamePattern("Resolve queried translation, ", caseId, "de") });
  await options.getByRole("button", { name: "Accept the reviewer’s text as v2…", exact: true }).click();
  const decision = page.getByRole("dialog", { name: `Accept the reviewer’s text as v2, ${caseId} de v1`, exact: true });
  const changes = decision.getByRole("region", { name: "Text changes", exact: true });
  await expect(changes.locator("ins")).toHaveText(/muscular/);
  expect(await changes.evaluate(view => view.scrollHeight > view.clientHeight)).toBe(true);
  await expect.poll(() => changeInView(changes)).toBe(true);
  expect(await changes.evaluate(view => view.scrollTop)).toBeGreaterThan(0);
  await expect(decision.getByRole("button", { name: "Accept as v2", exact: true })).toBeFocused();
  await shot(page, "3-changes-at-change-1280");
  expect(errors).toEqual([]);
});

test("1440 px: Fix typos after a decided query names no Resolve…", async ({ page }) => {
  await page.setViewportSize(WIDE);
  const errors = consoleErrors(page);
  const s = await leadScenario(page, "QUERIED_TRANSLATION_FOR_LEAD");
  const caseId = s.cases!.answer_only;
  await loginLead(page, s);
  await rowAction(page, "Resolve…", caseId, "de").click();
  const options = page.getByRole("dialog", { name: textNamePattern("Resolve queried translation, ", caseId, "de") });
  await options.getByRole("button", { name: "Accept v1 as it is…", exact: true }).click();
  const accept = page.getByRole("dialog", { name: `Accept v1 as it is, ${caseId} de`, exact: true });
  await accept.getByRole("textbox", { name: /^Answer to the reviewer/ }).fill("The short form is meant.");
  await accept.getByRole("button", { name: "Accept v1", exact: true }).click();
  await expect(accept).toHaveCount(0);
  const card = await openTextCard(page, caseId, "de");
  await showSegment(card, "Translation");
  const [v1] = await (await textVersionItems(card, 1)).all();
  const fix = await fixTypo(page, v1, caseId, 1);
  await expect(fix).toContainText("A submitted translation review stays with the version it reviewed.");
  await expect(fix).not.toContainText("Resolve…");
  await shot(page, "4-fix-typos-after-decided-query-1440");
  expect(errors).toEqual([]);
});

test("1440 and 390 px: Correct it myself… without a qualification says so up front; the rejected text's annotation reads alike everywhere", async ({ page }) => {
  await page.setViewportSize(WIDE);
  const errors = consoleErrors(page);
  const s = await leadScenario(page, "REJECTED_TRANSLATION_FOR_LEAD");
  const caseId = s.cases!.rejected;
  await loginLead(page, s);
  const cleared = await authenticatedRequest(page, "/api/v1/me/profile", "PATCH", { qualification: null });
  expect(cleared.ok(), await cleared.text()).toBeTruthy();

  // 6: the table names why annotation waits, as the card does.
  await expect(rowCell(textRow(page, caseId, "de"), "annotation")).toContainText("blocked");
  const card = await openTextCard(page, caseId, "de");
  await expect(card).toContainText("blocked, translation rejected");
  await page.keyboard.press("Escape");
  await expect(card).toHaveCount(0);

  // 4: the reason and the profile link before any press.
  await rowAction(page, "Resolve…", caseId, "de").click();
  const dialog = page.getByRole("dialog", { name: textNamePattern("Resolve rejected translation, ", caseId, "de") });
  await dialog.getByRole("button", { name: "Correct it myself (counts as accepted)…", exact: true }).click();
  const open = dialog.getByRole("button", { name: "Open translation review", exact: true });
  await expect(dialog).toContainText("A translation review records your qualification. Your profile has none yet.");
  await expect(dialog.getByRole("link", { name: "Add your qualification in your profile" })).toBeVisible();
  await expect(open).toHaveAttribute("aria-disabled", "true");
  await expect(open).toHaveAccessibleDescription("A translation review records your qualification. Your profile has none yet.");
  await shot(page, "5-correct-myself-no-qualification-1440");
  await page.keyboard.press("Escape");

  await page.setViewportSize({ width: 390, height: 844 });
  await documentsReady(page);
  await expect(page.getByRole("article", { name: textNamePattern("", caseId, "de") })).toContainText(/Annotation: .*blocked.*translation rejected/);
  await shot(page, "6-documents-phone-390");
  expect(errors).toEqual([]);
});
