import { expect, test, type Page } from "@playwright/test";
import { importPackage, loginAs, loginExisting, openCase, selectText, submitCase, viewSubmittedResult } from "./helpers";

// The fixture document is "Hypotonia and seizure. A😀é\r\nB": "Hypotonia" 0-9, "and" 10-13, "seizure" 14-21, "B" 30-31.
// With proposals, "Hypotonia" (HP:0001252) and "seizure" (HP:0001250) are proposals to check.

const FIXTURE = "browser-fixture-copy-tree-follow";
const SCENARIO_B = "pkg-scenario-b-copy-tree"; // a reference layer and two texts: "Der Patient leidet an Epilepsie ..."
const SEIZURE = "HP:0001250";
const NERVOUS_SYSTEM = "HP:0000707";
const AREFLEXIA = "HP:0001284";
const HEARING = "HP:0000365";
const HYPOTONIA = "HP:0001252";
// tests/browser_server.py COPY_PASSAGE_TEXT: a line break after "weakness", 108 characters (the prefill keeps 80 at most).
const PASSAGE_PROJECT = "pkg-copy-passage";
const PASSAGE = "Mild weakness\nof both legs, worse in the evening and after long walks, with frequent falls since the spring.";
const PASSAGE_ONE_LINE = PASSAGE.replace("\n", " ");
const LOOK_NOTE = "Only looking: nothing can be changed from here.";
const CHOOSE_NOTE = "Only looking: nothing changes until you choose a term and confirm.";

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

  test("Ctrl+C right after marking a passage over a line break copies all of it on one line; a selection made in the field copies just that", async ({ page, browserName }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await importPackage(page, "", PASSAGE_PROJECT, "copy-long");
    await openCase(page, { task: "annotate" });

    await selectText(page, 0, PASSAGE.length);
    // The search starts with the marked words, shortened and selected.
    await expect(search(page)).toBeFocused();
    const prefill = await search(page).inputValue();
    expect(prefill.length).toBeLessThan(PASSAGE_ONE_LINE.length);
    expect(await search(page).evaluate((field: HTMLInputElement) => [field.selectionStart, field.selectionEnd])).toEqual([0, prefill.length]);
    await copyByKeyboard(page, browserName, PASSAGE_ONE_LINE);
    // Again: the copy did not touch it.
    await copyByKeyboard(page, browserName, PASSAGE_ONE_LINE);
    await expectCopyButton(page, page.locator(".inspector-pane"), PASSAGE_ONE_LINE);

    // A part of the field selected by hand copies just that part.
    await search(page).click();
    await search(page).press("End");
    for (let step = 0; step < 4; step += 1) await search(page).press("Shift+ArrowLeft");
    await copyByKeyboard(page, browserName, prefill.slice(-4));
    // The whole field selected by hand copies the field.
    await search(page).press("ControlOrMeta+a");
    await copyByKeyboard(page, browserName, prefill);
    // No selection in the field: the passage again.
    await search(page).press("End");
    await copyByKeyboard(page, browserName, PASSAGE_ONE_LINE);

    // Text selected in the text pane (here not yet committed as a mark) copies as it stands, line break included,
    // as plain text only: no colours of the marks.
    await page.locator(".text-container").evaluate((container) => {
      (document.activeElement as HTMLElement | null)?.blur();
      const runs = [...container.querySelectorAll<HTMLElement>(".run")];
      const at = (offset: number): [Node, number] => {
        const run = [...runs].reverse().find((candidate) => Number(candidate.dataset.start) <= offset)!;
        return [run.firstChild!, offset - Number(run.dataset.start)];
      };
      const range = document.createRange();
      range.setStart(...at(5));
      range.setEnd(...at(26));
      window.getSelection()!.removeAllRanges();
      window.getSelection()!.addRange(range);
    });
    await copyByKeyboard(page, browserName, "weakness\nof both legs");
    if (browserName === "chromium") {
      const types = await page.evaluate(async () => (await navigator.clipboard.read()).flatMap((item) => [...item.types]));
      expect(types).toEqual(["text/plain"]);
    }
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

    // It is an icon at every width, so the quote keeps its room; at phone width it copies the same.
    await page.setViewportSize({ width: 375, height: 800 });
    const icon = bar.getByRole("button", { name: /^(Copy text|Copied)$/ });
    await expect(icon).toHaveText("");
    await expect(icon).toHaveAccessibleName("Copy text", { timeout: 4000 });
    await resetClipboard(page);
    await icon.click();
    await expect.poll(() => clipboard(page)).toBe("Hypotonia");
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBeTruthy();
  });
});

