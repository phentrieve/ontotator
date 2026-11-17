/**
 * Review 2 of the lead pause and the annotator limit, at 1440 and 390 px:
 * - F2: a text whose consolidation is open keeps it in the Documents row, the text card and History once the lead
 *   pauses the text ("consolidating · paused", the consolidator's row with "Paused by lead", no second "Consolidate…").
 * With SHOTS_DIR set, the states are also saved as screenshots.
 *
 * Builds fresh projects through ``POST /__test_documents__`` (scenario S464).
 */
import { expect, test, type Browser, type Locator, type Page } from "@playwright/test";
import { activityLines, cellUnder, documentsReady, documentsScenario, openTextCard, personRow, rowBox, showSegment, STAGE_HEADERS, textCard, textRow, type DocumentsScenario } from "./documentsHelpers";
import { loginExisting } from "./helpers";

test.setTimeout(300_000);
test.use({ actionTimeout: 15_000 });

const shots = process.env.SHOTS_DIR;
async function shot(page: Page, name: string): Promise<void> {
  if (shots) await page.screenshot({ path: `${shots}/${name}.png` });
}
const noHorizontalScroll = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
const WHY = "The clinic is checking the source text";

type Scenario = DocumentsScenario & { assignments: Record<string, number>; report_id: string };

/** Collects console and page errors; `expected` names the one refusal a test provokes (the browser logs a refused request). */
function watch(page: Page, errors: string[], expected?: RegExp): void {
  page.on("console", message => { if (message.type() === "error" && !expected?.test(message.text())) errors.push(message.text()); });
  page.on("pageerror", error => errors.push(String(error)));
}

/** A second signed-in person in their own browser context, at the same viewport. */
export async function person(browser: Browser, username: string, size: { width: number; height: number }, errors: string[], expected?: RegExp): Promise<Page> {
  const context = await browser.newContext({ viewport: size });
  const page = await context.newPage();
  watch(page, errors, expected);
  await loginExisting(page, username);
  return page;
}

const selectionBar = (page: Page): Locator => page.getByRole("region", { name: "Selection" });
const isPhone = (page: Page): boolean => (page.viewportSize()?.width ?? 1440) < 700;
/** The text's table row, or below 700 px its card. */
const rowOf = (page: Page, caseId: string): Locator => isPhone(page)
  ? page.locator("article.document-card").filter({ has: rowBox(page, caseId, "en") }) : textRow(page, caseId, "en");
/** Open the text card: from the text name, or below 700 px from the card's "Details". */
async function openCard(page: Page, caseId: string): Promise<Locator> {
  if (!isPhone(page)) return openTextCard(page, caseId, "en");
  await rowOf(page, caseId).getByRole("button", { name: /^Details, / }).click();
  const card = textCard(page, caseId, "en");
  await expect(card).toBeVisible();
  return card;
}
/** "Pause texts…" on one text, to the end. */
async function pauseText(page: Page, caseId: string): Promise<void> {
  await rowBox(page, caseId, "en").check();
  await selectionBar(page).getByRole("button", { name: "More actions" }).click();
  await page.getByRole("menu", { name: "More actions" }).getByRole("menuitem", { name: "Pause texts…" }).click();
  const dialog = page.getByRole("dialog", { name: "Pause texts: 1 text" });
  const apply = dialog.getByRole("button", { name: "Pause 1 text" });
  await dialog.getByLabel(/^Reason/).fill(WHY);
  await apply.click();
  await dialog.getByLabel(/^I understand/).check();
  await apply.click();
  await expect(dialog).toBeHidden();
  await expect(page.locator(".ui-toast")).toContainText("Paused 1 text.");
  await selectionBar(page).getByRole("button", { name: "Clear selection" }).click();
}

for (const [width, height, suffix] of [[1440, 900, ""], [390, 844, "-phone"]] as const) {
  const phone = width < 700;
  const size = { width, height };

  test(`F2: a paused text keeps its open consolidation in the row, the card and History (${width} px)`, async ({ page }) => {
    const errors: string[] = [];
    watch(page, errors);
    await page.setViewportSize(size);
    const s = await documentsScenario(page, "S464") as Scenario;
    await loginExisting(page, s.users.lead);
    await page.goto(`/#/projects/${encodeURIComponent(s.project)}/documents?segment=all`);
    await documentsReady(page);
    await pauseText(page, "EN100028");

    // The row: the annotations are submitted (not paused), the consolidation is, and stays named.
    const row = rowOf(page, "EN100028");
    await expect(row).toContainText("Paused by lead");
    if (phone) {
      await expect(row).toContainText("Consolidation paused by lead, Kim Lang");
    } else {
      await expect(cellUnder(row, STAGE_HEADERS.annotation).locator(".documents-status")).toHaveAttribute("title", "2 of 2 submitted");
      await expect(cellUnder(row, STAGE_HEADERS.finalization).locator(".documents-status")).toHaveAttribute("title", "consolidating · paused (2 of 2 groups open)");
    }
    expect(await noHorizontalScroll(page)).toBe(true);
    await rowOf(page, "EN100028").scrollIntoViewIfNeeded();
    await shot(page, `f2-row-paused${suffix}`);

    // The card: the stages, the consolidator's row with the cause, and no second consolidation on offer.
    const card = await openCard(page, "EN100028");
    await expect(card.getByRole("button", { name: /^Annotation 2 of 2 submitted/ })).toBeVisible();
    await expect(card.getByRole("button", { name: /^Finalization consolidating · paused \(2 of 2 groups open\)/ })).toBeVisible();
    await showSegment(card, "Finalization");
    await expect(personRow(card, "Consolidators", "Kim Lang")).toContainText("Paused by lead · 2 of 2 groups open");
    await expect(card.getByRole("button", { name: "Consolidate…" })).toHaveCount(0);
    await expect(card.getByText(/Starts once an annotation is submitted/)).toHaveCount(0);
    expect(await noHorizontalScroll(page)).toBe(true);
    await shot(page, `f2-card-paused${suffix}`);

    // History: the consolidation is Finalization work.
    await card.getByRole("button", { name: /^History/ }).click();
    const consolidation = activityLines(card).filter({ hasText: "Consolidation: Kim Lang" });
    await expect(consolidation).toContainText("Paused by lead");
    await expect(consolidation.locator(".row-activity-tag")).toHaveText("Finalization");
    await shot(page, `f2-card-history${suffix}`);
    expect(errors).toEqual([]);
  });
}
