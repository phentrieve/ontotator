/**
 * Issue 483: the lead decides a translation review submitted as a query, under "Resolve…" on the Documents row.
 * - "Accept the reviewer's text…": the reviewer's proposed text with its changes against the version becomes v2,
 *   accepted; the answer is optional.
 * - "Answer and accept the version as it is…": v1 is accepted unchanged; the answer is required.
 * After each the row goes on (the annotation can be assigned), the version row and History name the decision,
 * and the reviewer reads the answer at the submitted task.
 * Driven through the real endpoints at 1440 px and at 390 px; no console errors, no horizontal page scroll.
 */
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { activityLines, documentsLive, documentsReady, documentsTab, openTextCard, rowAction, textCard, textNamePattern, textVersionItems } from "./documentsHelpers";
import { loginThroughForm } from "./helpers";
import { leadScenario, type LeadPerson, type LeadScenario } from "./leadWorkflowHelpers";

test.setTimeout(240_000);
test.use({ actionTimeout: 15_000 });

const sizes = [["1440", { width: 1440, height: 900 }], ["390", { width: 390, height: 844 }]] as const;
const TIME = String.raw`\d{1,2} [A-Z][a-z]{2}(?: \d{4})?, \d{2}:\d{2}`;
const esc = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const QUESTION = "The source says muscular hypotonia. Is the short form meant?";

/** Screenshots for human review only (never baselines); ONTOTATOR_SHOTS_DIR overrides the folder. */
async function shot(page: Page, name: string) {
  const dir = process.env.ONTOTATOR_SHOTS_DIR ?? resolve(test.info().config.rootDir, "../../build/query-decision/evidence");
  mkdirSync(dir, { recursive: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth), `${name}: no horizontal scroll`).toBe(true);
  await page.screenshot({ path: resolve(dir, `${name}.png`) });
}

function consoleErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on("console", message => { if (message.type() === "error") errors.push(message.text()); });
  page.on("pageerror", error => errors.push(error.message));
  return errors;
}

async function login(page: Page, s: LeadScenario, who: LeadPerson) {
  // Leave the page first: a request it still sends without the cookies would end in a 401 in the console.
  await page.goto("about:blank");
  await page.context().clearCookies();
  if (who !== "lead") return loginThroughForm(page, s.users[who], s.display_names[who]);
  await loginThroughForm(page, s.users.lead, s.display_names.lead, { lastProject: s.project });
  await expect(page).toHaveURL(new RegExp(`#/projects/${esc(s.project)}/documents`));
  await documentsReady(page);
}

/** The card of a text: from its name in the table, from "Details" in the phone's cards. */
async function openCard(page: Page, caseId: string) {
  const card = textCard(page, caseId, "de");
  if ((page.viewportSize()?.width ?? 1440) >= 700 || await card.isVisible()) return openTextCard(page, caseId, "de");
  await page.getByRole("button", { name: new RegExp(`^Details, ${esc(caseId)}\\s*de`) }).click();
  await expect(card).toBeVisible();
  return card;
}

/** "Resolve…" on the row of a queried text: the options with the reviewer's question. */
async function resolveOptions(page: Page, caseId: string) {
  await rowAction(page, "Resolve…", caseId, "de").click();
  const options = page.getByRole("group", { name: textNamePattern("Resolve queried translation, ", caseId, "de") });
  await expect(options).toContainText("Ana Weber asked a question about this translation.");
  await expect(options).toContainText(QUESTION);
  await expect(options.getByRole("button")).toHaveText(["Accept the reviewer’s text…", "Answer and accept the version as it is…", "Reopen Ana Weber's review…",
    "Assign a new review…", "Correct the translation…", "Discard the de translation…", "Cancel"]);
  return options;
}

/** The row after the decision: no "Resolve…", the annotation can be assigned. */
async function rowGoesOn(page: Page, caseId: string) {
  await documentsTab(page, "To assign").click();
  await expect(rowAction(page, "Assign annotation…", caseId, "de")).toBeVisible();
  await expect(rowAction(page, "Resolve…", caseId, "de")).toHaveCount(0);
}

/** Ana opens her submitted review from My tasks and reads the lead's decision. */
async function reviewerReads(page: Page, s: LeadScenario, caseId: string, lines: readonly (string | RegExp)[]) {
  await login(page, s, "ana");
  await page.getByRole("tab", { name: /^Submitted/ }).click();
  const task = page.getByTestId("task-row").filter({ hasText: caseId });
  await expect(task).toContainText("Answer from the lead");
  // Issue 472: the submitted review names its decision, and its summary says the version was not accepted by it.
  await expect(task).toContainText("Your decision: Query");
  await task.getByRole("link").first().click();
  await expect(page.getByRole("region", { name: "Submitted review" })).toContainText("Reviewed, not accepted");
  const note = page.getByRole("note", { name: "Answer from the lead", exact: true });
  for (const line of lines) await expect(note).toContainText(line);
  return note;
}

