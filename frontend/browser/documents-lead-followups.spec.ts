/**
 * Review follow-ups for the lead on Documents (issue 469):
 *
 * 1. A refused Undo of a bulk Reopen… names the text that changed and what changed on it, as Change final… does.
 * 2. The assign dialog of a text over its limit says both numbers ("Limit reached: 2 assigned, limit 1.").
 * 3. "Annotators per text" from the assign dialog: a labelled "Change…", a typed number stays when the scope changes,
 *    the popover says why its button cannot act, and grey rows read "no free place (1 per text)".
 * 4. A text with a final result and a newer submission reads "Check changes, newer result" in the desktop row, as on
 *    the phone card, and the card offers "Keep the current final result" for a text with one version.
 *
 * Builds fresh projects through ``POST /__test_documents__`` (scenarios S336 and S336F).
 */
import { expect, test, type Page } from "@playwright/test";
import { decisionBlock, documentsReady, documentsScenario, openTextCard, rowCell, showSegment, textNamePattern, textRow } from "./documentsHelpers";
import { loginExisting } from "./helpers";

test.setTimeout(240_000);
test.use({ actionTimeout: 15_000 });

const noHorizontalScroll = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);

interface Work { assignment_id: number; task: string; status: string }

/** The lead withdraws the annotation of ``caseId`` en that is in ``status``, in the page's session. */
async function withdrawTask(page: Page, project: string, caseId: string, status: string): Promise<void> {
  const found = (await (await page.request.get(`/api/v1/projects/${encodeURIComponent(project)}/document-rows`, { params: { q: caseId } })).json()) as {
    groups: { rows: { case_id: string; language: string; work: Work[] }[] }[];
  };
  const work = found.groups.flatMap(group => group.rows).find(row => row.case_id === caseId && row.language === "en")?.work ?? [];
  const task = work.find(item => item.task === "annotate" && item.status === status);
  expect(task, `${caseId} en has an annotation that is ${status}`).toBeTruthy();
  const { csrf_token } = (await (await page.request.get("/api/v1/auth/me")).json()) as { csrf_token: string };
  const revoked = await page.request.post(`/api/v1/assignments/${task!.assignment_id}/revoke`, {
    data: { reason: "Assigned by mistake" },
    headers: { Origin: new URL(page.url()).origin, "X-CSRF-Token": csrf_token },
  });
  expect(revoked.ok(), await revoked.text()).toBeTruthy();
}

async function openAssignDialog(page: Page, caseId: string) {
  const card = await openTextCard(page, caseId, "en");
  await showSegment(card, "Annotation");
  await card.getByRole("button", { name: "Assign annotators…", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: /^Assign / });
  await expect(dialog.getByRole("table", { name: "Members" })).toBeVisible();
  return { card, dialog };
}

