/**
 * Findings of the user review, annotator screens and My tasks:
 * - "Continue from this submission" while the text is being consolidated: the task owner is told when the
 *   dialog opens, in their words; a refusal that still comes from the server is in view and focused on a phone;
 *   a task from proposals gives its reason.
 * - My tasks on a phone: text, task, status with its reason and the action are readable without sideways
 *   scrolling, for annotation, consolidation and translation review rows with long names.
 * - "Copy text" and Ctrl/Cmd+C copy the passage of a selected tool proposal, as they do for a finding.
 *
 * Every test builds its own project. With REVIEW_ANNOTATOR_SHOTS=<directory> the states are saved as screenshots.
 */
import { expect, test, type Locator, type Page } from "@playwright/test";
import { loginExisting, moreAction } from "./helpers";
import { loginScenarioUser as loginCheckUser, proposalCheckScenario } from "./proposalCheckHelpers";
import { loginScenarioUser, reviewFlowScenario } from "./reviewFlowHelpers";

test.setTimeout(240_000);
test.use({ actionTimeout: 15_000 });

const DESKTOP = { width: 1440, height: 900 } as const;
const PHONE = { width: 390, height: 844 } as const;
const SMALL_PHONE = { width: 375, height: 667 } as const;
type Size = { width: number; height: number };

const shots = process.env.REVIEW_ANNOTATOR_SHOTS;
async function shot(page: Page, name: string): Promise<void> {
  if (shots) await page.screenshot({ path: `${shots}/${name}.png` });
}

/** Console errors of the page; `allowed` names the refusals a test provokes on purpose. */
function consoleErrors(page: Page, allowed: RegExp[] = []): string[] {
  const errors: string[] = [];
  const keep = (text: string) => { if (!allowed.some(pattern => pattern.test(text))) errors.push(text); };
  page.on("console", message => { if (message.type() === "error") keep(message.text()); });
  page.on("pageerror", error => keep(error.message));
  return errors;
}
const noSidewaysScroll = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);

/** True when the element's centre is inside the window and the element itself (or a descendant) is on top there. */
const onTop = (locator: Locator) => locator.evaluate(element => {
  const box = element.getBoundingClientRect();
  const x = box.left + box.width / 2, y = box.top + box.height / 2;
  if (x < 0 || y < 0 || x > window.innerWidth || y > window.innerHeight) return false;
  const top = document.elementFromPoint(x, y);
  return !!top && (top === element || element.contains(top));
});

const CONSOLIDATED = "Your submission is being consolidated, so you cannot continue from it now. Ask your project lead.";
const FROM_PROPOSALS = "In a task from tool proposals you cannot continue from a submission yourself. Ask your project lead to start a new round.";
const LEAD_WORDING = "finish or withdraw";

interface ConsolidationScenario { users: Record<string, string>; pseudonyms: Record<string, string> }

/** A text whose consolidation is open; returns the username of one of its two annotators. */
async function consolidatedAnnotator(page: Page): Promise<string> {
  const response = await page.request.post("/__test_consolidation__", { params: { started: "true" }, timeout: 120_000 });
  expect(response.ok(), await response.text()).toBeTruthy();
  const scenario = await response.json() as ConsolidationScenario;
  return scenario.users["ann-0002"];
}

async function openWorkRounds(page: Page): Promise<Locator> {
  await page.getByRole("link", { name: "View", exact: true }).first().click();
  await expect(page.locator(".text-container")).toBeVisible();
  await moreAction(page, "Work rounds");
  const dialog = page.getByRole("dialog", { name: /^Work rounds/ });
  await expect(dialog.getByRole("heading", { name: "Start a new round", exact: true })).toBeVisible();
  return dialog;
}

