/**
 * Issue 483 (point 5): the lead adds to the reason of "Ask a reviewer to correct…" after sending it.
 * The lead asks Ana to correct the accepted de v1 of case-0101, then adds to the reason at Ana's row of the text
 * card ("Add to the reason…"). The reason as sent stays; the addition stands below it with its date, in the card and
 * in History, and Ana reads it in My tasks and in her review. Driven through the real endpoints at 1440 px and at
 * 390 px; no console errors, no horizontal page scroll.
 */
import { expect, test, type Locator, type Page } from "@playwright/test";
import { activityLines, cardPath, personRow, showSegment } from "./documentsHelpers";
import { loginThroughForm } from "./helpers";
import { leadScenario, type LeadScenario } from "./leadWorkflowHelpers";

test.setTimeout(240_000);
test.use({ actionTimeout: 15_000 });

const sizes = [["1440", { width: 1440, height: 900 }], ["390", { width: 390, height: 844 }]] as const;
const TIME = String.raw`\d{1,2} [A-Z][a-z]{2}(?: \d{4})?, \d{2}:\d{2}`;
const REASON = "Dose missing in the second sentence.";
const NOTE = "Paragraph 3 has the same unit as well.";
const CASE = "case-0101";

function consoleErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on("console", message => { if (message.type() === "error") errors.push(message.text()); });
  page.on("pageerror", error => errors.push(error.message));
  return errors;
}

const noHorizontalScroll = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth);

async function openCard(page: Page, s: LeadScenario): Promise<Locator> {
  await page.goto(`/#/projects/${encodeURIComponent(s.project)}/documents?panel=${encodeURIComponent(`${CASE}:de`)}`);
  const card = page.getByRole("dialog", { name: `${CASE} de` });
  await expect(cardPath(card)).toBeVisible();
  await showSegment(card, "Translation");
  return card;
}

for (const [name, viewport] of sizes) {
  test(`${name} px: the lead adds to the reason of a correction request and the reviewer reads it`, async ({ page }) => {
    await page.setViewportSize(viewport);
    const errors = consoleErrors(page);
    const s = await leadScenario(page, "ACCEPTED_TRANSLATION_FOR_LEAD");
    await loginThroughForm(page, s.users.lead, s.display_names.lead);
    let card = await openCard(page, s);

    // "Ask a reviewer to correct…" Ana, who accepted v1.
    const v1 = card.locator("li.text-version").first();
    await v1.getByRole("button", { name: `Ask a reviewer to correct v1 of ${CASE} de…`, exact: true }).click();
    const ask = page.getByRole("dialog", { name: `Ask a reviewer to correct, ${CASE} de`, exact: true });
    const reviewer = ask.getByLabel("Translation reviewer");
    const ana = await reviewer.locator("option", { hasText: s.display_names.ana }).getAttribute("value");
    await reviewer.selectOption(ana!);
    await ask.getByLabel("Reason for another review").fill(REASON);
    await ask.getByRole("button", { name: "Ask the reviewer", exact: true }).click();
    await expect(ask.getByText(/was asked to correct the translation\.$/)).toBeVisible();
    await ask.locator(".modal-actions").getByRole("button", { name: "Close", exact: true }).click();
    await expect(ask).toBeHidden();

    // Ana's row names the request; "Add to the reason…" adds a note below it.
    card = await openCard(page, s);
    const row = personRow(card, "Translation reviewers", s.display_names.ana);
    const reason = row.getByRole("note", { name: "Reason of the correction request", exact: true });
    await expect(reason).toContainText(`“${REASON}”`);
    await row.getByRole("button", { name: `Add to the reason for ${s.display_names.ana}`, exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "Add to the reason", exact: true });
    await expect(dialog).toContainText(`${s.display_names.ana} reads your addition below the reason, with its date. The reason as sent stays as it is.`);
    const add = dialog.locator(".modal-actions").getByRole("button", { name: "Add to the reason", exact: true });
    await expect(add).toBeDisabled();
    await dialog.getByLabel("Addition to the reason").fill(NOTE);
    expect(await noHorizontalScroll(page)).toBe(true);
    await add.click();
    await expect(dialog).toBeHidden();
    await expect(reason).toContainText(`“${REASON}”`);
    await expect(reason).toContainText(new RegExp(`Added by you on ${TIME}: ${NOTE.replace(/\./g, "\\.")}`));
    expect(await noHorizontalScroll(page)).toBe(true);

    // History: the request and the addition, each with who, when and the text.
    await card.getByRole("button", { name: /^History \(\d+\)$/ }).click();
    await expect(activityLines(card).filter({ hasText: "correction requested" })).toHaveText(
      new RegExp(`correction requested from ${s.display_names.ana} \\(${s.pseudonyms.ana}\\) by you, ${TIME}: ${REASON.replace(/\./g, "\\.")}$`));
    await expect(activityLines(card).filter({ hasText: "addition to the correction request" })).toHaveText(
      new RegExp(`addition to the correction request for ${s.display_names.ana} \\(${s.pseudonyms.ana}\\) by you, ${TIME}: ${NOTE.replace(/\./g, "\\.")}$`));

    // Ana: in My tasks under the task name, and in the review above Decision.
    await page.goto("about:blank");
    await page.context().clearCookies();
    await loginThroughForm(page, s.users.ana, s.display_names.ana);
    const task = page.getByTestId("task-row").filter({ hasText: CASE });
    await expect(task).toContainText(new RegExp(`Second review requested by the lead on .+: ${REASON.replace(/\./g, "\\.")}`));
    await expect(task).toContainText(new RegExp(`Added by the lead on .+: ${NOTE.replace(/\./g, "\\.")}`));
    expect(await noHorizontalScroll(page)).toBe(true);
    await task.getByRole("link").first().click();
    const note = page.getByRole("note", { name: "From the lead", exact: true });
    await expect(note.locator("p")).toHaveText([
      new RegExp(`^Second review requested by the lead on .+: ${REASON.replace(/\./g, "\\.")}$`),
      new RegExp(`^Added by the lead on .+: ${NOTE.replace(/\./g, "\\.")}$`),
    ]);
    expect(await noHorizontalScroll(page)).toBe(true);
    expect(errors).toEqual([]);
  });
}
