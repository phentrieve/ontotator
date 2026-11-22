/**
 * Issue 591 (acceptance of #571, docs/design.md › Panels and actions), in the real app:
 * 1. A query without a proposed change: the Resolve dialog opens with focus on its one decision, not on <body>.
 * 2. "Show the proposed text" opens at the first change, also when it sits below the visible part.
 * 3. The steps and dialogs behind the new choices: the correction step repeats its label (rule 2); a greyed
 *    primary names its reason as accessible description and tooltip (rule 4); the decision, typo-fix and
 *    correction dialogs open with focus on their primary action (rule 6).
 * At 1440×900 (deviceScaleFactor 2) in light and dark, and the proposed text also at 1280×720.
 */
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { expect, test, type Locator, type Page } from "@playwright/test";
import { documentsReady, openTextCard, rowAction, textNamePattern, textVersionItems } from "./documentsHelpers";
import { loginThroughForm } from "./helpers";
import { leadScenario, type LeadScenario } from "./leadWorkflowHelpers";

test.setTimeout(180_000);
test.use({ actionTimeout: 15_000, deviceScaleFactor: 2 });

const WIDE = { width: 1440, height: 900 };
const LAPTOP = { width: 1280, height: 720 };
const esc = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Screenshots for the review only (never baselines); ONTOTATOR_SHOTS_DIR overrides the folder. */
async function shot(page: Page, name: string) {
  const dir = process.env.ONTOTATOR_SHOTS_DIR ?? resolve(test.info().config.rootDir, "../../build/resolve-followups/evidence");
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
    return change.top >= box.top && change.bottom <= box.bottom;
  });
}

for (const scheme of ["light", "dark"] as const) {
  test(`1440 px ${scheme}: a query without a proposed change opens with focus on Accept v2 as it is… (defect 1)`, async ({ page }) => {
    await page.setViewportSize(WIDE);
    await page.emulateMedia({ colorScheme: scheme });
    const errors = consoleErrors(page);
    const s = await leadScenario(page, "QUERIED_CORRECTION_FOR_LEAD");
    const caseId = s.cases!.take_text;
    await loginLead(page, s);
    const resolveButton = rowAction(page, "Resolve…", caseId, "de");
    // By keyboard, as in the acceptance: Enter on Resolve….
    await resolveButton.focus();
    await page.keyboard.press("Enter");
    const dialog = page.getByRole("dialog", { name: textNamePattern("Resolve queried translation, ", caseId, "de") });
    await expect(dialog).toContainText("Ben Roth proposed no change to the text.");
    const decide = dialog.getByRole("button", { name: "Accept v2 as it is…", exact: true });
    await expect(decide).toBeFocused();
    expect(await page.evaluate(() => document.activeElement?.tagName)).toBe("BUTTON");
    await shot(page, `resolve-nochange-${scheme}-1440`);

    // Rule 6 and 4: the decision dialog opens on Accept v2; greyed, it names why.
    await page.keyboard.press("Enter");
    const decision = page.getByRole("dialog", { name: `Accept v2 as it is, ${caseId} de`, exact: true });
    await expect(decision).toContainText("v2 is accepted without changes.");
    const accept = decision.getByRole("button", { name: "Accept v2", exact: true });
    await expect(accept).toBeFocused();
    await expect(accept).toHaveAttribute("aria-disabled", "true");
    await expect(accept).toHaveAccessibleDescription("Enter the answer to the reviewer.");
    await expect(accept).toHaveAttribute("title", "Enter the answer to the reviewer.");
    await shot(page, `query-decision-unchanged-${scheme}-1440`);
    await page.keyboard.press("Escape");
    await expect(decision).toHaveCount(0);
    await expect(decide).toBeFocused();
    expect(errors).toEqual([]);
  });
}

for (const [name, viewport] of [["1440", WIDE], ["1280", LAPTOP]] as const) {
  test(`${name} px: Show the proposed text opens at the change (defect 2)`, async ({ page }) => {
    await page.setViewportSize(viewport);
    const errors = consoleErrors(page);
    const s = await leadScenario(page, "QUERIED_LONG_TRANSLATION_FOR_LEAD");
    const caseId = s.cases!.take_text;
    await loginLead(page, s);
    await rowAction(page, "Resolve…", caseId, "de").click();
    const dialog = page.getByRole("dialog", { name: textNamePattern("Resolve queried translation, ", caseId, "de") });
    await expect(dialog.getByRole("button", { name: "Accept the reviewer’s text as v2…", exact: true })).toBeFocused();
    await dialog.getByText("Show the proposed text (1 passage changed)", { exact: true }).click();
    const region = dialog.getByRole("region", { name: "Ana Weber’s proposed text, changes to v1", exact: true });
    await expect(region.locator("ins")).toHaveText(/muscular/);
    // The text is longer than the view; the view opens scrolled to the change, with text above it as context.
    expect(await region.evaluate(view => view.scrollHeight > view.clientHeight)).toBe(true);
    await expect.poll(() => changeInView(region)).toBe(true);
    expect(await region.evaluate(view => view.scrollTop)).toBeGreaterThan(0);
    await shot(page, `resolve-proposed-at-change-${name}`);

    // Rule 6: the decision dialog opens on its primary action.
    await dialog.getByRole("button", { name: "Accept the reviewer’s text as v2…", exact: true }).click();
    const decision = page.getByRole("dialog", { name: `Accept the reviewer’s text as v2, ${caseId} de v1`, exact: true });
    await expect(decision.getByRole("textbox", { name: "Reviewer’s text" })).toBeVisible();
    await expect(decision.getByRole("button", { name: "Accept as v2", exact: true })).toBeFocused();
    expect(errors).toEqual([]);
  });
}

