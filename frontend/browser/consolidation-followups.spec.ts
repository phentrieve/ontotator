/**
 * Consolidator follow-ups (issue 470, and the consolidation points of #472), at 1440 and 390 px where a phone is
 * concerned: the Undo of "Reopen all decisions…" goes with the first new decision; with 20 annotators a line under
 * each row to decide says who holds which value and stays in view while the table scrolls sideways, as do the
 * parent-term sentence and an "(all agree)" value; "Remove" takes an added finding out again, and a phone adds one by
 * a typed passage; the text view of a consolidator who is not the lead marks and links only their own submissions.
 * Scenario: tests/browser_consolidation_scenarios.py (a fresh project per test).
 */
import { expect, test, type Locator, type Page } from "@playwright/test";
import { loginExisting } from "./helpers";

test.setTimeout(240_000);
test.use({ actionTimeout: 15_000 });

const WIDE = { width: 1440, height: 900 };
const PHONE = { width: 390, height: 844 };

interface Scenario {
  project: string;
  users: Record<string, string>;
  pseudonyms: Record<string, string>;
  case_id: string;
  document_id: string;
  assignment_id: number;
}

async function scenario(page: Page, params: Record<string, string> = {}): Promise<Scenario> {
  const response = await page.request.post("/__test_consolidation__", { params: { started: "true", ...params }, timeout: 180_000 });
  expect(response.ok(), await response.text()).toBeTruthy();
  return await response.json() as Scenario;
}

const expanded = (page: Page) => page.locator(".cons-group-expanded");
const expandedTitle = (page: Page) => page.locator(".cons-group-expanded .cons-group-title");
const group = (page: Page, name: string) => page.locator(".cons-group-toggle").filter({ has: page.locator(".cons-group-title", { hasText: new RegExp(`^${name}$`) }) });
const take = (page: Page, value: string, field: string) =>
  expanded(page).getByRole("button", { name: new RegExp(`^Take ${value} from .+ for ${field}$`, "i") });
const keep = (page: Page) => expanded(page).getByRole("button", { name: "Keep", exact: true });
const progress = (page: Page) => page.locator(".cons-progress-line");
/** The app's toast, not the "Decision saved" Undo in a group's row (styled as a toast). */
const toast = (page: Page) => page.locator(".ui-toast:not(.cons-undo)");
const commandSaved = (page: Page) => page.waitForResponse(r => r.request().method() === "POST" && /\/commands$/.test(new URL(r.url()).pathname));

async function openTask(page: Page, s: Scenario, user: string): Promise<void> {
  await loginExisting(page, user);
  await page.goto(`/#/tasks/${s.assignment_id}`);
  await expect(page.getByRole("heading", { level: 1, name: /^Consolidate case-0107\W+en v1$/ })).toBeVisible({ timeout: 60_000 });
  await expect(expandedTitle(page)).toHaveText("muscular hypotonia");
}

/** The element lies inside the visible part of the table's scroll box (2 px tolerance for borders). */
async function expectInside(element: Locator, box: Locator): Promise<void> {
  const [inner, outer] = [await element.boundingBox(), await box.boundingBox()];
  expect(inner, "the element is rendered").not.toBeNull();
  expect(outer, "the scroll box is rendered").not.toBeNull();
  expect(inner!.x).toBeGreaterThanOrEqual(outer!.x - 2);
  expect(inner!.x + inner!.width).toBeLessThanOrEqual(outer!.x + outer!.width + 2);
}

