/**
 * Documents table at desktop widths (issue 544, findings U2-01, U3-02, U5-01; goals of issue 519): from 1280 px the
 * table never scrolls sideways, also with the "Typography hints" badge, long states and two people in Waiting on;
 * from 1400 px no status or Waiting on cell is cut, and where the table has room (1920 px) the full state shows.
 * The pause of a consolidation shows as an icon and in words at every width (issue 549, U3-01).
 *
 * The S0 fixture is patched in the list response, so every width sees the same worst-case rows.
 */
import { expect, test, type Page } from "@playwright/test";
import type { components } from "../src/api/generated";
import { documentsReady, documentsScenario, documentsTable, rowCell, textName, textRow } from "./documentsHelpers";
import { loginExisting } from "./helpers";

type Rows = components["schemas"]["DocumentRowsPage"];
type Cell = components["schemas"]["StageCellView"];

test.setTimeout(180_000);

const person = (display_name: string, pseudonym: string) => ({ display_name, pseudonym, is_me: false });
const reviewer = person("Translation reviewer", "ann-0007");
const ben = person("Ben Clausen", "ann-0008");
const cara = person("Cara Dietz", "ann-0009");

/** The de row: corrected v2 with typography hints and NEW (U2-01); a review nobody started, two annotators at work. */
function crowded(row: Rows["groups"][number]["rows"][number]) {
  Object.assign(row, { typography_hints: 3, new: true });
  row.stages!.review = { state: "in_progress", tone: "running", detail: { people: [reviewer], started: 0, open_tasks: 1, assigned: 1, total: 1 } } as Cell;
  row.stages!.annotation = { state: "in_progress", tone: "running", detail: { people: [ben, cara], started: 1, open_tasks: 2, assigned: 2, submitted: 0, total: 2, target: 3 } } as Cell;
  if (row.next_step) row.next_step.owner = { kind: "people", person: null, count: 2, people: [ben, cara] };
}

/** The en row: a consolidation the lead paused. */
function pausedConsolidation(row: Rows["groups"][number]["rows"][number]) {
  Object.assign(row, { lead_pause: { reason: "Guideline question", paused_by: person("Lena Lead", "lead-0001"), paused_at: new Date().toISOString() } });
  row.stages!.annotation = { state: "consolidating", tone: "running", detail: { people: [cara], submitted: 2, total: 2, note: "lead_pause" } } as Cell;
  row.consolidation_progress = { round_id: "r-1", open: 1, total: 3 } as Rows["groups"][number]["rows"][number]["consolidation_progress"];
}

async function openCrowded(page: Page) {
  const s = await documentsScenario(page, "S0");
  await loginExisting(page, s.users.lead);
  await page.route(url => new URL(url).pathname.endsWith("/document-rows"), async route => {
    const body = await (await route.fetch()).json() as Rows;
    for (const row of body.groups.flatMap(entry => entry.rows)) (row.language === "de" ? crowded : pausedConsolidation)(row);
    await route.fulfill({ json: body });
  });
  await page.goto(`/#/projects/${encodeURIComponent(s.project)}/documents`);
  await documentsReady(page);
  await expect(textRow(page, "synthetic-accepted", "de").getByText("Typography hints")).toBeVisible();
}

/** Cells whose text is cut (ellipsis or hidden overflow), by column. */
const cutCells = (page: Page) => documentsTable(page).locator(".documents-status, .documents-waiting-on, .waiting-name").evaluateAll(elements =>
  elements.filter(element => element.getClientRects().length > 0 && element.scrollWidth > element.clientWidth + 1)
    .map(element => `${element.closest("td")?.getAttribute("data-column") ?? element.className}: ${element.textContent}`));

const overflow = (page: Page) => page.locator(".documents-page .data-table-scroll").evaluate(element => element.scrollWidth - element.clientWidth);

for (const width of [1280, 1366, 1400, 1440, 1520, 1599, 1600, 1680, 1920]) {
  test(`the Documents table fits ${width} px without sideways scroll; from 1400 px nothing is cut`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await openCrowded(page);
    expect(await overflow(page), "sideways overflow of the table").toBeLessThanOrEqual(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth), "page overflow").toBeLessThanOrEqual(0);
    // Every text keeps one 40 px line; below 1366 px a crowded Text cell may take a second line rather than scroll.
    const height = (language: string) => textRow(page, "synthetic-accepted", language).evaluate(row => Math.round(row.getBoundingClientRect().height));
    expect(await height("en"), "row height en").toBeLessThanOrEqual(41);
    expect(await height("de"), "row height de").toBeLessThanOrEqual(width >= 1366 ? 41 : 64);
    // Last activity and Next step stay in view.
    const scroller = await page.locator(".documents-page .data-table-scroll").boundingBox();
    const header = await documentsTable(page).getByRole("columnheader", { name: "Last activity" }).boundingBox();
    expect(header!.x + header!.width, "Last activity in view").toBeLessThanOrEqual(scroller!.x + scroller!.width + 0.5);
    if (width >= 1400) expect(await cutCells(page), "cut cells").toEqual([]);
    // With room to spare the full states and every waiting person show (U5-01: cut at 1920 px before).
    if (width === 1920) {
      await expect(rowCell(textRow(page, "synthetic-accepted", "de"), "translation")).toContainText("assigned, not started (Translation reviewer)");
      await expect(rowCell(textRow(page, "synthetic-accepted", "de"), "waiting").locator(".waiting-wide")).toBeVisible();
    }
  });
}

