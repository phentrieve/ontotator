/**
 * Bulk "Change mode…" on Documents (issue 336 step 4): the entry in "More actions", the dialog with the two modes
 * and the reason, the preview grouped by consequence with the people affected, the consequences step without Undo,
 * and "Restore…" in a text card afterwards. With SHOTS_DIR set, the states are also saved as screenshots (desktop
 * and phone).
 *
 * Builds a fresh project through ``POST /__test_documents__`` (scenario S336M).
 */
import { expect, test, type Page } from "@playwright/test";
import { documentsReady, documentsScenario, openTextCard, showSegment, textCard, textNamePattern } from "./documentsHelpers";
import { loginExisting } from "./helpers";

test.setTimeout(240_000);
test.use({ actionTimeout: 15_000 });

const shots = process.env.SHOTS_DIR;
async function shot(page: Page, name: string): Promise<void> {
  if (shots) await page.screenshot({ path: `${shots}/${name}.png` });
}
const noHorizontalScroll = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);

for (const [width, height, suffix] of [[1440, 900, ""], [390, 844, "-phone"]] as const) {
  test(`More actions: Change mode… with the people affected, consequences and Restore… in the card (${width} px)`, async ({ page }) => {
    const errors: string[] = [];
    page.on("console", message => { if (message.type() === "error") errors.push(message.text()); });
    page.on("pageerror", error => errors.push(String(error)));
    await page.setViewportSize({ width, height });
    const s = await documentsScenario(page, "S336M");
    await loginExisting(page, s.users.lead);
    await page.goto(`/#/projects/${encodeURIComponent(s.project)}/documents`);
    await documentsReady(page);

    await page.getByRole("checkbox", { name: "Select all 8 filtered texts" }).click();
    const bar = page.getByRole("region", { name: "Selection" });
    await expect(bar).toContainText("8 texts in 8 cases selected");
    await bar.getByRole("button", { name: "More actions" }).click();
    let menu = page.getByRole("menu", { name: "More actions" });
    const entry = menu.getByRole("menuitem", { name: /^Change mode…/ });
    // "Pause texts…" and "Release texts…" (issue 464) follow it.
    await expect(menu.getByRole("menuitem").nth(5)).toHaveText("Change mode…");
    await expect(entry).not.toHaveAttribute("aria-disabled", "true");
    expect(await noHorizontalScroll(page)).toBe(true);
    await shot(page, `336-mode-menu-after${suffix}`);

    await entry.click();
    const dialog = page.getByRole("dialog", { name: "Change mode: 8 texts" });
    // The two modes are the only choice; none is preselected.
    await expect(dialog.getByRole("radio")).toHaveCount(2);
    await expect(dialog.getByRole("radio", { name: "From scratch" })).not.toBeChecked();
    await expect(dialog.getByRole("radio", { name: "From proposals" })).not.toBeChecked();
    await expect(dialog.getByText("Changes 4 selected texts.")).toBeVisible();
    await expect(dialog.getByText("Changes none of the selected texts.")).toBeVisible();
    const apply = dialog.getByRole("button", { name: /^Change mode( of \d+ texts?)?$/ });
    await expect(apply).toHaveAttribute("aria-disabled", "true");
    await expect(dialog.getByText("Choose the new mode first.")).toBeVisible();
    await shot(page, `336-mode-dialog-empty-after${suffix}`);

    // From scratch changes nothing here: every text is skipped with its reason.
    await dialog.getByRole("radio", { name: "From scratch" }).check();
    const groups = dialog.getByRole("list", { name: "Preview" }).getByRole("listitem");
    await expect(groups).toHaveCount(2);
    await expect(groups.nth(0)).toContainText("Skip 6 texts · already annotated from scratch");
    await expect(groups.nth(1)).toContainText("Skip 2 texts · no annotation work yet: set the mode with Plan…");
    await expect(dialog.locator(".work-plan-summary")).toHaveText("Will change: No selected text can change to annotation from scratch.");

    await dialog.getByRole("radio", { name: "From proposals" }).check();
    await expect(groups).toHaveCount(4);
    await expect(groups.nth(0)).toContainText("Annotate 4 texts from proposals · discards 6 submissions, removes 2 unsubmitted tasks");
    await expect(groups.nth(1)).toContainText("Skip 1 text · final result chosen: use Withdraw final… first");
    await expect(groups.nth(1)).toContainText("EN100026 en");
    await expect(groups.nth(2)).toContainText("Skip 2 texts · no annotation work yet: set the mode with Plan…");
    await expect(groups.nth(3)).toContainText("Skip 1 text · no tool proposals for the text");
    await expect(groups.nth(3)).toContainText("EN100028 en");
    await groups.nth(0).getByRole("button", { name: "Show all 4" }).click();
    await expect(groups.nth(0)).toContainText("EN100022 en, EN100023 en, EN100024 en, EN100025 en");
    const people = dialog.getByRole("list", { name: "Affected people" }).getByRole("listitem");
    await expect(people).toHaveText([
      "Tom Reis: 4 submissions are discarded.",
      "R. Roe: 2 submissions are discarded; 1 unsubmitted task is removed.",
      "Carla Diaz: 1 unsubmitted consolidation is removed.",
    ]);
    await expect(dialog.locator(".work-plan-summary")).toHaveText("Will change: the annotation mode of 4 texts");
    await expect(dialog.getByText("Enter the reason first.")).toBeVisible();
    await dialog.getByLabel(/^Reason/).fill("The tool proposals of 10 Nov are good enough to check");
    expect(await noHorizontalScroll(page)).toBe(true);
    await shot(page, `336-mode-dialog-after${suffix}`);

    await apply.click();
    await expect(dialog.getByText("What happens")).toBeVisible();
    await expect(dialog.getByText(/This cannot be undone here\. Restore… in a text card/)).toBeVisible();
    await expect(people).toHaveCount(3);
    await expect(apply).toHaveAttribute("aria-disabled", "true");
    await dialog.getByLabel("I understand — discard the work and change the mode").check();
    await expect(apply).not.toHaveAttribute("aria-disabled", "true");
    expect(await noHorizontalScroll(page)).toBe(true);
    await shot(page, `336-mode-consequences-after${suffix}`);

    await apply.click();
    await expect(dialog).toBeHidden();
    const toast = page.locator(".ui-toast");
    await expect(toast).toContainText("Changed the annotation mode of 4 texts.");
    await expect(toast.getByRole("button", { name: "Undo" })).toHaveCount(0);
    await expect(bar).toContainText("8 texts in 8 cases selected");
    expect(await noHorizontalScroll(page)).toBe(true);
    await shot(page, `336-mode-toast-after${suffix}`);

    // Nothing is left to change: the entry says why.
    await bar.getByRole("button", { name: "More actions" }).click();
    menu = page.getByRole("menu", { name: "More actions" });
    await expect(menu.getByRole("menuitem", { name: /^Change mode…/ })).toHaveAttribute("aria-disabled", "true");
    await expect(menu.getByRole("menuitem", { name: /^Change mode…/ })).toContainText("No selected text can change its annotation mode.");
    await shot(page, `336-mode-menu-unavailable-after${suffix}`);
    await page.keyboard.press("Escape");

    // Each text is a single change: its card names it and offers Restore….
    await bar.getByRole("button", { name: "Clear selection" }).click();
    // Below 700 px the list is cards: "Details" opens the text card.
    if (width < 700) await page.getByRole("button", { name: textNamePattern("Details, ", "EN100022", "en") }).click();
    const card = width < 700 ? textCard(page, "EN100022", "en") : await openTextCard(page, "EN100022", "en");
    await expect(card).toBeVisible();
    await showSegment(card, "Annotation");
    await expect(card.getByText(/now annotated from proposals; discarded work of/)).toBeVisible();
    await expect(card.getByRole("button", { name: "Restore…" })).toBeVisible();
    expect(await noHorizontalScroll(page)).toBe(true);
    await shot(page, `336-mode-card-restore-after${suffix}`);
    expect(errors).toEqual([]);
  });
}