test.describe("at 1440 px", () => {
  test.use({ viewport: WIDE });

  test("the Undo of Reopen all decisions… goes with the first new decision: never two Undo buttons", async ({ page }) => {
    const s = await scenario(page);
    await openTask(page, s, s.users.lead);
    await take(page, "absent", "Assertion").click();
    await keep(page).click();
    await expect(expandedTitle(page)).toHaveText("Absent reflexes");
    await keep(page).click();
    await expect(progress(page)).toContainText("2 of 8 groups open");
    await page.getByRole("button", { name: "More task actions", exact: true }).click();
    await page.getByRole("menuitem", { name: "Reopen all decisions…", exact: true }).click();
    await page.getByRole("dialog", { name: "Reopen 2 decided groups?" }).getByRole("button", { name: "Reopen all", exact: true }).click();
    await expect(toast(page).locator(".ui-toast-message")).toHaveText("Reopened 2 decided groups.");
    await expect(page.getByRole("button", { name: /^Undo/ })).toHaveCount(1);
    await expect(expandedTitle(page)).toHaveText("muscular hypotonia");
    // A new decision: the reopen can no longer be undone, so its message and Undo are gone; the decision's Undo is the only one.
    const undone: string[] = [];
    page.on("request", request => { if (request.url().includes("/consolidation-groups/undo-reopen-all")) undone.push(request.url()); });
    await take(page, "absent", "Assertion").click();
    await keep(page).click();
    await expect(group(page, "muscular hypotonia")).toHaveAccessibleName(/^muscular hypotonia decided/);
    await expect(toast(page)).toHaveCount(0);
    await expect(page.getByRole("button", { name: /^Undo/ })).toHaveCount(1);
    await expect(page.getByRole("button", { name: "Undo, muscular hypotonia", exact: true })).toBeVisible();
    await expect(page.getByText("Could not restore the decisions.")).toHaveCount(0);
    // Ctrl+Z undoes that decision, and asks the server for nothing else.
    await page.locator("body").click({ position: { x: 5, y: 5 } });
    await page.keyboard.press("Control+z");
    await expect(group(page, "muscular hypotonia")).toHaveAccessibleName(/^Conflict muscular hypotonia /);
    expect(undone).toEqual([]);
  });

  test("#472: the same passage from everyone reads (all agree), the count of fields goes down, and Undo hides beside a dialog", async ({ page }) => {
    const s = await scenario(page);
    await openTask(page, s, s.users.lead);
    // Both annotators marked "muscular hypotonia".
    const textRow = expanded(page).getByRole("row").filter({ has: page.getByRole("rowheader", { name: "Text", exact: true }) });
    await expect(textRow).toContainText("“muscular hypotonia”");
    await expect(expanded(page)).not.toContainText("overlapping");
    await group(page, "Prolonged seizure activity").click();
    await expect(expandedTitle(page)).toHaveText("Prolonged seizure activity");
    const toggle = group(page, "Prolonged seizure activity");
    await expect(toggle).toContainText("2 fields to decide");
    await take(page, "Status epilepticus", "Term").click();
    await expect(toggle).toContainText("1 field to decide");
    await take(page, "present", "Assertion").click();
    await expect(toggle).toContainText("chosen, not saved yet");
    await keep(page).click();
    await expect(toggle).toHaveAccessibleName(/^Prolonged seizure activity decided/);
    const undo = page.locator(".cons-undo");
    await expect(undo).toBeVisible();
    // A dialog opened after the decision: its Undo is not shown beside it, and is back when the dialog closes.
    await page.getByRole("button", { name: "More task actions", exact: true }).click();
    await page.getByRole("menuitem", { name: "Reopen all decisions…", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "Reopen 1 decided group?" });
    await expect(dialog).toBeVisible();
    await expect(undo).toBeHidden();
    await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
    await expect(undo).toBeVisible();
  });

  test("a consolidator who is not the lead: the text view marks and links only their own submissions, and has no Text card", async ({ page }) => {
    const s = await scenario(page, { consolidator: "adj" });
    await openTask(page, s, s.users.adj);
    await page.goto(`/#/projects/${encodeURIComponent(s.project)}/cases/${encodeURIComponent(s.case_id)}`);
    const toolbar = page.getByRole("group", { name: "Text view" });
    await expect(toolbar.getByRole("button", { name: "Submissions", exact: true })).toBeVisible({ timeout: 30_000 });
    await expect(toolbar.getByRole("link", { name: "Text card" })).toHaveCount(0);
    await toolbar.getByRole("button", { name: "Submissions", exact: true }).click();
    const history = page.getByRole("dialog", { name: "Submission history" });
    const table = history.getByRole("table", { name: "Submission history" });
    await expect(table).toBeVisible();
    // The two submissions they consolidate: not theirs, and nothing to click into "not available to you".
    await expect(table.getByRole("row")).toHaveCount(3);
    await expect(history).not.toContainText("(you)");
    await expect(history).not.toContainText(", you");
    await expect(table.getByRole("link")).toHaveCount(0);
    await expect(history).toContainText("Submitted results for this text version: your own and the submissions you consolidate.");
    await expect(history.getByText(/^Your submitted results/)).toHaveCount(0);
  });
});

