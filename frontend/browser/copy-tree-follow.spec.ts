import { expect, test, type Page } from "@playwright/test";
import { importPackage, loginAs, openCase, selectText } from "./helpers";

// The fixture document is "Hypotonia and seizure. A😀é\r\nB": "Hypotonia" 0-9, "and" 10-13, "seizure" 14-21, "B" 30-31.
// With proposals, "Hypotonia" (HP:0001252) and "seizure" (HP:0001250) are proposals to check.

const FIXTURE = "browser-fixture-copy-tree-follow";
const SCENARIO_B = "pkg-scenario-b-copy-tree"; // a reference layer and two texts: "Der Patient leidet an Epilepsie ..."
const SEIZURE = "HP:0001250";
const NERVOUS_SYSTEM = "HP:0000707";
const AREFLEXIA = "HP:0001284";
const HEARING = "HP:0000365";

const revision = (page: Page) => page.locator(".status-badge");
const search = (page: Page) => page.getByLabel("Search term", { exact: true });
const ownAnnotations = (page: Page) => page.locator(".sidebar [data-list-key^='annotation:']");
const showInTree = (page: Page) => page.getByRole("button", { name: "Show in tree" });
const treePanel = (page: Page) => page.getByRole("region", { name: "Ontology tree" });
const treeItem = (page: Page, termId: string) =>
  page.getByRole("tree", { name: "Terms" }).locator(`li[role="treeitem"][data-term-id="${termId}"]`);

/** Lets the page read the clipboard: Chromium needs both permissions, WebKit knows only "clipboard-read", Firefox none. */
async function allowClipboard(page: Page, browserName: string) {
  const permissions = { chromium: ["clipboard-read", "clipboard-write"], webkit: ["clipboard-read"] }[browserName];
  if (permissions) await page.context().grantPermissions(permissions);
}
/** Something else on the clipboard first, so a copy that did nothing cannot pass. */
const resetClipboard = (page: Page) => page.evaluate(() => navigator.clipboard.writeText("-"));
const clipboard = (page: Page) => page.evaluate(() => navigator.clipboard.readText());

/**
 * Ctrl+C (Cmd+C), and what it put on the clipboard. WebKit on Windows fires the copy event but never writes
 * the system clipboard from the keyboard, so there the event tells: the text a handler set, or else the
 * page's own selection, which the browser copies.
 */
async function copyByKeyboard(page: Page, browserName: string, expected: string) {
  if (browserName !== "webkit") {
    await resetClipboard(page);
    await page.keyboard.press("ControlOrMeta+c");
    await expect.poll(() => clipboard(page)).toBe(expected);
    return;
  }
  const copied = page.evaluate(() => new Promise<string>((resolve) => {
    window.addEventListener("copy", (event) => {
      const active = document.activeElement;
      const own = active instanceof HTMLInputElement ? active.value.slice(active.selectionStart ?? 0, active.selectionEnd ?? 0)
        : window.getSelection()?.toString() ?? "";
      resolve(event.defaultPrevented ? event.clipboardData?.getData("text/plain") ?? "" : own);
    }, { once: true });
  }));
  await page.keyboard.press("ControlOrMeta+c");
  expect(await copied).toBe(expected);
}

async function expectCopyButton(page: Page, scope: ReturnType<Page["locator"]>, text: string) {
  await resetClipboard(page);
  const button = scope.getByRole("button", { name: /^(Copy text|Copied)$/ });
  await button.click();
  await expect(button).toHaveAccessibleName("Copied");
  await expect.poll(() => clipboard(page)).toBe(text);
  // The label is back after about two seconds.
  await expect(button).toHaveAccessibleName("Copy text", { timeout: 4000 });
}

/** Mark text, search a term and pick it; the new annotation stays selected. */
async function annotate(page: Page, start: number, end: number, query: string, termId: string, expectedRevision: number) {
  await selectText(page, start, end);
  await search(page).fill(query);
  await page.locator(".candidate-card").filter({ hasText: termId }).click();
  await expect(revision(page)).toHaveAttribute("title", `Revision ${expectedRevision}`);
  await expect(page.locator(".inspector-pane h2")).toContainText(termId);
}

