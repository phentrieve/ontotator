/**
 * Four small layout and order fixes, each at the window sizes its issue names:
 * - issue 436: the findings list follows the text (start of the first segment, findings without a span last);
 * - issue 452: on a phone, "Choose term" of a new mark is in view without scrolling, and the text does not move;
 * - issue 438: on a phone, a submission layer of the text view goes below the text, which keeps the full width;
 * - issue 439: a toast of the previous action never covers an open dialog, and its Undo is still there afterwards.
 *
 * Every test builds its own project (ANNOTATION_LOOP, CHECKED, S336). With UI_FIXES_SHOTS=<directory> the states
 * are saved as screenshots, named with UI_FIXES_PHASE ("before" or "after", default "after").
 */
import { expect, test, type Locator, type Page } from "@playwright/test";
import { documentsReady, documentsScenario } from "./documentsHelpers";
import { loginExisting, selectText } from "./helpers";
import { loginScenarioUser as loginCheckUser, proposalCheckScenario } from "./proposalCheckHelpers";
import { loginScenarioUser, reviewFlowScenario, type ReviewFlowScenario } from "./reviewFlowHelpers";

test.setTimeout(240_000);
test.use({ actionTimeout: 15_000 });

const DESKTOP = { width: 1440, height: 900 } as const;
const PHONE = { width: 390, height: 844 } as const;

const shots = process.env.UI_FIXES_SHOTS;
const phase = process.env.UI_FIXES_PHASE ?? "after";
async function shot(page: Page, name: string): Promise<void> {
  if (shots) await page.screenshot({ path: `${shots}/${name}-${phase}.png` });
}

function consoleErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on("console", message => { if (message.type() === "error") errors.push(message.text()); });
  page.on("pageerror", error => errors.push(error.message));
  return errors;
}
const noSidewaysScroll = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);

/** True when the element's centre is inside the window and the element itself (or a descendant) is on top there. */
const onTop = (locator: Locator) => locator.evaluate(element => {
  const box = element.getBoundingClientRect();
  const x = box.left + box.width / 2, y = box.top + box.height / 2;
  if (x < 0 || y < 0 || x > window.innerWidth || y > window.innerHeight) return false;
  const top = document.elementFromPoint(x, y);
  return !!top && (top === element || element.contains(top));
});

const textPane = (page: Page) => page.locator(".text-container");
const search = (page: Page) => page.getByLabel("Search term", { exact: true });
const findingRows = (page: Page) => page.locator('.sidebar [data-list-key^="annotation:"]');
const pendingBar = (page: Page) => page.getByRole("group", { name: "New finding", exact: true });
const chooseTerm = (page: Page) => pendingBar(page).getByRole("button", { name: "Choose term", exact: true });

async function openLoop(page: Page, size: { width: number; height: number }): Promise<ReviewFlowScenario> {
  await page.setViewportSize(size);
  const s = await reviewFlowScenario(page, "ANNOTATION_LOOP");
  await loginScenarioUser(page, s, "annotator");
  await page.goto(`/#/tasks/${s.assignments["loop-en"]}`);
  await expect(textPane(page)).toHaveText(s.texts["loop-en"]);
  return s;
}

// ---- Issue 436 ------------------------------------------------------------------------------------------------

for (const size of [DESKTOP, PHONE]) {
  const phone = size.width < 700;
  test(`issue 436: the findings list follows the text, also after delete, undo, redo and a reload (${size.width} px)`, async ({ page }) => {
    const errors = consoleErrors(page);
    const s = await openLoop(page, size);
    const text = s.texts["loop-en"]; // "The patient has a seizure and hypotonia."
    const pane = async (name: "Findings" | "Document" | "Details") => {
      if (phone) await page.getByRole("navigation", { name: "Select view" }).getByRole("button", { name: name === "Findings" ? /^Findings/ : name }).click();
    };
    /** Term IDs of the list rows, top to bottom. */
    const order = async () => {
      await pane("Findings");
      return findingRows(page).evaluateAll(rows => rows.map(row => /HP:\d{7}/.exec(row.textContent ?? "")?.[0] ?? row.textContent));
    };
    const pick = async (termId: string, count: number) => {
      await search(page).fill(termId);
      await page.locator(".candidate-card").filter({ hasText: termId }).first().click();
      await expect(page.locator(".inspector-pane h2")).toContainText(termId);
      await expect(findingRows(page)).toHaveCount(count);
    };
    const mark = async (word: string, termId: string, count: number) => {
      await pane("Document");
      const start = text.indexOf(word);
      await selectText(page, start, start + word.length);
      if (phone) await chooseTerm(page).click();
      await pick(termId, count);
    };
    const SEIZURE = "HP:0001250", HYPOTONIA = "HP:0001252", AREFLEXIA = "HP:0001284", HEARING = "HP:0000365";

    // Created from the end of the text to its start, with a finding without a span in between.
    await mark("hypotonia", HYPOTONIA, 1);
    await mark("seizure", SEIZURE, 2);
    await pane("Findings");
    await page.getByRole("button", { name: "Add finding without a text span" }).click();
    const reason = page.getByLabel("Reason for no text span");
    if (await reason.count()) await reason.fill("Named in the referral letter only");
    await pick(HEARING, 3);
    await mark("patient", AREFLEXIA, 4);

    // The finding just added is the selected one, at its place in the text; the one without a span is last.
    await pane("Findings");
    await shot(page, `436-list-${size.width}`);
    expect(await order()).toEqual([AREFLEXIA, SEIZURE, HYPOTONIA, HEARING]);
    await expect(findingRows(page).first()).toHaveAttribute("aria-pressed", "true");
    await expect(findingRows(page).and(page.locator('[aria-pressed="true"]'))).toHaveCount(1);
    expect(await noSidewaysScroll(page)).toBe(true);

    // Delete the middle finding: the others keep their order and nothing is selected.
    await findingRows(page).filter({ hasText: SEIZURE }).click();
    await pane("Details");
    await page.getByRole("button", { name: "Delete finding", exact: true }).click();
    await page.getByRole("group", { name: "Confirm deletion" }).getByRole("button", { name: "Yes, delete" }).click();
    await expect(findingRows(page)).toHaveCount(3);
    expect(await order()).toEqual([AREFLEXIA, HYPOTONIA, HEARING]);
    await expect(findingRows(page).and(page.locator('[aria-pressed="true"]'))).toHaveCount(0);

    // Undo brings it back to its place in the text, not to the end; redo removes it again.
    await page.getByRole("button", { name: "Undo last change", exact: true }).click();
    await expect(findingRows(page)).toHaveCount(4);
    expect(await order()).toEqual([AREFLEXIA, SEIZURE, HYPOTONIA, HEARING]);
    await page.getByRole("button", { name: "Redo last change", exact: true }).click();
    await expect(findingRows(page)).toHaveCount(3);
    expect(await order()).toEqual([AREFLEXIA, HYPOTONIA, HEARING]);
    await page.getByRole("button", { name: "Undo last change", exact: true }).click();
    await expect(findingRows(page)).toHaveCount(4);

    // The order comes from the text, so a reload shows the same list.
    await page.reload();
    await expect(textPane(page)).toHaveText(text);
    await pane("Findings");
    await expect(findingRows(page)).toHaveCount(4);
    expect(await order()).toEqual([AREFLEXIA, SEIZURE, HYPOTONIA, HEARING]);
    await shot(page, `436-list-reloaded-${size.width}`);
    expect(errors).toEqual([]);
  });
}
