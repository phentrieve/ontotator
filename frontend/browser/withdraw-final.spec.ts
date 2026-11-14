/**
 * "Withdraw final…" (issue 343): next to "Change final…" in the text card's Finalization, a dialog with the
 * consequences, a Reason and "I understand"; afterwards the text has no final result and History names the
 * withdrawal. With SHOTS_DIR set, the states are also saved as screenshots (desktop and phone).
 *
 * Builds a fresh project through ``POST /__test_documents__`` (scenario S5: case-0377 en has a final result).
 */
import { expect, test, type Page } from "@playwright/test";
import { cardPath, documentsScenario, showSegment } from "./documentsHelpers";
import { loginExisting } from "./helpers";

test.setTimeout(180_000);
test.use({ actionTimeout: 15_000 });

const shots = process.env.SHOTS_DIR;
async function shot(page: Page, name: string): Promise<void> {
  if (shots) await page.screenshot({ path: `${shots}/${name}.png` });
}

for (const [width, height, suffix] of [[1440, 900, ""], [390, 844, "-phone"]] as const) {
  test(`withdraw a final result: button, dialog, after-state (${width} px)`, async ({ page }) => {
    const errors: string[] = [];
    page.on("console", message => { if (message.type() === "error") errors.push(message.text()); });
    page.on("pageerror", error => errors.push(String(error)));
    await page.setViewportSize({ width, height });
    const s = await documentsScenario(page, "S5");
    await loginExisting(page, s.users.lead);
    await page.goto(`/#/projects/${encodeURIComponent(s.project)}/documents?panel=${encodeURIComponent("case-0377:en")}`);
    const card = page.getByRole("dialog");
    await expect(cardPath(card)).toBeVisible();
    await showSegment(card, "Finalization");
    const part = card.locator(".text-card-part");
    const change = part.getByRole("button", { name: "Change final…", exact: true });
    const withdraw = part.getByRole("button", { name: "Withdraw final…", exact: true });
    await expect(withdraw).toBeVisible();
    // Next to Change final…, in the same action row as Open result.
    const [changeBox, withdrawBox] = [(await change.boundingBox())!, (await withdraw.boundingBox())!];
    if (width > 700) expect(Math.round(withdrawBox.y)).toBe(Math.round(changeBox.y));
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await withdraw.scrollIntoViewIfNeeded();
    await shot(page, `343-button-after${suffix}`);

    await withdraw.click();
    const dialog = page.getByRole("dialog", { name: "Withdraw final result: case-0377 en" });
    await expect(dialog.getByRole("list", { name: "What happens" }).getByRole("listitem")).toHaveText([
      "The text has no final result until you choose one again.",
      "Final exports already made stay as they are.",
      "Change mode… is possible again.",
      "Submissions and consolidation stay.",
    ]);
    const confirm = dialog.getByRole("button", { name: "Withdraw final result", exact: true });
    await expect(confirm).toHaveAttribute("aria-disabled", "true");
    await dialog.getByLabel(/^Reason/).fill("Re-annotation with guideline 2.3");
    await dialog.getByLabel("I understand").check();
    await expect(confirm).not.toHaveAttribute("aria-disabled", "true");
    await shot(page, `343-dialog-after${suffix}`);

    await confirm.click();
    await expect(dialog).toBeHidden();
    await expect(page.getByText("Final result of case-0377 en withdrawn.")).toBeVisible();
    await showSegment(card, "Finalization");
    await expect(part.getByRole("button", { name: "Withdraw final…", exact: true })).toHaveCount(0);
    await expect(part.getByRole("link", { name: "Open result", exact: true })).toHaveCount(0);
    await expect(card.getByText("Loading submissions…")).toHaveCount(0);
    await shot(page, `343-withdrawn-after${suffix}`);

    await card.getByRole("button", { name: /^History/ }).click();
    await expect(card.getByText(/withdrawn by .*Re-annotation with guideline 2\.3/)).toBeVisible();
    await shot(page, `343-history-after${suffix}`);
    expect(errors).toEqual([]);
  });
}
