/**
 * Excluding a modifier's words from its finding's span: a modifier marked inside the finding's span is offered to be
 * cut out of it (Exclude from span / Keep span), with Undo.
 *
 * Every test builds a fresh project through ``POST /__test_modifiers__?with_finding=1&wide=1``
 * (tests/browser_modifier_scenarios.py): Seizure on "wiederholt schwere Krampfanfälle"; ``inside=1`` also gives it
 * Severe on "schwere" (an existing finding), ``proposal=1&proposal_modifiers=1`` makes it a tool proposal instead.
 * The offer opens after a modifier's span is saved, from the row's "…" menu and from the row's "In span · Exclude".
 */
import { expect, test, type Page } from "@playwright/test";
import { loginScenarioUser, type ReviewFlowScenario } from "./reviewFlowHelpers";
import { selectText } from "./helpers";

test.setTimeout(120_000);
test.use({ actionTimeout: 15_000 });

const CASE = "modifiers";
const offer = (page: Page) => page.locator("[data-span-exclusion]");
const commandResponse = (page: Page, command: string) => page.waitForResponse(response =>
  response.url().endsWith("/commands") && response.request().method() === "POST"
  && (response.request().postDataJSON() as { payload?: { command?: string } } | null)?.payload?.command === command);

const severeRow = (page: Page) => page.locator('[data-modifier-chip="HP:0012828"]');
const hint = (page: Page) => severeRow(page).locator("[data-in-span]");

async function open(page: Page, wide = true, extra: Record<string, string> = {}): Promise<ReviewFlowScenario> {
  await page.setViewportSize({ width: 1440, height: 900 });
  const params = { with_finding: "1", wide: wide ? "1" : "0", ...extra };
  const response = await page.request.post("/__test_modifiers__", { params, timeout: 120_000 });
  expect(response.ok(), await response.text()).toBeTruthy();
  const s = (await response.json()) as ReviewFlowScenario;
  await loginScenarioUser(page, s, "annotator");
  await page.goto(`/#/tasks/${s.assignments[CASE]}`);
  await expect(page.locator(".text-container")).toHaveText(s.texts[CASE]);
  await page.evaluate(() => document.fonts.ready);
  await page.waitForLoadState("networkidle");
  return s;
}

/** Marks `word` with a real mouse drag (mousedown, move, mouseup), not a scripted selection. */
async function drag(page: Page, word: string) {
  const box = await page.locator(".text-container").evaluate((container, w) => {
    const at = container.textContent!.indexOf(w);
    const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
    const range = document.createRange();
    let position = 0, started = false;
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const length = node.textContent!.length;
      if (!started && at < position + length) { range.setStart(node, at - position); started = true; }
      if (started && at + w.length <= position + length) { range.setEnd(node, at + w.length - position); break; }
      position += length;
    }
    const rect = range.getBoundingClientRect();
    return { x: rect.left, y: rect.top + rect.height / 2, width: rect.width };
  }, word);
  await page.mouse.move(box.x + 1, box.y);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2, box.y, { steps: 4 });
  await page.mouse.move(box.x + box.width - 1, box.y, { steps: 4 });
  await page.mouse.up();
}

/** The finding (non-modifier) mention ids on the run holding `word`. */
const findingIdsAt = (page: Page, word: string) => page.locator(".text-container .run").evaluateAll((runs, w) =>
  runs.filter(run => run.textContent?.includes(w)).flatMap(run => (run as HTMLElement).dataset.mentions?.split(",") ?? [])
    .filter(id => id && !id.startsWith("mod:")), word);

/** Drags "schwere" inside Seizure's span, chooses Severe and attaches it with Enter. */
async function attachSevere(page: Page) {
  await drag(page, "schwere");
  // The selection inside the finding's span stays a new mark: the finding is not opened.
  await expect(page.getByText("New finding")).toBeVisible();
  await expect(page.locator("#search-input")).toBeFocused();
  await expect(page.locator("#search-input")).toHaveValue("schwere");
  // The similar hits are shuffled per annotator and mark (unbiased display, as in modifiers.spec.ts): "schwere" is
  // no exact name, so Severe ("Schwer") need not come first. Move the active hit to it with the keys.
  const hit = page.getByRole("listbox", { name: "Terms", exact: true }).locator('[role="option"][aria-selected="true"]');
  await expect(hit).toBeVisible();
  for (let step = 0; step < 10 && !(await hit.textContent())?.includes("Severe"); step += 1) await page.keyboard.press("ArrowDown");
  await expect(hit).toContainText("Severe");
  await expect(hit).toContainText("Modifier");
  await page.keyboard.press("Enter");
  await expect(page.getByRole("button", { name: "Attach Severe to Seizure" })).toBeFocused();
  const added = commandResponse(page, "add_modifier");
  await page.keyboard.press("Enter");
  expect((await added).ok()).toBeTruthy();
  await expect(page.locator('[data-modifier-chip="HP:0012828"]')).toContainText("Severe · HP:0012828 “schwere”");
}