test.describe("the open tree follows the selection", () => {
  test("another finding or a proposal restarts it, no selection closes it, a new finding sets it aside", async ({ page }) => {
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

    // A proposal (issue 523): the tree moves to the proposed term, only to look until a term is confirmed.
    await page.locator(".sidebar .doc-item").filter({ hasText: HYPOTONIA }).click();
    await expect(page.getByLabel(/Proposal details/i)).toBeVisible();
    await expect(treeItem(page, HYPOTONIA)).toHaveAttribute("aria-current", "true");
    await expect(panel.getByRole("status")).toHaveText(CHOOSE_NOTE);
    await expect(panel.getByRole("button", { name: "Use this term", exact: true })).toHaveCount(0);

    // Back on an own finding it follows there and assigns directly again.
    await own(AREFLEXIA).click();
    await expect(treeItem(page, AREFLEXIA)).toHaveAttribute("aria-current", "true");
    await expect(panel.getByRole("status")).toHaveCount(0);
    await expect(panel.getByRole("button", { name: "Use this term", exact: true })).toBeVisible();

    // No selection closes it.
    await page.getByRole("button", { name: "Clear selection" }).click();
    await expect(panel).toHaveCount(0);
    await own(HEARING).click();
    await page.waitForTimeout(300);
    await expect(panel).toHaveCount(0);
    await showInTree(page).click();
    await expect(treeItem(page, HEARING)).toHaveAttribute("aria-current", "true");
    expect(opens).toEqual([HEARING, AREFLEXIA, HYPOTONIA, AREFLEXIA, HEARING]);

    // A new finding sets it aside; Esc discards that, and the tree is back on the same walk.
    await selectText(page, 14, 21);
    await expect(search(page)).toBeVisible();
    await expect(panel).toHaveCount(0);
    await expect(page.locator(".tree-host")).toBeHidden();
    await search(page).focus();
    await page.keyboard.press("Escape");
    await expect(panel).toBeVisible();
    await expect(treeItem(page, HEARING)).toHaveAttribute("aria-current", "true");
    expect(opens).toHaveLength(5);

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
    expect(opens).toEqual([HEARING, AREFLEXIA, HYPOTONIA, AREFLEXIA, HEARING, AREFLEXIA]);

    // Escape in the tree widget closes it; the finding stays selected.
    await treeItem(page, NERVOUS_SYSTEM).click();
    await page.keyboard.press("Escape");
    await expect(panel).toHaveCount(0);
    await expect(page.locator(".inspector-pane h2")).toContainText(NERVOUS_SYSTEM);
  });

  test("a reference moves the tree there to look; moving to another text closes it", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 1200 });
    await loginAs(page, "tree-follow-ref", [SCENARIO_B], { proposals: true });
    await page.goto(`/#/?project=${SCENARIO_B}`);
    await openCase(page, { task: "annotate", projectKey: SCENARIO_B });
    await annotate(page, 4, 11, "Seizure", SEIZURE, 1); // "Patient"
    const panel = treePanel(page);

    await showInTree(page).click();
    await expect(treeItem(page, SEIZURE)).toHaveAttribute("aria-current", "true");
    await page.getByRole("button", { name: /MONDO:0000001/ }).click();
    await expect(page.getByLabel(/Reference details/i)).toBeVisible();
    await expect(treeItem(page, "MONDO:0000001")).toHaveAttribute("aria-current", "true");
    await expect(panel.getByRole("status")).toHaveText(LOOK_NOTE);
    await expect(panel.getByRole("button", { name: /Use this term/ })).toHaveCount(0);

    await ownAnnotations(page).first().click();
    await expect(treeItem(page, SEIZURE)).toHaveAttribute("aria-current", "true");
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

// A desktop and a phone window, each with its own users. No console error and no horizontal scroll at any step.
// COPY_TREE_SHOTS=<directory> saves a screenshot of each changed screen.
const SIZES = [
  { name: "desktop", width: 1440, height: 900 },
  { name: "phone", width: 390, height: 844 },
] as const;

function consoleErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on("console", message => { if (message.type() === "error") errors.push(message.text()); });
  page.on("pageerror", error => errors.push(error.message));
  return errors;
}

