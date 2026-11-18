/**
 * Four small layout and order fixes, each at the window sizes its issue names:
 * - issue 436: the findings list follows the text (start of the first segment, findings without a span last);
 * - issue 452: on a phone, "Choose term" of a new mark is in view without scrolling, and the text does not move;
 * - issue 438: on a phone, a submission layer of the text view goes below the text, which keeps the full width;
 * - issue 439: a toast of the previous action never covers an open dialog, and its Undo is still there afterwards.
 *
 * Every test builds its own project (ANNOTATION_LOOP, CHECKED, S336). With UI_FIXES_SHOTS=<directory> the states
 * are saved as screenshots, named with UI_FIXES_PHASE ("before" or "after", default "after").
 */
import { expect, test, type Locator, type Page } from "@playwright/test";
import { documentsReady, documentsScenario } from "./documentsHelpers";
import { loginExisting, selectText } from "./helpers";
import { loginScenarioUser as loginCheckUser, proposalCheckScenario } from "./proposalCheckHelpers";
import { loginScenarioUser, reviewFlowScenario, type ReviewFlowScenario } from "./reviewFlowHelpers";

test.setTimeout(240_000);
test.use({ actionTimeout: 15_000 });

const DESKTOP = { width: 1440, height: 900 } as const;
const PHONE = { width: 390, height: 844 } as const;

const shots = process.env.UI_FIXES_SHOTS;
const phase = process.env.UI_FIXES_PHASE ?? "after";
async function shot(page: Page, name: string): Promise<void> {
  if (shots) await page.screenshot({ path: `${shots}/${name}-${phase}.png` });
}

function consoleErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on("console", message => { if (message.type() === "error") errors.push(message.text()); });
  page.on("pageerror", error => errors.push(error.message));
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

const textPane = (page: Page) => page.locator(".text-container");
const search = (page: Page) => page.getByLabel("Search term", { exact: true });
const findingRows = (page: Page) => page.locator('.sidebar [data-list-key^="annotation:"]');
const pendingBar = (page: Page) => page.getByRole("group", { name: "New finding", exact: true });
const chooseTerm = (page: Page) => pendingBar(page).getByRole("button", { name: "Choose term", exact: true });

async function openLoop(page: Page, size: { width: number; height: number }): Promise<ReviewFlowScenario> {
  await page.setViewportSize(size);
  const s = await reviewFlowScenario(page, "ANNOTATION_LOOP");
  await loginScenarioUser(page, s, "annotator");
  await page.goto(`/#/tasks/${s.assignments["loop-en"]}`);
  await expect(textPane(page)).toHaveText(s.texts["loop-en"]);
  return s;
}

// ---- Issue 436 ------------------------------------------------------------------------------------------------

