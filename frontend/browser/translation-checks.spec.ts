/**
 * Translation checks (issue 484; issue 483, point 5): the check for passages in brackets the translation added, the
 * typography hints in the confirmation of "Submit review…", the flag and filter "Typography hints" on Documents, and
 * a change of spaces only under "Show changes".
 *
 * Every test builds a fresh project (scenario TRANSLATION_CHECKS).
 */
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { expect, test, type Locator, type Page } from "@playwright/test";
import { documentsReady, filterChip, openFilters, rowBox, textRow } from "./documentsHelpers";
import { loginScenarioUser, reviewFlowScenario, type ReviewFlowScenario } from "./reviewFlowHelpers";

test.setTimeout(180_000);
test.use({ actionTimeout: 15_000 });

const WIDE = { width: 1440, height: 900 };
const NARROW = { width: 390, height: 844 };
const sizes = [["1440", WIDE], ["390", NARROW]] as const;
type Scenario = ReviewFlowScenario & { documents: Record<"spaced-v1" | "spaced-v2", string> };

/** Screenshots for human review only (never baselines); SHOTS_DIR overrides the folder. */
const shotsDir = () => process.env.SHOTS_DIR ?? resolve(test.info().config.rootDir, "../../build/translation-checks/evidence");
async function shot(page: Page, name: string) {
  mkdirSync(shotsDir(), { recursive: true });
  await page.screenshot({ path: resolve(shotsDir(), `${name}.png`) });
}
function watchErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on("console", message => { if (message.type() === "error") errors.push(message.text()); });
  page.on("pageerror", error => errors.push(String(error)));
  return errors;
}
const noPageScroll = async (page: Page) =>
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
const target = (page: Page) => page.getByRole("textbox", { name: "Translation (de)", exact: true });
const checks = (page: Page) => page.getByRole("region", { name: "Automatic translation checks", exact: true });

