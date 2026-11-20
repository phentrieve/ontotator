/**
 * Lead pause (issue 464): a lead pauses the work on selected texts and releases it. "More actions" in the selection
 * bar: "Pause texts…" with its preview, the reason and the consequences step; the paused texts on Documents (stage
 * cell, badge, filter) and in the text card (who, when, why); the annotator's My tasks ("Paused by lead") and a save
 * that is refused while the editor is open, with the typed finding kept; a task assigned on a paused text, paused from
 * the start; "Release texts…"; and the two causes, a problem report and the lead, each released on its own. With
 * SHOTS_DIR set, the states are also saved as screenshots (desktop and phone).
 *
 * Builds a fresh project through ``POST /__test_documents__`` (scenario S464).
 */
import { expect, test, type Browser, type Locator, type Page } from "@playwright/test";
import { cellUnder, documentsReady, documentsScenario, openFilters, openTextCard, personRow, rowBox, showSegment, STAGE_HEADERS, textCard, textRow, type DocumentsScenario } from "./documentsHelpers";
import { loginExisting, selectText } from "./helpers";

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
/** Select the texts by their checkboxes; the bar shows the count. */
async function selectTexts(page: Page, cases: readonly string[]): Promise<void> {
  for (const caseId of cases) await rowBox(page, caseId, "en").check();
  await expect(selectionBar(page)).toContainText(`${cases.length} ${cases.length === 1 ? "text" : "texts"} in`);
}
async function openMenu(page: Page): Promise<Locator> {
  await selectionBar(page).getByRole("button", { name: "More actions" }).click();
  const menu = page.getByRole("menu", { name: "More actions" });
  await expect(menu).toBeVisible();
  return menu;
}
/** Run "Pause texts…" or "Release texts…" on the current selection to the end; returns after the toast. */
async function run(page: Page, action: "Pause" | "Release", texts: number, changed: number, reason?: string): Promise<void> {
  const menu = await openMenu(page);
  await menu.getByRole("menuitem", { name: `${action} texts…` }).click();
  const dialog = page.getByRole("dialog", { name: `${action} texts: ${texts} ${texts === 1 ? "text" : "texts"}` });
  const apply = dialog.getByRole("button", { name: `${action} ${changed} ${changed === 1 ? "text" : "texts"}` });
  await expect(apply).toBeVisible();
  if (reason) await dialog.getByLabel(/^Reason/).fill(reason);
  await apply.click();
  await dialog.getByLabel(/^I understand/).check();
  await apply.click();
  await expect(dialog).toBeHidden();
  await expect(page.locator(".ui-toast")).toContainText(`${action === "Pause" ? "Paused" : "Released"} ${changed} ${changed === 1 ? "text" : "texts"}.`);
}