async function expectNoSidewaysScroll(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBeTruthy();
}

async function shot(page: Page, name: string) {
  await expectNoSidewaysScroll(page);
  const directory = process.env.COPY_TREE_SHOTS;
  if (directory) await page.screenshot({ path: `${directory}/${name}.png` });
}

for (const size of SIZES) {
  const phone = size.name === "phone";
  /** At phone width one pane shows at a time; a wide window has no pane tabs. */
  const pane = async (page: Page, name: "Document" | "Findings" | "Details") => {
    if (phone) await page.getByRole("navigation", { name: "Select view" }).getByRole("button", { name: name === "Findings" ? /^Findings/ : name }).click();
  };

  /** The first finding of the text; at phone width the term search opens from the "New finding" bar. */
  const annotateHere = async (page: Page, start: number, end: number, query: string, termId: string) => {
    await selectText(page, start, end);
    if (phone) await page.getByRole("group", { name: "New finding", exact: true }).getByRole("button", { name: "Choose term", exact: true }).click();
    await search(page).fill(query);
    await page.locator(".candidate-card").filter({ hasText: termId }).click();
    await expect(revision(page)).toHaveAttribute("title", "Revision 1");
  };

  test.describe(`${size.width} px: copy text and the tree that closes`, () => {
    test.beforeEach(async ({ page, browserName }) => {
      await allowClipboard(page, browserName);
      await page.setViewportSize({ width: size.width, height: size.height });
    });

    test("'Copy text' and Ctrl+C copy the passage of a new finding and of a mention", async ({ page, browserName }) => {
      const errors = consoleErrors(page);
      await importPackage(page, "", FIXTURE, `copy-${size.name}`);
      await openCase(page, { task: "annotate" });

      await selectText(page, 14, 21);
      if (phone) {
        // The text stays in view; the "New finding" bar holds the button, as an icon.
        const bar = page.getByRole("group", { name: "New finding", exact: true });
        const icon = bar.getByRole("button", { name: "Copy text" });
        // The workspace is as high as the window and starts under the header: the bar sticks to the window's bottom (issue 452).
        await expect(icon).toBeInViewport({ ratio: 1 });
        await shot(page, `${size.name}-new-finding-bar`);
        await resetClipboard(page);
        await icon.click();
        await expect.poll(() => clipboard(page)).toBe("seizure");
        await shot(page, `${size.name}-new-finding-bar-copied`);
        await bar.getByRole("button", { name: "Choose term" }).click();
      }
      await expect(search(page)).toBeVisible();
      const panel = page.locator(".inspector-pane");
      const button = panel.getByRole("button", { name: /^(Copy text|Copied)$/ });
      await expect(button).toBeInViewport({ ratio: 1 });
      await shot(page, `${size.name}-new-finding`);
      await resetClipboard(page);
      await button.click();
      await expect(button).toHaveAccessibleName("Copied");
      await expect.poll(() => clipboard(page)).toBe("seizure");
      await shot(page, `${size.name}-new-finding-copied`);
      await expect(button).toHaveAccessibleName("Copy text", { timeout: 4000 });

      // Ctrl+C in the search field, nothing selected in it or on the page: the marked text, not the query.
      await search(page).fill("Seiz");
      await search(page).press("End");
      await page.evaluate(() => window.getSelection()?.removeAllRanges());
      expect(await page.evaluate(() => window.getSelection()?.toString())).toBe("");
      await copyByKeyboard(page, browserName, "seizure");
      // Text selected in the field is copied as usual.
      await search(page).fill("Status epi");
      await search(page).evaluate((field: HTMLInputElement) => field.setSelectionRange(0, 6));
      await copyByKeyboard(page, browserName, "Status");

      // The saved finding: the button at its mention card, and Ctrl+C with the focus in the list.
      await search(page).fill("Seizure");
      await page.locator(".candidate-card").filter({ hasText: SEIZURE }).click();
      await expect(revision(page)).toHaveAttribute("title", "Revision 1");
      await pane(page, "Details");
      const card = page.locator(".mention-card").first();
      await card.scrollIntoViewIfNeeded();
      await expectCopyButton(page, card, "seizure");
      await page.getByRole("button", { name: "Add segment", exact: true }).click();
      await pane(page, "Document");
      await selectText(page, 0, 9);
      await expect(revision(page)).toHaveAttribute("title", "Revision 2");
      await page.evaluate(() => window.getSelection()?.removeAllRanges());
      // The finding is still selected: with the focus in the list and nothing selected on the page.
      await pane(page, "Findings");
      await ownAnnotations(page).first().focus();
      await copyByKeyboard(page, browserName, "Hypotonia seizure");
      await pane(page, "Details");
      await card.scrollIntoViewIfNeeded();
      await resetClipboard(page);
      const mentionButton = card.getByRole("button", { name: /^(Copy text|Copied)$/ });
      await mentionButton.click();
      await expect(mentionButton).toHaveAccessibleName("Copied");
      await expect.poll(() => clipboard(page)).toBe("Hypotonia seizure");
      await shot(page, `${size.name}-mention-copied`);
      // The other buttons of the card did not move for the longer or shorter label.
      const before = await card.locator(".mention-card__actions").boundingBox();
      await expect(mentionButton).toHaveAccessibleName("Copy text", { timeout: 4000 });
      expect(await card.locator(".mention-card__actions").boundingBox()).toEqual(before);
      await shot(page, `${size.name}-mention`);
      expect(errors).toEqual([]);
    });

    test("the tree follows to a proposal to look and closes on no selection; 'Show in tree' opens it again", async ({ page }) => {
      const errors = consoleErrors(page);
      await importPackage(page, "", FIXTURE, `tree-${size.name}`, { proposals: true });
      await openCase(page, { task: "annotate" });
      await annotateHere(page, 30, 31, "Hearing", HEARING);
      await pane(page, "Details");
      await showInTree(page).click();
      await expect(treeItem(page, HEARING)).toHaveAttribute("aria-current", "true");
      await shot(page, `${size.name}-tree-open`);

      await pane(page, "Findings");
      await page.locator(".sidebar .doc-item").filter({ hasText: "HP:0001252" }).click();
      await pane(page, "Details");
      await expect(page.getByLabel(/Proposal details/i)).toBeVisible();
      await expect(treeItem(page, HYPOTONIA)).toHaveAttribute("aria-current", "true");
      await expect(treePanel(page).getByRole("status")).toHaveText(CHOOSE_NOTE);
      await shot(page, `${size.name}-tree-proposal`);

      await pane(page, "Findings");
      await ownAnnotations(page).filter({ hasText: HEARING }).click();
      await pane(page, "Details");
      await expect(page.locator(".inspector-pane h2")).toContainText(HEARING);
      await expect(treeItem(page, HEARING)).toHaveAttribute("aria-current", "true");

      await page.getByRole("button", { name: "Clear selection" }).click();
      await expect(treePanel(page)).toHaveCount(0);
      await expect(page.locator(".tree-host")).toHaveCount(0);
      await shot(page, `${size.name}-tree-closed-no-selection`);

      await pane(page, "Findings");
      await ownAnnotations(page).filter({ hasText: HEARING }).click();
      await pane(page, "Details");
      await showInTree(page).click();
      await expect(treePanel(page)).toBeVisible();
      await expect(treeItem(page, HEARING)).toHaveAttribute("aria-current", "true");
      expect(errors).toEqual([]);
    });

    test("the tree follows to a reference to look; 'Show in tree' opens it again", async ({ page }) => {
      const errors = consoleErrors(page);
      await loginAs(page, `tree-ref-${size.name}`, [SCENARIO_B], { proposals: true });
      await page.goto(`/#/?project=${SCENARIO_B}`);
      await openCase(page, { task: "annotate", projectKey: SCENARIO_B });
      await annotateHere(page, 4, 11, "Seizure", SEIZURE);
      await pane(page, "Details");
      await showInTree(page).click();
      await expect(treeItem(page, SEIZURE)).toHaveAttribute("aria-current", "true");

      await pane(page, "Findings");
      await page.getByRole("button", { name: /MONDO:0000001/ }).click();
      await pane(page, "Details");
      await expect(page.getByLabel(/Reference details/i)).toBeVisible();
      await expect(treeItem(page, "MONDO:0000001")).toHaveAttribute("aria-current", "true");
      await expect(treePanel(page).getByRole("status")).toHaveText(LOOK_NOTE);
      await expect(treePanel(page).getByRole("button", { name: /Use this term/ })).toHaveCount(0);
      await shot(page, `${size.name}-tree-reference`);

      await page.keyboard.press("Escape");
      await expect(treePanel(page)).toHaveCount(0);
      await pane(page, "Findings");
      await ownAnnotations(page).first().click();
      await pane(page, "Details");
      await expect(treePanel(page)).toHaveCount(0);
      await showInTree(page).click();
      await expect(treePanel(page)).toBeVisible();
      await expect(treeItem(page, SEIZURE)).toHaveAttribute("aria-current", "true");
      await expectNoSidewaysScroll(page);
      expect(errors).toEqual([]);
    });
  });

  // Issue 523: the tree opens only to look from a proposal, a search hit, a reference and a submitted finding;
  // a term is taken from it only after a confirmation that says what happens.
  test.describe(`${size.width} px: the tree only to look`, () => {
    test.beforeEach(async ({ page }) => { await page.setViewportSize({ width: size.width, height: size.height }); });
    const take = (page: Page) => treePanel(page).getByRole("button", { name: "Use this term instead…" });

    test("an undecided proposal: look at its neighbours, then confirm another term: decided as Changed", async ({ page }) => {
      const errors = consoleErrors(page);
      await importPackage(page, "", FIXTURE, `look-proposal-${size.name}`, { proposals: true });
      await openCase(page, { task: "annotate" });
      await pane(page, "Findings");
      await page.locator(".sidebar .doc-item").filter({ hasText: HYPOTONIA }).click();
      await pane(page, "Details");
      await page.getByLabel(/Proposal details/i).getByRole("button", { name: "Show in tree" }).click();
      await expect(treeItem(page, HYPOTONIA)).toHaveAttribute("aria-current", "true");
      await expect(treePanel(page).getByRole("status")).toHaveText(CHOOSE_NOTE);
      await expect(take(page)).toBeDisabled();

      // Looking changes nothing.
      await treeItem(page, AREFLEXIA).click();
      await expect(treePanel(page).locator(".tree-detail__name")).toHaveText("Areflexia");
      await expect(revision(page)).toHaveAttribute("title", "Revision 0");
      await shot(page, `${size.name}-look-proposal`);

      // The confirmation says what happens, takes the focus, and Cancel changes nothing.
      await take(page).click();
      const confirm = treePanel(page).getByRole("group", { name: `Proposal: decide as Changed with Areflexia (${AREFLEXIA})` });
      await expect(confirm).toBeVisible();
      await expect(confirm.getByRole("button", { name: "Confirm" })).toBeFocused();
      await shot(page, `${size.name}-look-proposal-confirm`);
      await page.keyboard.press("Escape");
      await expect(confirm).toHaveCount(0);
      await expect(take(page)).toBeFocused();
      await expect(revision(page)).toHaveAttribute("title", "Revision 0");

      // From the keyboard: Enter opens the confirmation, Enter confirms.
      await page.keyboard.press("Enter");
      await expect(confirm.getByRole("button", { name: "Confirm" })).toBeFocused();
      await page.keyboard.press("Enter");
      await expect(page.getByText(/^Your replacement for the proposal/)).toBeVisible();
      await expect(page.locator(".inspector-pane h2")).toContainText(AREFLEXIA);
      // The tree stays with the copy, which now takes a term directly.
      await expect(treeItem(page, AREFLEXIA)).toHaveAttribute("aria-current", "true");
      await expect(treePanel(page).getByRole("status")).toHaveCount(0);
      await expect(treePanel(page).getByRole("button", { name: "Use this term", exact: true })).toBeDisabled();
      await pane(page, "Findings");
      await expect(page.locator(".sidebar .doc-item").filter({ hasText: HYPOTONIA }).first()).toContainText("Replaced");
      await shot(page, `${size.name}-look-proposal-changed`);
      expect(errors).toEqual([]);
    });

    test("a search hit of a new finding: look in the tree, then confirm a term: the finding gets it", async ({ page }) => {
      const errors = consoleErrors(page);
      await importPackage(page, "", FIXTURE, `look-new-${size.name}`);
      await openCase(page, { task: "annotate" });
      await selectText(page, 14, 21);
      if (phone) await page.getByRole("group", { name: "New finding", exact: true }).getByRole("button", { name: "Choose term", exact: true }).click();
      await search(page).fill("Seizure");
      // The button belongs to the active hit; the pointer makes a hit active.
      await page.getByRole("option", { name: /^Seizure HP:0001250/ }).hover();
      await page.getByRole("button", { name: "Show in tree: Seizure" }).click();
      await expect(treeItem(page, SEIZURE)).toHaveAttribute("aria-selected", "true");
      await expect(treePanel(page).getByRole("status")).toHaveText(CHOOSE_NOTE);
      // The search stays: the tree is beside it, not instead of it.
      await expect(search(page)).toBeAttached();
      await shot(page, `${size.name}-look-new`);

      await treeItem(page, "HP:0011146").click();
      await expect(treePanel(page).locator(".tree-detail__name")).toHaveText("Dialeptic seizure");
      await expect(revision(page)).toHaveAttribute("title", "Revision 0");
      await take(page).click();
      const confirm = treePanel(page).getByRole("group", { name: "New finding: choose Dialeptic seizure (HP:0011146)" });
      await expect(confirm.getByRole("button", { name: "Confirm" })).toBeFocused();
      await shot(page, `${size.name}-look-new-confirm`);
      await confirm.getByRole("button", { name: "Confirm" }).click();
      await expect(revision(page)).toHaveAttribute("title", "Revision 1");
      await expect(ownAnnotations(page)).toHaveCount(1);
      await expect(ownAnnotations(page)).toContainText("HP:0011146");
      await expect(treeItem(page, "HP:0011146")).toHaveAttribute("aria-current", "true");
      await expect(treePanel(page).getByRole("button", { name: "Use this term", exact: true })).toBeVisible();
      expect(errors).toEqual([]);
    });

    test("a submitted own finding: the tree only shows terms, with no button", async ({ page }) => {
      await importPackage(page, "", FIXTURE, `look-submitted-${size.name}`);
      await openCase(page, { task: "annotate" });
      await annotateHere(page, 14, 21, "Seizure", SEIZURE);
      // The submit's first answer can be the 422 of the unconfirmed values: errors count from here on.
      await submitCase(page);
      await viewSubmittedResult(page);
      const errors = consoleErrors(page);
      await pane(page, "Findings");
      await ownAnnotations(page).first().click();
      await pane(page, "Details");
      await showInTree(page).click();
      await expect(treeItem(page, SEIZURE)).toHaveAttribute("aria-current", "true");
      await expect(treePanel(page).getByRole("status")).toHaveText(LOOK_NOTE);
      await treeItem(page, "HP:0011146").click();
      await expect(treePanel(page).locator(".tree-detail__name")).toHaveText("Dialeptic seizure");
      await expect(treePanel(page).getByRole("button", { name: /Use this term/ })).toHaveCount(0);
      await shot(page, `${size.name}-look-submitted`);
      expect(errors).toEqual([]);
    });

    test("other people's findings in a blinded consolidation: only to look, and no names", async ({ page }) => {
      test.setTimeout(240_000);
      const response = await page.request.post("/__test_consolidation__", { params: { started: "true", blind: "true" }, timeout: 120_000 });
      expect(response.ok(), await response.text()).toBeTruthy();
      const scenario = await response.json() as { users: Record<string, string>; pseudonyms: Record<string, string>; assignment_id: number };
      const secrets = ["ann-0001", "ann-0002"].flatMap(name => [scenario.users[name], scenario.pseudonyms[name]]);
      const leaks: string[] = [];
      page.on("response", async answer => {
        if (!new URL(answer.url()).pathname.startsWith("/api/v1/terms/tree/")) return;
        const body = await answer.text().catch(() => "");
        for (const secret of secrets) if (body.includes(secret)) leaks.push(`${answer.url()}: ${secret}`);
      });
      await loginExisting(page, scenario.users.adj);
      await page.goto(`/#/tasks/${scenario.assignment_id}`);
      await expect(page.getByRole("heading", { level: 1, name: /^Consolidate / })).toBeVisible({ timeout: 30_000 });
      await page.getByRole("button", { name: "Open in full editor", exact: true }).click();
      await pane(page, "Findings");
      await expect(page.getByText(/^Selected submitted findings \([1-9]\d*\)$/)).toBeVisible({ timeout: 30_000 });
      await page.locator('.sidebar [data-list-key^="target:"]').first().click();
      await pane(page, "Details");
      await page.getByLabel(/Proposal details/i).getByRole("button", { name: "Show in tree" }).click();
      await expect(treePanel(page).getByRole("status")).toHaveText(LOOK_NOTE);
      await expect(treePanel(page).locator(".tree-detail__name")).not.toHaveText("");
      await expect(treePanel(page).getByRole("button", { name: /Use this term/ })).toHaveCount(0);
      const opened = await page.evaluate(() => document.querySelector(".tree-host")?.textContent ?? "");
      expect(secrets.filter(secret => opened.includes(secret))).toEqual([]);
      expect(await page.locator("body").innerText().then(text => secrets.filter(secret => text.includes(secret)))).toEqual([]);
      await shot(page, `${size.name}-look-consolidation`);
      expect(leaks).toEqual([]);
    });
  });
}

test("1280x600: the tree of a proposal takes the column too, the proposal stays in one line (issue 542)", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 600 });
  await importPackage(page, "", FIXTURE, "low-proposal", { proposals: true });
  await openCase(page, { task: "annotate" });
  await page.locator(".sidebar .doc-item").filter({ hasText: HYPOTONIA }).click();
  await page.getByLabel(/Proposal details/i).getByRole("button", { name: "Show in tree" }).click();
  await expect(treeItem(page, HYPOTONIA)).toHaveAttribute("aria-current", "true");
  // As for an own finding: the column is the tree's, the proposal is named in one line above it.
  await expect(page.locator(".panel-given-to-tree--column")).toHaveCount(1);
  const bar = page.getByRole("group", { name: "Finding", exact: true });
  await expect(bar).toContainText(HYPOTONIA);
  await expect(page.getByLabel(/Proposal details/i)).toBeHidden();
  await expect(treePanel(page).getByRole("button", { name: "Use this term instead…" })).toBeInViewport({ ratio: 1 });
  // "Show finding" brings the proposal and its decisions back.
  await bar.getByRole("button", { name: "Show finding" }).click();
  await expect(page.getByLabel(/Proposal details/i)).toBeVisible();
});
