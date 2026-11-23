import { expect, test, type Locator, type Page } from "@playwright/test";
import { importPackage, openCase, selectText } from "./helpers";

// Issues 539, 540 and 542: more room for the text and the tree. The fixture's text is
// "Hypotonia and seizure. ...": "Hypotonia" 0-9, "seizure" 14-21; with proposals both are proposals to check.
const FIXTURE = "browser-fixture-editor-room";
const SEIZURE = "HP:0001250";
const DIALEPTIC = "HP:0011146";
const HYPOTONIA = "HP:0001252";

const revision = (page: Page) => page.locator(".status-badge");
const header = (page: Page) => page.locator("header.shell-header");
const caseBar = (page: Page) => page.getByRole("group", { name: "Case", exact: true });
const treePanel = (page: Page) => page.getByRole("region", { name: "Ontology tree" });
const treeItem = (page: Page, termId: string) =>
  page.getByRole("tree", { name: "Terms" }).locator(`li[role="treeitem"][data-term-id="${termId}"]`);
const findingBar = (page: Page) => page.getByRole("group", { name: "Finding", exact: true });
const railDivider = (page: Page) => page.getByRole("separator", { name: "Resize details panel" });
const collapse = (page: Page) => page.getByRole("button", { name: "Collapse details panel" });
const expand = (page: Page) => page.getByRole("button", { name: "Expand details panel" });
const box = async (locator: Locator) => {
  const found = await locator.boundingBox();
  expect(found).not.toBeNull();
  return found!;
};
const proposal = (page: Page, termId: string) => page.locator(".sidebar .doc-item").filter({ hasText: termId }).first();
/** Rows of the tree that are fully in view. */
const visibleRows = (page: Page) => page.locator(".tree-host").evaluate((host) => {
  const box = host.getBoundingClientRect();
  return [...host.querySelectorAll<HTMLElement>('.tree-browser__tree li[role="treeitem"]')].filter((row) => {
    const r = row.getBoundingClientRect();
    return r.height > 0 && r.top >= box.top - 1 && r.bottom <= Math.min(box.bottom, window.innerHeight) + 1;
  }).length;
});

async function open(page: Page, annotator: string, size: { width: number; height: number }, proposals = false) {
  await page.setViewportSize(size);
  await importPackage(page, "", FIXTURE, annotator, { proposals });
  await openCase(page, { task: "annotate" });
}
async function annotateSeizure(page: Page) {
  await selectText(page, 14, 21);
  await page.getByLabel("Search term", { exact: true }).fill("Seizure");
  await page.locator(".candidate-card").filter({ hasText: SEIZURE }).click();
  await expect(revision(page)).toHaveAttribute("title", "Revision 1");
}

