/**
 * Review 2 of the lead pause and the annotator limit, at 1440 and 390 px:
 * - F2: a text whose consolidation is open keeps it in the Documents row, the text card and History once the lead
 *   pauses the text ("consolidating · paused", the consolidator's row with "Paused by lead", no second "Consolidate…").
 * - F3: an annotator whose editor was open before the pause reads the reason in the New finding panel at 390 px,
 *   where the banner above the panes is out of view; at 1440 px the banner is in view and the panel has no second line.
 * - F4: a text whose first annotator is at work and that can take another keeps "· max 2" in its row at 1440 px, the
 *   empty "To assign" tab says where such texts are, and Filter › Annotation › "Can take another annotator" lists them.
 * With SHOTS_DIR set, the states are also saved as screenshots.
 *
 * Builds fresh projects through ``POST /__test_documents__`` (scenario S464).
 */
import { expect, test, type Browser, type Locator, type Page } from "@playwright/test";
import { activityLines, cellUnder, documentsReady, documentsScenario, documentsTab, filterChip, openFilters, openTextCard, personRow, rowBox, showSegment, STAGE_HEADERS, textCard, textRow, type DocumentsScenario } from "./documentsHelpers";
import { authenticatedRequest, loginExisting, selectText } from "./helpers";

test.setTimeout(300_000);
test.use({ actionTimeout: 15_000 });

const shots = process.env.SHOTS_DIR;
async function shot(page: Page, name: string): Promise<void> {
  if (shots) await page.screenshot({ path: `${shots}/${name}.png` });
}
const noHorizontalScroll = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
const WHY = "The clinic is checking the source text";

const TEXT = "The patient is a 14-month-old girl with developmental delay and recurrent seizures. On examination she shows generalized hypotonia.";

type Scenario = DocumentsScenario & { assignments: Record<string, number>; report_id: string };

/** Collects console and page errors; `expected` names the one refusal a test provokes (the browser logs a refused request). */
function watch(page: Page, errors: string[], expected?: RegExp): void {
  page.on("console", message => { if (message.type() === "error" && !expected?.test(message.text())) errors.push(message.text()); });
  page.on("pageerror", error => errors.push(String(error)));
}