test("a modifier marked inside the span: Exclude from span splits the finding; Undo puts the span back", async ({ page }) => {
  await open(page);
  await attachSevere(page);
  await expect(offer(page)).toContainText("Exclude “schwere” from the text span of Seizure?");
  await expect(offer(page).locator("[data-exclusion-before] del")).toHaveText("schwere");
  await expect(offer(page).locator("[data-exclusion-after]")).toHaveText("wiederholt … Krampfanfälle");
  expect(await findingIdsAt(page, "schwere")).toHaveLength(1);

  const edited = commandResponse(page, "edit_mention");
  await offer(page).getByRole("button", { name: "Exclude from span" }).click();
  const response = await edited;
  expect(response.ok()).toBeTruthy();
  expect((response.request().postDataJSON() as { payload: { segments: unknown } }).payload.segments).toEqual([
    { start: 14, end: 24 }, { start: 33, end: 46 }]);
  await expect(offer(page)).toHaveCount(0);
  await expect.poll(() => findingIdsAt(page, "schwere")).toEqual([]);
  expect(await findingIdsAt(page, "wiederholt")).toHaveLength(1);
  expect(await findingIdsAt(page, "Krampfanfälle")).toHaveLength(1);
  // The modifier keeps its own span and its chip has the focus.
  await expect(page.locator('[data-modifier-chip="HP:0012828"]')).toContainText("Severe · HP:0012828 “schwere”");
  await expect(page.locator('[data-modifier-chip="HP:0012828"]').getByRole("button", { name: "Actions, Severe" })).toBeFocused();

  const toast = page.locator(".ui-toast");
  await expect(toast).toContainText("Excluded “schwere” from the text span of Seizure.");
  await toast.getByRole("button", { name: "Undo" }).click();
  await expect.poll(() => findingIdsAt(page, "schwere")).toHaveLength(1);
  await expect(offer(page)).toHaveCount(0);
});

test("Keep span changes nothing", async ({ page }) => {
  await open(page);
  await attachSevere(page);
  let edits = 0;
  page.on("request", request => {
    if (request.url().endsWith("/commands") && (request.postDataJSON() as { payload?: { command?: string } } | null)?.payload?.command === "edit_mention") edits += 1;
  });
  await offer(page).getByRole("button", { name: "Keep span" }).click();
  await expect(offer(page)).toHaveCount(0);
  await expect(page.locator('[data-modifier-chip="HP:0012828"]').getByRole("button", { name: "Actions, Severe" })).toBeFocused();
  expect(await findingIdsAt(page, "schwere")).toHaveLength(1);
  expect(edits).toBe(0);
  // The row keeps its quiet hint, so the offer can be taken up later.
  await expect(hint(page)).toHaveText("In span · Exclude");
});

/** Opens Seizure, the finding the scenario made, from the findings list. */
async function selectSeizure(page: Page) {
  await page.locator('.sidebar [data-list-key="annotation:seizure"]').click();
  await expect(page.getByRole("list", { name: "Modifiers of Seizure" })).toBeVisible();
}

test("an existing finding: the row hint In span · Exclude opens the box; Exclude from span removes the hint", async ({ page }) => {
  await open(page, true, { inside: "1" });
  await selectSeizure(page);
  // No box by itself when the finding opens: only the quiet hint in the row.
  await expect(hint(page)).toHaveText("In span · Exclude");
  await expect(offer(page)).toHaveCount(0);
  await hint(page).getByRole("button", { name: "Exclude Severe from the span of Seizure" }).click();
  await expect(offer(page)).toContainText("Exclude “schwere” from the text span of Seizure?");
  await expect(offer(page).locator("[data-exclusion-after]")).toHaveText("wiederholt … Krampfanfälle");
  await expect(offer(page).getByRole("button", { name: "Exclude from span" })).toBeFocused();
  // While the box is open, it stands for the hint.
  await expect(hint(page)).toHaveCount(0);

  const edited = commandResponse(page, "edit_mention");
  await page.keyboard.press("Enter");
  expect((await edited).ok()).toBeTruthy();
  await expect(offer(page)).toHaveCount(0);
  await expect.poll(() => findingIdsAt(page, "schwere")).toEqual([]);
  await expect(hint(page)).toHaveCount(0);
  await expect(severeRow(page)).toContainText("Severe · HP:0012828 “schwere”");
});