test.describe("one bar for the app header and the case (issue 539)", () => {
  for (const size of [{ width: 1440, height: 900 }, { width: 1280, height: 720 }, { width: 1280, height: 600 }]) {
    test(`${size.width}x${size.height}: the case controls share the header's one line; the panes start under it`, async ({ page }) => {
      await open(page, `room-bar-${size.width}-${size.height}`, size);
      // The case toolbar is in the header, after the header's own controls.
      await expect(header(page).getByRole("group", { name: "Case", exact: true })).toBeVisible();
      const bar = await box(header(page));
      expect(bar.height).toBeLessThanOrEqual(48);
      const user = await box(page.locator(".shell-user-menu"));
      const status = await box(caseBar(page).locator("[role=status]"));
      expect(Math.abs((user.y + user.height / 2) - (status.y + status.height / 2))).toBeLessThanOrEqual(4);
      // Every control of the case keeps its name.
      for (const name of ["Undo last change", "Redo last change", "More actions"]) await expect(caseBar(page).getByRole("button", { name })).toBeVisible();
      await expect(caseBar(page).getByRole("button", { name: /^Finish & submit/ })).toBeVisible();
      await expect(caseBar(page).getByRole("heading", { level: 1 })).toBeVisible();
      // The panes start right under the one bar.
      const layout = await box(page.locator(".app-layout"));
      expect(layout.y).toBeLessThanOrEqual(bar.y + bar.height + 1);
      expect(Math.abs(layout.y + layout.height - size.height)).toBeLessThanOrEqual(1);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBeTruthy();
    });
  }

  test("the keyboard order is what it was: the header's controls, then the case's; Skip to content reaches the case first", async ({ page }) => {
    await open(page, "room-bar-keys", { width: 1280, height: 720 });
    await page.getByRole("link", { name: "Skip to content" }).focus();
    await page.keyboard.press("Enter");
    await page.keyboard.press("Tab");
    // The first control of the case bar: the case navigation.
    expect(await page.evaluate(() => !!document.activeElement?.closest('[role="group"][aria-label="Case"]'))).toBeTruthy();
    // Shift+Tab from there goes back into the header's own controls (the user menu).
    await page.keyboard.press("Shift+Tab");
    await expect(page.locator(".shell-user-menu")).toBeFocused();
  });

  // #627: with the working time and the text stepper the case's controls need more room than a 1280 px window leaves
  // next to the header's own controls. A stand-in a little wider than the working time (about 130 px) takes that room here.
  for (const width of [1100, 1150, 1200, 1250, 1280, 1320, 1366, 1440]) {
    test(`${width} px, wide case controls: nothing in the bar is drawn over anything else`, async ({ page }) => {
      await open(page, `room-bar-wide-${width}`, { width, height: 800 });
      await page.locator(".case-toolbar--merged .app-actions").evaluate((actions) => {
        const standIn = document.createElement("span");
        standIn.className = "test-stand-in";
        standIn.textContent = "00:00 Pause timer";
        standIn.style.display = "inline-block";
        standIn.style.width = "200px";
        standIn.style.flex = "none";
        actions.prepend(standIn);
      });
      const boxes = await header(page).evaluate((bar) => {
        const hidden = (el: Element) => {
          for (let node: Element | null = el; node && node !== bar; node = node.parentElement) {
            const style = getComputedStyle(node);
            if (style.display === "none" || style.visibility === "hidden" || style.clipPath.startsWith("inset(50%")) return true;
          }
          return false;
        };
        const title = bar.querySelector(".case-toolbar--merged .case-title")!;
        const parts = [title, ...bar.querySelectorAll(".case-toolbar--merged .case-mode, .case-toolbar--merged .app-actions > *, .shell-heading, .shell-actions")];
        return parts.filter((el) => !hidden(el)).map((el) => {
          const r = el.getBoundingClientRect();
          return { name: el.className, left: r.left, right: r.right, top: r.top, bottom: r.bottom, width: r.width };
        }).filter((r) => r.width > 0);
      });
      for (let i = 0; i < boxes.length; i++) {
        for (let j = i + 1; j < boxes.length; j++) {
          const a = boxes[i], b = boxes[j];
          const overlap = a.left < b.right - 1 && b.left < a.right - 1 && a.top < b.bottom - 1 && b.top < a.bottom - 1;
          expect(overlap, `${a.name} and ${b.name} overlap`).toBeFalsy();
        }
      }
      // Every control stays inside the window; the case name keeps at least its opening characters.
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBeTruthy();
      expect((await box(caseBar(page).getByRole("heading", { level: 1 }))).width).toBeGreaterThanOrEqual(60);
      await expect(caseBar(page).getByRole("button", { name: /^Finish & submit/ })).toBeInViewport();
    });
  }

  test("390 px: the phone keeps its own header, the case toolbar scrolls with the page as before", async ({ page }) => {
    await open(page, "room-bar-phone", { width: 390, height: 844 });
    await expect(header(page).locator(".case-toolbar")).toHaveCount(0);
    await expect(page.locator("main .case-toolbar")).toBeVisible();
  });
});