for (const [width, height, suffix] of [[1440, 900, ""], [390, 844, "-phone"]] as const) {
  const phone = width < 700;
  const size = { width, height };

  test(`a lead pauses texts, the annotator's save is refused, a new task starts paused, the lead releases (${width} px)`, async ({ page, browser }) => {
    const errors: string[] = [];
    watch(page, errors);
    await page.setViewportSize(size);
    const s = await documentsScenario(page, "S464") as Scenario;

    // Tom Reis has EN100022 open in the editor before the pause lands.
    // His search is refused once (409): that is the refusal this test is about.
    const tom = await person(browser, s.users.tom, size, errors, /status of 409 \(Conflict\)/);
    await tom.goto(`/#/tasks/${s.assignments.started}`);
    await expect(tom.locator(".text-container")).toHaveText(`${TEXT} EN100022`);

    await loginExisting(page, s.users.lead);
    await page.goto(`/#/projects/${encodeURIComponent(s.project)}/documents`);
    await documentsReady(page);
    await selectTexts(page, ["EN100022", "EN100023", "EN100024", "EN100025"]);

    // The menu: both entries, "Release texts…" unavailable with its reason.
    const menu = await openMenu(page);
    await expect(menu.getByRole("menuitem")).toHaveText(["Reopen…", "Withdraw open tasks…", /^Accept agreeing results…/, /^Change final…/, /^Start a round…/, /^Change mode…/, "Pause texts…", /^Release texts…/]);
    const releaseEntry = menu.getByRole("menuitem", { name: /^Release texts…/ });
    await expect(releaseEntry).toHaveAttribute("aria-disabled", "true");
    await expect(releaseEntry).toContainText("None of the selected texts is paused by a lead.");
    expect(await noHorizontalScroll(page)).toBe(true);
    await shot(page, `464-menu${suffix}`);

    // The dialog: the preview by consequence, the required reason.
    await menu.getByRole("menuitem", { name: "Pause texts…" }).click();
    const dialog = page.getByRole("dialog", { name: "Pause texts: 4 texts" });
    const groups = dialog.getByRole("list", { name: "Preview" }).getByRole("listitem");
    await expect(groups).toHaveCount(2);
    await expect(groups.nth(0)).toContainText("Pause 2 texts with 3 open tasks · Tom Reis 2, R. Roe 1");
    await expect(groups.nth(1)).toContainText("Pause 2 texts without open tasks · tasks assigned later are paused from the start");
    await expect(dialog.locator(".work-plan-summary")).toHaveText("Will change: the work on 4 texts");
    const apply = dialog.getByRole("button", { name: "Pause 4 texts" });
    await expect(apply).toHaveAttribute("aria-disabled", "true");
    await expect(dialog.getByText("Enter the reason first.")).toBeVisible();
    await dialog.getByLabel(/^Reason/).fill(WHY);
    expect(await noHorizontalScroll(page)).toBe(true);
    await shot(page, `464-pause-dialog${suffix}`);

    // The consequences step.
    await apply.click();
    await expect(dialog.getByText("What happens")).toBeVisible();
    await expect(dialog).toContainText("2 people keep 3 tasks in My tasks, marked “Paused by lead” with your reason.");
    await expect(dialog).toContainText("Submitted work and final results are untouched and are exported as before.");
    await expect(dialog).toContainText(`Reason: ${WHY}`);
    await expect(apply).toHaveAttribute("aria-disabled", "true");
    await dialog.getByLabel("I understand — pause the work on these texts").check();
    await shot(page, `464-pause-consequences${suffix}`);
    await apply.click();
    await expect(dialog).toBeHidden();
    const toast = page.locator(".ui-toast");
    await expect(toast).toContainText("Paused 4 texts.");
    await expect(toast.getByRole("button", { name: "Undo" })).toHaveCount(0);
    await toast.getByRole("button", { name: "Dismiss" }).click();
    await selectionBar(page).getByRole("button", { name: "Clear selection" }).click();

    // Documents: the paused texts carry the badge; work in progress reads "Paused by lead" and is nobody's turn.
    const started = rowOf(page, "EN100022");
    await expect(started.getByText("Paused by lead").first()).toBeVisible();
    if (!phone) {
      await expect(cellUnder(started, STAGE_HEADERS.annotation)).toContainText("1 of 2 submitted");
      await expect(cellUnder(started, STAGE_HEADERS.annotation)).not.toContainText("open:");
      await expect(cellUnder(started, STAGE_HEADERS.waiting)).not.toContainText("Tom Reis");
      // A final result and submitted work stay as they were.
      await expect(cellUnder(rowOf(page, "EN100024"), STAGE_HEADERS.finalization)).toContainText("accepted");
    }
    await expect(rowOf(page, "EN100026").getByText("Paused by lead")).toHaveCount(0);
    expect(await noHorizontalScroll(page)).toBe(true);
    await shot(page, `464-documents-paused${suffix}`);

    // The filter lists the paused texts.
    const filters = await openFilters(page);
    await filters.getByRole("checkbox", { name: /^Paused by lead, 4 texts$/ }).check();
    if (phone) await filters.getByRole("button", { name: "Show 4 texts" }).click();
    await expect(page.getByRole("button", { name: "Remove filter Paused by lead", exact: true })).toBeVisible();
    await expect(page.getByRole("checkbox", { name: "Select all 4 filtered texts" })).toBeVisible();
    await shot(page, `464-documents-filter${suffix}`);
    await page.getByRole("button", { name: "Remove filter Paused by lead", exact: true }).click();
    if (!phone) await page.keyboard.press("Escape");

    // The text card says who paused when and why.
    const card = await openCard(page, "EN100022");
    const banner = card.getByRole("group", { name: "Paused by lead" });
    await expect(banner).toContainText(new RegExp(`^Paused by leadyou, .+: ${WHY}`));
    await expect(banner.getByRole("button", { name: "Release…, EN100022 en" })).toBeVisible();
    await showSegment(card, "Annotation");
    await expect(personRow(card, "Annotators", "Tom Reis")).toContainText("Paused by lead");
    await expect(personRow(card, "Annotators", "R. Roe")).not.toContainText("Paused");
    expect(await noHorizontalScroll(page)).toBe(true);
    await shot(page, `464-text-card${suffix}`);
    await page.keyboard.press("Escape");
    await expect(card).toBeHidden();

    // Tom Reis, with the editor open since before the pause: the next save is refused with the lead's reason, the
    // finding he chose stays in his editor, and the banner names the cause.
    if (phone) await tom.getByRole("navigation", { name: "Select view" }).getByRole("button", { name: "Document" }).click();
    const word = TEXT.indexOf("seizures");
    await selectText(tom, word, word + "seizures".length);
    if (phone) await tom.getByRole("group", { name: "New finding", exact: true }).getByRole("button", { name: "Choose term", exact: true }).click();
    await tom.getByLabel("Search term", { exact: true }).fill("HP:0001250");
    // The search is the first thing the server refuses: the banner names the cause; the marked passage stays.
    await expect(tom.locator(".paused-notice").getByText(`Paused by lead: ${WHY}`)).toBeVisible();
    await expect(tom.getByRole("heading", { name: "New finding" })).toBeVisible();
    await tom.getByRole("button", { name: "Show more" }).click();
    await expect(tom.getByText("Your local input is kept.", { exact: false })).toBeVisible();
    expect(await noHorizontalScroll(tom)).toBe(true);
    await shot(tom, `464-refused-save${suffix}`);

    // My tasks: the task stays, marked "Paused by lead" with the reason, and opens read-only.
    await tom.goto("/#/?status=all");
    const leaving = tom.getByRole("dialog", { name: "Paused task has local input" });
    if (await leaving.isVisible().catch(() => false)) await leaving.getByRole("button", { name: "Discard local input and leave" }).click();
    const task = tom.getByTestId("task-row").filter({ hasText: "EN100022" });
    await expect(task).toContainText("Paused by lead");
    await expect(task).toContainText(WHY);
    await expect(task.getByRole("link", { name: "View paused task" })).toBeVisible();
    await expect(tom.getByTestId("task-row").filter({ hasText: "EN100023" })).toContainText("Paused by lead");
    await expect(tom.getByTestId("task-row").filter({ hasText: "EN100024" })).not.toContainText("Paused");
    expect(await noHorizontalScroll(tom)).toBe(true);
    await shot(tom, `464-my-tasks${suffix}`);
    await task.getByRole("link", { name: "View paused task" }).click();
    await expect(tom.locator(".text-container")).toHaveText(`${TEXT} EN100022`);
    await expect(tom.getByText(`Paused by lead: ${WHY}`)).toBeVisible();
    await shot(tom, `464-paused-editor${suffix}`);

    // Assigning on a paused text stays possible; the dialog says the task starts paused.
    const paused = await openCard(page, "EN100025");
    await showSegment(paused, "Annotation");
    await paused.getByRole("button", { name: /^Assign annotat/ }).first().click();
    const assign = page.getByRole("dialog", { name: /^Assign/ }).last();
    await expect(assign).toContainText("This text is paused by a lead. A task assigned now is paused from the start (“Paused by lead” in My tasks) until you release the text.");
    await assign.getByRole("checkbox", { name: /Ana Weber/ }).check();
    expect(await noHorizontalScroll(page)).toBe(true);
    await shot(page, `464-assign-on-paused${suffix}`);
    await assign.getByRole("button", { name: /^Assign 1/ }).click();
    await expect(assign).toBeHidden();
    await expect(personRow(paused, "Annotators", "Ana Weber")).toContainText("Paused by lead");
    await shot(page, `464-assigned-paused${suffix}`);
    await page.keyboard.press("Escape");
    const ana = await person(browser, s.users.ana, size, errors);
    await ana.goto("/#/?status=all");
    const fresh = ana.getByTestId("task-row").filter({ hasText: "EN100025" });
    await expect(fresh).toContainText("Paused by lead");
    await expect(fresh).toContainText(WHY);
    await shot(ana, `464-my-tasks-new-task${suffix}`);

    // Release: all four texts; the work opens again.
    await selectTexts(page, ["EN100022", "EN100023", "EN100024", "EN100025"]);
    const again = await openMenu(page);
    const pauseEntry = again.getByRole("menuitem", { name: /^Pause texts…/ });
    await expect(pauseEntry).toHaveAttribute("aria-disabled", "true");
    await expect(pauseEntry).toContainText("The selected texts are already paused.");
    await again.getByRole("menuitem", { name: "Release texts…" }).click();
    const release = page.getByRole("dialog", { name: "Release texts: 4 texts" });
    await expect(release.getByRole("list", { name: "Preview" }).getByRole("listitem").first()).toContainText("Release 3 texts with 4 open tasks");
    await expect(release.getByLabel("Reason (optional)")).toBeVisible();
    expect(await noHorizontalScroll(page)).toBe(true);
    await shot(page, `464-release-dialog${suffix}`);
    await release.getByRole("button", { name: "Release 4 texts" }).click();
    await release.getByLabel("I understand").check();
    await shot(page, `464-release-consequences${suffix}`);
    await release.getByRole("button", { name: "Release 4 texts" }).click();
    await expect(release).toBeHidden();
    await expect(page.locator(".ui-toast")).toContainText("Released 4 texts.");
    await expect(rowOf(page, "EN100022").getByText("Paused by lead")).toHaveCount(0);
    await shot(page, `464-documents-released${suffix}`);
    await ana.reload();
    await expect(ana.getByTestId("task-row").filter({ hasText: "EN100025" })).not.toContainText("Paused");
    await tom.reload();
    await expect(tom.locator(".text-container")).toHaveText(`${TEXT} EN100022`);
    await expect(tom.getByText(/^Paused by lead: /)).toHaveCount(0);

    await tom.context().close();
    await ana.context().close();
    expect(errors).toEqual([]);
  });

  test(`a problem report and a lead pause are released each on its own (${width} px)`, async ({ page, browser }) => {
    const errors: string[] = [];
    watch(page, errors);
    await page.setViewportSize(size);
    const s = await documentsScenario(page, "S464") as Scenario;
    const roe = await person(browser, s.users.roe, size, errors);
    const task = () => roe.getByTestId("task-row").filter({ hasText: "EN100026" });
    await roe.goto("/#/?status=all");
    // Paused by the report only.
    await expect(task()).toContainText("Paused");
    await expect(task()).not.toContainText("Paused by lead");

    await loginExisting(page, s.users.lead);
    await page.goto(`/#/projects/${encodeURIComponent(s.project)}/documents`);
    await documentsReady(page);
    await selectTexts(page, ["EN100026"]);
    await run(page, "Pause", 1, 1, WHY);

    // Both causes, each with its reason.
    await roe.reload();
    await expect(task()).toContainText("The last sentence of the text is cut off.");
    await expect(task()).toContainText("Paused by lead");
    await expect(task()).toContainText(WHY);
    expect(await noHorizontalScroll(roe)).toBe(true);
    await shot(roe, `464-two-causes-my-tasks${suffix}`);
    await task().getByRole("link", { name: "View paused task" }).click();
    await expect(roe.getByText(`Paused by a problem report and by lead: The last sentence of the text is cut off. · Lead: ${WHY}`)).toBeVisible();
    await shot(roe, `464-two-causes-editor${suffix}`);

    // The lead decides the report (resume): the lead pause stays and is the cause named.
    await page.goto(`/#/projects/${encodeURIComponent(s.project)}/problem-reports/${encodeURIComponent(s.report_id)}`);
    const decide = page.getByRole("group", { name: "Decide on this report", exact: true });
    await decide.getByRole("button", { name: /^Close and resume / }).click();
    await expect(page.locator(".lead-outcome")).toContainText("The text is paused by a lead: its open tasks stay paused until the text is released");
    await expect(page.getByText("Paused by lead", { exact: true })).toBeVisible();
    await shot(page, `464-report-resumed${suffix}`);
    await roe.goto("/#/?status=all");
    await expect(task()).toContainText("Paused by lead");
    await expect(task()).not.toContainText("The last sentence of the text is cut off.");
    await shot(roe, `464-lead-cause-remains${suffix}`);

    // The release preview no longer names a report; after it the task opens.
    await page.goto(`/#/projects/${encodeURIComponent(s.project)}/documents`);
    await documentsReady(page);
    await selectTexts(page, ["EN100026"]);
    await run(page, "Release", 1, 1);
    await roe.reload();
    await expect(task()).not.toContainText("Paused");
    await expect(task().getByRole("link", { name: /^(Continue|Start|Open)/ })).toBeVisible();
    await shot(roe, `464-both-released${suffix}`);

    await roe.context().close();
    expect(errors).toEqual([]);
  });

  test(`releasing the text first leaves the task paused by the report (${width} px)`, async ({ page, browser }) => {
    const errors: string[] = [];
    watch(page, errors);
    await page.setViewportSize(size);
    const s = await documentsScenario(page, "S464") as Scenario;
    const roe = await person(browser, s.users.roe, size, errors);
    await loginExisting(page, s.users.lead);
    await page.goto(`/#/projects/${encodeURIComponent(s.project)}/documents`);
    await documentsReady(page);
    await selectTexts(page, ["EN100026"]);
    await run(page, "Pause", 1, 1, WHY);
    await page.locator(".ui-toast").getByRole("button", { name: "Dismiss" }).click();
    // Both causes show on Documents: the text's badge, and the report as the lead's next step.
    await expect(rowOf(page, "EN100026").getByText("Paused by lead")).toBeVisible();
    await expect(page.getByRole("button", { name: /^Decide on report…, EN100026/ })).toBeVisible();
    await shot(page, `464-documents-two-causes${suffix}`);

    // The release names the task the report still pauses.
    const menu = await openMenu(page);
    await menu.getByRole("menuitem", { name: "Release texts…" }).click();
    const release = page.getByRole("dialog", { name: "Release texts: 1 text" });
    const groups = release.getByRole("list", { name: "Preview" }).getByRole("listitem");
    await expect(groups.nth(1)).toContainText("1 task stays paused · paused by a problem report as well: decide the report under Problem reports");
    expect(await noHorizontalScroll(page)).toBe(true);
    await shot(page, `464-release-still-paused${suffix}`);
    await release.getByRole("button", { name: "Release 1 text" }).click();
    await expect(release).toContainText("1 task stays paused by a problem report until that report is decided.");
    await release.getByLabel("I understand").check();
    await release.getByRole("button", { name: "Release 1 text" }).click();
    await expect(release).toBeHidden();

    await roe.goto("/#/?status=all");
    const task = roe.getByTestId("task-row").filter({ hasText: "EN100026" });
    await expect(task).toContainText("Paused");
    await expect(task).toContainText("The last sentence of the text is cut off.");
    await expect(task).not.toContainText("Paused by lead");
    await shot(roe, `464-report-cause-remains${suffix}`);
    // Documents: the text is no longer paused by the lead; the report still waits for the lead.
    await expect(rowOf(page, "EN100026").getByText("Paused by lead")).toHaveCount(0);
    await shot(page, `464-documents-report-remains${suffix}`);

    await roe.context().close();
    expect(errors).toEqual([]);
  });
  test(`a paused consolidation is read-only and names the pause: by the lead, then by a problem report (${width} px)`, async ({ page, browser }) => {
    const errors: string[] = [];
    watch(page, errors);
    await page.setViewportSize(size);
    const s = await documentsScenario(page, "S464") as Scenario;
    // Kim Lang has the consolidation open before the pause lands; one refused decision is what this test is about.
    const kim = await person(browser, s.users.kim, size, errors, /status of 409 \(Conflict\)/);
    const task = `/#/tasks/${s.assignments.consolidation}`;
    await kim.goto(task);
    const keep = kim.getByRole("button", { name: /^Keep .+'s finding$/ });
    const add = kim.getByRole("button", { name: /^Add finding/ });
    await expect(kim.getByRole("heading", { level: 1, name: /^Consolidate EN100028/ })).toBeVisible();
    await expect(keep.first()).toBeVisible();

    await loginExisting(page, s.users.lead);
    await page.goto(`/#/projects/${encodeURIComponent(s.project)}/documents`);
    await documentsReady(page);
    await selectTexts(page, ["EN100028"]);
    await run(page, "Pause", 1, 1, WHY);
    await expect(rowOf(page, "EN100028").getByText("Paused by lead").first()).toBeVisible();

    // The decision is refused; the screen names the pause (not "changed elsewhere") and turns read-only.
    await keep.first().click();
    await expect(kim.getByText(`Paused by lead: ${WHY}`)).toBeVisible();
    await expect(kim.getByText(/changed elsewhere/)).toHaveCount(0);
    await expect(keep).toHaveCount(0);
    await expect(add).toHaveCount(0);
    await expect(kim.getByRole("button", { name: /^Submit/ })).toHaveCount(0);
    await kim.getByRole("button", { name: "Show more" }).click();
    await expect(kim.getByText("It opens again when the project lead releases the text.", { exact: false })).toBeVisible();
    expect(await noHorizontalScroll(kim)).toBe(true);
    await shot(kim, `464-consolidation-paused-by-lead${suffix}`);
    // Opened again, and in the full editor: the same banner, read-only.
    await kim.reload();
    await expect(kim.getByText(`Paused by lead: ${WHY}`)).toBeVisible();
    await expect(keep).toHaveCount(0);
    await kim.goto(`${task}?view=editor`);
    await expect(kim.getByText(`Paused by lead: ${WHY}`)).toBeVisible();
    await expect(kim.getByRole("button", { name: /^Finish & submit/ })).toHaveCount(0);
    await shot(kim, `464-consolidation-editor-paused-by-lead${suffix}`);

    await page.locator(".ui-toast").getByRole("button", { name: "Dismiss" }).click();
    await run(page, "Release", 1, 1);
    await kim.goto(task);
    await expect(keep.first()).toBeVisible();
    await expect(kim.getByText(/^Paused by lead: /)).toHaveCount(0);

    // A problem report pauses the consolidation as well: the banner says so and how to continue.
    await kim.getByRole("button", { name: /^Report a text problem/ }).click();
    const form = kim.getByRole("dialog", { name: "New problem report", exact: true });
    await form.getByRole("textbox", { name: /What is the problem\?/ }).fill("Two findings name the same passage.");
    await form.getByRole("button", { name: "Report and pause my task", exact: true }).click();
    const reports = kim.getByRole("dialog").filter({ hasText: "Your reports" });
    await expect(reports).toContainText("Your task: Paused");
    await reports.locator(".modal-actions").getByRole("button", { name: "Close", exact: true }).click();
    await expect(kim.getByText("Task paused: Two findings name the same passage.")).toBeVisible();
    await expect(keep).toHaveCount(0);
    await expect(add).toHaveCount(0);
    await kim.getByRole("button", { name: "Show more" }).click();
    await expect(kim.getByText("To continue, open “Text problems” and choose “Resume my task…”", { exact: false })).toBeVisible();
    expect(await noHorizontalScroll(kim)).toBe(true);
    await shot(kim, `464-consolidation-paused-by-report${suffix}`);
    await kim.goto(`${task}?view=editor`);
    await expect(kim.getByText("Task paused: Two findings name the same passage.")).toBeVisible();
    await shot(kim, `464-consolidation-editor-paused-by-report${suffix}`);

    // Resumed from the report: the decisions are back.
    await kim.goto(task);
    await kim.getByRole("button", { name: /^(Report a text problem|Text problems)/ }).click();
    const list = kim.getByRole("dialog").filter({ hasText: "Your reports" });
    await list.getByRole("button", { name: "Resume my task…", exact: true }).click();
    await list.getByRole("textbox", { name: /Why can you continue\?/ }).fill("Checked with the lead.");
    await list.getByRole("button", { name: "Resume my task", exact: true }).click();
    await expect(list).toContainText("Your task: Active");
    await list.locator(".modal-actions").getByRole("button", { name: "Close", exact: true }).click();
    await expect(keep.first()).toBeVisible();
    await expect(kim.getByText(/^Task paused: /)).toHaveCount(0);

    await kim.context().close();
    expect(errors).toEqual([]);
  });

}