// Issue 470, point 2: 20 annotators; the fixture hides their names, so the table and the line show letters only.
for (const [viewport, label] of [[WIDE, "1440 px"], [PHONE, "390 px"]] as const) {
  test.describe(`20 annotators at ${label}`, () => {
    test.use({ viewport });

    test("a line under each row to decide says who holds which value and stays in view when the table scrolls sideways", async ({ page }) => {
      const s = await scenario(page, { people: "20", blind: "true" });
      await openTask(page, s, s.users.adj);
      const scroll = expanded(page).locator(".cons-compare-scroll");
      const split = (field: string) => expanded(page).locator(`tr.cons-row--conflict:has(th:text-is("${field}")) + tr.cons-row-split .cons-pin`);
      // ann-0003 and every third person after them chose the parent term on "hypotonia"; ann-0002 and every third after them say absent.
      await expect(split("Term")).toHaveText("Hypotonia 14 · Abnormality of the nervous system 6 (C, F, I, L, O, R)");
      await expect(split("Assertion")).toHaveText("Present 13 · Absent 7 (B, E, H, K, N, Q, T)");
      const parent = expanded(page).locator("tr.cons-row-hint.cons-row-hint .cons-pin").filter({ hasText: "is a parent term of" });
      await expect(parent).toHaveText("Abnormality of the nervous system is a parent term of Hypotonia.");
      const sizes = await scroll.evaluate(element => ({ scroll: element.scrollWidth, client: element.clientWidth }));
      expect(sizes.scroll, "20 columns do not fit").toBeGreaterThan(sizes.client * 2);
      // Blinding: letters, never a name or pseudonym of an annotator.
      const table = await scroll.innerText();
      for (const name of Object.keys(s.pseudonyms).filter(name => name.startsWith("ann-"))) {
        expect(table).not.toContain(s.pseudonyms[name]);
        expect(table).not.toContain(s.users[name]);
      }
      const agreed = expanded(page).locator("tr.cons-row--agreed", { has: page.locator('th:text-is("Experiencer")') }).locator("td:visible").first();
      for (const position of ["middle", "end"] as const) {
        await scroll.evaluate((element, where) => { element.scrollLeft = where === "end" ? element.scrollWidth : element.scrollWidth / 2; }, position);
        await expect.poll(async () => await scroll.evaluate(element => element.scrollLeft)).toBeGreaterThan(sizes.client);
        // Sideways only: on a phone the open group is taller than the screen.
        for (const line of [split("Term"), split("Assertion"), parent]) await expectInside(line, scroll);
        // The row labels stay as before, and an agreed row is never empty: its value is in view.
        await expectInside(expanded(page).getByRole("rowheader", { name: "Experiencer", exact: true }), scroll);
        if (viewport.width < 700) {
          const value = agreed.locator(".cons-pin");
          await expect(value).toHaveText("Patient (all agree)");
          await expectInside(value, scroll);
          const header = await expanded(page).getByRole("rowheader", { name: "Experiencer", exact: true }).boundingBox();
          expect((await value.boundingBox())!.x, "the value starts after the row label").toBeGreaterThanOrEqual(header!.x + header!.width - 1);
        } else {
          await expect(agreed).toContainText("Patient");
        }
      }
      // No sideways scroll of the page itself.
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    });
  });
}

for (const [viewport, label] of [[WIDE, "1440 px"], [PHONE, "390 px"]] as const) {
  test.describe(`an added finding at ${label}`, () => {
    test.use({ viewport });

    test("Add finding by a typed passage, then Remove takes it out again after a confirmation", async ({ page }) => {
      const s = await scenario(page);
      await openTask(page, s, s.users.lead);
      if (viewport.width < 700) {
        // A phone has no text pane; the hint says how to add.
        await expect(page.getByRole("region", { name: "Clinical text" })).toHaveCount(0);
        await expect(page.getByText("Type the passage to add a finding everyone missed.", { exact: true })).toBeVisible();
      }
      await page.getByRole("button", { name: "Add finding", exact: true }).click();
      const form = page.getByRole("dialog", { name: "Add finding" });
      await form.getByLabel("Passage from the text").fill("last week");
      await form.getByRole("button", { name: "Continue", exact: true }).click();
      const picker = page.getByRole("dialog", { name: "Add finding" });
      await picker.getByRole("combobox").fill("Seizure");
      const added = commandSaved(page);
      await picker.getByRole("option", { name: /Seizure/ }).first().click();
      expect((await added).ok()).toBeTruthy();
      const list = page.getByRole("region", { name: "Added findings" });
      await expect(list.getByRole("heading", { name: "Added by you", exact: true })).toBeVisible();
      await expect(list).toContainText("“last week”");
      // The values open right after adding; close them to reach the two actions.
      await list.getByRole("group", { name: /^Values of / }).getByRole("button", { name: "Cancel", exact: true }).click();
      await expect(list.getByRole("button", { name: /^Edit values, / })).toBeVisible();
      await list.getByRole("button", { name: /^Remove, / }).click();
      const confirm = list.getByRole("group", { name: "Remove this finding?" });
      await expect(confirm).toContainText("“last week”. You added it; it is in no group.");
      await confirm.getByRole("button", { name: "Cancel", exact: true }).click();
      await expect(list).toContainText("“last week”");
      await list.getByRole("button", { name: /^Remove, / }).click();
      const removed = commandSaved(page);
      await confirm.getByRole("button", { name: "Remove", exact: true }).click();
      const response = await removed;
      expect(response.ok(), await response.text()).toBeTruthy();
      expect((response.request().postDataJSON() as { payload: Record<string, unknown> }).payload).toMatchObject({ command: "delete_draft_annotation" });
      await expect(page.getByRole("region", { name: "Added findings" })).toHaveCount(0);
      await expect(toast(page).locator(".ui-toast-message")).toHaveText(/^Finding removed: /);
      // Gone on the server too; the groups are untouched.
      await page.reload();
      await expect(expandedTitle(page)).toHaveText("muscular hypotonia", { timeout: 30_000 });
      await expect(page.getByRole("region", { name: "Added findings" })).toHaveCount(0);
      await expect(progress(page)).toContainText("4 of 8 groups open");
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    });
  });
}