for (const [name, viewport] of sizes) {
  test(`a reviewer sees the passages in brackets the translation added and the typography hints before submitting (${name})`, async ({ page }) => {
    await page.setViewportSize(viewport);
    const errors = watchErrors(page);
    const s = await reviewFlowScenario(page, "TRANSLATION_CHECKS") as Scenario;
    await loginScenarioUser(page, s, "ana");
    await page.goto(`/#/tasks/${s.assignments["added-gloss"]}`);
    await expect(target(page)).toHaveValue(s.texts["added-gloss"]);

    // The checks band: no check of the translation run failed; Ontotator's own check has its line.
    const band = checks(page);
    await expect(band.locator(".translation-checks-brackets")).toHaveText("More passages in brackets than in the source: 3 in the translation, 1 in the source");
    await expect(band).not.toContainText("automatic check failed");
    await band.getByRole("button", { name: "Details", exact: true }).click();
    const block = band.locator("section.translation-check").filter({ has: page.getByRole("heading", { name: "Passages in brackets added in translation", exact: true }) });
    await expect(block.getByRole("listitem")).toHaveText(["“(Ikterus)”", "“(drei Tage)”", "“(ASS)”"]);
    await expect(block).toContainText("If you are not sure, choose Query with the category Addition.");
    await shot(page, `brackets-details-${name}`);
    await band.getByRole("button", { name: "Hide details", exact: true }).click();

    // The reviewer removes the two added names and, by mistake, types a double space and a doubled full stop.
    const edited = "Gelbsucht  seit Montag (drei Tage). Die Patientin nimmt Aspirin..";
    await target(page).fill(edited);
    await expect(page.getByRole("radio", { name: "Accepted with corrections", exact: true })).toBeChecked();
    await expect(page.locator(".translation-save-status")).toHaveText("Saved");

    // Show changes marks the double space: a change of spaces only is visible.
    await page.getByRole("checkbox", { name: "Show changes", exact: true }).check();
    const changes = page.getByRole("region", { name: "Text changes", exact: true });
    await expect(changes.locator("ins").first()).toHaveText("  ", { useInnerText: false });
    expect(await changes.locator("ins").first().evaluate(node => getComputedStyle(node).backgroundColor)).not.toBe("rgba(0, 0, 0, 0)");
    await shot(page, `review-show-changes-${name}`);
    await page.getByRole("checkbox", { name: "Show changes", exact: true }).uncheck();

    // The confirmation names the hints of the text to be saved and shows the places; it blocks nothing.
    await page.getByRole("button", { name: "Submit review…", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "Submit this review?", exact: true });
    await expect(dialog.getByText("2 typography hints in your text: double space, doubled full stop.", { exact: true })).toBeVisible();
    await dialog.getByRole("button", { name: "Show them", exact: true }).click();
    const places = dialog.getByRole("list", { name: "Typography hints", exact: true }).getByRole("listitem");
    await expect(places).toHaveCount(2);
    await expect(places.nth(0)).toContainText("double space");
    await expect(places.nth(1)).toContainText("doubled full stop");
    await expect(places.nth(1).locator("mark")).toHaveText("..");
    await noPageScroll(page);
    await shot(page, `submit-hints-${name}`);

    // Keep editing, fix both, and the line is gone.
    await dialog.getByRole("button", { name: "Keep editing", exact: true }).click();
    await target(page).fill("Gelbsucht seit Montag (drei Tage). Die Patientin nimmt Aspirin.");
    await expect(page.locator(".translation-save-status")).toHaveText("Saved");
    await page.getByRole("button", { name: "Submit review…", exact: true }).click();
    await expect(dialog).toBeVisible();
    await expect(dialog.getByText("Accepted with corrections", { exact: true })).toBeVisible();
    await expect(dialog).not.toContainText("typography");
    await dialog.getByRole("button", { name: "Submit review", exact: true }).click();
    await expect(dialog).toHaveCount(0);
    expect(errors).toEqual([]);
  });

  test(`a lead finds texts with typography hints on Documents and sees a change of spaces in the comparison (${name})`, async ({ page }) => {
    await page.setViewportSize(viewport);
    const errors = watchErrors(page);
    const phone = name === "390";
    const s = await reviewFlowScenario(page, "TRANSLATION_CHECKS") as Scenario;
    await loginScenarioUser(page, s, "lead");
    await page.goto(`/#/projects/${encodeURIComponent(s.project)}/documents`);
    await documentsReady(page);
    const rowOf = (caseId: string, language: string): Locator => phone
      ? page.locator("article.document-card").filter({ has: rowBox(page, caseId, language) }) : textRow(page, caseId, language);

    // The flag: only the text whose newest version has hints carries it.
    const flag = rowOf("spaced", "de").locator(".documents-typography-hints");
    await expect(flag).toHaveText("Typography hints");
    await expect(flag).toHaveAttribute("title", "2 typography hints in the newest version: spacing errors or invisible characters");
    await expect(rowOf("added-gloss", "de").locator(".documents-typography-hints")).toHaveCount(0);
    await expect(rowOf("spaced", "en").locator(".documents-typography-hints")).toHaveCount(0);
    await noPageScroll(page);
    await shot(page, `documents-flag-${name}`);

    // The filter lists it.
    const filters = await openFilters(page);
    await filters.getByRole("checkbox", { name: /^Typography hints, 1 text$/ }).check();
    await shot(page, `documents-filter-${name}`);
    if (phone) await filters.getByRole("button", { name: "Show 1 text" }).click();
    else await page.keyboard.press("Escape");
    await expect(filterChip(page, "Typography hints")).toBeVisible();
    await expect(rowOf("spaced", "de")).toBeVisible();
    await expect(rowBox(page, "added-gloss", "de")).toHaveCount(0);

    // The text view: v1 against v2 with Show changes marks the double space on both sides.
    const query = new URLSearchParams({ variant: s.documents["spaced-v1"], annotations: "text" });
    await page.goto(`/#/projects/${encodeURIComponent(s.project)}/cases/spaced?${query}`);
    await page.getByRole("button", { name: "Compare", exact: true }).click();
    const comparison = page.getByRole("region", { name: "Comparison", exact: true });
    await comparison.getByLabel("Language and version", { exact: true }).selectOption(s.documents["spaced-v2"]);
    const controls = page.getByRole("toolbar", { name: "Comparison controls", exact: true });
    await controls.getByLabel("Show changes", { exact: true }).check();
    const marked = (surface: Locator) => surface.locator(".run--marker").evaluateAll(runs => runs.map(run => run.textContent ?? ""));
    const right = comparison.locator(".text-container");
    await expect.poll(() => marked(right)).toContain("  ");
    const left = page.locator(".comparison-reading > .readonly-annotation-view .text-container");
    await expect.poll(() => marked(left)).toContain(" ");
    await expect(page.locator(".comparison-global-controls")).toContainText(/\d+ passages? added, \d+ passages? removed\./);
    await shot(page, `compare-spaces-${name}`);
    expect(errors).toEqual([]);
  });
}
