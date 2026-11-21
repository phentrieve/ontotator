/**
 * The "More actions" menu of the Documents selection bar stays inside the window (issue 585). Its reasons load after
 * it opens and make it taller; the menu is placed again then, opens above its button where there is more room, and
 * scrolls when it is taller than the room on either side. Every entry stays reachable by mouse and keyboard, also in
 * low windows and on phones. With SHOTS_DIR set, the open menu is also saved as a screenshot.
 *
 * Builds a fresh project through ``POST /__test_documents__`` (scenario S464).
 */
import { expect, test, type Locator, type Page } from "@playwright/test";
import { documentsReady, documentsScenario, rowBox } from "./documentsHelpers";
import { loginExisting } from "./helpers";

test.setTimeout(180_000);
test.use({ actionTimeout: 15_000 });

const shots = process.env.SHOTS_DIR;
const selectionBar = (page: Page): Locator => page.getByRole("region", { name: "Selection" });
const moreActions = (page: Page): Locator => selectionBar(page).getByRole("button", { name: "More actions" });
const menuOf = (page: Page): Locator => page.getByRole("menu", { name: "More actions" });

async function selectTexts(page: Page, cases: readonly string[]): Promise<void> {
  for (const caseId of cases) await rowBox(page, caseId, "en").check();
  await expect(selectionBar(page)).toContainText(`${cases.length} ${cases.length === 1 ? "text" : "texts"} in`);
}

/** The menu's box, its button's box and the window height, read in one go. */
async function boxes(page: Page) {
  return page.evaluate(() => {
    const menu = document.querySelector<HTMLElement>('[role="menu"][aria-label="More actions"]')!.getBoundingClientRect();
    const button = document.querySelector<HTMLElement>('[aria-label="Selection"] button[aria-label="More actions"]')!.getBoundingClientRect();
    return { menu: { top: menu.top, bottom: menu.bottom }, button: { top: button.top, bottom: button.bottom }, height: window.innerHeight };
  });
}

// 1280 × 400: taller than the room on either side, the menu scrolls.
const SIZES = [[1440, 900], [1440, 760], [1280, 720], [1280, 600], [1280, 400], [390, 844], [390, 640]] as const;

for (const [width, height] of SIZES) {
  test(`More actions stays inside the window after its reasons load; every entry can be reached (${width}×${height})`, async ({ page }) => {
    const errors: string[] = [];
    page.on("console", message => { if (message.type() === "error") errors.push(message.text()); });
    page.on("pageerror", error => errors.push(String(error)));
    // The selection is made in a window at least 600 px high; the menu is then opened at the size under test.
    await page.setViewportSize({ width, height: Math.max(height, 600) });
    const s = await documentsScenario(page, "S464");
    await loginExisting(page, s.users.lead);
    await page.goto(`/#/projects/${encodeURIComponent(s.project)}/documents`);
    await documentsReady(page);
    await selectTexts(page, ["EN100028", "EN100023"]);

    // EN100028: an open consolidation; EN100023: open annotations, nothing submitted. Pause both, so that the menu gets its longest reasons.
    await moreActions(page).click();
    await menuOf(page).getByRole("menuitem", { name: "Pause texts…" }).click();
    const dialog = page.getByRole("dialog", { name: "Pause texts: 2 texts" });
    const apply = dialog.getByRole("button", { name: "Pause 2 texts" });
    await expect(apply).toBeVisible();
    await dialog.getByLabel(/^Reason/).fill("The clinic is checking the source text");
    await apply.click();
    await dialog.getByLabel(/^I understand/).check();
    await apply.click();
    await expect(dialog).toBeHidden();
    await page.locator(".ui-toast").getByRole("button", { name: "Dismiss" }).click();
    await page.setViewportSize({ width, height });

    await moreActions(page).click();
    const menu = menuOf(page);
    // The reasons have loaded: the menu has grown.
    await expect(menu.getByRole("menuitem", { name: /^Pause texts…/ })).toContainText("The selected texts are already paused.");
    await expect(menu.getByRole("menuitem", { name: /^Start a round…/ })).toContainText("1 text has an open consolidation; the other has no submitted annotations.");
    if (shots) await page.screenshot({ path: `${shots}/585-menu-${width}x${height}.png` });

    // The menu is inside the window and does not cover its own button.
    await expect.poll(async () => {
      const { menu: box, button, height: windowHeight } = await boxes(page);
      return box.top >= 0 && box.bottom <= windowHeight && (box.bottom <= button.top || box.top >= button.bottom);
    }).toBe(true);

    // Keyboard: every entry gets the focus in turn and is then visible inside the window.
    const items = menu.getByRole("menuitem");
    const count = await items.count();
    expect(count).toBe(8);
    for (let index = 0; index < count; index += 1) {
      await expect(items.nth(index)).toBeFocused();
      await expect(items.nth(index)).toBeInViewport({ ratio: 1 });
      await page.keyboard.press("ArrowDown");
    }
    await expect(items.first()).toBeFocused();
    await page.keyboard.press("End");
    await expect(items.last()).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(page.getByRole("dialog", { name: "Release texts: 2 texts" })).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog", { name: "Release texts: 2 texts" })).toBeHidden();

    // Mouse: the last entry, the one useful for paused texts, can be clicked where it is.
    await moreActions(page).click();
    await expect(menu.getByRole("menuitem", { name: /^Pause texts…/ })).toContainText("The selected texts are already paused.");
    const release = menu.getByRole("menuitem", { name: "Release texts…" });
    await release.scrollIntoViewIfNeeded();
    await expect(release).toBeInViewport({ ratio: 1 });
    const box = (await release.boundingBox())!;
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    await expect(page.getByRole("dialog", { name: "Release texts: 2 texts" })).toBeVisible();
    expect(errors).toEqual([]);
  });
}
