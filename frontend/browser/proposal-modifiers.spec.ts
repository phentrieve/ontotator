/**
 * Issue 525: an open tool proposal's modifiers change in place, and every modifier row names its term ID.
 *
 * ``POST /__test_modifiers__?proposal=1&proposal_modifiers=1`` (tests/browser_modifier_scenarios.py): German text,
 * a tool proposal Seizure on "Krampfanfälle" with Severe on "schwere" and a spanless Recurrent; the round is a
 * proposal check. The first change runs Edit & Replace and goes to the copy: the proposal reads Replaced, and the
 * line's Undo takes the whole step back, so the proposal is open again.
 */
import { expect, test, type Page } from "@playwright/test";
import { loginScenarioUser, type ReviewFlowScenario } from "./reviewFlowHelpers";
import { selectText } from "./helpers";

test.setTimeout(120_000);
test.use({ actionTimeout: 15_000 });

const CASE = "modifiers";
const textPane = (page: Page) => page.locator(".text-container");
const proposalRow = (page: Page) => page.locator('.sidebar [data-list-key^="target:"]');
const ownRows = (page: Page) => page.locator('.sidebar [data-list-key^="annotation:"]');
const panel = (page: Page) => page.locator(".review-actions__proposal");
const status = (page: Page) => page.locator("[data-advance-status]");
const LINE = "Your change made a copy; the proposal is decided as Replaced.";
const commandResponse = (page: Page, command: string) => page.waitForResponse(response =>
  response.url().endsWith("/commands") && response.request().method() === "POST"
  && (response.request().postDataJSON() as { payload?: { command?: string } } | null)?.payload?.command === command);
const decisionResponse = (page: Page) => page.waitForResponse(response =>
  /\/decisions$/.test(new URL(response.url()).pathname) && response.request().method() === "POST");

const SIZES = [{ width: 1440, height: 900 }, { width: 390, height: 844 }];

async function open(page: Page, size: { width: number; height: number }): Promise<ReviewFlowScenario> {
  await page.setViewportSize(size);
  const response = await page.request.post("/__test_modifiers__", { params: { proposal: "1", proposal_modifiers: "1" }, timeout: 120_000 });
  expect(response.ok(), await response.text()).toBeTruthy();
  const s = (await response.json()) as ReviewFlowScenario;
  await loginScenarioUser(page, s, "annotator");
  await page.goto(`/#/tasks/${s.assignments[CASE]}`);
  await expect(textPane(page)).toHaveText(s.texts[CASE]);
  await page.evaluate(() => document.fonts.ready);
  await page.waitForLoadState("networkidle");
  return s;
}

/** Selects the proposal: its details (with the Modifiers) are shown. */
async function selectProposal(page: Page) {
  await expect(proposalRow(page)).toContainText("Modifiers: Recurrent · HP:0031796, Severe · HP:0012828");
  // At 390 px the list is its own pane.
  const findings = page.getByRole("button", { name: "Findings", exact: true });
  if (await findings.isVisible()) await findings.click();
  await proposalRow(page).click();
  await expect(panel(page).getByRole("list", { name: "Modifiers of Seizure" })).toBeVisible();
}

/** The proposal reads Replaced and its copy is open with the line; Undo restores the open proposal. */
async function expectReplacedThenUndo(page: Page) {
  await expect(status(page)).toContainText(LINE);
  await expect(proposalRow(page)).toContainText("Replaced");
  await expect(ownRows(page)).toHaveCount(1);
  const undo = status(page).getByRole("button", { name: "Undo", exact: true });
  await expect(undo).toBeInViewport();
  const undone = page.waitForResponse(response => response.url().endsWith("/history") && response.request().method() === "POST");
  await undo.click();
  expect((await undone).ok()).toBeTruthy();
  await expect(status(page)).toHaveText("Change undone. The proposal is open again.");
  await expect(proposalRow(page)).toContainText("Pending");
  await expect(ownRows(page)).toHaveCount(0);
  await expect(panel(page).getByRole("button", { name: "+ Add modifier…" })).toBeVisible();
  await expect(panel(page).getByRole("list", { name: "Modifiers of Seizure" })).toHaveText(
    "Recurrent · HP:0031796no text span · Link a text spanSevere · HP:0012828 “schwere”");
}