for (const [name, size] of [["1440", DESKTOP], ["390", PHONE], ["375x667", SMALL_PHONE]] as [string, Size][]) {
  test(`${name}: a submission being consolidated says so when Work rounds opens, with no button to try`, async ({ page }) => {
    const errors = consoleErrors(page);
    await page.setViewportSize(size);
    await loginExisting(page, await consolidatedAnnotator(page));
    const dialog = await openWorkRounds(page);
    const reason = dialog.getByText(CONSOLIDATED, { exact: true });
    await reason.scrollIntoViewIfNeeded();
    expect(await onTop(reason)).toBe(true);
    await expect(dialog.getByRole("radio")).toHaveCount(0);
    await expect(dialog.getByRole("button", { name: "Continue from this submission", exact: true })).toHaveCount(0);
    await expect(dialog.getByRole("button", { name: "Reload task state", exact: true })).toHaveCount(0);
    await expect(dialog).not.toContainText(LEAD_WORDING);
    // Blinding: the reason names nobody.
    await expect(dialog).not.toContainText(/ann-\d{4}/);
    expect(await noSidewaysScroll(page)).toBe(true);
    await shot(page, `continue-consolidated-${name}`);
    expect(errors).toEqual([]);
  });

  test(`${name}: a refusal that still comes from the server is in view and focused`, async ({ page }) => {
    const errors = consoleErrors(page, [/409/]);
    await page.setViewportSize(size);
    await loginExisting(page, await consolidatedAnnotator(page));
    // The consolidation opened after the dialog loaded: the sources still offered the submission.
    await page.route("**/api/v1/assignments/*/round-sources", async route => {
      const response = await route.fetch();
      const sources = await response.json() as Record<string, unknown>[];
      await route.fulfill({ response, json: sources.map(source => ({ ...source, refused_by: null })) });
    });
    const dialog = await openWorkRounds(page);
    await dialog.getByRole("radio").first().check();
    await shot(page, `continue-offered-${name}`);
    await dialog.getByRole("button", { name: "Continue from this submission", exact: true }).click();
    const refusal = dialog.getByRole("alert");
    await expect(refusal).toHaveText(CONSOLIDATED);
    await expect.poll(() => onTop(refusal)).toBe(true);
    await expect(refusal.locator("xpath=..")).toBeFocused();
    await expect(dialog).not.toContainText(LEAD_WORDING);
    await expect(dialog.getByRole("button", { name: "Continue from this submission", exact: true })).toHaveCount(0);
    await expect(dialog.getByRole("button", { name: "Reload task state", exact: true })).toHaveCount(0);
    expect(await noSidewaysScroll(page)).toBe(true);
    await shot(page, `continue-refused-${name}`);
    expect(errors).toEqual([]);
  });
}

for (const [name, size] of [["1440", DESKTOP], ["390", PHONE]] as [string, Size][]) {
  test(`${name}: a submitted task from proposals says why no submission can be continued`, async ({ page }) => {
    const errors = consoleErrors(page);
    await page.setViewportSize(size);
    const scenario = await proposalCheckScenario(page, "CHECKED");
    await loginCheckUser(page, scenario, "tom");
    const dialog = await openWorkRounds(page);
    const reason = dialog.getByText(FROM_PROPOSALS, { exact: true });
    await reason.scrollIntoViewIfNeeded();
    expect(await onTop(reason)).toBe(true);
    await expect(dialog).not.toContainText("No submission can be continued right now.");
    await expect(dialog.getByRole("button", { name: "Reload task state", exact: true })).toHaveCount(0);
    expect(await noSidewaysScroll(page)).toBe(true);
    await shot(page, `continue-proposals-${name}`);
    expect(errors).toEqual([]);
  });
}

const LONG_HOLD = "The source text names two different doses of valproate in the second paragraph; the lead is checking the original discharge letter before anybody continues.";
const REOPEN_REASON = "Guideline changed: code seizure types separately and check the temporality of every finding again.";
const CONSOLIDATION_REASON = "The two annotators disagree on the assertion of three findings.";