for (const size of [DESKTOP, PHONE]) {
  const phone = size.width < 700;
  test(`issue 436: the findings list follows the text, also after delete, undo, redo and a reload (${size.width} px)`, async ({ page }) => {
    const errors = consoleErrors(page);
    const s = await openLoop(page, size);
    const text = s.texts["loop-en"]; // "The patient has a seizure and hypotonia."
    const pane = async (name: "Findings" | "Document" | "Details") => {
      if (phone) await page.getByRole("navigation", { name: "Select view" }).getByRole("button", { name: name === "Findings" ? /^Findings/ : name }).click();
    };
    /** Term IDs of the list rows, top to bottom. */
    const order = async () => {
      await pane("Findings");
      return findingRows(page).evaluateAll(rows => rows.map(row => /HP:\d{7}/.exec(row.textContent ?? "")?.[0] ?? row.textContent));
    };
    const pick = async (termId: string, count: number) => {
      await search(page).fill(termId);
      await page.locator(".candidate-card").filter({ hasText: termId }).first().click();
      await expect(page.locator(".inspector-pane h2")).toContainText(termId);
      await expect(findingRows(page)).toHaveCount(count);
    };
    const mark = async (word: string, termId: string, count: number) => {
      await pane("Document");
      const start = text.indexOf(word);
      await selectText(page, start, start + word.length);
      if (phone) await chooseTerm(page).click();
      await pick(termId, count);
    };
    const SEIZURE = "HP:0001250", HYPOTONIA = "HP:0001252", AREFLEXIA = "HP:0001284", HEARING = "HP:0000365";

    // Created from the end of the text to its start, with a finding without a span in between.
    await mark("hypotonia", HYPOTONIA, 1);
    await mark("seizure", SEIZURE, 2);
    await pane("Findings");
    await page.getByRole("button", { name: "Add finding without a text span" }).click();
    const reason = page.getByLabel("Reason for no text span");
    if (await reason.count()) await reason.fill("Named in the referral letter only");
    await pick(HEARING, 3);
    await mark("patient", AREFLEXIA, 4);

    // The finding just added is the selected one, at its place in the text; the one without a span is last.
    await pane("Findings");
    await shot(page, `436-list-${size.width}`);
    expect(await order()).toEqual([AREFLEXIA, SEIZURE, HYPOTONIA, HEARING]);
    await expect(findingRows(page).first()).toHaveAttribute("aria-pressed", "true");
    await expect(findingRows(page).and(page.locator('[aria-pressed="true"]'))).toHaveCount(1);
    expect(await noSidewaysScroll(page)).toBe(true);

    // Delete the middle finding: the others keep their order and nothing is selected.
    await findingRows(page).filter({ hasText: SEIZURE }).click();
    await pane("Details");
    await page.getByRole("button", { name: "Delete finding", exact: true }).click();
    await page.getByRole("group", { name: "Confirm deletion" }).getByRole("button", { name: "Yes, delete" }).click();
    await expect(findingRows(page)).toHaveCount(3);
    expect(await order()).toEqual([AREFLEXIA, HYPOTONIA, HEARING]);
    await expect(findingRows(page).and(page.locator('[aria-pressed="true"]'))).toHaveCount(0);

    // Undo brings it back to its place in the text, not to the end; redo removes it again.
    await page.getByRole("button", { name: "Undo last change", exact: true }).click();
    await expect(findingRows(page)).toHaveCount(4);
    expect(await order()).toEqual([AREFLEXIA, SEIZURE, HYPOTONIA, HEARING]);
    await page.getByRole("button", { name: "Redo last change", exact: true }).click();
    await expect(findingRows(page)).toHaveCount(3);
    expect(await order()).toEqual([AREFLEXIA, HYPOTONIA, HEARING]);
    await page.getByRole("button", { name: "Undo last change", exact: true }).click();
    await expect(findingRows(page)).toHaveCount(4);

    // The order comes from the text, so a reload shows the same list.
    await page.reload();
    await expect(textPane(page)).toHaveText(text);
    await pane("Findings");
    await expect(findingRows(page)).toHaveCount(4);
    expect(await order()).toEqual([AREFLEXIA, SEIZURE, HYPOTONIA, HEARING]);
    await shot(page, `436-list-reloaded-${size.width}`);
    expect(errors).toEqual([]);
  });
}

// ---- Issue 452 ------------------------------------------------------------------------------------------------

const pageScroll = (page: Page) => page.locator(".shell-reading").evaluate(element => element.scrollTop);

for (const size of [PHONE, { width: 375, height: 667 }, { width: 667, height: 375 }]) {
  test(`issue 452: after marking text, "Choose term" is in view and clickable without scrolling (${size.width} × ${size.height})`, async ({ page }) => {
    const errors = consoleErrors(page);
    const s = await openLoop(page, size);
    const text = s.texts["loop-en"];
    expect(await pageScroll(page), "the page starts unscrolled").toBe(0);
    await shot(page, `452-unmarked-${size.width}x${size.height}`);

    // A passage at the top of the text.
    const marked = page.locator(".text-container .run--marked").first();
    await selectText(page, text.indexOf("patient"), text.indexOf("patient") + "patient".length);
    await expect(pendingBar(page)).toBeVisible();
    await shot(page, `452-marked-${size.width}x${size.height}`);
    for (const name of ["Choose term", "Discard", "Copy text"]) {
      const button = pendingBar(page).getByRole("button", { name, exact: true });
      await expect(button, name).toBeInViewport({ ratio: 1 });
      expect(await onTop(button), `${name} is not covered`).toBe(true);
    }
    // Nothing moved: the page is still unscrolled, the bar is at the bottom edge of the window.
    expect(await pageScroll(page)).toBe(0);
    const bar = (await pendingBar(page).boundingBox())!;
    expect(Math.round(bar.y + bar.height)).toBe(size.height);
    // The marked passage is in view, above the bar, and nothing lies over it.
    await expect(marked).toBeInViewport({ ratio: 1 });
    expect(await onTop(marked), "the marked text is not covered").toBe(true);
    const mark = (await marked.boundingBox())!;
    expect(mark.y + mark.height).toBeLessThanOrEqual(bar.y);
    expect(await noSidewaysScroll(page)).toBe(true);

    // The bar leads on to the term search.
    await chooseTerm(page).click();
    await expect(search(page)).toBeVisible();
    await expect(search(page)).toHaveValue("patient");
    await shot(page, `452-term-search-${size.width}x${size.height}`);
    expect(errors).toEqual([]);
  });
}