for (const size of SIZES) {
  test.describe(`${size.width} px`, () => {
    test("rows name their codes; + Add modifier… on an open proposal replaces it with the copy; Undo restores it", async ({ page }) => {
      await open(page, size);
      await selectProposal(page);
      await expect(panel(page).getByText("A change makes your copy of the proposal (Edit & Replace).", { exact: true })).toBeVisible();
      await panel(page).getByRole("button", { name: "+ Add modifier…" }).click();
      const search = page.getByRole("combobox", { name: "Search modifier" });
      await search.fill("Mild");
      const hit = page.getByRole("option").filter({ hasText: "Mild" }).first();
      await expect(hit).toBeVisible();
      const created = commandResponse(page, "create_annotation");
      const added = commandResponse(page, "add_modifier");
      const decided = decisionResponse(page);
      await hit.click();
      expect((await created).ok()).toBeTruthy();
      expect((await added).ok()).toBeTruthy();
      const decision = await decided;
      expect(decision.ok()).toBeTruthy();
      // The decision Edit & Replace records today: changed, replaced by the copy.
      const body = decision.request().postDataJSON() as { payload: { outcome: string; target: { annotation_id: string }; replacement: { annotation_id: string } } };
      expect(body.payload.outcome).toBe("changed");
      expect(body.payload.replacement.annotation_id).toMatch(/^ann-/);
      // The copy's Modifiers name every code, Mild among them.
      await expect(page.getByRole("list", { name: "Modifiers of Seizure" })).toContainText("Mild · HP:0012825");
      await expect(ownRows(page).locator(".mod-lines")).toHaveText("Modifiers: Mild · HP:0012825, Recurrent · HP:0031796, Severe · HP:0012828");
      await expectReplacedThenUndo(page);
    });

    test("Remove modifier on an open proposal replaces it with the copy; Undo restores it", async ({ page }) => {
      await open(page, size);
      await selectProposal(page);
      await panel(page).getByRole("button", { name: "Actions, Severe" }).click();
      const removed = commandResponse(page, "remove_modifier");
      const decided = decisionResponse(page);
      await page.getByRole("menuitem", { name: "Remove modifier" }).click();
      expect((await removed).ok()).toBeTruthy();
      expect((await decided).ok()).toBeTruthy();
      await expect(ownRows(page).locator(".mod-lines")).toHaveText("Modifiers: Recurrent · HP:0031796");
      await expectReplacedThenUndo(page);
    });

    test("Link a text span on an open proposal links the marked text on the copy; Undo restores it", async ({ page }) => {
      const s = await open(page, size);
      await selectProposal(page);
      await panel(page).getByRole("button", { name: "Link a text span", exact: true }).click();
      await expect(page.locator(".attach-mention-banner")).toContainText("Select the text for Recurrent. Esc cancels.");
      await expect(textPane(page)).toBeInViewport();
      const linked = commandResponse(page, "set_modifier_segments");
      const decided = decisionResponse(page);
      const start = s.texts[CASE].indexOf("wiederholt");
      await selectText(page, start, start + "wiederholt".length);
      expect((await linked).ok()).toBeTruthy();
      expect((await decided).ok()).toBeTruthy();
      await expect(page.getByRole("list", { name: "Modifiers of Seizure" })).toContainText("Recurrent · HP:0031796 “wiederholt”");
      await expectReplacedThenUndo(page);
    });
  });
}

test("a decided proposal keeps read-only rows with codes", async ({ page }) => {
  await open(page, SIZES[0]);
  await selectProposal(page);
  await page.keyboard.press("1");
  await expect(proposalRow(page)).toContainText("Confirmed");
  await proposalRow(page).click();
  const rows = panel(page).getByRole("list", { name: "Modifiers of Seizure" });
  await expect(rows).toHaveText("Recurrent · HP:0031796Severe · HP:0012828 “schwere”");
  await expect(panel(page).getByRole("button", { name: "+ Add modifier…" })).toHaveCount(0);
  await expect(panel(page).getByRole("button", { name: /^Actions,/ })).toHaveCount(0);
});
