/**
 * Many annotators on one text (issue 447; issue 457: "Annotators per text" has no built-in maximum). A text with eight annotators stays
 * usable on Documents (row and text card) and in the consolidation view, at 1440 px and at 390 px: every annotator is
 * there, the comparison table scrolls inside its own box, and the page itself never scrolls sideways. With hidden
 * names the letters go on after the fifth ("Annotator F" …). Scenario: tests/browser_consolidation_scenarios.py
 * (people=8). `SHOTS_DIR` saves screenshots of every screen.
 */
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Locator, type Page } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { documentsReady, showSegment, textCard } from "./documentsHelpers";
import { loginExisting } from "./helpers";

test.setTimeout(300_000);
test.use({ actionTimeout: 15_000 });

// MANY_ANNOTATORS=20 (or 30, up to 60) runs the same checks with that many people (slow: the scenario submits each annotation).
const PEOPLE = Number(process.env.MANY_ANNOTATORS ?? 8);
const SHOTS = process.env.SHOTS_DIR;
const SIZES = [{ name: "desktop", width: 1440, height: 900 }, { name: "phone", width: 390, height: 844 }] as const;

interface ManyScenario {
  project: string;
  users: Record<string, string>;
  pseudonyms: Record<string, string>;
  case_id: string;
  assignment_id: number;
}

async function manyScenario(page: Page, params: Record<string, string> = {}): Promise<ManyScenario> {
  const response = await page.request.post("/__test_consolidation__", { params: { started: "true", people: String(PEOPLE), ...params }, timeout: 240_000 });
  expect(response.ok(), await response.text()).toBeTruthy();
  return await response.json() as ManyScenario;
}

/** Console errors and uncaught exceptions of the page, collected for the whole test. */
function collectErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on("console", message => { if (message.type() === "error") errors.push(message.text()); });
  page.on("pageerror", error => errors.push(String(error)));
  return errors;
}

/** The page itself does not scroll sideways (a wide table scrolls inside its own box). */
async function expectNoPageScroll(page: Page): Promise<void> {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow, "page-level horizontal scroll").toBeLessThanOrEqual(0);
}

async function shot(page: Page, name: string): Promise<void> {
  if (!SHOTS) return;
  mkdirSync(SHOTS, { recursive: true });
  await page.screenshot({ path: `${SHOTS}/${name}.png` });
}

/** "A" … "Z", then "AA", "AB" … as the server names hidden annotators (consolidation_blinding.letters). */
function letters(index: number): string {
  let [text, rest] = ["", index];
  do { text = String.fromCharCode(65 + (rest % 26)) + text; rest = Math.floor(rest / 26) - 1; } while (rest >= 0);
  return text;
}

const group = (page: Page, name: string): Locator => page.locator(".cons-group").filter({ has: page.locator(".cons-group-title", { hasText: name }) });

async function openHypotonia(page: Page): Promise<Locator> {
  const hypotonia = group(page, "muscular hypotonia");
  const toggle = hypotonia.locator(".cons-group-toggle");
  if ((await toggle.getAttribute("aria-expanded")) !== "true") await toggle.click();
  await expect(hypotonia.locator("table.cons-compare")).toBeVisible();
  return hypotonia;
}