test("issue 452: a passage marked where the bar appears is moved clear of it, by no more than needed", async ({ page }) => {
  const errors = consoleErrors(page);
  // A window so low that the first line of the text is at its bottom edge, where the bar goes. (258 px since the
  // shell header got lower at this width: the user menu button is narrower than "Log out" was, so the breadcrumb
  // wraps less, issue 510.)
  const height = 258;
  const s = await openLoop(page, { width: 390, height });
  const text = s.texts["loop-en"];
  const line = (await textPane(page).locator(".run").first().boundingBox())!;
  expect(line.y + line.height, "the text's first line is where the bar will be").toBeGreaterThan(height - 40);
  await selectText(page, text.indexOf("patient"), text.indexOf("patient") + "patient".length);
  await expect(pendingBar(page)).toBeVisible();
  const marked = page.locator(".text-container .run--marked").first();
  await expect.poll(() => pageScroll(page)).toBeGreaterThan(0);
  await shot(page, "452-marked-under-bar-390x270");
  const [bar, mark] = [(await pendingBar(page).boundingBox())!, (await marked.boundingBox())!];
  expect(mark.y + mark.height).toBeLessThanOrEqual(bar.y);
  expect(bar.y - (mark.y + mark.height), "scrolled no further than needed").toBeLessThanOrEqual(12);
  await expect(marked).toBeInViewport({ ratio: 1 });
  expect(await onTop(marked)).toBe(true);
  await expect(chooseTerm(page)).toBeInViewport({ ratio: 1 });
  expect(await onTop(chooseTerm(page))).toBe(true);
  expect(errors).toEqual([]);
});

// ---- Issue 438 ------------------------------------------------------------------------------------------------

const CASE = "EN100024";
const showSelect = (page: Page) => page.getByRole("combobox", { name: "Show", exact: true }).first();
const layer = (page: Page) => page.getByRole("region", { name: "Findings", exact: true });
const readingText = (page: Page) => page.locator(".case-viewer .text-container").first();
const box = async (locator: Locator) => (await locator.boundingBox())!;

for (const size of [PHONE, { width: 375, height: 667 }, DESKTOP]) {
  const phone = size.width < 700;
  test(`issue 438: text view with a submission layer, ${phone ? "the text keeps the full width" : "the layer stays beside the text"} (${size.width} px)`, async ({ page }) => {
    const errors = consoleErrors(page);
    await page.setViewportSize(size);
    const s = await proposalCheckScenario(page, "CHECKED");
    await loginCheckUser(page, s, "lead");
    await page.goto(`/#/projects/${encodeURIComponent(s.project)}/cases/${CASE}?variant=${encodeURIComponent(s.cases[CASE])}`);
    await expect(showSelect(page)).toBeVisible({ timeout: 30_000 });
    await expect(readingText(page)).toBeVisible();
    const textOnly = await box(readingText(page));

    // Tom's submission as the shown layer.
    const value = await showSelect(page).locator("option", { hasText: s.display_names.tom }).first().getAttribute("value");
    await showSelect(page).selectOption(value!);
    await expect(layer(page)).toContainText("(HP:0002133)");
    await expect(page.locator(".text-container .run--marked").first()).toBeVisible();
    await shot(page, `438-layer-${size.width}`);

    const [text, findings] = [await box(readingText(page)), await box(layer(page))];
    if (phone) {
      // The text is as wide as without a layer (the window less its margins), and the layer is below it.
      expect(text.width).toBeGreaterThanOrEqual(textOnly.width - 1);
      expect(text.width).toBeGreaterThanOrEqual(size.width - 48);
      expect(findings.y).toBeGreaterThanOrEqual(text.y + text.height - 1);
      expect(findings.width).toBeGreaterThanOrEqual(size.width - 48);
      // The layer is reachable: its findings scroll into view.
      await layer(page).getByRole("listitem").first().scrollIntoViewIfNeeded();
      await expect(layer(page).getByRole("listitem").first()).toBeInViewport({ ratio: 1 });
      await shot(page, `438-layer-findings-${size.width}`);
    } else {
      // Desktop is unchanged: a 300 px column to the right of the text.
      expect(findings.width).toBe(300);
      expect(findings.x).toBeGreaterThanOrEqual(text.x + text.width - 1);
      expect(Math.abs(findings.y - text.y)).toBeLessThan(120);
    }
    expect(await noSidewaysScroll(page)).toBe(true);
    expect(errors).toEqual([]);
  });
}

