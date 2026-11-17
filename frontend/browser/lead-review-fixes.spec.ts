/**
 * Findings of the review of the lead's pages (Documents and the text card):
 * - F1: History names who reopened a task, started a round or changed a final result, when and why.
 * - F2: a final result replaced in the text card has the toast with Undo of the bulk "Change final…", the card
 *   stays on its text, and the toast raised while the card is open is visible and its Undo works.
 * With SHOTS_DIR set, the states are also saved as screenshots (desktop and phone).
 *
 * Each test builds a fresh project through a scenario route.
 */
import { expect, test, type Locator, type Page } from "@playwright/test";
import { activityLines, cardPath, documentsReady, documentsScenario, showSegment } from "./documentsHelpers";
import { loginExisting } from "./helpers";

test.setTimeout(240_000);
test.use({ actionTimeout: 15_000 });

const shots = process.env.SHOTS_DIR;
async function shot(page: Page, name: string): Promise<void> {
  if (!shots) return;
  await page.evaluate(() => Promise.all(document.getAnimations().map(animation => animation.finished.catch(() => null))));
  await page.screenshot({ path: `${shots}/${name}.png` });
}
const noHorizontalScroll = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
const SIZES = [[1440, 900, ""], [390, 844, "-phone"]] as const;
/** "17 Nov, 13:37": every History line of a change carries date and time. */
const WHEN = String.raw`\d{1,2} [A-Z][a-z]{2}, \d\d:\d\d`;

function watchErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on("console", message => { if (message.type() === "error") errors.push(message.text()); });
  page.on("pageerror", error => errors.push(String(error)));
  return errors;
}

async function openDocuments(page: Page, scenario: string, query = ""): Promise<Awaited<ReturnType<typeof documentsScenario>>> {
  const s = await documentsScenario(page, scenario);
  await loginExisting(page, s.users.lead);
  await page.goto(`/#/projects/${encodeURIComponent(s.project)}/documents${query}`);
  await documentsReady(page);
  return s;
}

/** The card of a text, opened by its address; returns the dialog. */
async function openCard(page: Page, project: string, caseId: string): Promise<Locator> {
  await page.goto(`/#/projects/${encodeURIComponent(project)}/documents?panel=${encodeURIComponent(`${caseId}:en`)}`);
  const card = page.getByRole("dialog", { name: `${caseId} en` });
  await expect(cardPath(card)).toBeVisible();
  return card;
}

async function showHistory(card: Locator): Promise<Locator> {
  await card.getByRole("button", { name: /^History \(\d+\)$/ }).click();
  await expect(card.getByRole("button", { name: "Back", exact: true })).toBeVisible();
  return activityLines(card);
}

/** Select all texts and open an entry of "More actions". */
async function moreAction(page: Page, count: number, entry: string): Promise<void> {
  await page.getByRole("checkbox", { name: `Select all ${count} filtered texts` }).click();
  await page.getByRole("region", { name: "Selection" }).getByRole("button", { name: "More actions" }).click();
  await page.getByRole("menu", { name: "More actions" }).getByRole("menuitem", { name: entry }).click();
}