/** A second signed-in person in their own browser context, at the same viewport. */
async function person(browser: Browser, username: string, size: { width: number; height: number }, errors: string[], expected?: RegExp): Promise<Page> {
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

/** Pause one text as the signed-in lead, through the API (the dialog has its own spec). */
async function pauseByApi(page: Page, project: string, caseId: string): Promise<void> {
  const url = `/api/v1/projects/${encodeURIComponent(project)}/text-pauses/pause`;
  const rows = [{ case_id: caseId, language: "en" }];
  const preview = await (await authenticatedRequest(page, url, "POST", { rows, preview: true })).json();
  const applied = await authenticatedRequest(page, url, "POST", { rows, reason: WHY, preview_token: preview.preview_token });
  expect(applied.status()).toBe(200);
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

  test(`F3: the annotator reads why the save was refused where they work (${width} px)`, async ({ page, browser }) => {
    const errors: string[] = [];
    watch(page, errors);
    await page.setViewportSize(size);
    const s = await documentsScenario(page, "S464") as Scenario;
    // Tom Reis has EN100022 open before the pause lands; the refused request (409) is what this test is about.
    const tom = await person(browser, s.users.tom, size, errors, /status of 409 \(Conflict\)/);
    await tom.goto(`/#/tasks/${s.assignments.started}`);
    await expect(tom.locator(".text-container")).toHaveText(`${TEXT} EN100022`);
    await loginExisting(page, s.users.lead);
    await pauseByApi(page, s.project, "EN100022");

    if (phone) await tom.getByRole("navigation", { name: "Select view" }).getByRole("button", { name: "Document" }).click();
    const word = TEXT.indexOf("seizures");
    await selectText(tom, word, word + "seizures".length);
    if (phone) await tom.getByRole("group", { name: "New finding", exact: true }).getByRole("button", { name: "Choose term", exact: true }).click();
    // The term search is the first thing the server refuses.
    await tom.getByLabel("Search term", { exact: true }).fill("HP:0001250");
    const panel = tom.getByRole("region", { name: "New finding", exact: true });
    await expect(panel.getByRole("heading", { name: "New finding" })).toBeVisible();
    const banner = tom.locator(".paused-notice").getByText(`Paused by lead: ${WHY}`);
    await expect(banner).toBeVisible();
    if (phone) {
      // The banner sits above the pane the person works in; the panel repeats its line, in view.
      const line = panel.getByRole("status").filter({ hasText: `Paused by lead: ${WHY}` });
      await expect(line).toBeInViewport();
      await expect(line).toContainText("Nothing can be saved now. What you marked is kept until you leave the task.");
      await expect(panel.getByText("“seizures”")).toBeVisible();
    } else {
      await expect(banner).toBeInViewport();
      await expect(panel.getByRole("status")).toHaveCount(0);
    }
    expect(await noHorizontalScroll(tom)).toBe(true);
    await shot(tom, `f3-refused${suffix}`);
    expect(errors).toEqual([]);
    await tom.context().close();
  });

  test(`F4: a text with a free place while its first annotator works can be found (${width} px)`, async ({ page }) => {
    const errors: string[] = [];
    watch(page, errors);
    await page.setViewportSize(size);
    const s = await documentsScenario(page, "S464") as Scenario;
    await loginExisting(page, s.users.lead);
    await page.goto(`/#/projects/${encodeURIComponent(s.project)}/documents`);
    await documentsReady(page);

    // The limit is 2 and nobody works on EN100027: the lead assigns Ana Weber alone.
    const card = await openCard(page, "EN100027");
    await showSegment(card, "Annotation");
    await card.getByRole("button", { name: /^Assign annotat/ }).first().click();
    const assign = page.getByRole("dialog", { name: /^Assign/ }).last();
    await assign.getByRole("checkbox", { name: /Ana Weber/ }).check();
    await assign.getByRole("button", { name: /^Assign 1/ }).click();
    await expect(assign).toBeHidden();
    await page.keyboard.press("Escape");
    await expect(card).toBeHidden();

    // The row is in progress and still says that a place is free.
    const row = rowOf(page, "EN100027");
    if (phone) {
      await expect(row).toContainText("max 2");
    } else {
      const status = cellUnder(row, STAGE_HEADERS.annotation).locator(".documents-status");
      await expect(status).toHaveAttribute("title", "assigned, not started · max 2 · open: Ana Weber");
      const short = status.locator(".stage-state-narrow");
      await expect(short).toBeVisible();
      await expect(short).toHaveText("0/1 · max 2");
      // Not cut: the cell shows the whole short state.
      expect(await status.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
      // A fully staffed text that nobody started reads as before.
      await expect(cellUnder(rowOf(page, "EN100023"), STAGE_HEADERS.annotation).locator(".stage-state-narrow")).toHaveText("not started");
    }
    await row.scrollIntoViewIfNeeded();
    await shot(page, `f4-row${suffix}`);

    // "To assign" is empty now and says where the texts with a free place are.
    await documentsTab(page, "To assign", 0).click();
    await expect(page.getByRole("heading", { name: "No text waits for an assignment" })).toBeVisible();
    await expect(page.getByText("A text that someone already works on can still take another annotator, up to the limit.")).toBeVisible();
    expect(await noHorizontalScroll(page)).toBe(true);
    await shot(page, `f4-to-assign-empty${suffix}`);
    await page.getByRole("link", { name: "Show texts that can take another annotator" }).click();
    await documentsReady(page);
    await expect(filterChip(page, "Can take another annotator")).toBeVisible();
    await expect(rowBox(page, "EN100027", "en")).toBeVisible();
    await expect(rowBox(page, "EN100023", "en")).toHaveCount(0);

    // The same filter under Annotation in the popover, with its count; with "In progress" it lists the text.
    const filters = await openFilters(page);
    const option = filters.getByRole("checkbox", { name: /^Can take another annotator, \d+ texts?$/ });
    await expect(option).toBeChecked();
    expect(await noHorizontalScroll(page)).toBe(true);
    await shot(page, `f4-filter${suffix}`);
    if (phone) await page.getByRole("button", { name: /^Show \d+ text/ }).click(); else await page.keyboard.press("Escape");
    await documentsTab(page, "In progress").click();
    await documentsReady(page);
    await expect(rowBox(page, "EN100027", "en")).toBeVisible();
    await expect(rowBox(page, "EN100022", "en")).toHaveCount(0);
    await shot(page, `f4-in-progress-filtered${suffix}`);
    expect(errors).toEqual([]);
  });
}