test.describe("the right column as a rail (issue 540)", () => {
  test("1280x720: the edge resizes the column, the button collapses it to a strip; both are kept after a reload", async ({ page }) => {
    await open(page, "room-rail", { width: 1280, height: 720 });
    await annotateSeizure(page);
    await page.getByRole("button", { name: "Show in tree" }).click();
    await expect(treePanel(page)).toBeVisible();
    const before = await box(page.locator(".inspector-pane"));
    const textBefore = await box(page.locator(".center-pane"));

    // Drag the edge 100 px to the left: the column (panel and tree) is 100 px wider, the text 100 px narrower.
    const edge = await box(railDivider(page));
    await page.mouse.move(edge.x + edge.width / 2, edge.y + edge.height / 2);
    await page.mouse.down();
    await page.mouse.move(edge.x + edge.width / 2 - 100, edge.y + edge.height / 2, { steps: 5 });
    await page.mouse.up();
    await expect.poll(async () => Math.round((await box(page.locator(".inspector-pane"))).width)).toBe(Math.round(before.width) + 100);
    expect(Math.round((await box(page.locator(".tree-host"))).width)).toBe(Math.round(before.width) + 100);
    expect(Math.round((await box(page.locator(".center-pane"))).width)).toBe(Math.round(textBefore.width) - 100);
    // The keyboard as on the findings column's divider: Home is the least, Enter the default.
    await railDivider(page).focus();
    await page.keyboard.press("Home");
    await expect(railDivider(page)).toHaveAttribute("aria-valuenow", "320");
    await page.keyboard.press("Enter");
    await expect(railDivider(page)).toHaveAttribute("aria-valuenow", "380");
    await page.keyboard.press("Shift+ArrowLeft");
    await expect(railDivider(page)).toHaveAttribute("aria-valuenow", "444");
    await expect(railDivider(page)).toBeFocused();
    await page.keyboard.press("Shift+ArrowLeft");
    await expect(railDivider(page)).toHaveAttribute("aria-valuenow", "508");
    await page.keyboard.press("Shift+ArrowRight");
    await expect(railDivider(page)).toHaveAttribute("aria-valuenow", "444");
    // Written 300 ms after the last key, as the findings column's width.
    await expect.poll(() => page.evaluate(() => Object.entries(localStorage).find(([key]) => key.startsWith("ontotator.editor.detailsWidth.v1:"))?.[1])).toBe("444");

    // Collapsed: a 44 px strip; the text gets the room; the focus is on the strip.
    await collapse(page).click();
    await expect(expand(page)).toBeFocused();
    await expect(page.locator(".inspector-pane")).toBeHidden();
    await expect(page.locator(".tree-host")).toBeHidden();
    expect(Math.round((await box(expand(page))).width)).toBe(44);
    expect((await box(page.locator(".center-pane"))).width).toBeGreaterThan(textBefore.width + 300);

    // Kept after a reload, per user in this browser.
    await page.reload();
    await expect(expand(page)).toBeVisible();
    await expand(page).click();
    await expect(collapse(page)).toBeFocused();
    await expect(railDivider(page)).toHaveAttribute("aria-valuenow", "444");
  });

  test("1280x600: collapsed with the tree in the column of a low window; marking text opens the column again", async ({ page }) => {
    await open(page, "room-rail-low", { width: 1280, height: 600 });
    await annotateSeizure(page);
    await page.getByRole("button", { name: "Show in tree" }).click();
    await expect(page.locator(".app-layout")).toHaveClass(/panel-given-to-tree--column/);
    await collapse(page).click();
    await expect(page.locator(".tree-host")).toBeHidden();
    await expand(page).click();
    // Back as it was: the tree has the column, the finding is one line.
    await expect(findingBar(page)).toBeVisible();
    await expect(treePanel(page)).toBeVisible();
    // The tree's rows load again after the expand; wait for them instead of counting once.
    await expect.poll(() => visibleRows(page)).toBeGreaterThanOrEqual(9);
    // Work that needs the panel opens it again.
    await collapse(page).click();
    await selectText(page, 0, 9);
    await expect(page.getByLabel("Search term", { exact: true })).toBeVisible();
    await expect(collapse(page)).toBeVisible();
  });

  test("1440x900: 'Show in tree', copy and move sit next to their item as icons, with names and tooltips", async ({ page }) => {
    await open(page, "room-actions", { width: 1440, height: 900 });
    await annotateSeizure(page);
    const row = page.locator(".inspector-pane .term-heading-row");
    const tree = row.getByRole("button", { name: "Show in tree" });
    await expect(tree).toHaveAttribute("title", /^Show in tree/);
    // In one line with the term's name.
    const heading = await box(page.locator(".inspector-pane h2"));
    const icon = await box(tree);
    expect(icon.y).toBeLessThan(heading.y + heading.height);
    const mention = page.locator(".mention-card").first();
    await expect(mention.getByRole("button", { name: "Copy text" })).toBeVisible();
    await expect(mention.getByRole("button", { name: "Add segment" })).toHaveAttribute("title", /^Add segment/);
  });
});

