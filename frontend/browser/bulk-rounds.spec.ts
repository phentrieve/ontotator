/**
 * Bulk "Start a round…" on Documents (issue 336 step 3): the entry in "More actions", the dialog with the two rounds
 * a lead can start for a submitted annotation, the preview grouped by consequence, the consequences step without
 * Undo, and the new rounds. With SHOTS_DIR set, the states are also saved as screenshots (desktop and phone).
 *
 * Builds a fresh project through ``POST /__test_documents__`` (scenario S336R).
 */
import { expect, test, type Page } from "@playwright/test";
import { documentsReady, documentsScenario } from "./documentsHelpers";
import { loginExisting } from "./helpers";

test.setTimeout(240_000);
test.use({ actionTimeout: 15_000 });

const shots = process.env.SHOTS_DIR;
async function shot(page: Page, name: string): Promise<void> {
  if (shots) await page.screenshot({ path: `${shots}/${name}.png` });
}
const noHorizontalScroll = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);

for (const [width, height, suffix] of [[1440, 900, ""], [390, 844, "-phone"]] as const) {
  for (const kind of ["carry_forward", "clean_restart"] as const) {
    const restart = kind === "clean_restart";
    test(`More actions: Start a round… ${restart ? "restarts" : "continues"} the submitted annotations (${width} px)`, async ({ page }) => {
      const errors: string[] = [];
      page.on("console", message => { if (message.type() === "error") errors.push(message.text()); });
      page.on("pageerror", error => errors.push(String(error)));
      await page.setViewportSize({ width, height });
      const s = await documentsScenario(page, "S336R");
      await loginExisting(page, s.users.lead);
      await page.goto(`/#/projects/${encodeURIComponent(s.project)}/documents`);
      await documentsReady(page);

      await page.getByRole("checkbox", { name: "Select all 8 filtered texts" }).click();
      const bar = page.getByRole("region", { name: "Selection" });
      await expect(bar).toContainText("8 texts in 8 cases selected");
      await bar.getByRole("button", { name: "More actions" }).click();
      let menu = page.getByRole("menu", { name: "More actions" });
      const entry = menu.getByRole("menuitem", { name: /^Start a round…/ });
      await expect(entry).toHaveText("Start a round…");
      await expect(entry).not.toHaveAttribute("aria-disabled", "true");
      expect(await noHorizontalScroll(page)).toBe(true);
      if (!restart) await shot(page, `336-round-menu-after${suffix}`);

      await entry.click();
      const dialog = page.getByRole("dialog", { name: "Start a round: 8 texts" });
      await expect(dialog.getByRole("radio")).toHaveCount(2);
      await expect(dialog.getByRole("radio", { name: "Continue from the submission" })).toBeChecked();
      await expect(dialog.getByRole("checkbox")).toHaveCount(0);
      const groups = dialog.getByRole("list", { name: "Preview" }).getByRole("listitem");
      await expect(groups).toHaveCount(4);
      await expect(groups.nth(0)).toContainText("Continue 7 submitted tasks in a new round · Tom Reis 5, R. Roe 2");
      if (restart) {
        await dialog.getByRole("radio", { name: "Restart" }).check();
        await expect(groups.nth(0)).toContainText("Restart 7 submitted tasks in a new round · Tom Reis 5, R. Roe 2");
      }
      await expect(groups.nth(1)).toContainText("Skip 1 text · final result chosen: use Withdraw final… first");
      await expect(groups.nth(1)).toContainText("EN100027 en");
      await expect(groups.nth(2)).toContainText("Skip 1 text · a consolidation is open: finish or withdraw it first");
      await expect(groups.nth(2)).toContainText("EN100028 en");
      await expect(groups.nth(3)).toContainText("Keep 2 open tasks · not submitted yet");
      await expect(dialog.locator(".work-plan-summary")).toHaveText("Will change: 7 tasks in 5 texts");
      await groups.nth(0).getByRole("button", { name: "Show all 5" }).click();
      await expect(groups.nth(0)).toContainText("EN100022 en, EN100023 en, EN100024 en, EN100025 en, EN100026 en");

      const apply = dialog.getByRole("button", { name: "Start 7 rounds" });
      if (restart) {
        // A restart needs a reason, as the single action does.
        await expect(apply).toHaveAttribute("aria-disabled", "true");
        await expect(dialog.getByText("Enter the reason first.")).toBeVisible();
        await dialog.getByLabel(/^Reason/).fill("Tool proposals of 10 Nov replace the earlier set");
      } else {
        await expect(dialog.getByLabel("Reason (optional)")).toBeVisible();
      }
      expect(await noHorizontalScroll(page)).toBe(true);
      await shot(page, `336-round-dialog-${restart ? "restart" : "continue"}-after${suffix}`);

      await apply.click();
      await expect(dialog.getByText("What happens")).toBeVisible();
      await expect(dialog.getByText(/This cannot be undone here/)).toBeVisible();
      await expect(apply).toHaveAttribute("aria-disabled", "true");
      await dialog.getByLabel(restart ? "I understand — restart without the earlier findings" : "I understand", { exact: true }).check();
      await expect(apply).not.toHaveAttribute("aria-disabled", "true");
      expect(await noHorizontalScroll(page)).toBe(true);
      await shot(page, `336-round-consequences-${restart ? "restart" : "continue"}-after${suffix}`);

      await apply.click();
      await expect(dialog).toBeHidden();
      const toast = page.locator(".ui-toast");
      await expect(toast).toContainText("Started 7 rounds in 5 texts.");
      await expect(toast.getByRole("button", { name: "Undo" })).toHaveCount(0);
      await expect(bar).toContainText("8 texts in 8 cases selected");
      expect(await noHorizontalScroll(page)).toBe(true);
      await shot(page, `336-round-toast-${restart ? "restart" : "continue"}-after${suffix}`);

      // The task has a new round of the kind asked for; the earlier one is closed.
      const rounds = await page.evaluate(async id => {
        const response = await fetch(`/api/v1/assignments/${id}/rounds`);
        return (await response.json() as { kind: string; state: string }[]).map(round => `${round.kind}:${round.state}`);
      }, (s.assignments as Record<string, number>).first);
      expect(rounds).toEqual(restart ? ["ordinary:abandoned", "clean_restart:editable"] : ["ordinary:superseded", "carry_forward:editable"]);

      // Nothing is submitted any more on the texts that take a round: the entry says so, and names the two texts it
      // skips (issue 576, F6: it read "No submitted annotations" for them too).
      await bar.getByRole("button", { name: "More actions" }).click();
      menu = page.getByRole("menu", { name: "More actions" });
      await expect(menu.getByRole("menuitem", { name: /^Start a round…/ })).toHaveAttribute("aria-disabled", "true");
      await expect(menu.getByRole("menuitem", { name: /^Start a round…/ })).toContainText("1 text has a final result, 1 has an open consolidation; the others have no submitted annotations.");
      if (restart) await shot(page, `336-round-menu-unavailable-after${suffix}`);
      expect(errors).toEqual([]);
    });
  }
}