for (const [width, height, suffix] of SIZES) {
  test(`F1: History names the lead, the time and the reason of a reopened task (${width} px)`, async ({ page }) => {
    const errors = watchErrors(page);
    await page.setViewportSize({ width, height });
    const s = await openDocuments(page, "S336");
    await moreAction(page, 8, "Reopen…");
    const dialog = page.getByRole("dialog", { name: /^Reopen/ });
    await dialog.getByLabel(/^Reason/).fill("Guideline changed: code seizure types separately");
    const apply = dialog.getByRole("button", { name: /^Reopen \d+/ });
    await apply.click();
    await dialog.getByLabel("I understand").check();
    await apply.click();
    await expect(dialog).toBeHidden();

    const card = await openCard(page, s.project, "EN100027");
    const lines = await showHistory(card);
    await expect(lines.first()).toHaveText(new RegExp(`^Annotation: ?task of R\\. Roe \\(ann-\\d+\\) reopened by you, ${WHEN}: Guideline changed: code seizure types separately$`));
    // Every line with a time has its date.
    for (const text of await lines.allInnerTexts()) expect(text, text).not.toMatch(/(^|[^,]) \d\d:\d\d/);
    expect(await noHorizontalScroll(page)).toBe(true);
    await shot(page, `f1-reopen-history-after${suffix}`);
    expect(errors).toEqual([]);
  });

  test(`F1, F2: a final result replaced in the card stays there, has Undo in the message, and History names both (${width} px)`, async ({ page }) => {
    const errors = watchErrors(page);
    await page.setViewportSize({ width, height });
    const s = await openDocuments(page, "S336F");
    // The bulk Change final…: R. Roe's newer submission replaces Tom Reis's final result of EN100022 and EN100023.
    await moreAction(page, 8, "Change final…");
    const bulk = page.getByRole("dialog", { name: "Change final: 8 texts" });
    const apply = bulk.getByRole("button", { name: "Change 2 final results" });
    await apply.click();
    await bulk.getByLabel("I understand").check();
    await apply.click();
    await expect(bulk).toBeHidden();

    // Change final… in the card: one click on "Use as final" saves. The card stays on EN100022 (EN100024 waits for a
    // decision), and the message raised while the card is open is visible with its Undo.
    const card = await openCard(page, s.project, "EN100022");
    await showSegment(card, "Finalization");
    await card.getByRole("button", { name: "Change final…", exact: true }).click();
    // A table on the desktop, a list on the phone.
    const submissions = width > 700 ? card.getByRole("table", { name: "Submissions, EN100022 en" }).getByRole("row") : card.getByRole("list", { name: "Submissions, EN100022 en" }).getByRole("listitem");
    await submissions.filter({ hasText: "Tom Reis" }).getByRole("button", { name: "Use as final" }).click();
    const toast = page.locator(".ui-toast");
    await expect(toast).toContainText("Final result of EN100022 en changed.");
    await expect(card.locator(".final-panel-success")).toContainText("Final result saved for EN100022 en.");
    await expect(page.getByRole("dialog", { name: "EN100022 en" })).toBeVisible();
    await expect(page.getByRole("dialog", { name: "EN100024 en" })).toHaveCount(0);
    const undo = toast.getByRole("button", { name: "Undo" });
    await expect(undo).toBeVisible();
    // Nothing of the card lies over the Undo button.
    const onTop = await undo.evaluate(element => {
      const box = element.getBoundingClientRect();
      const hit = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2);
      return !!hit && element.contains(hit);
    });
    expect(onTop, "the Undo button is covered").toBe(true);
    expect(await noHorizontalScroll(page)).toBe(true);
    await shot(page, `f2-toast-with-card-open-after${suffix}`);

    await undo.click();
    await expect(toast).toContainText("The earlier final result of EN100022 en is back.");
    await expect(page.getByRole("dialog", { name: "EN100022 en" })).toBeVisible();
    await shot(page, `f2-undone-after${suffix}`);

    // History, newest first: the Undo, the change in the card, the bulk change, the first choice.
    const lines = await showHistory(card);
    const roe = String.raw`the result of R\. Roe \(ann-\d+\)`;
    const tom = String.raw`the result of Tom Reis \(ann-\d+\)`;
    await expect(lines.nth(0)).toHaveText(new RegExp(`^Finalization: ?change undone by you, ${roe} is final again, ${WHEN}$`));
    await expect(lines.nth(1)).toHaveText(new RegExp(`^Finalization: ?changed from ${roe} to ${tom} by you, ${WHEN}$`));
    await expect(lines.nth(2)).toHaveText(new RegExp(`^Finalization: ?changed from ${tom} to ${roe} by you, ${WHEN}$`));
    await expect(lines.nth(3)).toHaveText(new RegExp(`^Finalization: ?${tom} chosen by you, ${WHEN}$`));
    expect(await noHorizontalScroll(page)).toBe(true);
    await shot(page, `f1-final-history-after${suffix}`);
    expect(errors).toEqual([]);
  });
}
