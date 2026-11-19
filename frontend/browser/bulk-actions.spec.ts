/**
 * Bulk lead actions on Documents (issue 336 step 1) and the over-limit filter (issue 339 b): "More actions" in the
 * selection bar, the Reopen… dialog with its preview groups, the consequences step and the Undo toast; the filter
 * "More annotators than the limit" and Withdraw open tasks… above the limit. With SHOTS_DIR set, the states are also
 * saved as screenshots (desktop and phone).
 *
 * Builds a fresh project through ``POST /__test_documents__`` (scenario S336).
 */
import { expect, test, type Page } from "@playwright/test";
import { documentsReady, documentsScenario, openFilters } from "./documentsHelpers";
import { loginExisting } from "./helpers";

test.setTimeout(240_000);
test.use({ actionTimeout: 15_000 });

const shots = process.env.SHOTS_DIR;
async function shot(page: Page, name: string): Promise<void> {
  if (shots) await page.screenshot({ path: `${shots}/${name}.png` });
}
const noHorizontalScroll = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);

for (const [width, height, suffix] of [[1440, 900, ""], [390, 844, "-phone"]] as const) {
  test(`More actions: Reopen… with preview, consequences and Undo; over-limit filter and withdraw (${width} px)`, async ({ page }) => {
    const errors: string[] = [];
    page.on("console", message => { if (message.type() === "error") errors.push(message.text()); });
    page.on("pageerror", error => errors.push(String(error)));
    await page.setViewportSize({ width, height });
    const s = await documentsScenario(page, "S336");
    await loginExisting(page, s.users.lead);
    await page.goto(`/#/projects/${encodeURIComponent(s.project)}/documents`);
    await documentsReady(page);

    await page.getByRole("checkbox", { name: "Select all 8 filtered texts" }).click();
    const bar = page.getByRole("region", { name: "Selection" });
    await expect(bar).toContainText("8 texts in 8 cases selected");
    const more = bar.getByRole("button", { name: "More actions" });
    await more.click();
    const menu = page.getByRole("menu", { name: "More actions" });
    await expect(menu.getByRole("menuitem")).toHaveText(["Reopen…", "Withdraw open tasks…", /^Accept agreeing results…/, /^Change final…/, /^Start a round…/, /^Change mode…/, "Pause texts…", /^Release texts…/]);
    await expect(menu.getByRole("menuitem", { name: "Reopen…" })).not.toHaveAttribute("aria-disabled", "true");
    expect(await noHorizontalScroll(page)).toBe(true);
    await shot(page, `336-menu-after${suffix}`);

    await menu.getByRole("menuitem", { name: "Reopen…" }).click();
    const dialog = page.getByRole("dialog", { name: "Reopen: 8 texts" });
    const groups = dialog.getByRole("list", { name: "Preview" }).getByRole("listitem");
    await expect(groups).toHaveCount(3);
    await expect(groups.nth(0)).toContainText("Reopen 8 submitted tasks · Tom Reis 5, R. Roe 3");
    await expect(groups.nth(1)).toContainText("Skip 1 text · final result chosen: use Change final… first");
    await expect(groups.nth(2)).toContainText("Keep 2 open tasks · not submitted yet");
    await expect(dialog.getByText("Will change:")).toBeVisible();
    await expect(dialog.locator(".work-plan-summary")).toHaveText("Will change: 8 tasks in 6 texts");
    await groups.nth(0).getByRole("button", { name: "Show all 6" }).click();
    await expect(groups.nth(0)).toContainText("EN100022 en, EN100023 en, EN100024 en, EN100025 en, EN100026 en, EN100027 en");
    await dialog.getByLabel(/^Reason/).fill("Guideline 2.3 changed for vital signs");
    expect(await noHorizontalScroll(page)).toBe(true);
    await shot(page, `336-dialog-after${suffix}`);

    const apply = dialog.getByRole("button", { name: "Reopen 8 tasks" });
    await apply.click();
    await expect(dialog.getByText("What happens")).toBeVisible();
    await expect(apply).toHaveAttribute("aria-disabled", "true");
    await dialog.getByLabel("I understand").check();
    await expect(apply).not.toHaveAttribute("aria-disabled", "true");
    await shot(page, `336-consequences-after${suffix}`);

    await apply.click();
    await expect(dialog).toBeHidden();
    const toast = page.locator(".ui-toast");
    await expect(toast).toContainText("Reopened 8 tasks in 6 texts.");
    await expect(toast.getByRole("button", { name: "Undo" })).toBeVisible();
    await expect(bar).toContainText("8 texts in 8 cases selected");
    expect(await noHorizontalScroll(page)).toBe(true);
    await shot(page, `336-undo-toast-after${suffix}`);
    await toast.getByRole("button", { name: "Undo" }).click();
    await expect(toast).toContainText("The reopened tasks are submitted again.");
    await toast.getByRole("button", { name: "Dismiss" }).click();
    await expect(toast).toHaveCount(0);

    // Issue 339 b: the filter lists the texts over the lowered limit; withdraw the open extra task there.
    await bar.getByRole("button", { name: "Clear selection" }).click();
    const filters = await openFilters(page);
    await filters.getByRole("checkbox", { name: /^More annotators than the limit, 3 texts$/ }).check();
    if (width < 700) await filters.getByRole("button", { name: "Show 3 texts" }).click();
    await expect(page.getByRole("button", { name: "Remove filter More annotators than the limit", exact: true })).toBeVisible();
    await expect(page.getByRole("checkbox", { name: "Select all 3 filtered texts" })).toBeVisible();
    expect(await noHorizontalScroll(page)).toBe(true);
    await shot(page, `339b-filter-after${suffix}`);

    await page.getByRole("checkbox", { name: "Select all 3 filtered texts" }).click();
    await bar.getByRole("button", { name: "More actions" }).click();
    await page.getByRole("menu", { name: "More actions" }).getByRole("menuitem", { name: "Withdraw open tasks…" }).click();
    const withdraw = page.getByRole("dialog", { name: "Withdraw open tasks: 3 texts" });
    await withdraw.getByLabel("Only annotations above the limit of annotators per text").check();
    const withdrawGroups = withdraw.getByRole("list", { name: "Preview" }).getByRole("listitem");
    await expect(withdrawGroups.first()).toContainText("Withdraw 1 open task · R. Roe 1");
    await expect(withdraw.locator(".work-plan-summary")).toHaveText("Will change: 1 task in 1 text");
    await shot(page, `336-withdraw-dialog-after${suffix}`);
    await withdraw.getByRole("button", { name: "Withdraw 1 task" }).click();
    await withdraw.getByLabel("I understand — withdraw the open tasks").check();
    await withdraw.getByRole("button", { name: "Withdraw 1 task" }).click();
    await expect(withdraw).toBeHidden();
    await expect(toast).toContainText("Withdrew 1 task in 1 text.");
    expect(errors).toEqual([]);
  });
}