test("1440 px: the correction step repeats its label; a greyed Discard has its reason as tooltip (defect 3, rules 2 and 4)", async ({ page }) => {
  await page.setViewportSize(WIDE);
  const errors = consoleErrors(page);
  const s = await leadScenario(page, "REJECTED_TRANSLATION_FOR_LEAD");
  const caseId = s.cases!.rejected;
  await loginLead(page, s);
  await rowAction(page, "Resolve…", caseId, "de").click();
  const dialog = page.getByRole("dialog", { name: textNamePattern("Resolve rejected translation, ", caseId, "de") });
  await dialog.getByRole("button", { name: "Correct it myself (counts as accepted)…", exact: true }).click();
  await expect(dialog.getByRole("heading", { name: textNamePattern("Correct it myself (counts as accepted), ", caseId, "de") })).toBeVisible();
  await shot(page, "step-correct-1440");
  await dialog.getByRole("button", { name: "Cancel", exact: true }).click();

  await dialog.getByRole("button", { name: textNamePattern("Other ways to resolve ", caseId, "de") }).click();
  await page.getByRole("menuitem", { name: "Discard the de translation…", exact: true }).click();
  const discard = dialog.getByRole("button", { name: "Discard", exact: true });
  await expect(discard).toHaveAttribute("aria-disabled", "true");
  await expect(discard).toHaveAccessibleDescription("Enter a reason.");
  await expect(discard).toHaveAttribute("title", "Enter a reason.");
  expect(errors).toEqual([]);
});

for (const scheme of ["light", "dark"] as const) {
  test(`1440 px ${scheme}: Edit the translation… opens Fix typos and the correction with focus on their primary action (defect 3, rules 4 and 6)`, async ({ page }) => {
    await page.setViewportSize(WIDE);
    await page.emulateMedia({ colorScheme: scheme });
    const errors = consoleErrors(page);
    const s = await leadScenario(page, "ACCEPTED_TRANSLATION_FOR_LEAD");
    const caseId = s.cases!.accepted;
    await loginLead(page, s);
    const card = await openTextCard(page, caseId, "de");
    const [v1] = await (await textVersionItems(card, 1)).all();
    const edit = v1.getByRole("button", { name: `Edit the translation v1 of ${caseId} de…`, exact: true });
    const choice = page.getByRole("dialog", { name: `Edit the translation, ${caseId} de v1`, exact: true });

    await edit.click();
    await choice.getByRole("radio", { name: "Only spelling, spacing or grammar", exact: true }).check();
    await choice.getByRole("button", { name: "Continue", exact: true }).click();
    // Issue 556: the title and the button name the consequence; the greyed Save's reason is a ReasonButton tip.
    const fix = page.getByRole("dialog", { name: `Fix typos (no review), ${caseId} de v1`, exact: true });
    await expect(fix.getByRole("textbox", { name: "Corrected text", exact: true })).toBeVisible();
    const save = fix.getByRole("button", { name: "Save as v2 (stays Accepted)", exact: true });
    await expect(save).toBeFocused();
    await expect(save).toHaveAttribute("aria-disabled", "true");
    await expect(save).toHaveAccessibleDescription("Change the text first.");
    // Before any press, the reason shows as a tooltip on focus and on hover.
    const tip = fix.locator(".ui-reason-tip", { hasText: "Change the text first." });
    await expect(tip).toBeVisible();
    await fix.getByRole("textbox", { name: "Corrected text", exact: true }).focus();
    await expect(tip).toBeHidden();
    await save.hover();
    await expect(tip).toBeVisible();
    await save.focus();
    await shot(page, `fix-typos-${scheme}-1440`);
    await page.keyboard.press("Escape");
    await expect(fix).toHaveCount(0);
    await expect(edit).toBeFocused();

    await edit.click();
    await choice.getByRole("radio", { name: "The meaning changes", exact: true }).check();
    await choice.getByRole("button", { name: "Continue", exact: true }).click();
    const correct = page.getByRole("dialog", { name: `Correct it myself, ${caseId} de v1, accepted`, exact: true });
    await expect(correct).toContainText("The corrected text becomes v2.");
    await expect(correct.getByRole("button", { name: "Open translation review", exact: true })).toBeFocused();
    await shot(page, `correct-accepted-${scheme}-1440`);
    await page.keyboard.press("Escape");
    await expect(correct).toHaveCount(0);
    await expect(edit).toBeFocused();
    expect(errors).toEqual([]);
  });
}