test("assign dialog: both numbers on an over-limit text, a labelled Change… that keeps the typed number; a refused Undo names the text (1440 px)", async ({ page }) => {
  const errors: string[] = [];
  page.on("console", message => { if (message.type() === "error") errors.push(message.text()); });
  page.on("pageerror", error => errors.push(String(error)));
  await page.setViewportSize({ width: 1440, height: 900 });
  const s = await documentsScenario(page, "S336");
  await loginExisting(page, s.users.lead);
  await page.goto(`/#/projects/${encodeURIComponent(s.project)}/documents`);
  await documentsReady(page);

  // Point 2: EN100024 has two annotators (one submitted, one open) and the limit was lowered to 1.
  let { card, dialog } = await openAssignDialog(page, "EN100024");
  await expect(dialog.locator(".assign-limit-hint")).toContainText("Limit reached: 2 assigned, limit 1.");
  await expect(dialog.getByText(/annotators? already assigned/)).toHaveCount(0);
  await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(dialog).toBeHidden();
  await card.getByRole("button", { name: "Close", exact: true }).first().click();

  // Point 3: EN100029 has a free place again once its open task is withdrawn.
  await withdrawTask(page, s.project, "EN100029", "open");
  await page.reload();
  await documentsReady(page);
  ({ card, dialog } = await openAssignDialog(page, "EN100029"));
  await expect(dialog.locator(".assign-limit-hint")).toContainText("0 assigned · 1 more possible (limit 1)");
  const change = dialog.getByRole("button", { name: "Change… (limit: 1 annotator per text)", exact: true });
  await expect(change).toHaveText("Change…");
  await dialog.getByRole("checkbox", { name: /^Tom Reis/ }).check();
  // The other person is grey with the text's limit as the reason, not "limit reached".
  const other = dialog.getByRole("checkbox", { name: /^R\. Roe.*, no free place \(1 per text\)$/ });
  await expect(other).toHaveAttribute("aria-disabled", "true");
  await expect(dialog.getByRole("table", { name: "Members" })).not.toContainText("limit reached");

  await change.click();
  const popover = page.getByRole("dialog", { name: "Annotators per text" });
  const field = popover.getByRole("spinbutton", { name: "Annotators per text" });
  await expect(popover.getByRole("radio", { name: "Only for the selected text (EN100029 en)" })).toBeChecked();
  await field.fill("2");
  await popover.getByRole("radio", { name: "For all texts" }).check();
  // The typed 2 stays and the button can act.
  await expect(field).toHaveValue("2");
  const all = popover.getByRole("button", { name: "Change for all texts", exact: true });
  await expect(all).not.toHaveAttribute("aria-disabled", "true");
  // A number that changes nothing in this scope: the popover says why.
  await field.fill("1");
  await expect(all).toHaveAttribute("aria-disabled", "true");
  await expect(popover.getByText('The project setting is already 1. Enter another number, or choose "Only for the selected text".')).toBeVisible();
  await field.fill("0");
  await expect(popover.getByText("Enter a whole number of 1 or more.")).toBeVisible();
  await field.fill("2");
  await expect(popover.getByText(/already|Enter a whole number/)).toHaveCount(0);
  await all.click();
  await expect(popover).toBeHidden();
  await expect(dialog.getByText("Annotators per text: 2, for all texts.")).toBeVisible();
  await expect(dialog.locator(".assign-limit-hint")).toContainText("0 assigned · 1 selected · 1 more possible (limit 2)");
  await expect(dialog.getByRole("checkbox", { name: /^Tom Reis/ })).toBeChecked();
  await expect(dialog.getByRole("checkbox", { name: /^R\. Roe/ })).not.toHaveAttribute("aria-disabled", "true");
  expect(await noHorizontalScroll(page)).toBe(true);
  await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(dialog).toBeHidden();
  await card.getByRole("button", { name: "Close", exact: true }).first().click();

  // Point 1: bulk Reopen…, then one reopened task is withdrawn: the Undo is refused and names that text.
  await page.getByRole("checkbox", { name: "Select all 8 filtered texts" }).click();
  const bar = page.getByRole("region", { name: "Selection" });
  await bar.getByRole("button", { name: "More actions" }).click();
  await page.getByRole("menu", { name: "More actions" }).getByRole("menuitem", { name: "Reopen…" }).click();
  const reopen = page.getByRole("dialog", { name: "Reopen: 8 texts" });
  await expect(reopen.locator(".work-plan-summary")).toHaveText("Will change: 8 tasks in 6 texts");
  await reopen.getByLabel(/^Reason/).fill("Guideline 2.3 changed for vital signs");
  const apply = reopen.getByRole("button", { name: "Reopen 8 tasks" });
  await apply.click();
  await reopen.getByLabel("I understand").check();
  await apply.click();
  await expect(reopen).toBeHidden();
  const toast = page.locator(".ui-toast");
  await expect(toast).toContainText("Reopened 8 tasks in 6 texts.");
  await withdrawTask(page, s.project, "EN100022", "reopened");
  await toast.getByRole("button", { name: "Undo" }).click();
  await expect(toast).toContainText(
    "Undo is not possible: 1 of 6 texts changed since (EN100022 en: a task was assigned, reopened, withdrawn or paused, or got a new round). Nothing was undone.");
  await expect(toast).not.toContainText("Undo is no longer possible");
  await expect(toast.getByRole("button", { name: "Undo" })).toHaveCount(0);
  expect(await noHorizontalScroll(page)).toBe(true);
  // The refused Undo answers 409: the browser logs that one failed request.
  expect(errors.filter(text => !text.includes("409"))).toEqual([]);
});

