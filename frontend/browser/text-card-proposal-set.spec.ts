/**
 * The text card names the proposal set (issue 337) and a text's own annotator limit (issue 422).
 * Scenario NEWER_SET (tests/browser_proposal_check_scenarios.py): Tom and Mia submitted their checks of EN100024 on the
 * first tool set, a newer set was imported, the text has its own limit of 3 and Ali is assigned, not started.
 */
import { expect, test, type Page } from "@playwright/test";
import { documentsReady, openTextCard, personRow, showSegment } from "./documentsHelpers";
import { loginScenarioUser, proposalCheckScenario, type ProposalCheckScenario } from "./proposalCheckHelpers";

test.setTimeout(180_000);
test.use({ viewport: { width: 1280, height: 900 }, actionTimeout: 15_000 });

const CASE = "EN100024";
const SCRATCH = "EN100031";

async function openDocuments(page: Page, s: ProposalCheckScenario): Promise<void> {
  // Right after the login the app may still settle on My tasks: go again until Documents shows.
  await expect(async () => {
    await page.goto(`/#/projects/${encodeURIComponent(s.project)}/documents`);
    await documentsReady(page, 5_000);
  }).toPass({ timeout: 60_000 });
}

test("the Annotation part names the set, a newer one with its help, and the text's own limit", async ({ page }) => {
  const s = await proposalCheckScenario(page, "NEWER_SET");
  await loginScenarioUser(page, s, "lead");
  await openDocuments(page, s);
  const card = await openTextCard(page, CASE, "en");
  await showSegment(card, "Annotation");
  const line = card.locator(".text-card-proposal-set");
  // Both sets of this fixture are imported on the same day, within seconds: each shows its time (issue 472).
  await expect(line).toContainText(/^Proposals set \d{4}-\d{2}-\d{2} \d\d:\d\d(:\d\d)? \(test-tool 1\), 3 proposals/);
  const newer = line.getByText(/^Newer set available: \d{4}-\d{2}-\d{2} \d\d:\d\d(:\d\d)?$/);
  await expect(newer).toBeVisible();
  const shown = ((await line.textContent()) ?? "").match(/^Proposals set (\S+ \S+) /)?.[1];
  expect(await newer.textContent()).not.toBe(`Newer set available: ${shown}`);
  const help = line.getByRole("link", { name: "How to use it", exact: true });
  await expect(help).toHaveAttribute("href", /work-from-new-tool-proposals/);
  await expect(help).toHaveAttribute("target", "_blank");
  await expect(card.getByText("Annotators: 3 for this text (project: 2)", { exact: true })).toBeVisible();
  // Only the person on another set names it.
  await expect(personRow(card, "Annotators", s.display_names.ali)).toContainText("newest set");
  await expect(personRow(card, "Annotators", s.display_names.tom)).not.toContainText("set");
});

test("the limit popover gives one text its own limit; the project keeps its value", async ({ page }) => {
  const s = await proposalCheckScenario(page, "FRESH");
  await loginScenarioUser(page, s, "lead");
  await openDocuments(page, s);
  const card = await openTextCard(page, SCRATCH, "en");
  await showSegment(card, "Annotation");
  await card.getByRole("button", { name: "Assign annotators…", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: /^Assign / });
  await dialog.getByRole("button", { name: "Change… (limit: 2 annotators per text)" }).click();
  const popover = page.getByRole("dialog", { name: "Annotators per text" });
  await expect(popover.getByRole("radio", { name: `Only for the selected text (${SCRATCH} en)` })).toBeChecked();
  await expect(popover.getByRole("radio", { name: "For all texts" })).not.toBeChecked();
  await popover.getByRole("spinbutton", { name: "Annotators per text" }).fill("4");
  const saved = page.waitForResponse(r => r.request().method() === "PUT" && r.url().endsWith("/annotations-per-text"));
  await popover.getByRole("button", { name: "Change for 1 text", exact: true }).click();
  expect((await saved).ok()).toBeTruthy();
  await expect(dialog.getByText(`Annotators per text: 4, for ${SCRATCH} en.`, { exact: true })).toBeVisible();
  await expect(dialog.getByText("0 assigned · 4 more possible (limit 4)", { exact: true })).toBeVisible();
  await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(card.getByText("Annotators: 4 for this text (project: 2)", { exact: true })).toBeVisible();
  // Another text still has the project's 2.
  const settings = await page.request.get(`/api/v1/projects/${encodeURIComponent(s.project)}/settings`);
  expect((await settings.json()).annotations_per_text).toBe(2);
});