test.describe("copy the marked text", () => {
  test.beforeEach(async ({ page, browserName }) => { await allowClipboard(page, browserName); });

  test("Ctrl+C and 'Copy text' copy a new finding's marked text; a field's own selection copies as usual", async ({ page, browserName }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await importPackage(page, "", FIXTURE, "copy-pending");
    await openCase(page, { task: "annotate" });

    await selectText(page, 14, 21);
    await expect(search(page)).toBeVisible();
    await copyByKeyboard(page, browserName, "seizure");

    // Typed into the search, its prefill is no longer selected: the marked text is copied, not the query.
    await search(page).fill("Seiz");
    await search(page).press("End");
    await copyByKeyboard(page, browserName, "seizure");

    // Text selected in the search field is copied as usual.
    await search(page).fill("Status");
    await search(page).selectText();
    await copyByKeyboard(page, browserName, "Status");

    // The button at the quote of the new finding.
    await expectCopyButton(page, page.locator(".inspector-pane"), "seizure");

    // Esc still discards the new finding; nothing was saved.
    await search(page).focus();
    await page.keyboard.press("Escape");
    await expect(page.locator(".text-container .run--marked")).toHaveCount(0);
    await expect(revision(page)).toHaveAttribute("title", "Revision 0");

    // And the annotation flow is unchanged.
    await annotate(page, 14, 21, "Seizure", SEIZURE, 1);
    await expect(ownAnnotations(page)).toHaveCount(1);
  });

  test("a selected finding copies its mention, several segments joined by a space", async ({ page, browserName }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await importPackage(page, "", FIXTURE, "copy-finding");
    await openCase(page, { task: "annotate" });
    await annotate(page, 0, 9, "Hypotonia", "HP:0001252", 1);

    // Selected again from the list, with the focus there and no text selection on the page.
    await page.getByRole("button", { name: "Clear selection" }).click();
    await ownAnnotations(page).first().click();
    await expect(page.locator(".inspector-pane h2")).toContainText("HP:0001252");
    await copyByKeyboard(page, browserName, "Hypotonia");
    const card = page.locator(".mention-card").first();
    await expectCopyButton(page, card, "Hypotonia");

    await page.getByRole("button", { name: "Add segment", exact: true }).click();
    await selectText(page, 14, 21);
    await expect(revision(page)).toHaveAttribute("title", "Revision 2");
    // selectText leaves a page selection behind, which a real mouse would not after the segment was added.
    await page.evaluate(() => window.getSelection()?.removeAllRanges());
    await copyByKeyboard(page, browserName, "Hypotonia seizure");
    await expectCopyButton(page, page.locator(".mention-card").first(), "Hypotonia seizure");
  });

  test("at 600 px the 'New finding' bar has 'Copy text'", async ({ page }) => {
    await page.setViewportSize({ width: 600, height: 800 });
    await importPackage(page, "", FIXTURE, "copy-narrow");
    await openCase(page, { task: "annotate" });
    await selectText(page, 0, 9);
    const bar = page.getByRole("group", { name: "New finding", exact: true });
    await expect(bar).toBeVisible();
    await expectCopyButton(page, bar, "Hypotonia");
    // Nothing overflows the page because of the extra button.
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBeTruthy();

    // At phone width it is an icon, so the quote keeps its room; it copies the same.
    await page.setViewportSize({ width: 375, height: 800 });
    const icon = bar.getByRole("button", { name: "Copy text" });
    await expect(icon).toHaveText("");
    await resetClipboard(page);
    await icon.click();
    await expect.poll(() => clipboard(page)).toBe("Hypotonia");
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBeTruthy();
  });
});