/** One row per kind of task and state a person meets on My tasks, built on a real task of the logged-in user. */
function everyKindOfRow(real: Record<string, unknown>): Record<string, unknown>[] {
  const base = { ...real, status: "open", held: false, hold_reason: null, reopened_at: null, reopen_reason: null, consolidation_reason: null,
    report_answered: false, answered_report_id: null, waiting_for_translation_review: false, waiting_for_lead: false, failed_check_count: null };
  const row = (id: number, caseId: string, changes: Record<string, unknown>) => ({ ...base, assignment_id: 9000 + id, case_id: caseId, ...changes });
  return [
    row(1, "university-hospital-epilepsy-cohort-2024-discharge-letter-000123", { status: "in_progress", annotation_mode: "scratch" }),
    row(2, "case-0102", { status: "in_progress", annotation_mode: "proposals", held: true, hold_reason: LONG_HOLD }),
    row(3, "case-0103", { status: "reopened", reopened_at: "2026-11-17T13:43:00Z", reopen_reason: REOPEN_REASON }),
    row(4, "case-0104", { task: "review", annotation_mode: null, consolidation_reason: CONSOLIDATION_REASON }),
    row(5, "case-0105", { task: "translation_review", annotation_mode: null, language: "de", source_language: "en", target_language: "de", status: "in_progress", failed_check_count: 2, version: 2, origin: "correction" }),
    row(6, "case-0106", { task: "translation_review", annotation_mode: null, language: "de", source_language: "en", target_language: "de", waiting_for_lead: true }),
    row(7, "case-0107", { language: "de", waiting_for_translation_review: true }),
    row(8, "case-0108", { status: "submitted", report_answered: true }),
  ];
}

const taskRows = (page: Page) => page.getByTestId("task-row");

async function openMyTasks(page: Page, size: Size): Promise<void> {
  await page.setViewportSize(size);
  const scenario = await reviewFlowScenario(page, "ANNOTATION_LOOP");
  await page.route("**/api/v1/me/tasks", async route => {
    const response = await route.fetch();
    const real = await response.json() as Record<string, unknown>[];
    await route.fulfill({ response, json: [...real, ...everyKindOfRow(real[0])] });
  });
  await loginScenarioUser(page, scenario, "annotator");
  await expect(taskRows(page)).toHaveCount(11);
}

for (const [name, size] of [["390", PHONE], ["375", { width: 375, height: 667 }]] as [string, Size][]) {
  test(`${name}: My tasks shows text, task, status with its reason and the action without sideways scrolling`, async ({ page }) => {
    const errors = consoleErrors(page);
    await openMyTasks(page, size);
    const table = page.getByRole("table", { name: "My tasks", exact: true });
    await expect(table.getByRole("columnheader")).toHaveText(["Task", "Action"]);
    // Neither the page nor the table scrolls sideways.
    expect(await noSidewaysScroll(page)).toBe(true);
    expect(await table.evaluate(element => element.scrollWidth <= element.parentElement!.clientWidth)).toBe(true);

    /** Every given text of the row is inside the window and not covered. */
    const readable = async (row: Locator, texts: string[]) => {
      await row.scrollIntoViewIfNeeded();
      for (const text of texts) {
        const part = row.getByText(text, { exact: true }).first();
        await expect(part).toBeVisible();
        expect(await part.evaluate(element => { const box = element.getBoundingClientRect(); return box.left >= 0 && box.right <= window.innerWidth; }), text).toBe(true);
        expect(await onTop(part), text).toBe(true);
      }
    };
    const row = (caseId: string) => taskRows(page).filter({ hasText: caseId });
    // A real task of the scenario: open, from scratch.
    await readable(taskRows(page).first(), ["Annotation, from scratch", "Open", "Start"]);
    await readable(row("discharge-letter-000123"), ["Annotation, from scratch", "In progress", "Continue"]);
    await readable(row("case-0102"), ["Annotation, from proposals", "In progress", "Paused", LONG_HOLD, "View paused task"]);
    await readable(row("case-0103"), ["Reopened", "Continue"]);
    await expect(row("case-0103")).toContainText(`Reason: ${REOPEN_REASON}`);
    await readable(row("case-0104"), [`Reason from the lead: ${CONSOLIDATION_REASON}`, "Open", "Start"]);
    await expect(row("case-0104").locator(".task-stack__task")).toContainText("Consolidation");
    await readable(row("case-0105"), ["In progress", "Continue"]);
    await expect(row("case-0105").locator(".task-stack__task")).toContainText("Translation review (en to de)");
    await expect(row("case-0105")).toContainText("case-0105 de v2 corrected");
    await expect(row("case-0105")).toContainText("2 automatic checks failed");
    await readable(row("case-0106"), ["Waiting for the project lead", "The lead decides how it continues"]);
    await readable(row("case-0107"), ["Waiting for translation review", "Opens once a translation is accepted"]);
    await readable(row("case-0108"), ["Submitted", "Answer to your report", "View"]);
    // The reopen reason is written out: no popover to find on a phone.
    await expect(page.getByRole("button", { name: "Reopened, why", exact: true })).toHaveCount(0);

    // The whole list in one picture: the same width, a window tall enough for every row.
    await page.setViewportSize({ width: size.width, height: 2000 });
    await shot(page, `my-tasks-${name}`);
    expect(errors).toEqual([]);
  });
}

