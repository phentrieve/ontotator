/**
 * Issue 618 (blocker for 0.14.0): the reason of a greyed quick choice in the Work plan dialog (#604, `ReasonButton`
 * from #599) floated above the button, right-aligned, and the dialog's scrolling body cut it (48 px of each line on a
 * phone, 88 px at 1440) while it covered the other quick choice. Inside a scrolling box the reason now shows in the
 * flow under its button. At 1440×900, 1280×720 and 390×844, light and dark, on focus, press and hover: the tip lies
 * inside the dialog body, is not cut, and covers no other quick choice.
 */
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { expect, test, type Locator, type Page } from "@playwright/test";
import { documentsReady, documentsTab, rowBox } from "./documentsHelpers";
import { loginThroughForm } from "./helpers";
import { leadScenario } from "./leadWorkflowHelpers";

test.setTimeout(180_000);
test.use({ actionTimeout: 15_000 });

const esc = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const VIEWPORTS = [
  { name: "1440", width: 1440, height: 900 },
  { name: "1280", width: 1280, height: 720 },
  { name: "390", width: 390, height: 844 },
] as const;

/** Screenshots for review only (never baselines); ONTOTATOR_SHOTS_DIR overrides the folder. */
async function shot(page: Page, name: string) {
  const dir = process.env.ONTOTATOR_SHOTS_DIR ?? resolve(test.info().config.rootDir, "../../build/reason-tip/evidence");
  mkdirSync(dir, { recursive: true });
  await page.screenshot({ path: resolve(dir, `${name}.png`) });
}

type Box = { x: number; y: number; width: number; height: number };
const inside = (inner: Box, outer: Box) =>
  inner.x >= outer.x - 0.5 && inner.y >= outer.y - 0.5
  && inner.x + inner.width <= outer.x + outer.width + 0.5 && inner.y + inner.height <= outer.y + outer.height + 0.5;
const overlaps = (a: Box, b: Box) =>
  a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;

/** The shown tip of `button`: inside the dialog body's visible box, not cut, clear of every other quick choice. */
async function expectReadable(tip: Locator, button: Locator, choices: Locator, body: Locator, what: string) {
  await expect(tip, what).toBeVisible();
  const tipBox = (await tip.boundingBox())!;
  const bodyBox = (await body.boundingBox())!;
  expect(inside(tipBox, bodyBox), `${what}: tip ${JSON.stringify(tipBox)} inside body ${JSON.stringify(bodyBox)}`).toBe(true);
  // Nothing of the text is cut: the tip shows its whole content.
  expect(await tip.evaluate(element => element.scrollWidth <= element.clientWidth && element.scrollHeight <= element.clientHeight), `${what}: not cut`).toBe(true);
  for (const other of await choices.all()) {
    if (await other.evaluate((element, self) => element === self, await button.elementHandle())) continue;
    const otherBox = (await other.boundingBox())!;
    expect(overlaps(tipBox, otherBox), `${what}: tip ${JSON.stringify(tipBox)} clear of ${await other.textContent()} ${JSON.stringify(otherBox)}`).toBe(false);
  }
}

for (const viewport of VIEWPORTS) {
  for (const scheme of ["light", "dark"] as const) {
    test(`${viewport.name} px ${scheme}: a greyed quick choice shows its whole reason under it, inside the dialog body (issue 618)`, async ({ page }) => {
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      await page.emulateMedia({ colorScheme: scheme });
      const s = await leadScenario(page, "ACCEPTED_TRANSLATION_FOR_LEAD");
      const caseId = s.cases!.accepted;
      await loginThroughForm(page, s.users.lead, s.display_names.lead, { lastProject: s.project });
      await expect(page).toHaveURL(new RegExp(`#/projects/${esc(s.project)}/documents`));
      await documentsReady(page);
      await documentsTab(page, "All").click();
      await rowBox(page, caseId, "de").check();
      await page.getByRole("region", { name: "Selection", exact: true }).getByRole("button", { name: "Plan…", exact: true }).click();
      const plan = page.getByRole("dialog", { name: /^Work plan\W+1 case$/ });
      const body = plan.locator(".ui-dialog-body");
      const group = plan.getByRole("group", { name: "Quick choice for the selected translations" });
      const choices = group.locator(".plan-quick-choice-actions").getByRole("button");
      await expect(choices).toHaveCount(2);
      // The effects of the quick choices come with the plan preview: wait for the greyed state before counting.
      const annotationOnly = group.getByRole("button", { name: /^Annotation only, no translation review/ });
      await expect(annotationOnly).toHaveAttribute("aria-disabled", "true");
      const greyed = group.locator('.plan-quick-choice-actions button[aria-disabled="true"]');
      // The a11y contract stays: the reason is the description and the title.
      await expect(annotationOnly).toHaveAccessibleDescription(/^Already planned\. 1 text keeps its translation review: it has started or is done\.$/);
      await expect(annotationOnly).toHaveAttribute("title", /^Already planned\./);
      const tip = annotationOnly.locator("xpath=following-sibling::*[contains(@class, 'ui-reason-tip')]");

      for (const button of await greyed.all()) {
        const buttonTip = button.locator("xpath=following-sibling::*[contains(@class, 'ui-reason-tip')]");
        // Hidden until it is asked for: it takes no room in the dialog.
        await expect(buttonTip).toBeHidden();
        // Keyboard focus.
        await button.focus();
        await expectReadable(buttonTip, button, choices, body, `focus ${await button.textContent()}`);
        await button.blur();
        await expect(buttonTip).toBeHidden();
      }

      // A press (touch on the phone) shows it too and changes nothing.
      // aria-disabled keeps it pressable; Playwright counts it as not enabled, so the press goes to its centre.
      const centre = (await annotationOnly.boundingBox())!;
      await page.mouse.click(centre.x + centre.width / 2, centre.y + centre.height / 2);
      await expectReadable(tip, annotationOnly, choices, body, "press");
      await shot(page, `quick-choice-press-${viewport.name}-${scheme}`);
      await annotationOnly.blur();

      if (viewport.name !== "390") {
        // Pointing at it: the tip shows and the button stays under the pointer.
        await annotationOnly.hover();
        await expectReadable(tip, annotationOnly, choices, body, "hover");
        await expect(annotationOnly).toBeVisible();
        await page.mouse.move(0, 0);
      }

      // The footer's greyed Save keeps its tip above the button (the footer does not scroll).
      const save = plan.getByRole("button", { name: "Save for 1 case", exact: true });
      if ((await save.getAttribute("aria-disabled")) === "true") {
        await expect(save.locator("xpath=..")).toHaveAttribute("data-tip", "above");
      }
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth), "no horizontal scroll").toBe(true);
    });
  }
}