for (const [name, viewport] of sizes) {
  test(`${name} px: Accept the reviewer's text… makes it v2, accepted, and the reviewer reads the answer`, async ({ page }) => {
    await page.setViewportSize(viewport);
    const errors = consoleErrors(page);
    const s = await leadScenario(page, "QUERIED_TRANSLATION_FOR_LEAD");
    const caseId = s.cases!.take_text;
    await login(page, s, "lead");
    const options = await resolveOptions(page, caseId);
    await shot(page, `options-${name}`);
    await options.getByRole("button", { name: "Accept the reviewer’s text…", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: `Accept the reviewer’s text, ${caseId} de v1`, exact: true });
    // The reviewer's proposed text, not the version's, with the change marked against v1.
    const editor = dialog.getByRole("textbox", { name: "Reviewer’s text", exact: true });
    await expect(editor).toHaveValue(/generalized muscular hypotonia\./);
    await expect(dialog).toContainText("Ana Weber asked a question about v1.");
    await expect(dialog).toContainText("The text below becomes v2, a correction of v1, and is accepted. It is recorded as your decision on the query.");
    await expect(dialog).toContainText("Changes to v1 · 1 passage changed");
    await expect(dialog.getByRole("region", { name: "Text changes", exact: true }).locator("ins")).toHaveText(/muscular/);
    await dialog.getByRole("textbox", { name: "Answer to the reviewer (optional)", exact: true }).fill("Yes, as you proposed.");
    await shot(page, `take-text-dialog-${name}`);
    await dialog.getByRole("button", { name: "Accept as v2", exact: true }).click();
    await expect(dialog).toHaveCount(0);
    await expect(documentsLive(page)).toHaveText(`${caseId} de: the reviewer’s text was saved as v2 and accepted. The reviewer sees your answer at their submitted task.`);

    await rowGoesOn(page, caseId);
    await shot(page, `take-text-row-${name}`);
    // The version row and History name the decision; it is not "reviewed outside Ontotator".
    const card = await openCard(page, caseId);
    const versions = await textVersionItems(card, 2);
    const v2 = versions.filter({ hasText: "Correction of v1" });
    await expect(v2).toContainText("Accepted");
    await expect(v2).toContainText(new RegExp(`Accepted: decision on the query of Ana Weber \\(${esc(s.pseudonyms.ana)}\\), the reviewer’s text taken, Project Lead \\(${esc(s.pseudonyms.lead)}, you\\), ${TIME} · Answer: Yes, as you proposed\\.`));
    await expect(card).not.toContainText("reviewed outside Ontotator");
    await shot(page, `take-text-card-${name}`);
    await card.getByRole("button", { name: /^History \(\d+\)$/ }).click();
    await expect(activityLines(card).filter({ hasText: "query decided" })).toHaveText(
      new RegExp(`query decided by you, the reviewer’s text taken, v1 → v2, ${TIME}: Yes, as you proposed\\.$`));
    await shot(page, `take-text-history-${name}`);

    await reviewerReads(page, s, caseId, [/The lead decided your query on .+\. Your text was accepted as v2\./, "Answer from the lead: Yes, as you proposed."]);
    await shot(page, `take-text-reviewer-${name}`);
    expect(errors).toEqual([]);
  });

  test(`${name} px: Answer and accept the version as it is… needs an answer and accepts v1 unchanged`, async ({ page }) => {
    await page.setViewportSize(viewport);
    const errors = consoleErrors(page);
    const s = await leadScenario(page, "QUERIED_TRANSLATION_FOR_LEAD");
    const caseId = s.cases!.answer_only;
    await login(page, s, "lead");
    const options = await resolveOptions(page, caseId);
    await options.getByRole("button", { name: "Answer and accept the version as it is…", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: `Answer and accept the version as it is, ${caseId} de v1`, exact: true });
    await expect(dialog).toContainText("v1 is accepted without changes. It is recorded as your decision on the query.");
    await expect(dialog).toContainText("The reviewer also proposed a changed text. It is not taken.");
    // Without an answer nothing is saved.
    const accept = dialog.getByRole("button", { name: "Accept v1", exact: true });
    await expect(accept).toHaveAttribute("aria-disabled", "true");
    // Issue 547, U2-05: a click without an answer says so once, at the field.
    await accept.click({ force: true });
    await expect(dialog.getByText("Enter the answer to the reviewer.", { exact: true })).toHaveCount(1);
    await expect(dialog.locator(".field-hint-error")).toHaveText("Enter the answer to the reviewer.");
    await shot(page, `answer-empty-${name}`);
    await dialog.getByRole("textbox", { name: /^Answer to the reviewer/ }).fill("The short form is meant; the source is the same in both places.");
    await shot(page, `answer-dialog-${name}`);
    await accept.click();
    await expect(dialog).toHaveCount(0);
    await expect(documentsLive(page)).toHaveText(`${caseId} de v1 was accepted as it is. The reviewer sees your answer at their submitted task.`);

    await rowGoesOn(page, caseId);
    await shot(page, `answer-row-${name}`);
    const card = await openCard(page, caseId);
    const [v1] = await (await textVersionItems(card, 1)).all();
    await expect(v1).toContainText("Accepted");
    await expect(v1).toContainText(new RegExp(`Accepted: decision on the query of Ana Weber \\(${esc(s.pseudonyms.ana)}\\), the version kept as it is, Project Lead \\(${esc(s.pseudonyms.lead)}, you\\), ${TIME} · Answer: The short form is meant; the source is the same in both places\\.`));
    await shot(page, `answer-card-${name}`);
    await card.getByRole("button", { name: /^History \(\d+\)$/ }).click();
    await expect(activityLines(card).filter({ hasText: "query decided" })).toHaveText(
      new RegExp(`query decided by you, v1 accepted as it is, ${TIME}: The short form is meant; the source is the same in both places\\.$`));

    await reviewerReads(page, s, caseId, [/The lead decided your query on .+\. v1 was accepted as it is\./, "Answer from the lead: The short form is meant; the source is the same in both places."]);
    await shot(page, `answer-reviewer-${name}`);
    expect(errors).toEqual([]);
  });
}
