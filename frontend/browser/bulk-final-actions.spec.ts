/**
 * Bulk actions on final results on Documents (issue 336 step 2; issues 354 and 339 f): "Change final…" (the newest
 * submission replaces the final result) and "Accept agreeing results…" (texts without a final result) in the
 * selection bar's "More actions" menu, each with its preview groups, the consequences step and a message. The message
 * after "Change final…" offers Undo: it brings the earlier final results back (the change is then offered again), and
 * it is refused, naming the text, once a final result changed since. "Accept agreeing results…" has no Undo.
 * Afterwards both entries are unavailable with their reason. With SHOTS_DIR set, the states are also saved as
 * screenshots (desktop and phone).
 *
 * Builds a fresh project through ``POST /__test_documents__`` (scenario S336F).
 */
import { expect, test, type Locator, type Page } from "@playwright/test";
import { documentsReady, documentsScenario } from "./documentsHelpers";
import { loginExisting } from "./helpers";

test.setTimeout(240_000);
test.use({ actionTimeout: 15_000 });

const shots = process.env.SHOTS_DIR;
async function shot(page: Page, name: string): Promise<void> {
  if (!shots) return;
  // A message that just arrived is still fading in.
  await page.evaluate(() => Promise.all(document.getAnimations().map(animation => animation.finished.catch(() => null))));
  await page.screenshot({ path: `${shots}/${name}.png` });
}
const noHorizontalScroll = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);

/** The lead confirms the final result of ``caseId`` en again, in the page's session: its revision moves on. */
async function confirmFinalAgain(page: Page, project: string, caseId: string): Promise<void> {
  const base = `/api/v1/projects/${encodeURIComponent(project)}`;
  const found = (await (await page.request.get(`${base}/document-rows`, { params: { q: caseId } })).json()) as {
    groups: { rows: { case_id: string; language: string; final: { document_id: string; submission_id: string; revision: number } | null }[] }[];
  };
  const final = found.groups.flatMap(group => group.rows).find(row => row.case_id === caseId && row.language === "en")?.final;
  expect(final, `${caseId} en has a final result`).toBeTruthy();
  const { csrf_token } = (await (await page.request.get("/api/v1/auth/me")).json()) as { csrf_token: string };
  const saved = await page.request.put(`${base}/final-selections`, {
    data: { document_id: final!.document_id, submission_id: final!.submission_id, expected_revision: final!.revision },
    headers: { Origin: new URL(page.url()).origin, "X-CSRF-Token": csrf_token },
  });
  expect(saved.ok(), await saved.text()).toBeTruthy();
}

/** More actions › Change final… › Change 2 final results › I understand › apply. */
async function changeTwoFinals(page: Page, more: Locator): Promise<void> {
  await more.click();
  await page.getByRole("menu", { name: "More actions" }).getByRole("menuitem", { name: "Change final…" }).click();
  const dialog = page.getByRole("dialog", { name: "Change final: 8 texts" });
  const apply = dialog.getByRole("button", { name: "Change 2 final results" });
  await apply.click();
  await dialog.getByLabel("I understand").check();
  await apply.click();
  await expect(dialog).toBeHidden();
}

