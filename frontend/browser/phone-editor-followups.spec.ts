/**
 * Phone and editor follow-ups, each at the window size its issue names:
 * - issue 468.1: the "−" marker of Show changes since v1 keeps its tooltip after a tap, until it is dismissed, and
 *   has a larger hit area;
 * - issue 468.2: at 390 px the proposal details show the sentence around the quoted passage, and a touch screen
 *   shows no key hints on the decision buttons;
 * - issue 466: at 844 × 390 (a phone in landscape) the term search of a new mark is in view and usable;
 * - issue 472 (Layout, phone points): Undo, Redo, Previous / Next text and the consolidation ✓ are at least
 *   44 × 44 px; the New finding bar shows the marked words in full; the selection bar and a toast leave most of
 *   Documents in view.
 *
 * Every test builds its own project through a scenario route.
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
const LANDSCAPE = { width: 844, height: 390 } as const;
/** The smallest touch target (CSS px). */
const TARGET = 44;

function consoleErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on("console", message => { if (message.type() === "error") errors.push(message.text()); });
  page.on("pageerror", error => errors.push(error.message));
  return errors;
}
const noSidewaysScroll = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
const box = async (locator: Locator) => (await locator.boundingBox())!;

/** True when the element's centre is inside the window and the element itself (or a descendant) is on top there. */
const onTop = (locator: Locator) => locator.evaluate(element => {
  const rect = element.getBoundingClientRect();
  const x = rect.left + rect.width / 2, y = rect.top + rect.height / 2;
  if (x < 0 || y < 0 || x > window.innerWidth || y > window.innerHeight) return false;
  const top = document.elementFromPoint(x, y);
  return !!top && (top === element || element.contains(top));
});

const textPane = (page: Page) => page.locator(".text-container").first();
const search = (page: Page) => page.getByLabel("Search term", { exact: true });
const viewTab = (page: Page, name: string | RegExp) => page.getByRole("navigation", { name: "Select view" }).getByRole("button", { name });

async function openLoop(page: Page, size: { width: number; height: number }): Promise<ReviewFlowScenario> {
  await page.setViewportSize(size);
  const s = await reviewFlowScenario(page, "ANNOTATION_LOOP");
  await loginScenarioUser(page, s, "annotator");
  await page.goto(`/#/tasks/${s.assignments["loop-en"]}`);
  await expect(textPane(page)).toHaveText(s.texts["loop-en"]);
  return s;
}

/** Each target is at least 44 × 44 px, and no two of them overlap. */
async function expectTouchTargets(targets: Locator[]): Promise<void> {
  const boxes = [];
  for (const target of targets) {
    await expect(target).toBeVisible();
    const rect = await box(target);
    expect(rect.width, `${await target.getAttribute("aria-label")}: width`).toBeGreaterThanOrEqual(TARGET);
    expect(rect.height, `${await target.getAttribute("aria-label")}: height`).toBeGreaterThanOrEqual(TARGET);
    boxes.push(rect);
  }
  for (const [index, a] of boxes.entries()) for (const b of boxes.slice(index + 1)) {
    const apart = a.x + a.width <= b.x || b.x + b.width <= a.x || a.y + a.height <= b.y || b.y + b.height <= a.y;
    expect(apart, "two targets overlap").toBe(true);
  }
}

// ---- Issue 468.1 ----------------------------------------------------------------------------------------------

interface CarryScenario { assignment_id: number; username: string; text: string }

async function openCarried(page: Page): Promise<CarryScenario> {
  const response = await page.request.post("/__test_carry_forward__", { params: { scenario: "corrected" }, timeout: 120_000 });
  expect(response.ok(), await response.text()).toBeTruthy();
  const s = (await response.json()) as CarryScenario;
  await loginExisting(page, s.username);
  await page.goto(`/#/tasks/${s.assignment_id}`);
  await expect(textPane(page)).toBeVisible();
  await page.getByRole("checkbox", { name: "Show changes since v1" }).check();
  await expect(page.locator(".text-container .change-removed")).toBeVisible();
  return s;
}