test.describe("the tree from a proposal or a search hit (issue 542)", () => {
  test("U1-01, 1280x600: a tree opened from a proposal takes the column like the others", async ({ page }) => {
    await open(page, "room-u1-01", { width: 1280, height: 600 }, true);
    await proposal(page, SEIZURE).click();
    await page.getByLabel(/Proposal details/i).getByRole("button", { name: "Show in tree" }).click();
    await expect(treeItem(page, SEIZURE)).toHaveAttribute("aria-current", "true");
    await expect(page.locator(".app-layout")).toHaveClass(/panel-given-to-tree--column/);
    await expect(findingBar(page)).toContainText("Seizure");
    const showFinding = findingBar(page).getByRole("button", { name: "Show finding" });
    // As for an own finding, the focus is on the term's row in the tree.
    await expect(treeItem(page, SEIZURE)).toBeFocused();
    expect(await visibleRows(page)).toBeGreaterThanOrEqual(9);
    // "Show finding" brings the decision back.
    await showFinding.click();
    await expect(page.getByLabel(/Proposal details/i)).toBeVisible();
    // Selecting another proposal while the tree is open keeps the tree's column.
    await findingBar(page).getByRole("button", { name: "Hide finding" }).click();
    await proposal(page, HYPOTONIA).click();
    await expect(page.locator(".app-layout")).toHaveClass(/panel-given-to-tree--column/);
    await expect(findingBar(page)).toContainText("Hypotonia");
  });

  test("U1-02, 1440x900: the definition of the active hit no longer covers the hits", async ({ page }) => {
    await open(page, "room-u1-02", { width: 1440, height: 900 });
    await selectText(page, 0, 9);
    await page.getByLabel("Search term", { exact: true }).fill("seiz");
    await page.getByRole("option", { name: /^Seizure HP:0001250/ }).hover();
    await page.getByRole("button", { name: "Show in tree: Seizure" }).click();
    await expect(treePanel(page)).toBeVisible();
    // The preview follows the hits: whatever is at a visible hit's centre is that hit, not the definition.
    const covered = await page.getByRole("listbox").evaluate((list) => [...list.querySelectorAll<HTMLElement>('[role="option"]')].map((option) => {
      const r = option.getBoundingClientRect();
      const scroller = option.closest(".inspector-pane")!.getBoundingClientRect();
      if (r.top < scroller.top || r.bottom > scroller.bottom) return null;
      const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      return hit && option.contains(hit) ? null : (hit as HTMLElement | null)?.className ?? "nothing";
    }).filter(Boolean));
    expect(covered).toEqual([]);
    // The first hits are in view without scrolling the panel.
    await expect(page.getByRole("listbox").getByRole("option").first()).toBeInViewport({ ratio: 1 });
  });

  test("U1-03 and U1-04: 'Use this term instead…' says Replaced, and one Undo opens the proposal again", async ({ page }) => {
    await open(page, "room-u1-03", { width: 1440, height: 900 }, true);
    await proposal(page, SEIZURE).click();
    await page.getByLabel(/Proposal details/i).getByRole("button", { name: "Show in tree" }).click();
    await treeItem(page, DIALEPTIC).click();
    await treePanel(page).getByRole("button", { name: "Use this term instead…" }).click();
    const confirm = treePanel(page).getByRole("group", { name: `Proposal: decide as Replaced with Dialeptic seizure (${DIALEPTIC})` });
    await confirm.getByRole("button", { name: "Confirm" }).click();
    await expect(proposal(page, SEIZURE)).toContainText("Replaced");

    await page.getByRole("button", { name: "Undo last change", exact: true }).click();
    await expect(proposal(page, SEIZURE)).toContainText("Pending");
    await expect(page.locator(".sidebar [data-list-key^='annotation:']")).toHaveCount(0);
  });
});

