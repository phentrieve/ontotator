/**
 * Issue 621: the (?) help and Work plan follow-ups from the 0.14.0 acceptance. At 1440×900 and at 390×844 by touch:
 * the dialog opens with the focus on its primary action in view (not on a (?) in the scrolled body); the (?) at the
 * top of the scrolling body keeps its whole hit area (36 px, 44 px on a touch screen); a (?) opened at the bottom
 * edge of the body scrolls its explanation into view; a quick choice's count "(2 texts)" stays on one line; and the
 * dialog's Close is 44 px on the phone.
 */
import { expect, test, type Locator, type Page } from "@playwright/test";
import { documentsReady, documentsTab, rowBox } from "./documentsHelpers";
import { loginThroughForm } from "./helpers";
import { leadScenario } from "./leadWorkflowHelpers";

test.setTimeout(180_000);
test.use({ actionTimeout: 15_000 });

const esc = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Selects the scenario's texts by key (``accepted``, ``unreviewed``) and opens Plan… from the selection bar. */
async function openPlan(page: Page, keys: string[] = ["accepted"]): Promise<Locator> {
  const s = await leadScenario(page, "ACCEPTED_TRANSLATION_FOR_LEAD");
  await loginThroughForm(page, s.users.lead, s.display_names.lead, { lastProject: s.project });
  await expect(page).toHaveURL(new RegExp(`#/projects/${esc(s.project)}/documents`));
  await documentsReady(page);
  await documentsTab(page, "All").click();
  for (const key of keys) await rowBox(page, s.cases![key], "de").check();
  await page.getByRole("region", { name: "Selection", exact: true }).getByRole("button", { name: "Plan…", exact: true }).click();
  const plan = page.getByRole("dialog", { name: new RegExp(`^Work plan\\W+${keys.length} cases?$`) });
  await expect(plan).toBeVisible();
  return plan;
}

/** Every corner and edge midpoint of the (?)'s hit area hits the button itself: the scrolling body cuts none of it. */
async function expectWholeHitArea(button: Locator, size: number, what: string): Promise<void> {
  const missed = await button.evaluate((element, side) => {
    const rect = element.getBoundingClientRect();
    const cx = rect.left + rect.width / 2; const cy = rect.top + rect.height / 2;
    const reach = side / 2 - 1;
    const points: [number, number][] = [];
    for (const dx of [-reach, 0, reach]) for (const dy of [-reach, 0, reach]) points.push([cx + dx, cy + dy]);
    return points.filter(([x, y]) => document.elementFromPoint(x, y) !== element).map(([x, y]) => { const hit = document.elementFromPoint(x, y); return `${Math.round(x)},${Math.round(y)} ${hit?.tagName}.${hit?.className}`; });
  }, size);
  expect(missed, `${what}: points of the ${size} px hit area that miss the button`).toEqual([]);
}

/** How many line boxes the text `part` of the element takes. */
const linesOf = (locator: Locator, part: string) => locator.evaluate((element, wanted) => {
  const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const at = node.textContent!.indexOf(wanted);
    if (at < 0) continue;
    const range = document.createRange();
    range.setStart(node, at); range.setEnd(node, at + wanted.length);
    return new Set([...range.getClientRects()].filter(rect => rect.width > 0).map(rect => Math.round(rect.top))).size;
  }
  return -1;
}, part);

test("1440 px, keyboard: the Work plan opens on Save, in view; the quick choice's (?) keeps its 36 px hit area", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const plan = await openPlan(page);
  const save = plan.getByRole("button", { name: "Save for 1 case", exact: true });
  await expect(save).toBeFocused();
  await expect(save).toBeInViewport({ ratio: 1 });
  // The body loads after the focus moved: it stays on Save.
  const quick = plan.getByRole("button", { name: "Help: Quick choice", exact: true });
  await expect(quick).toBeVisible();
  await expect(plan.getByRole("textbox", { name: /^Reason/ })).toBeVisible();
  await expect(save).toBeFocused();
  // The greyed Save says why while it has the focus.
  await expect(save).toHaveAttribute("aria-disabled", "true");
  await expect(save).toHaveAccessibleDescription("Nothing to change yet.");
  await expectWholeHitArea(quick, 36, "desktop");
  // Tab walks into the body: the (?) is reached and opens with Enter.
  await quick.focus();
  await page.keyboard.press("Enter");
  await expect(quick).toHaveAttribute("aria-expanded", "true");
  await expect(plan.getByText("Fills the choices below for the selected texts only", { exact: false })).toBeInViewport({ ratio: 1 });
});

test.describe("390 px by touch", () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true });

  test("focus on Save, the (?) hit area, Close 44 px, the count on one line, and an explanation opened at the bottom edge scrolls into view", async ({ page }) => {
    // The unreviewed text is one "Annotation only, no translation review" changes: that choice names "(1 text)".
    const plan = await openPlan(page, ["accepted", "unreviewed"]);
    const save = plan.getByRole("button", { name: "Save for 2 cases", exact: true });
    await expect(save).toBeFocused();
    await expect(save).toBeInViewport({ ratio: 1 });
    const body = plan.locator(".ui-dialog-body");

    const close = (await plan.getByRole("button", { name: "Close", exact: true }).boundingBox())!;
    expect(close.width).toBeGreaterThanOrEqual(44);
    expect(close.height).toBeGreaterThanOrEqual(44);

    const quick = plan.getByRole("button", { name: "Help: Quick choice", exact: true });
    await expect(quick).toBeVisible();
    const coarse = await page.evaluate(() => matchMedia("(pointer: coarse)").matches);
    await expectWholeHitArea(quick, coarse ? 44 : 36, coarse ? "touch" : "phone");

    // The count of each quick choice that changes texts stays together: "(1 text)", never "(1" / "text)".
    const choices = plan.getByRole("group", { name: "Quick choice for the selected translations" }).locator(".plan-quick-choice-actions").getByRole("button");
    await expect(choices).toHaveCount(2);
    await expect(choices.filter({ hasText: /\(\d+\stexts?\)/ }).first()).toBeVisible();
    for (const choice of await choices.all()) {
      const count = /\(\d+\stexts?\)/.exec((await choice.textContent()) ?? "")?.[0];
      if (count) expect(await linesOf(choice, count), `${count} in ${await choice.textContent()}`).toBe(1);
    }

    // Help: Reason at the bottom edge of the scrolling body, then a tap: the explanation scrolls into view.
    const reasonHelp = plan.getByRole("button", { name: "Help: Reason", exact: true });
    await reasonHelp.evaluate(element => {
      const scroller = element.closest(".ui-dialog-body")!;
      const box = scroller.getBoundingClientRect();
      const button = element.getBoundingClientRect();
      scroller.scrollTop += button.bottom - (box.bottom - parseFloat(getComputedStyle(scroller).paddingBottom));
    });
    await reasonHelp.tap();
    await expect(reasonHelp).toHaveAttribute("aria-expanded", "true");
    const text = plan.locator(`[id="${await reasonHelp.getAttribute("aria-controls")}"]`);
    await expect(text).toBeVisible();
    const [textBox, bodyBox] = [(await text.boundingBox())!, (await body.boundingBox())!];
    expect(textBox.y + textBox.height, "explanation inside the body").toBeLessThanOrEqual(bodyBox.y + bodyBox.height + 0.5);
    expect(textBox.y).toBeGreaterThanOrEqual(bodyBox.y - 0.5);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth), "no horizontal scroll").toBe(true);
  });
});
