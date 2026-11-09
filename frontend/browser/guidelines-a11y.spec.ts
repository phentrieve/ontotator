/**
 * Project guidelines: layout, keyboard and accessibility (plan "Project guidelines" G6b; spec
 * "UI: annotators and reviewers", "Testing > Browser (Playwright)").
 *
 * Every test builds its own ``PUBLISHED`` project through ``POST /__test_guidelines__``: v1 published
 * by the lead ("First version"), not yet seen by Ana, who owns the en annotate task ``annotate-1``.
 * In the editor the guidelines open as the inspector's "Guidelines v1" tab from 1060 px (three
 * columns); below, the drawer is a modal ``lg`` Dialog from 700 px and a full-height sheet below that.
 */
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Locator, type Page } from "@playwright/test";
import { moreAction, selectText } from "./helpers";
import { guidelineScenario, loginGuidelineUser, type GuidelineScenario } from "./guidelineHelpers";

test.setTimeout(180_000);
test.use({ actionTimeout: 15_000 });

const V1_TEXT = "Annotate every phenotype the text states about the patient.";

/** Screenshots for human review only (never baselines). */
const evidenceDir = () => resolve(test.info().config.rootDir, "../../build/project-guidelines/evidence");
async function evidence(page: Page, name: string) {
  mkdirSync(evidenceDir(), { recursive: true });
  await page.screenshot({ path: resolve(evidenceDir(), `guidelines-a11y-${name}.png`), fullPage: false });
}

/** The editor's "More actions" button: its menu holds the guidelines item; focus returns here. */
const entry = (page: Page) => page.getByRole("button", { name: "More actions", exact: true });
const openGuidelines = (page: Page) => moreAction(page, /^Guidelines v1/);
const aside = (page: Page) => page.getByRole("complementary", { name: "Guidelines v1", exact: true });
/** The inspector's Guidelines tab panel (editor from 1060 px). */
const tabPanel = (page: Page) => page.locator(".inspector-pane").getByRole("tabpanel", { name: "Guidelines v1", exact: true });
const tab = (page: Page, name: "Details" | "Guidelines v1") => page.getByRole("tablist", { name: "Inspector", exact: true }).getByRole("tab", { name, exact: true });

/** Boxes of the three columns and the first characters of the text (on top, inside the text column). */
async function columns(page: Page) {
  return page.evaluate(() => {
    const box = (selector: string) => {
      const { left, right, top, bottom, width } = document.querySelector(selector)!.getBoundingClientRect();
      return { left, right, top, bottom, width };
    };
    const container = document.querySelector(".text-container")!;
    const node = document.createTreeWalker(container, NodeFilter.SHOW_TEXT).nextNode()!;
    const range = document.createRange();
    range.setStart(node, 0);
    range.setEnd(node, Math.min(12, node.textContent!.length));
    const first = range.getBoundingClientRect();
    const hit = document.elementFromPoint(first.left + 2, (first.top + first.bottom) / 2);
    return { sidebar: box(".sidebar"), center: box(".center-pane"), inspector: box(".inspector-pane"),
      textOnTop: !!hit && container.contains(hit), viewport: innerWidth };
  });
}
const modal = (page: Page) => page.getByRole("dialog", { name: "Guidelines v1", exact: true });
const scrollWidth = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth);

/** Fresh PUBLISHED project; Ana logged in at ``size`` on her first annotate task. */
async function anaOnTask(page: Page, size: { width: number; height: number }): Promise<GuidelineScenario> {
  await page.setViewportSize(size);
  const s = await guidelineScenario(page, "PUBLISHED");
  await loginGuidelineUser(page, s, "ana");
  await page.goto(`/#/tasks/${s.assignments["annotate-1"]}`);
  await expect(page.locator(".text-container")).toBeVisible();
  await expect(entry(page)).toBeVisible();
  return s;
}

/** Press Tab until ``target`` has focus (at most ``limit`` times). */
async function tabTo(page: Page, target: Locator, limit = 80): Promise<void> {
  const stops: string[] = [];
  for (let index = 0; index < limit; index += 1) {
    await page.keyboard.press("Tab");
    if (await target.evaluate(element => element === document.activeElement)) return;
    stops.push(await page.evaluate(() => {
      const element = document.activeElement as HTMLElement | null;
      return element ? `${element.tagName.toLowerCase()}:${(element.getAttribute("aria-label") ?? element.textContent ?? "").trim().slice(0, 40)}` : "none";
    }));
  }
  throw new Error(`Tab never reached the target. Stops: ${stops.join(" | ")}`);
}