test.describe("acceptance of the editor room (issue 589)", () => {
  const treeDivider = (page: Page) => page.getByRole("separator", { name: "Resize ontology tree" });

  for (const size of [{ width: 1440, height: 900 }, { width: 1280, height: 720 }]) {
    test(`${size.width}x${size.height}: a column folded with the tree open is only the strip; Expand takes all of it and is the last Tab stop there`, async ({ page }) => {
      await open(page, `room-fold-tree-${size.width}`, size);
      await annotateSeizure(page);
      await page.getByRole("button", { name: "Show in tree" }).click();
      await expect(treePanel(page)).toBeVisible();
      await expect(treeDivider(page)).toBeVisible();

      await collapse(page).click();
      await expect(expand(page)).toBeFocused();
      // The tree's divider is gone with the tree: nothing drawn on the strip, no Tab stop after Expand.
      await expect(treeDivider(page)).toHaveCount(0);
      await expect(page.locator(".sidebar-resizer--rows")).toHaveCount(0);
      await page.keyboard.press("Tab");
      expect(await page.evaluate(() => document.activeElement?.closest(".app-layout") !== null
        && document.activeElement?.getAttribute("role") === "separator")).toBe(false);

      // Every point of the strip is Expand, the bottom (where the divider used to lie) as well.
      const strip = await box(expand(page));
      const covered = await page.evaluate(({ x, ys }) => ys.map((y) => {
        const hit = document.elementFromPoint(x, y);
        return hit?.closest(".details-rail-expand") ? null : (hit as HTMLElement | null)?.className ?? "nothing";
      }).filter(Boolean), { x: strip.x + strip.width / 2, ys: [strip.y + 8, strip.y + strip.height / 2, strip.y + strip.height - 4] });
      expect(covered).toEqual([]);
      await page.mouse.click(strip.x + strip.width / 2, strip.y + strip.height - 4);
      await expect(collapse(page)).toBeFocused();
      // Expanded, the tree and its divider are back.
      await expect(treePanel(page)).toBeVisible();
      await expect(treeDivider(page)).toBeVisible();
    });
  }

  for (const size of [{ width: 1280, height: 720 }, { width: 1440, height: 900 }]) {
    test(`${size.width}x${size.height}: the tree opened from a search hit leaves the active hit in view, clear of the divider`, async ({ page }) => {
      await open(page, `room-hit-tree-${size.width}`, size);
      await selectText(page, 0, 9);
      await page.getByLabel("Search term", { exact: true }).fill("seiz");
      const seizure = page.getByRole("option", { name: /^Seizure HP:0001250/ });
      await seizure.hover();
      await page.getByRole("button", { name: "Show in tree: Seizure" }).click();
      await expect(treeItem(page, SEIZURE)).toHaveAttribute("aria-selected", "true");
      await expect(seizure).toHaveAttribute("aria-selected", "true");
      // Wholly inside the panel's part of the column, and what lies at its top, middle and bottom is the hit itself.
      await expect.poll(() => seizure.evaluate((option) => {
        const r = option.getBoundingClientRect();
        const panel = option.closest(".inspector-pane")!.getBoundingClientRect();
        if (r.top < panel.top || r.bottom > panel.bottom) return "outside the panel";
        const x = r.left + r.width / 2;
        return [r.top + 2, r.top + r.height / 2, r.bottom - 2].map((y) => {
          const hit = document.elementFromPoint(x, y);
          return hit && option.contains(hit) ? "" : (hit as HTMLElement | null)?.className ?? "nothing";
        }).join("");
      })).toBe("");
      await expect(seizure).toBeInViewport({ ratio: 1 });
    });
  }
});