test("1440: My tasks keeps its columns, and Reopened opens its reason", async ({ page }) => {
  const errors = consoleErrors(page);
  await openMyTasks(page, DESKTOP);
  const table = page.getByRole("table", { name: "My tasks", exact: true });
  await expect(table.getByRole("columnheader")).toHaveText(["Text", "Project", "Task", "Status", "Assigned", "Last change", "Action"]);
  await page.getByRole("button", { name: "Reopened, why", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "Why reopened", exact: true })).toContainText(`Reason: ${REOPEN_REASON}`);
  await page.keyboard.press("Escape");
  expect(await noSidewaysScroll(page)).toBe(true);
  await shot(page, "my-tasks-1440");
  expect(errors).toEqual([]);
});

for (const [name, size] of [["1440", DESKTOP], ["390", PHONE]] as [string, Size][]) {
  test(`${name}: "Copy text" and the copy shortcut copy the passage of a selected tool proposal`, async ({ page, browserName }) => {
    test.skip(browserName !== "chromium", "The clipboard is read back; the other engines are covered by the unit tests.");
    const errors = consoleErrors(page);
    await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
    await page.setViewportSize(size);
    const scenario = await proposalCheckScenario(page, "ONE_ASSIGNED");
    await loginCheckUser(page, scenario, "tom");
    await page.goto(`/#/tasks/${scenario.assignments.tom}`);
    await expect(page.locator(".text-container")).toBeVisible();
    const clipboard = () => page.evaluate(() => navigator.clipboard.readText());
    const reset = () => page.evaluate(() => navigator.clipboard.writeText("-"));
    const views = page.getByRole("navigation", { name: "Select view" });
    const phone = size.width < 700;

    if (phone) await views.getByRole("button", { name: /^Findings/ }).click();
    await page.locator('.sidebar [data-list-key^="target:"]').first().click();
    const panel = page.locator(".review-actions__proposal");
    if (phone && !await panel.isVisible()) await views.getByRole("button", { name: "Details", exact: true }).click();
    const quote = panel.locator(".review-actions__quote").first();
    const button = quote.getByRole("button", { name: /^(Copy text|Copied)$/ });
    await button.scrollIntoViewIfNeeded();
    expect(await onTop(button)).toBe(true);
    // The quoted passage itself, without the button's label.
    const passage = (await quote.evaluate(element => element.firstChild?.textContent ?? "")).trim();
    expect(passage.length).toBeGreaterThan(2);
    expect(await page.locator(".text-container").innerText()).toContain(passage);

    await reset();
    await button.click();
    await expect.poll(clipboard).toBe(passage);
    await expect(button).toHaveAccessibleName("Copied");
    await shot(page, `proposal-copy-${name}`);
    await expect(button).toHaveAccessibleName("Copy text", { timeout: 4000 });

    // The shortcut, with nothing else selected.
    await reset();
    await page.keyboard.press("ControlOrMeta+c");
    await expect.poll(clipboard).toBe(passage);

    // A field with its own selection copies that selection.
    const note = page.getByRole("textbox", { name: "Reviewer note", exact: true });
    await note.fill("my own words");
    await note.selectText();
    await page.keyboard.press("ControlOrMeta+c");
    await expect.poll(clipboard).toBe("my own words");
    await note.fill("");
    expect(await noSidewaysScroll(page)).toBe(true);
    expect(errors).toEqual([]);
  });
}