async function axeViolations(page: Page, include: string): Promise<string[]> {
  const results = await new AxeBuilder({ page }).include(include).analyze();
  return results.violations.flatMap(v => v.nodes.map(n => `${v.id} ${n.target.join(" ")}: ${n.failureSummary ?? ""}`));
}

for (const width of [1280, 1440]) {
  test(`at ${width} px the guidelines open in the inspector and the editor keeps three columns`, async ({ page }) => {
    await anaOnTask(page, { width, height: 800 });
    const before = await columns(page);
    await openGuidelines(page);
    const panel = tabPanel(page);
    await expect(panel).toBeVisible();
    await expect(panel).toBeFocused();
    await expect(panel.getByRole("heading", { name: "Guidelines v1", level: 2 })).toBeVisible();
    await expect(panel.getByText(V1_TEXT)).toBeVisible();
    await expect(panel.getByRole("link", { name: "All versions", exact: true })).toBeVisible();
    await expect(tab(page, "Guidelines v1")).toHaveAttribute("aria-selected", "true");
    await expect(tab(page, "Details")).toHaveAttribute("aria-selected", "false");
    // No page drawer, nothing modal.
    await expect(aside(page)).toHaveCount(0);
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(page.locator('[aria-modal="true"]')).toHaveCount(0);

    // Three columns: the inspector (420 px) beside the text, at the right edge; the text keeps at least 420 px and is not covered.
    const open = await columns(page);
    expect(open.inspector.left, "inspector beside the text").toBeGreaterThanOrEqual(open.center.right - 1);
    expect(Math.abs(open.inspector.top - open.center.top), "inspector not stacked").toBeLessThanOrEqual(1);
    expect(Math.round(open.inspector.right)).toBe(width);
    expect(Math.round(open.inspector.width)).toBe(420);
    expect(open.center.width).toBeGreaterThanOrEqual(420);
    expect(open.center.width, "the text loses at most the 40 px the inspector gains").toBeGreaterThanOrEqual(before.center.width - 41);
    expect(open.textOnTop).toBe(true);
    expect(await scrollWidth(page)).toBeLessThanOrEqual(width);
    await evidence(page, `${width}-inspector-guidelines`);

    // The editor stays operable: marking text brings Details (the New finding panel) to the front.
    await selectText(page, 0, 11);
    await expect(tab(page, "Details")).toHaveAttribute("aria-selected", "true");
    await page.getByLabel("Search term", { exact: true }).fill("Hypotonia");
    await expect(page.locator(".candidate-card").filter({ hasText: "HP:0001252" })).toHaveAttribute("aria-selected", "true");
    await page.getByLabel("Search term", { exact: true }).press("Enter");
    await expect(page.locator(".sidebar .doc-item")).toHaveCount(1);
    // The Guidelines tab stays; selecting the finding in the list does not take it away.
    await tab(page, "Guidelines v1").click();
    await expect(panel).toBeVisible();
    await page.locator(".sidebar .doc-item").first().click();
    await expect(tab(page, "Guidelines v1")).toHaveAttribute("aria-selected", "true");
    await expect(panel.getByText(V1_TEXT)).toBeVisible();
    await evidence(page, `${width}-inspector-guidelines-editor-used`);

    await panel.getByRole("button", { name: "Close", exact: true }).click();
    await expect(panel).toHaveCount(0);
    await expect(page.getByRole("tablist", { name: "Inspector" })).toHaveCount(0);
    await expect(entry(page)).toBeFocused();
    expect(Math.round((await columns(page)).inspector.width)).toBe(380);
  });
}

test("inspector tabs: arrow keys switch, Escape and ✕ close and return focus", async ({ page }) => {
  await anaOnTask(page, { width: 1280, height: 800 });
  await openGuidelines(page);
  await expect(tabPanel(page)).toBeFocused();
  await tab(page, "Guidelines v1").focus();
  await page.keyboard.press("ArrowLeft");
  await expect(tab(page, "Details")).toBeFocused();
  await expect(tab(page, "Details")).toHaveAttribute("aria-selected", "true");
  await expect(tabPanel(page)).toBeHidden();
  await page.keyboard.press("ArrowRight");
  await expect(tab(page, "Guidelines v1")).toBeFocused();
  await expect(tabPanel(page)).toBeVisible();
  // Tab moves from the selected tab to ✕, then into the panel.
  await page.keyboard.press("Tab");
  await expect(page.getByRole("button", { name: "Close guidelines", exact: true })).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(tabPanel(page)).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(tabPanel(page)).toHaveCount(0);
  await expect(entry(page)).toBeFocused();
  await openGuidelines(page);
  await page.getByRole("button", { name: "Close guidelines", exact: true }).click();
  await expect(tabPanel(page)).toHaveCount(0);
  await expect(entry(page)).toBeFocused();
});