// ---- Issue 439 ------------------------------------------------------------------------------------------------

for (const size of [DESKTOP, PHONE]) {
  test(`issue 439: a toast with Undo never covers the next dialog and is back when it closes (${size.width} px)`, async ({ page }) => {
    const errors = consoleErrors(page);
    await page.setViewportSize(size);
    const s = await documentsScenario(page, "S336");
    await loginExisting(page, s.users.lead);
    await page.goto(`/#/projects/${encodeURIComponent(s.project)}/documents`);
    await documentsReady(page);

    await page.getByRole("checkbox", { name: "Select all 8 filtered texts" }).click();
    const bar = page.getByRole("region", { name: "Selection" });
    const openAction = async (name: string) => {
      await bar.getByRole("button", { name: "More actions" }).click();
      await page.getByRole("menu", { name: "More actions" }).getByRole("menuitem", { name }).click();
    };
    await openAction("Reopen…");
    const reopen = page.getByRole("dialog", { name: "Reopen: 8 texts" });
    await reopen.getByLabel(/^Reason/).fill("Guideline 2.3 changed for vital signs");
    await reopen.getByRole("button", { name: "Reopen 8 assignments" }).click();
    await reopen.getByLabel("I understand").check();
    await reopen.getByRole("button", { name: "Reopen 8 assignments" }).click();
    await expect(reopen).toBeHidden();
    const toast = page.locator(".ui-toast");
    const status = page.getByRole("status").filter({ has: toast });
    // The announcement: the toast is in a polite live region.
    await expect(status).toHaveAttribute("aria-live", "polite");
    await expect(status).toContainText("Reopened 8 assignments in 6 texts.");
    await expect(toast.getByRole("button", { name: "Undo" })).toBeVisible();

    // The next dialog, opened right away while the toast is showing.
    await openAction("Withdraw open tasks…");
    const withdraw = page.getByRole("dialog", { name: /^Withdraw open tasks: 8 texts/ });
    await expect(withdraw).toBeVisible();
    await expect(withdraw.getByRole("list", { name: "Preview" })).toBeVisible();
    await shot(page, `439-dialog-with-toast-${size.width}`);

    // The toast does not lie over any part of the dialog, and every control of the dialog is on top and clickable.
    const overlap = await page.evaluate(() => {
      const dialog = document.querySelector('[role="dialog"]')!.getBoundingClientRect();
      const element = document.querySelector<HTMLElement>(".ui-toast");
      if (!element || getComputedStyle(element).visibility === "hidden") return false;
      const box = element.getBoundingClientRect();
      return box.width > 0 && box.left < dialog.right && box.right > dialog.left && box.top < dialog.bottom && box.bottom > dialog.top;
    });
    expect(overlap, "the toast overlaps the dialog").toBe(false);
    const controls = withdraw.locator("button, input, textarea, select");
    const count = await controls.count();
    expect(count).toBeGreaterThan(2);
    for (let index = 0; index < count; index++) {
      const control = controls.nth(index);
      await control.scrollIntoViewIfNeeded();
      expect(await onTop(control), `dialog control ${index} is not covered`).toBe(true);
      await control.click({ trial: true });
    }
    // The announcement is not taken away: the message is still in the live region.
    await expect(status).toContainText("Reopened 8 assignments in 6 texts.");

    // Closing the dialog without acting: the Undo is still valid and reachable, and it works.
    await withdraw.getByRole("button", { name: "Cancel", exact: true }).click();
    await expect(withdraw).toBeHidden();
    await expect(toast.getByRole("button", { name: "Undo" })).toBeVisible();
    await shot(page, `439-toast-after-dialog-${size.width}`);
    await toast.getByRole("button", { name: "Undo" }).click();
    await expect(toast).toContainText("The reopened tasks are submitted again.");
    expect(await noSidewaysScroll(page)).toBe(true);
    expect(errors).toEqual([]);
  });
}
