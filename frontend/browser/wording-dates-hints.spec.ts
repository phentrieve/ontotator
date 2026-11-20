/**
 * Issue 472, the points on wording, dates, layout and hints (1440 px): the status cells of the Documents table are
 * not cut, a person's row says "Submitted today 14:02" by the rule of "assigned today 13:39", two proposal sets of
 * one day show their time, the single Reopen dialog names the person, the text view names a submission with a local
 * time (never a raw timestamp), and Settings says a refused username at its field, why a value is greyed and that a
 * language code is wanted.
 *
 * Builds a fresh project through ``POST /__test_documents__`` (scenario S336).
 */
import { expect, test, type Page } from "@playwright/test";
import type { components } from "../src/api/generated";
import { documentsReady, documentsScenario, documentsTable, openTextCard, rowCell, showSegment, textRow } from "./documentsHelpers";
import { loginExisting } from "./helpers";

test.setTimeout(180_000);
test.use({ actionTimeout: 15_000, viewport: { width: 1440, height: 900 } });

const shots = process.env.SHOTS_DIR;
async function shot(page: Page, name: string): Promise<void> {
  if (shots) await page.screenshot({ path: `${shots}/${name}.png` });
}
const TODAY = /today \d\d:\d\d/;
const RAW_TIMESTAMP = /\d{4}-\d\d-\d\d[T ]\d\d:\d\d:\d\d/;