test("900 px uses a dialog", async ({ page }) => {
  await anaOnTask(page, { width: 900, height: 800 });
  await openGuidelines(page);
  const dialog = modal(page);
  await expect(dialog).toBeVisible();
  await expect(dialog).toHaveAttribute("aria-modal", "true");
  await expect(dialog).toHaveClass(/ui-dialog--lg/);
  await expect(aside(page)).toHaveCount(0);
  await expect(dialog.locator(".ui-drawer-heading-target")).toBeFocused();
  await expect(dialog.getByText(V1_TEXT)).toBeVisible();
  const box = (await dialog.boundingBox())!;
  expect(box.width).toBeLessThan(900);
  expect(box.height).toBeLessThan(800);
  await evidence(page, "900-dialog");
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(entry(page)).toBeFocused();
});

test("390 px uses a sheet", async ({ page }) => {
  await anaOnTask(page, { width: 390, height: 844 });
  await openGuidelines(page);
  const sheet = modal(page);
  await expect(sheet).toBeVisible();
  await expect(sheet).toHaveAttribute("aria-modal", "true");
  await expect(page.locator(".ui-drawer-sheet")).toHaveCount(1);
  await expect(sheet.locator(".ui-drawer-heading-target")).toBeFocused();
  const box = (await sheet.boundingBox())!;
  expect(box.x).toBeLessThanOrEqual(1);
  expect(box.width).toBeGreaterThanOrEqual(389);
  expect(box.y).toBeLessThanOrEqual(1);
  expect(box.height).toBeGreaterThanOrEqual(843);
  const close = sheet.getByRole("button", { name: "Close", exact: true }).last();
  await expect(close).toBeInViewport({ ratio: 1 });
  await expect(sheet.getByRole("link", { name: "All versions", exact: true })).toBeInViewport({ ratio: 1 });
  await evidence(page, "390-sheet");
  await close.click();
  await expect(sheet).toHaveCount(0);
  await expect(entry(page)).toBeFocused();
});

test("320 px reflow without horizontal scrolling", async ({ page }) => {
  await anaOnTask(page, { width: 320, height: 720 });
  expect(await scrollWidth(page), "task page").toBeLessThanOrEqual(320);
  // The notice wraps inside the page.
  const notice = page.getByText("This project has guidelines (v1)", { exact: true });
  await expect(notice).toBeVisible();
  expect((await notice.boundingBox())!.x + (await notice.boundingBox())!.width).toBeLessThanOrEqual(320);
  await openGuidelines(page);
  const sheet = modal(page);
  await expect(sheet.getByText(V1_TEXT)).toBeVisible();
  expect(await scrollWidth(page), "sheet open").toBeLessThanOrEqual(320);
  const overflow = await sheet.evaluate(element => {
    const body = element.querySelector(".ui-dialog-body") as HTMLElement;
    return { body: body.scrollWidth - body.clientWidth, right: element.getBoundingClientRect().right };
  });
  expect(overflow.body, "sheet body horizontal overflow").toBeLessThanOrEqual(0);
  expect(overflow.right).toBeLessThanOrEqual(320);
  // A wide table scrolls inside its own container, not the page.
  const table = sheet.getByRole("region", { name: "Table", exact: true });
  await table.scrollIntoViewIfNeeded();
  expect((await table.boundingBox())!.x + (await table.boundingBox())!.width).toBeLessThanOrEqual(320);
  await evidence(page, "320-sheet");
});

test("keyboard-only path: Tab to More, the Guidelines item, Enter, Escape returns focus", async ({ page }) => {
  await anaOnTask(page, { width: 1280, height: 800 });
  await page.locator("body").focus();
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  await tabTo(page, entry(page));
  // ArrowUp opens the menu at its last item ("Keyboard shortcuts (?)"). Above it the editor's own action "Reset all
  // my changes…" (issue 320), then the screen's items "Help for this screen" and the guidelines item.
  for (const name of ["Keyboard shortcuts (?)", "Reset all my changes…", "Help for this screen", /^Guidelines v1/]) {
    await page.keyboard.press("ArrowUp");
    await expect(page.getByRole("menuitem", { name, exact: typeof name === "string" })).toBeFocused();
  }
  await page.keyboard.press("Enter");
  const panel = tabPanel(page);
  await expect(panel).toBeVisible();
  await expect(panel).toBeFocused();
  // Tab moves on into the guidelines text and their footer.
  await tabTo(page, panel.getByRole("link", { name: "All versions", exact: true }), 20);
  await page.keyboard.press("Escape");
  await expect(panel).toHaveCount(0);
  await expect(entry(page)).toBeFocused();
  // The notice's "Read guidelines v1" opens the same tab with Enter.
  await tabTo(page, page.getByRole("button", { name: "Read guidelines v1", exact: true }), 80);
  await page.keyboard.press("Enter");
  await expect(panel).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(panel).toHaveCount(0);
});