test("an existing finding: the row menu has Exclude from finding's span, which opens the same box", async ({ page }) => {
  await open(page, true, { inside: "1" });
  await selectSeizure(page);
  await severeRow(page).getByRole("button", { name: "Actions, Severe" }).click();
  await expect(page.getByRole("menuitem")).toHaveText(["Change text span…", "Remove text span", "Exclude from finding's span", "Remove modifier"]);
  await page.getByRole("menuitem", { name: "Exclude from finding's span" }).click();
  await expect(offer(page)).toContainText("Exclude “schwere” from the text span of Seizure?");
  await expect(offer(page).getByRole("button", { name: "Exclude from span" })).toBeFocused();
  await offer(page).getByRole("button", { name: "Keep span" }).click();
  await expect(offer(page)).toHaveCount(0);
  await expect(hint(page)).toHaveText("In span · Exclude");
});

test("a modifier outside the span of an existing finding: no hint and no menu item", async ({ page }) => {
  await open(page, false, { inside: "1" });
  await selectSeizure(page);
  await expect(severeRow(page)).toContainText("Severe · HP:0012828 “schwere”");
  await expect(hint(page)).toHaveCount(0);
  await severeRow(page).getByRole("button", { name: "Actions, Severe" }).click();
  await expect(page.getByRole("menuitem")).toHaveText(["Change text span…", "Remove text span", "Remove modifier"]);
});

test("a tool proposal: no offer on the proposal; a span linked on it makes the copy, and the offer applies to the copy", async ({ page }) => {
  // Proposal Seizure on "wiederholt schwere Krampfanfälle" with Severe on "schwere" and a spanless Recurrent.
  const s = await open(page, true, { with_finding: "0", proposal: "1", proposal_modifiers: "1" });
  await page.locator('.sidebar [data-list-key^="target:"]').click();
  const proposal = page.locator(".review-actions__proposal");
  await expect(proposal.getByRole("list", { name: "Modifiers of Seizure" })).toBeVisible();
  // The proposal itself is never edited: no hint and no menu item, though Severe lies inside its span.
  await expect(proposal.locator("[data-in-span]")).toHaveCount(0);
  await proposal.getByRole("button", { name: "Actions, Severe" }).click();
  await expect(page.getByRole("menuitem")).toHaveText(["Change text span…", "Remove text span", "Remove modifier"]);
  await page.keyboard.press("Escape");

  await proposal.getByRole("button", { name: "Link a text span", exact: true }).click();
  const linked = commandResponse(page, "set_modifier_segments");
  const start = s.texts[CASE].indexOf("wiederholt");
  await selectText(page, start, start + "wiederholt".length);
  expect((await linked).ok()).toBeTruthy();
  // The copy is selected; the offer is for the copy's span.
  await expect(page.locator("[data-advance-status]")).toContainText("Your change made a copy; the proposal is decided as Replaced.");
  await expect(offer(page)).toContainText("Exclude “wiederholt” from the text span of Seizure?");
  await expect(offer(page).locator("[data-exclusion-after]")).toHaveText("schwere Krampfanfälle");
  const edited = commandResponse(page, "edit_mention");
  await offer(page).getByRole("button", { name: "Exclude from span" }).click();
  const response = await edited;
  expect(response.ok()).toBeTruthy();
  const copyId = (response.request().postDataJSON() as { payload: { annotation_id: string } }).payload.annotation_id;
  expect(copyId).not.toBe("p-seizure");
  // Severe still lies inside the copy's span: its row has the hint.
  await expect(severeRow(page).locator("[data-in-span]")).toHaveText("In span · Exclude");
});

test("a modifier outside the finding's span gets no offer", async ({ page }) => {
  // Seizure on "Krampfanfälle" only: Severe on "schwere" lies outside it.
  await open(page, false);
  await attachSevere(page);
  await expect(offer(page)).toHaveCount(0);
});