test("a paused consolidation shows the pause icon and the word at 1280, 1440 and 1700 px (issue 549, U3-01)", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openCrowded(page);
  const final = rowCell(textRow(page, "synthetic-accepted", "en"), "finalization");
  for (const width of [1280, 1440, 1700]) {
    await page.setViewportSize({ width, height: 900 });
    // An SVG, not a font glyph: it draws in every font.
    const icon = await final.locator('.stage-cell-symbol[data-symbol="⏸"] svg').boundingBox();
    expect(icon!.width, `${width} px icon`).toBeGreaterThan(8);
    const shown = await final.locator(".documents-status").evaluate(element =>
      [...element.querySelectorAll<HTMLElement>(":scope > span")].filter(span => span.getClientRects().length && getComputedStyle(span).position !== "absolute").map(span => span.textContent).join(""));
    expect(shown, `${width} px words`).toContain("paused");
  }
});

/** S0 with the case IDs of the acceptance stack (issue 576, F1): two pairs that share a long start, one very long ID. */
const CASE_IDS = ["synthetic-accepted", "synthetic-ready", "synthetic-failed", "L3CASE-006-very-long-identifier-for-layout", "L3CASE-007-typo"];

async function openManyIds(page: Page) {
  const s = await documentsScenario(page, "S0");
  await loginExisting(page, s.users.lead);
  await page.route(url => new URL(url).pathname.endsWith("/document-rows"), async route => {
    const body = await (await route.fetch()).json() as Rows;
    const [first] = body.groups;
    body.groups = CASE_IDS.map(caseId => ({ ...structuredClone(first), case_id: caseId, rows: first.rows.map(row => ({ ...structuredClone(row), case_id: caseId })) }));
    await route.fulfill({ json: body });
  });
  await page.goto(`/#/projects/${encodeURIComponent(s.project)}/documents`);
  await documentsReady(page);
  await expect(textName(page, "L3CASE-007-typo", "en")).toBeVisible();
}

/** What each row's case ID shows: the visible text, and whether CSS cuts it (an ellipsis drawn over the text). */
const shownIds = (page: Page) => documentsTable(page).locator("th[scope=row] .documents-row-case .documents-id").evaluateAll(ids => ids.map(id => {
  const parts = [...id.children].filter((part): part is HTMLElement => part instanceof HTMLElement);
  const shown = parts.length ? parts.find(part => part.getClientRects().length > 0) ?? id : id;
  return { full: id.getAttribute("title") ?? "", text: shown.textContent ?? "", cut: [id, shown].some(element => element.scrollWidth > element.clientWidth + 1) };
}));

for (const width of [1280, 1366, 1440]) {
  test(`case IDs stay apart at ${width} px: in full while the table has room, else one middle ellipsis (issue 576, F1)`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await openManyIds(page);
    expect(await overflow(page), "sideways overflow of the table").toBeLessThanOrEqual(0);
    const ids = await shownIds(page);
    expect(ids.filter(id => id.cut), "IDs cut by CSS").toEqual([]);
    // One shown form per case: no two cases read the same.
    const forms = new Map(ids.map(id => [id.full, id.text]));
    expect(new Set(forms.values()).size, JSON.stringify([...forms])).toBe(CASE_IDS.length);
    for (const id of ids) {
      expect(id.text.split("…").length, `one ellipsis at most: ${id.text}`).toBeLessThanOrEqual(2);
      // Short IDs keep every character, with room or not.
      if (id.full.length <= 18) expect(id.text).toBe(id.full);
    }
    // From 1366 px the table has room for the IDs of up to 24 characters in full; only the 42-character one keeps its
    // two ends around "…" (at 1366 px "L3CASE-00…" read the same for 006 and 007-typo, and "synthetic-…" for three).
    if (width >= 1366) expect(ids.filter(id => id.full.length <= 24 && id.text !== id.full).map(id => id.text)).toEqual([]);
  });
}