for (const size of SIZES) {
  test(`many annotators on one text, ${size.name}: Documents, the text card and the consolidation view`, async ({ page }) => {
    await page.setViewportSize({ width: size.width, height: size.height });
    const errors = collectErrors(page);
    const s = await manyScenario(page);
    await loginExisting(page, s.users.lead);

    // Documents: the row, then the card with one row per annotator.
    await page.goto(`/#/projects/${encodeURIComponent(s.project)}/documents`);
    await documentsReady(page);
    await expect(page.getByText(s.case_id).first()).toBeVisible();
    await expectNoPageScroll(page);
    await shot(page, `447-documents-${size.name}`);
    await page.goto(`/#/projects/${encodeURIComponent(s.project)}/documents?panel=${encodeURIComponent(`${s.case_id}:en`)}`);
    const card = textCard(page, s.case_id, "en");
    await expect(card).toBeVisible({ timeout: 30_000 });
    await showSegment(card, "Annotation");
    const annotators = card.getByRole("list", { name: "Annotators", exact: true }).getByRole("listitem");
    await expect(annotators).toHaveCount(PEOPLE);
    await expect(card).toContainText(`${PEOPLE} of ${PEOPLE} submitted`);
    await expect(card.getByRole("link", { name: /^Open annotation of / })).toHaveCount(PEOPLE);
    // Every annotator row lies inside the card, left to right.
    const cardBox = (await card.boundingBox())!;
    for (let index = 0; index < PEOPLE; index += 1) {
      const box = (await annotators.nth(index).boundingBox())!;
      expect(box.x).toBeGreaterThanOrEqual(cardBox.x - 1);
      expect(box.x + box.width).toBeLessThanOrEqual(cardBox.x + cardBox.width + 1);
    }
    await expectNoPageScroll(page);
    await shot(page, `447-text-card-${size.name}`);
    await annotators.nth(PEOPLE - 1).scrollIntoViewIfNeeded();
    await shot(page, `447-text-card-last-annotator-${size.name}`);

    // The consolidation view: one column per annotator; the table scrolls in its own box.
    await page.goto(`/#/tasks/${s.assignment_id}`);
    await expect(page.getByRole("heading", { level: 1, name: `Consolidate ${s.case_id} en v1`, exact: true })).toBeVisible({ timeout: 30_000 });
    const hypotonia = await openHypotonia(page);
    const table = hypotonia.locator("table.cons-compare");
    await expect(table.locator("thead th")).toHaveCount(PEOPLE);
    await hypotonia.scrollIntoViewIfNeeded();
    await expectNoPageScroll(page);
    await shot(page, `447-consolidation-${size.name}`);
    expect((await new AxeBuilder({ page }).include(".cons-screen").analyze()).violations).toEqual([]);
    // The last annotator's column is reachable: scrolled into view inside the table's box, and its ✓ works.
    const scroller = hypotonia.locator(".cons-compare-scroll");
    const last = table.locator("thead th").nth(PEOPLE - 1);
    await last.scrollIntoViewIfNeeded();
    const [frame, column] = [(await scroller.boundingBox())!, (await last.boundingBox())!];
    expect(column.x).toBeGreaterThanOrEqual(frame.x - 1);
    expect(column.x + column.width).toBeLessThanOrEqual(frame.x + frame.width + 1);
    const take = table.locator("tr.cons-row--conflict").first().locator("button.cons-take").nth(PEOPLE - 1);
    await take.click();
    await expect(take).toHaveAttribute("aria-pressed", "true");
    await expectNoPageScroll(page);
    await shot(page, `447-consolidation-last-column-${size.name}`);
    // Scrolled to the last person, the row labels are still in view (sticky first column).
    const label = table.locator("tbody th").first();
    const labelBox = (await label.boundingBox())!;
    expect(labelBox.x).toBeGreaterThanOrEqual(frame.x - 1);
    expect(labelBox.x + labelBox.width).toBeLessThanOrEqual(column.x + 1);
    // The legend names every annotator: three lines of one person each, the fourth for the other five.
    const legend = page.getByRole("list", { name: "Legend", exact: true });
    if (await legend.isVisible()) await expect(legend).toContainText(`Line 4 (double): +${PEOPLE - 3}:`);
    expect(errors).toEqual([]);
  });
}

test("hidden names: the letters go on after the fifth annotator", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const errors = collectErrors(page);
  const s = await manyScenario(page, { blind: "true" });
  await loginExisting(page, s.users.adj);
  await page.goto(`/#/tasks/${s.assignment_id}`);
  await expect(page.getByRole("heading", { level: 1, name: `Consolidate ${s.case_id} en v1`, exact: true })).toBeVisible({ timeout: 30_000 });
  const hypotonia = await openHypotonia(page);
  const heads = hypotonia.locator("table.cons-compare thead th");
  await expect(heads).toHaveText(Array.from({ length: PEOPLE }, (_, index) => new RegExp(`Annotator ${letters(index)}$`)));
  await expectNoPageScroll(page);
  await shot(page, "447-consolidation-blind-desktop");
  expect(errors).toEqual([]);
});

for (const size of SIZES) {
  test(`nine of twelve annotators assigned, ${size.name}: the card's count line and the assign dialog`, async ({ page }) => {
    await page.setViewportSize({ width: size.width, height: size.height });
    const errors = collectErrors(page);
    const s = await manyScenario(page, { started: "false", people: "6", open_people: "3", limit: "12" });
    await loginExisting(page, s.users.lead);
    await page.goto(`/#/projects/${encodeURIComponent(s.project)}/documents?panel=${encodeURIComponent(`${s.case_id}:en`)}`);
    const card = textCard(page, s.case_id, "en");
    await expect(card).toBeVisible({ timeout: 30_000 });
    await showSegment(card, "Annotation");
    await expect(card.getByText("9 of 12 annotators assigned.", { exact: true })).toBeVisible();
    await expect(card.getByRole("list", { name: "Annotators", exact: true }).getByRole("listitem")).toHaveCount(9);
    await expectNoPageScroll(page);
    await shot(page, `447-card-9-of-12-${size.name}`);
    // The assign dialog names the room that is left (3 of 12).
    await card.getByRole("button", { name: "Assign annotators…", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: /^Assign/ });
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText("12");
    await expectNoPageScroll(page);
    await shot(page, `447-assign-dialog-${size.name}`);
    expect(errors).toEqual([]);
  });
}