test("Documents at 1440 px: status cells are not cut, rows and proposal sets carry readable dates, Reopen names the person", async ({ page }) => {
  const s = await documentsScenario(page, "S336");
  await loginExisting(page, s.users.lead);
  // The fixture has neither a two-digit count nor proposal sets: patch the list response (as documents-table.spec.ts does).
  const set = (set_id: number, imported_at: string, newest: boolean) => ({ set_id, imported_at, tool: "phentrieve", tool_version: "1.4", proposal_count: 24, newest });
  await page.route(url => new URL(url).pathname.endsWith("/document-rows"), async route => {
    const body = await (await route.fetch()).json() as components["schemas"]["DocumentRowsPage"];
    for (const row of body.groups.flatMap(entry => entry.rows)) {
      if (row.case_id === "EN100022") {
        row.stages!.annotation = { state: "submitted", tone: "progress", detail: { submitted: 20, total: 22 } } as components["schemas"]["StageCellView"];
        Object.assign(row, { proposal_count: 24, annotation_mode: { mode: "proposals", source: "project", locked: false, override: null, proposal_count: 24 },
          proposal_set: set(1, "2026-11-17T09:12:00", false), newer_proposal_set: set(2, "2026-11-17T13:40:00", true) });
      }
    }
    await route.fulfill({ json: body });
  });
  await page.goto(`/#/projects/${encodeURIComponent(s.project)}/documents`);
  await documentsReady(page);

  // Layout: "20/22 submitted" and "accepted 18 Nov" keep their last letters, with room to spare, and the table
  // still fits the page.
  const annotation = rowCell(textRow(page, "EN100022", "en"), "annotation").locator(".documents-status");
  await expect(annotation.locator(".stage-state-narrow")).toHaveText("20/22 submitted");
  const accepted = rowCell(textRow(page, "EN100028", "en"), "finalization").locator(".documents-status");
  await expect(accepted).toContainText(/accepted \d{1,2} [A-Z][a-z]{2}$/);
  for (const cell of [annotation, accepted]) {
    const room = await cell.evaluate(element => ({ cut: element.scrollWidth - element.clientWidth, cap: getComputedStyle(element).maxWidth }));
    expect(room.cut).toBeLessThanOrEqual(0);
    // Other systems draw the same words wider: no fixed cap, the table chooses words that fit (issue 544).
    expect(room.cap).toBe("none");
  }
  const cut = await documentsTable(page).locator(".documents-status.stage-cell").evaluateAll(cells => cells.filter(cell => cell.scrollWidth > cell.clientWidth).map(cell => cell.textContent));
  expect(cut).toEqual([]);
  expect(await page.locator(".documents-page .data-table-scroll").evaluate(element => element.scrollWidth - element.clientWidth)).toBeLessThanOrEqual(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await shot(page, "472-documents-1440");

  // The text card: both days of a row follow one rule; two sets of one day show their time.
  const card = await openTextCard(page, "EN100022", "en");
  await showSegment(card, "Annotation");
  const part = card.getByRole("region", { name: "Annotation", exact: true });
  await expect(part.locator(".text-card-proposal-set")).toContainText("set 2026-11-17 09:12 (phentrieve 1.4), 24 proposals");
  await expect(part.locator(".text-card-proposal-set")).toContainText("Newer set available: 2026-11-17 13:40");
  const tom = part.getByRole("list", { name: "Annotators" }).getByRole("listitem").filter({ hasText: "Tom Reis" });
  await expect(tom).toContainText(new RegExp(`Submitted ${TODAY.source}, \\d+ findings? · assigned ${TODAY.source}`));
  await shot(page, "472-card-row");

  // The single Reopen dialog names the person and says why its reason is optional.
  await tom.getByRole("button", { name: /^Reopen Tom Reis/ }).click();
  const reopen = page.getByRole("dialog", { name: /^Reopen EN100022 en for Tom Reis/ });
  await expect(reopen.getByRole("textbox", { name: "Reason (optional)" })).toBeVisible();
  await expect(reopen).toContainText("The person reads it in My tasks. Reopening several texts at once needs a reason.");
  await shot(page, "472-reopen-single");
  await reopen.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(reopen).toBeHidden();
});

test("the text view names an own submission with a local date and time, never a raw timestamp", async ({ page }) => {
  const s = await documentsScenario(page, "S336");
  await loginExisting(page, s.users.tom);
  await page.goto(`/#/projects/${encodeURIComponent(s.project)}/cases/EN100022`);
  const show = page.getByRole("combobox", { name: "Show", exact: true }).first();
  await expect(show).toBeVisible();
  const own = show.locator("option", { hasText: "My annotation" });
  await expect(own).toHaveCount(1);
  const label = (await own.textContent()) ?? "";
  expect(label).toMatch(/^My annotation, from scratch, \d{1,2} [A-Z][a-z]{2}, \d\d:\d\d$/);
  await show.selectOption({ label });
  await expect(page.locator("body")).not.toContainText(RAW_TIMESTAMP);
  await shot(page, "472-text-view-own");
});

test("Settings: a refused username at its field, the reason for a greyed value, and that a language code is wanted", async ({ page }) => {
  const s = await documentsScenario(page, "S336");
  await loginExisting(page, s.users.lead);
  const settings = (section: string) => `/#/projects/${encodeURIComponent(s.project)}/settings/${section}`;

  // People: the display name typed without choosing the suggestion.
  await page.goto(settings("people"));
  await page.getByRole("button", { name: "Add member…", exact: true }).click();
  const form = page.getByRole("form", { name: "Add member", exact: true });
  const username = form.getByRole("combobox", { name: /^Username/ });
  await username.fill("Maria Klein");
  await form.getByRole("checkbox", { name: "New member: Annotator", exact: true }).check();
  await form.getByRole("button", { name: "Add member", exact: true }).click();
  const alert = form.getByRole("alert");
  // No person of that name is offered here, so the field says what a username looks like (with a suggestion
  // of that name it names the username: tests/members.test.tsx).
  await expect(alert).toHaveText("Use 3–64 lowercase letters, digits, dots, hyphens or underscores, starting and ending with a letter or digit.");
  // At the field: directly below it, inside the form.
  const [fieldBox, alertBox] = await Promise.all([username.boundingBox(), alert.boundingBox()]);
  expect(alertBox!.y - (fieldBox!.y + fieldBox!.height)).toBeLessThan(80);
  await expect(page.getByRole("alert")).toHaveCount(1);
  await shot(page, "472-add-member-error");

  // Annotation: the greyed prefilled value says why, on the screen.
  await page.goto(settings("annotation"));
  const values = page.getByRole("region", { name: "Values annotators can choose", exact: true });
  await values.locator("summary").first().click();
  const row = values.getByRole("group", { name: "Assertion", exact: true });
  await expect(row.getByRole("button", { name: "Present", exact: true })).toBeDisabled();
  await expect(row.getByText("“Present” is prefilled and cannot be hidden.", { exact: true })).toBeVisible();
  await shot(page, "472-values-reason");

  // General: the language field asks for a code.
  await page.goto(settings("general"));
  await expect(page.getByText("Type a language code, for example de (not “German”), then press Enter or Add language.", { exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});