test.describe("the open tree follows the selection", () => {
  test("another own finding restarts it, a proposal or no selection closes it, a new finding sets it aside", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 1200 });
    await importPackage(page, "", FIXTURE, "tree-follow", { proposals: true });
    await openCase(page, { task: "annotate" });
    await annotate(page, 10, 13, "Areflexia", AREFLEXIA, 1);
    await annotate(page, 30, 31, "Hearing", HEARING, 2);
    const opens: string[] = [];
    page.on("request", (request) => {
      if (request.url().endsWith("/api/v1/terms/tree/open")) opens.push(String(request.postDataJSON()?.term_id));
    });
    const panel = treePanel(page);
    const own = (termId: string) => ownAnnotations(page).filter({ hasText: termId });

    await showInTree(page).click();
    await expect(treeItem(page, HEARING)).toHaveAttribute("aria-current", "true");
    expect(opens).toEqual([HEARING]);

    // Another own finding: exactly one new walk, at its term.
    await own(AREFLEXIA).click();
    await expect(treeItem(page, AREFLEXIA)).toHaveAttribute("aria-current", "true");
    await expect(treeItem(page, AREFLEXIA)).toHaveAttribute("aria-selected", "true");
    await page.waitForTimeout(300);
    expect(opens).toEqual([HEARING, AREFLEXIA]);

    // A proposal: nothing to assign there, the tree closes.
    await page.locator(".sidebar .doc-item").filter({ hasText: "HP:0001252" }).click();
    await expect(page.getByLabel(/Proposal details/i)).toBeVisible();
    await expect(panel).toHaveCount(0);
    await expect(page.locator(".tree-host")).toHaveCount(0);

    // Back on an own finding it stays closed until "Show in tree".
    await own(AREFLEXIA).click();
    await page.waitForTimeout(300);
    await expect(panel).toHaveCount(0);
    await showInTree(page).click();
    await expect(treeItem(page, AREFLEXIA)).toHaveAttribute("aria-current", "true");

    // No selection closes it too.
    await page.getByRole("button", { name: "Clear selection" }).click();
    await expect(panel).toHaveCount(0);
    await own(HEARING).click();
    await showInTree(page).click();
    await expect(treeItem(page, HEARING)).toHaveAttribute("aria-current", "true");
    expect(opens).toEqual([HEARING, AREFLEXIA, AREFLEXIA, HEARING]);

    // A new finding sets it aside; Esc discards that, and the tree is back on the same walk.
    await selectText(page, 14, 21);
    await expect(search(page)).toBeVisible();
    await expect(panel).toHaveCount(0);
    await expect(page.locator(".tree-host")).toBeHidden();
    await search(page).focus();
    await page.keyboard.press("Escape");
    await expect(panel).toBeVisible();
    await expect(treeItem(page, HEARING)).toHaveAttribute("aria-current", "true");
    expect(opens).toHaveLength(4);

    // "Use this term": the tree stays open and marks the new term as current, without a new walk.
    await own(AREFLEXIA).click();
    await expect(treeItem(page, AREFLEXIA)).toHaveAttribute("aria-current", "true");
    await treeItem(page, NERVOUS_SYSTEM).click();
    await panel.getByRole("button", { name: "Use this term" }).click();
    await expect(revision(page)).toHaveAttribute("title", "Revision 3");
    await expect(panel).toBeVisible();
    await expect(treeItem(page, NERVOUS_SYSTEM)).toHaveAttribute("aria-current", "true");
    await expect(treeItem(page, AREFLEXIA)).not.toHaveAttribute("aria-current", "true");
    await expect(page.locator(".inspector-pane h2")).toContainText(NERVOUS_SYSTEM);
    await page.waitForTimeout(300);
    expect(opens).toEqual([HEARING, AREFLEXIA, AREFLEXIA, HEARING, AREFLEXIA]);

    // Escape in the tree widget closes it; the finding stays selected.
    await treeItem(page, NERVOUS_SYSTEM).click();
    await page.keyboard.press("Escape");
    await expect(panel).toHaveCount(0);
    await expect(page.locator(".inspector-pane h2")).toContainText(NERVOUS_SYSTEM);
  });

  test("a reference closes the tree, and so does moving to another text", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 1200 });
    await loginAs(page, "tree-follow-ref", [SCENARIO_B], { proposals: true });
    await page.goto(`/#/?project=${SCENARIO_B}`);
    await openCase(page, { task: "annotate", projectKey: SCENARIO_B });
    await annotate(page, 4, 11, "Seizure", SEIZURE, 1); // "Patient"
    const panel = treePanel(page);

    await showInTree(page).click();
    await expect(treeItem(page, SEIZURE)).toHaveAttribute("aria-current", "true");
    await page.getByRole("button", { name: /MONDO:0005027/ }).click();
    await expect(page.getByLabel(/Reference details/i)).toBeVisible();
    await expect(panel).toHaveCount(0);

    await ownAnnotations(page).first().click();
    await showInTree(page).click();
    await expect(panel).toBeVisible();
    await page.locator(".case-navigation").getByRole("button", { name: /Next text/i }).click();
    await expect(page.locator(".case-navigation select option:checked")).toHaveText(/Text 2 of 2/i);
    await expect(panel).toHaveCount(0);
    await page.locator(".case-navigation").getByRole("button", { name: /Previous text/i }).click();
    await expect(page.locator(".case-navigation select option:checked")).toHaveText(/Text 1 of 2/i);
    await expect(ownAnnotations(page)).toHaveCount(1);
    await expect(panel).toHaveCount(0);
  });
});