for (const [width, height] of [[1440, 900], [390, 844]] as const) {
  test(`a final result with a newer submission: "Check changes, newer result" and "Keep the current final result" (${width} px)`, async ({ page }) => {
    const errors: string[] = [];
    page.on("console", message => { if (message.type() === "error") errors.push(message.text()); });
    page.on("pageerror", error => errors.push(String(error)));
    await page.setViewportSize({ width, height });
    const s = await documentsScenario(page, "S336F");
    await loginExisting(page, s.users.lead);
    await page.goto(`/#/projects/${encodeURIComponent(s.project)}/documents`);
    await documentsReady(page);

    // EN100022: Tom Reis's submission is final; R. Roe submitted afterwards. EN100027: two agreeing submissions, no final.
    if (width >= 700) {
      const cell = rowCell(textRow(page, "EN100022", "en"), "finalization");
      await expect(cell).toContainText("Check changes");
      await expect(cell.locator("[title]").first()).toHaveAttribute("title", /Check changes, newer result/);
      await expect(cell).not.toContainText("ready to accept");
      // A text without a final result keeps "ready to accept".
      await expect(rowCell(textRow(page, "EN100027", "en"), "finalization")).toContainText("ready to accept");
    } else {
      // The phone card's wording is the model and stays as it is.
      const phone = page.getByRole("article", { name: "EN100022 en", exact: true });
      await expect(phone).toContainText("Check changes");
      await expect(phone).toContainText("newer result");
      await expect(phone).not.toContainText("ready to accept");
    }

    // Below 700 px the list is cards: "Details" opens the text card.
    if (width < 700) await page.getByRole("button", { name: textNamePattern("Details, ", "EN100022", "en") }).click();
    const card = await openTextCard(page, "EN100022", "en");
    await showSegment(card, "Finalization");
    await expect(card.getByRole("button", { name: /^Finalization / })).toContainText("Check changes, newer result");
    const block = decisionBlock(card);
    await expect(block.getByRole("button", { name: "Keep the current final result", exact: true })).toBeVisible();
    await expect(block.getByRole("button", { name: "Use the newer result", exact: true })).toBeVisible();
    await expect(block.getByRole("button", { name: /^Keep final on/ })).toHaveCount(0);
    expect(await noHorizontalScroll(page)).toBe(true);
    await block.getByRole("button", { name: "Keep the current final result", exact: true }).click();
    await expect(page.getByText("Final result saved for EN100022 en.", { exact: true })).toBeVisible();
    expect(errors).toEqual([]);
  });
}

test("Assign… in the selection bar on a fully staffed text says the limit is reached and offers Change…, never Loading… (issue 549, U3-03; 1440 px)", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const s = await documentsScenario(page, "S336");
  await loginExisting(page, s.users.lead);
  await page.goto(`/#/projects/${encodeURIComponent(s.project)}/documents`);
  await documentsReady(page);
  // EN100024 en holds two annotators with the limit lowered to 1: nothing in the selection needs a task.
  await rowCell(textRow(page, "EN100024", "en"), "select").getByRole("checkbox").check();
  const bar = page.getByRole("region", { name: "Selection" });
  await bar.getByRole("button", { name: /^Assign/ }).click();
  const dialog = page.getByRole("dialog", { name: "Assign tasks", exact: true });
  await expect(dialog.locator(".assign-limit-hint")).toContainText("Limit reached: 2 assigned, limit 1.");
  await expect(dialog.getByRole("button", { name: "Change… (limit: 1 annotator per text)", exact: true })).toBeVisible();
  await expect(dialog.getByRole("table", { name: "Members" })).toBeVisible();
  // Nothing loads any more: no "Loading…" beside the Assign button, which points to the reason instead.
  await page.waitForTimeout(1500);
  await expect(dialog.getByText("Loading…", { exact: true })).toHaveCount(0);
  const assign = dialog.getByRole("button", { name: "Assign", exact: true });
  await expect(assign).toHaveAttribute("aria-disabled", "true");
  await expect(assign).toHaveAccessibleDescription("Limit reached: 2 assigned, limit 1.");
  expect(await noHorizontalScroll(page)).toBe(true);
});