for (const [width, height, suffix] of [[1440, 900, ""], [390, 844, "-phone"]] as const) {
  test(`More actions: Change final… and Accept agreeing results… with preview and consequences (${width} px)`, async ({ page }) => {
    const errors: string[] = [];
    page.on("console", message => { if (message.type() === "error") errors.push(message.text()); });
    page.on("pageerror", error => errors.push(String(error)));
    await page.setViewportSize({ width, height });
    const s = await documentsScenario(page, "S336F");
    await loginExisting(page, s.users.lead);
    await page.goto(`/#/projects/${encodeURIComponent(s.project)}/documents`);
    await documentsReady(page);

    await page.getByRole("checkbox", { name: "Select all 8 filtered texts" }).click();
    const bar = page.getByRole("region", { name: "Selection" });
    await expect(bar).toContainText("8 texts in 8 cases selected");
    const more = bar.getByRole("button", { name: "More actions" });
    await more.click();
    let menu = page.getByRole("menu", { name: "More actions" });
    await expect(menu.getByRole("menuitem")).toHaveText([/^Reopen…/, /^Withdraw open tasks…/, "Accept agreeing results…", "Change final…", /^Start a round…/, /^Change mode…/, "Pause texts…", /^Release texts…/]);
    await expect(menu.getByRole("menuitem", { name: "Change final…" })).not.toHaveAttribute("aria-disabled", "true");
    expect(await noHorizontalScroll(page)).toBe(true);
    await shot(page, `336-final-menu-after${suffix}`);

    // Change final…: the newest submission replaces the final result of two texts; differing submissions are skipped.
    await menu.getByRole("menuitem", { name: "Change final…" }).click();
    const dialog = page.getByRole("dialog", { name: "Change final: 8 texts" });
    await expect(dialog.getByText("Rule:")).toBeVisible();
    const groups = dialog.getByRole("list", { name: "Preview" }).getByRole("listitem");
    await expect(groups).toHaveCount(5);
    await expect(groups.nth(0)).toContainText("Use the newest annotation for 2 texts · R. Roe 2");
    await expect(groups.nth(0)).toContainText("EN100022 en, EN100023 en");
    await expect(groups.nth(1)).toContainText("Skip 1 text · submissions differ: compare or consolidate first");
    await expect(groups.nth(1)).toContainText("EN100024 en");
    await expect(groups.nth(2)).toContainText("Skip 1 text · the final result already is the newest submission");
    await expect(groups.nth(3)).toContainText("Skip 1 text · other work on the text is still open");
    await expect(groups.nth(4)).toContainText("Skip 3 texts · no final result yet: use Accept agreeing results… or the text card");
    await expect(dialog.locator(".work-plan-summary")).toHaveText("Will change: the final result of 2 texts");
    expect(await noHorizontalScroll(page)).toBe(true);
    await shot(page, `336-change-final-dialog-after${suffix}`);

    const apply = dialog.getByRole("button", { name: "Change 2 final results" });
    await apply.click();
    await expect(dialog.getByText("What happens")).toBeVisible();
    await expect(dialog.getByText("without comparing")).toHaveCount(0);
    await expect(dialog.getByText("Undo in the message brings the earlier final results back while nothing else changed on the texts.")).toBeVisible();
    await expect(apply).toHaveAttribute("aria-disabled", "true");
    await dialog.getByLabel("I understand").check();
    await expect(apply).not.toHaveAttribute("aria-disabled", "true");
    await shot(page, `336-change-final-consequences-after${suffix}`);

    await apply.click();
    await expect(dialog).toBeHidden();
    const toast = page.locator(".ui-toast");
    await expect(toast).toContainText("Changed the final result of 2 texts.");
    const undo = toast.getByRole("button", { name: "Undo" });
    await expect(undo).toBeVisible();
    await expect(bar).toContainText("8 texts in 8 cases selected");
    expect(await noHorizontalScroll(page)).toBe(true);
    await shot(page, `336-change-final-toast-after${suffix}`);

    // Undo: both texts have their earlier final result again, so the change is offered again.
    await undo.click();
    await expect(toast).toContainText("The earlier final results of 2 texts are back.");
    await expect(toast.getByRole("button", { name: "Undo" })).toHaveCount(0);
    await expect(bar).toContainText("8 texts in 8 cases selected");
    expect(await noHorizontalScroll(page)).toBe(true);
    await shot(page, `change-final-undone-after${suffix}`);
    await toast.getByRole("button", { name: "Dismiss" }).click();

    // The change again; then one final result is confirmed again: the Undo restores neither text and names that one.
    await changeTwoFinals(page, more);
    await expect(toast).toContainText("Changed the final result of 2 texts.");
    await confirmFinalAgain(page, s.project, "EN100022");
    await toast.getByRole("button", { name: "Undo" }).click();
    await expect(toast).toContainText("Undo is not possible: 1 of 2 texts changed since (EN100022 en: its final result was changed, confirmed again or withdrawn). Nothing was undone.");
    await expect(toast.getByRole("button", { name: "Undo" })).toHaveCount(0);
    expect(await noHorizontalScroll(page)).toBe(true);
    await shot(page, `change-final-undo-refused-after${suffix}`);
    await toast.getByRole("button", { name: "Dismiss" }).click();

    // Accept agreeing results…: two texts without a final result agree in full.
    await more.click();
    menu = page.getByRole("menu", { name: "More actions" });
    await menu.getByRole("menuitem", { name: "Accept agreeing results…" }).click();
    const accept = page.getByRole("dialog", { name: "Accept agreeing results: 8 texts" });
    const acceptGroups = accept.getByRole("list", { name: "Preview" }).getByRole("listitem");
    await expect(acceptGroups).toHaveCount(3);
    await expect(acceptGroups.nth(0)).toContainText("Accept the result of 2 texts · all annotations agree in full");
    await expect(acceptGroups.nth(0)).toContainText("EN100027 en, EN100028 en");
    await expect(acceptGroups.nth(1)).toContainText("Skip 1 text · fewer than two submissions to compare");
    await expect(acceptGroups.nth(2)).toContainText("Keep 5 final results · already final: use Change final… for them");
    await expect(accept.locator(".work-plan-summary")).toHaveText("Will become final: 2 texts");
    expect(await noHorizontalScroll(page)).toBe(true);
    await shot(page, `354-accept-agreeing-dialog-after${suffix}`);
    const acceptApply = accept.getByRole("button", { name: "Accept 2 results" });
    await acceptApply.click();
    await expect(accept.getByText("This cannot be undone here; use Withdraw final… or Change final… in a text card.")).toBeVisible();
    await accept.getByLabel("I understand").check();
    await shot(page, `354-accept-agreeing-consequences-after${suffix}`);
    await acceptApply.click();
    await expect(accept).toBeHidden();
    await expect(toast).toContainText("Accepted the results of 2 texts.");
    await expect(toast.getByRole("button", { name: "Undo" })).toHaveCount(0);
    await toast.getByRole("button", { name: "Dismiss" }).click();

    // Nothing left for either action: the entries stay, unavailable, with the reason (decision 336-C).
    await more.click();
    menu = page.getByRole("menu", { name: "More actions" });
    const acceptItem = menu.getByRole("menuitem", { name: /^Accept agreeing results…/ });
    const changeItem = menu.getByRole("menuitem", { name: /^Change final…/ });
    await expect(acceptItem).toHaveAttribute("aria-disabled", "true");
    await expect(acceptItem).toContainText("No selected text has annotations that agree in full.");
    await expect(changeItem).toHaveAttribute("aria-disabled", "true");
    await expect(changeItem).toContainText("No selected text has a newer submission than its final result.");
    expect(await noHorizontalScroll(page)).toBe(true);
    await shot(page, `336-final-menu-unavailable-after${suffix}`);
    // The refused Undo is one expected 409: the browser logs the failed request, nothing else.
    expect(errors).toEqual(["Failed to load resource: the server responded with a status of 409 (Conflict)"]);
  });
}