test.describe("issue 468.1 on a touch screen", () => {
  test.use({ hasTouch: true, viewport: PHONE });

  test("a tap on the “−” marker shows the earlier wording until it is dismissed (390 px)", async ({ page }) => {
    const errors = consoleErrors(page);
    const s = await openCarried(page);
    const marker = page.locator(".text-container .change-removed");
    const tip = page.getByRole("tooltip");
    const elsewhere = page.getByRole("status").filter({ hasText: /passage changed/ });

    // The hit area is larger than the 14 px box: about 44 px wide and one line (at least 24 px) high.
    const rect = await box(marker);
    const centre = { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
    const hits = (dx: number, dy: number) => page.evaluate(([x, y]) => !!document.elementFromPoint(x, y)?.closest(".change-removed"), [centre.x + dx, centre.y + dy]);
    for (const [dx, dy] of [[-20, 0], [20, 0], [0, -12], [0, 12]]) expect(await hits(dx, dy), `hit at ${dx}, ${dy}`).toBe(true);
    expect(await hits(-30, 0)).toBe(false);
    expect(await hits(0, 22), "the line below stays free").toBe(false);

    // A tap opens it, and it is still there seconds later.
    await marker.tap();
    await expect(tip).toBeVisible();
    await page.waitForTimeout(2500);
    await expect(tip).toBeVisible();
    await expect(tip).toContainText("In v1:");
    await expect(tip.locator("del")).toContainText(["Krampfanfälle"]);
    await expect(tip).toBeInViewport({ ratio: 1 });
    // A tap inside the tooltip keeps it.
    await tip.tap();
    await expect(tip).toBeVisible();

    // Dismissed by a second tap on the marker,
    await marker.tap();
    await expect(tip).toHaveCount(0);
    // by a tap somewhere else (here at the edge of the larger hit area, not on the box itself),
    await page.touchscreen.tap(centre.x + 18, centre.y);
    await expect(tip).toBeVisible();
    await elsewhere.tap();
    await expect(tip).toHaveCount(0);
    // and by Esc.
    await marker.tap();
    await expect(tip).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(tip).toHaveCount(0);

    // The marks added no characters.
    expect(await textPane(page).evaluate(node => node.textContent)).toBe(s.text);
    expect(await noSidewaysScroll(page)).toBe(true);
    expect(errors).toEqual([]);
  });
});

test("issue 468.1: with a mouse, hover still shows the earlier wording and a click keeps it (1440 px)", async ({ page }) => {
  const errors = consoleErrors(page);
  await page.setViewportSize(DESKTOP);
  await openCarried(page);
  const marker = page.locator(".text-container .change-removed");
  const tip = page.getByRole("tooltip");
  // Hover: open while the pointer is on the marker, closed after it leaves.
  await marker.hover();
  await expect(tip).toContainText("Krampfanfälle");
  await page.mouse.move(5, 5);
  await expect(tip).toHaveCount(0);
  // Click: it stays when the pointer leaves, until a click elsewhere.
  await marker.click();
  await page.mouse.move(5, 5);
  await page.waitForTimeout(600);
  await expect(tip).toBeVisible();
  await page.getByRole("status").filter({ hasText: /passage changed/ }).click();
  await expect(tip).toHaveCount(0);
  expect(errors).toEqual([]);
});

// ---- Issue 468.2 ----------------------------------------------------------------------------------------------

const targets = (page: Page) => page.locator('.sidebar [data-list-key^="target:"]');
const proposal = (page: Page) => page.getByLabel("Proposal details");
const sentence = (page: Page) => proposal(page).locator(".review-actions__sentence");

async function openProposals(page: Page): Promise<string> {
  const s = await proposalCheckScenario(page, "ONE_ASSIGNED");
  await loginCheckUser(page, s, "tom");
  await page.goto(`/#/tasks/${s.assignments.tom}`);
  await expect(textPane(page)).toBeVisible();
  return (await textPane(page).evaluate(node => node.textContent)) ?? "";
}

test.describe("issue 468.2 on a touch screen", () => {
  test.use({ hasTouch: true, viewport: PHONE });

  test("the proposal details show the sentence around the quoted passage, also for the next proposal (390 px)", async ({ page }) => {
    const errors = consoleErrors(page);
    const text = await openProposals(page);
    await viewTab(page, /^Findings/).tap();
    await expect(targets(page).first()).toBeVisible();
    const count = await targets(page).count();
    expect(count).toBeGreaterThan(1);
    await targets(page).first().tap();

    /** The sentence shown for the selected proposal: part of the text, longer than the quote, the quote marked. */
    const expectSentence = async () => {
      await expect(sentence(page).first()).toBeVisible();
      await expect(sentence(page).first()).toBeInViewport({ ratio: 1 });
      const quote = (await sentence(page).first().locator("mark").first().textContent())!;
      const shown = (await sentence(page).first().evaluate(node => [...node.children].filter(child => !child.classList.contains("visually-hidden")).map(child => child.textContent).join("")));
      expect(quote.length).toBeGreaterThan(0);
      expect(shown.length).toBeGreaterThan(quote.length);
      expect(text).toContain(shown.replace(/^…|…$/g, ""));
      await expect(proposal(page).locator(".review-actions__quote").first()).toContainText(quote);
      return shown;
    };
    // The text itself is not on screen in the Details view.
    await expect(viewTab(page, "Details")).toHaveAttribute("aria-pressed", "true");
    await expect(textPane(page)).toBeHidden();
    const first = await expectSentence();
    expect(first).toBe("Keine Krampfanfälle in der Neonatalzeit.");

    // A touch screen without a keyboard: the decision buttons carry no key hints.
    const confirm = page.getByRole("button", { name: /^Confirm/ });
    await expect(confirm).toBeVisible();
    await expect(confirm.locator("kbd")).toBeHidden();
    await expect(page.locator(".decision-grid kbd:visible")).toHaveCount(0);

    // After Confirm the next proposal opens in Details, with its own sentence.
    await confirm.tap();
    await expect(targets(page).nth(1)).toHaveClass(/\bselected\b/);
    await expect(viewTab(page, "Details")).toHaveAttribute("aria-pressed", "true");
    const second = await expectSentence();
    expect(second).not.toBe("");
    expect(await noSidewaysScroll(page)).toBe(true);
    expect(errors).toEqual([]);
  });
});

test("issue 468.2: beside the text the proposal details stay as they were, key hints included (1440 px)", async ({ page }) => {
  const errors = consoleErrors(page);
  await page.setViewportSize(DESKTOP);
  await openProposals(page);
  await targets(page).first().click();
  await expect(proposal(page).locator(".review-actions__quote").first()).toBeVisible();
  await expect(sentence(page)).toHaveCount(0);
  await expect(textPane(page)).toBeVisible();
  await expect(page.getByRole("button", { name: /^Confirm/ }).locator("kbd")).toBeVisible();
  expect(errors).toEqual([]);
});

// ---- Issue 466 ------------------------------------------------------------------------------------------------

const pageScroll = (page: Page) => page.locator(".shell-reading").evaluate(element => element.scrollTop);
const findingRows = (page: Page) => page.locator('.sidebar [data-list-key^="annotation:"]');

test("issue 466: after marking text on a phone in landscape, the term search is in view and usable (844 × 390)", async ({ page }) => {
  const errors = consoleErrors(page);
  const s = await openLoop(page, LANDSCAPE);
  const text = s.texts["loop-en"];
  expect(await pageScroll(page), "the page starts unscrolled").toBe(0);
  // The text and the panel stand side by side, each inside the window.
  const [centre, inspector] = [await box(page.locator(".center-pane")), await box(page.locator(".inspector-pane"))];
  expect(inspector.x).toBeGreaterThanOrEqual(centre.x + centre.width - 1);
  for (const pane of [centre, inspector]) expect(pane.y + pane.height).toBeLessThanOrEqual(LANDSCAPE.height);

  await selectText(page, text.indexOf("patient"), text.indexOf("patient") + "patient".length);
  await expect(search(page)).toBeVisible();
  await expect(search(page)).toHaveValue("patient");
  // The whole search field is in the window, nothing lies over it, and the page did not scroll.
  await expect(search(page)).toBeInViewport({ ratio: 1 });
  expect(await onTop(search(page)), "the term search is not covered").toBe(true);
  expect(await pageScroll(page)).toBe(0);
  // The marked passage is still readable beside it: no blank text pane.
  const marked = page.locator(".text-container .run--marked").first();
  await expect(marked).toBeInViewport({ ratio: 1 });
  expect(await onTop(marked), "the marked text is not covered").toBe(true);
  // No "New finding" bar in this layout.
  await expect(page.locator(".pending-bar")).toHaveCount(0);

  // Usable: a search, a hit in view, and the finding is there.
  await search(page).fill("HP:0001250");
  const hit = page.locator(".candidate-card").filter({ hasText: "HP:0001250" }).first();
  await expect(hit).toBeVisible();
  await expect(search(page)).toBeInViewport({ ratio: 1 });
  await hit.scrollIntoViewIfNeeded();
  await expect(hit.locator(".candidate-header")).toBeInViewport({ ratio: 1 });
  await hit.click();
  await expect(page.locator(".inspector-pane h2")).toContainText("HP:0001250");
  await expect(findingRows(page)).toHaveCount(1);
  expect(await pageScroll(page)).toBe(0);
  expect(await noSidewaysScroll(page)).toBe(true);
  expect(errors).toEqual([]);
});

test("issue 466: a tablet keeps the panel under the text (1024 × 768)", async ({ page }) => {
  await openLoop(page, { width: 1024, height: 768 });
  const [centre, inspector] = [await box(page.locator(".center-pane")), await box(page.locator(".inspector-pane"))];
  expect(inspector.y).toBeGreaterThanOrEqual(centre.y + centre.height - 1);
  expect(Math.abs(inspector.x - centre.x)).toBeLessThanOrEqual(1);
});

// ---- Issue 472, Layout: phone points ---------------------------------------------------------------------------

for (const size of [PHONE, LANDSCAPE]) {
  test(`issue 472: Undo, Redo and Previous / Next text are at least 44 × 44 px and apart (${size.width} × ${size.height})`, async ({ page }) => {
    const errors = consoleErrors(page);
    await openLoop(page, size);
    const undo = page.getByRole("button", { name: "Undo last change", exact: true });
    const redo = page.getByRole("button", { name: "Redo last change", exact: true });
    await expectTouchTargets([
      page.getByRole("button", { name: "Previous text", exact: true }), page.getByRole("button", { name: "Next text", exact: true }), undo, redo,
    ]);
    // Undo and Redo no longer touch.
    const [left, right] = [await box(undo), await box(redo)];
    expect(right.x - (left.x + left.width)).toBeGreaterThanOrEqual(4);
    expect(await noSidewaysScroll(page)).toBe(true);
    expect(errors).toEqual([]);
  });
}

test("issue 472: the consolidation ✓ is at least 44 × 44 px (390 px)", async ({ page }) => {
  const errors = consoleErrors(page);
  await page.setViewportSize(PHONE);
  const response = await page.request.post("/__test_consolidation__", { params: { started: "true" }, timeout: 120_000 });
  expect(response.ok(), await response.text()).toBeTruthy();
  const s = (await response.json()) as { users: { lead: string }; assignment_id: number };
  await loginExisting(page, s.users.lead);
  await page.goto(`/#/tasks/${s.assignment_id}`);
  await expect(page.getByRole("heading", { level: 1, name: /^Consolidate / })).toBeVisible({ timeout: 30_000 });
  const takes = page.locator(".cons-group-expanded .cons-take");
  await expect(takes.first()).toBeVisible();
  expect(await takes.count()).toBeGreaterThanOrEqual(2);
  await expectTouchTargets([takes.nth(0), takes.nth(1)]);
  // Still usable: a tap on the larger ✓ takes the value.
  await takes.first().click();
  await expect(page.locator('.cons-take[aria-pressed="true"]').first()).toBeVisible();
  expect(await noSidewaysScroll(page)).toBe(true);
  expect(errors).toEqual([]);
});

test("issue 472: the New finding bar shows the marked words in full (390 px)", async ({ page }) => {
  const errors = consoleErrors(page);
  const s = await openLoop(page, PHONE);
  const text = s.texts["loop-en"]; // "The patient has a seizure and hypotonia."
  await selectText(page, 0, text.length);
  const bar = page.getByRole("group", { name: "New finding", exact: true });
  await expect(bar).toBeVisible();
  const words = bar.locator(".pending-bar__text");
  await expect(words).toHaveText(`New finding “${text}”`);
  // Nothing is clipped: the line holds all of its text, inside the window.
  expect(await words.evaluate(node => node.scrollWidth <= node.clientWidth && node.scrollHeight <= node.clientHeight)).toBe(true);
  await expect(words).toBeInViewport({ ratio: 1 });
  // The bar is still at the bottom edge with its three buttons in reach, and the marked text is above it.
  const rect = await box(bar);
  expect(Math.round(rect.y + rect.height)).toBe(PHONE.height);
  for (const name of ["Choose term", "Discard", "Copy text"]) {
    const button = bar.getByRole("button", { name, exact: true });
    await expect(button, name).toBeInViewport({ ratio: 1 });
    expect(await onTop(button), `${name} is not covered`).toBe(true);
  }
  const marked = await box(page.locator(".text-container .run--marked").first());
  expect(marked.y + marked.height).toBeLessThanOrEqual(rect.y);
  expect(await noSidewaysScroll(page)).toBe(true);
  expect(errors).toEqual([]);
});

test("issue 472: the selection bar and a toast leave most of Documents in view (390 px)", async ({ page }) => {
  const errors = consoleErrors(page);
  await page.setViewportSize(PHONE);
  const s = await documentsScenario(page, "S336");
  await loginExisting(page, s.users.lead);
  await page.goto(`/#/projects/${encodeURIComponent(s.project)}/documents`);
  await documentsReady(page);
  await page.getByRole("checkbox", { name: "Select all 8 filtered texts" }).click();
  const bar = page.getByRole("region", { name: "Selection" });
  await expect(bar).toBeVisible();
  // Every action is still there, each at least 32 px high.
  for (const name of [/^Assign/, "Plan…", "More actions", "Move to front", "Show selected", "Clear selection"]) {
    const button = bar.getByRole("button", { name, exact: typeof name === "string" });
    await expect(button).toBeInViewport({ ratio: 1 });
    expect((await box(button)).height).toBeGreaterThanOrEqual(32);
  }

  await bar.getByRole("button", { name: "More actions" }).click();
  await page.getByRole("menu", { name: "More actions" }).getByRole("menuitem", { name: "Reopen…" }).click();
  const reopen = page.getByRole("dialog", { name: "Reopen: 8 texts" });
  await reopen.getByLabel(/^Reason/).fill("Guideline 2.3 changed for vital signs");
  await reopen.getByRole("button", { name: "Reopen 8 tasks" }).click();
  await reopen.getByLabel("I understand").check();
  await reopen.getByRole("button", { name: "Reopen 8 tasks" }).click();
  await expect(reopen).toBeHidden();
  const toast = page.locator(".ui-toast");
  await expect(toast).toContainText("Reopened 8 tasks in 6 texts.");
  await expect(toast.getByRole("button", { name: "Undo" })).toBeVisible();

  // The toast sits above the bar without covering it, and together they take less than a third of the window.
  await expect.poll(async () => { const [t, b] = [await box(toast), await box(bar)]; return t.y + t.height <= b.y; }).toBe(true);
  const [toastBox, barBox] = [await box(toast), await box(bar)];
  expect(barBox.height).toBeLessThanOrEqual(140);
  expect(PHONE.height - toastBox.y).toBeLessThan(PHONE.height / 3);
  expect(await noSidewaysScroll(page)).toBe(true);
  expect(errors).toEqual([]);
});