test("axe has no violations on the inspector with the guidelines, Settings › Guidelines and the withdraw dialog", async ({ page }) => {
  const s = await anaOnTask(page, { width: 1280, height: 800 });
  await openGuidelines(page);
  await expect(tabPanel(page).getByText(V1_TEXT)).toBeVisible();
  await evidence(page, "axe-inspector-guidelines");
  // Soft, so Settings and the withdraw dialog are still checked when the inspector fails.
  expect.soft(await axeViolations(page, ".inspector-pane"), "inspector with the guidelines").toEqual([]);

  const lead = await page.context().browser()!.newContext({ baseURL: test.info().project.use.baseURL, viewport: { width: 1280, height: 800 } });
  try {
    const leadPage = await lead.newPage();
    await loginGuidelineUser(leadPage, s, "lead");
    await leadPage.goto(`/#/projects/${encodeURIComponent(s.project)}/settings/guideline`);
    await expect(leadPage.getByRole("heading", { name: "In force Guidelines v1", level: 2, exact: true })).toBeVisible();
    await expect(leadPage.getByRole("table", { name: "Guideline versions" })).toBeVisible();
    expect(await axeViolations(leadPage, "main"), "Settings › Guidelines").toEqual([]);
    // With the publish form open, a chosen file and its preview.
    await leadPage.getByRole("button", { name: "Publish a new version", exact: true }).click();
    await leadPage.getByLabel("Guideline file (.md or .txt, up to 256 KB)", { exact: true }).setInputFiles(s.files["v2.md"]);
    await expect(leadPage.getByRole("button", { name: "Publish as v2", exact: true })).toBeVisible();
    expect(await axeViolations(leadPage, "main"), "Settings › Guidelines with preview").toEqual([]);
    await evidence(leadPage, "axe-settings");

    await leadPage.locator(".guidelines-current-actions").getByRole("button", { name: "More actions, v1", exact: true }).click();
    await leadPage.getByRole("menuitem", { name: "Withdraw v1…", exact: true }).click();
    const dialog = leadPage.getByRole("dialog", { name: "Withdraw v1?", exact: true });
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText("No guideline is in force until you publish a new version.");
    expect(await axeViolations(leadPage, '[role="dialog"]'), "withdraw dialog").toEqual([]);
    await evidence(leadPage, "axe-withdraw-dialog");
    await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
    await expect(dialog).toHaveCount(0);
  } finally {
    await lead.close();
  }
});

test("forced colours keep the New badge and the notice visible", async ({ page }) => {
  await page.emulateMedia({ forcedColors: "active" });
  await anaOnTask(page, { width: 1280, height: 800 });
  // The "New" badge is now the menu item's "(new)" text (no separate badge element to colour-check).
  await entry(page).click();
  await expect(page.getByRole("menuitem", { name: "Guidelines v1 (new)", exact: true })).toBeVisible();
  await page.keyboard.press("Escape");
  const title = page.getByText("This project has guidelines (v1)", { exact: true });
  await expect(title).toBeVisible();
  await expect(page.getByRole("button", { name: "Read guidelines v1", exact: true })).toBeVisible();
  // Text keeps a system colour distinct from its background; the notice keeps a visible edge.
  for (const [name, locator] of [["notice title", title]] as const) {
    const colours = await locator.evaluate(element => {
      let background = "rgba(0, 0, 0, 0)";
      for (let node: Element | null = element; node && /rgba\(0, 0, 0, 0\)|transparent/.test(background); node = node.parentElement) {
        background = getComputedStyle(node).backgroundColor;
      }
      return { color: getComputedStyle(element).color, background, hidden: getComputedStyle(element).visibility };
    });
    expect(colours.hidden, name).toBe("visible");
    expect(colours.color, name).not.toBe(colours.background);
  }
  const edge = await title.evaluate(element => {
    for (let node: Element | null = element; node; node = node.parentElement) {
      const style = getComputedStyle(node);
      if (style.borderTopStyle !== "none" && parseFloat(style.borderTopWidth) > 0) return true;
      if (style.borderLeftStyle !== "none" && parseFloat(style.borderLeftWidth) > 0) return true;
      if (node.matches(".notice")) break;
    }
    return false;
  });
  expect(edge, "notice keeps a border in forced colours").toBe(true);
  await evidence(page, "forced-colours");
});
