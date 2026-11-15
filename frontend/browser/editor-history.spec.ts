/**
 * Undo, redo and reset in the editor (issue 320) in a real browser against the real server: the steps come
 * from the saved edits, so they survive a reload, and every step is saved as a new edit.
 *
 * Uses a fresh ``ANNOTATION_LOOP`` project (``POST /__test_review_flow__``): creation defaults Present /
 * Patient / Current, so adding a finding and confirming its defaults are two steps.
 */
import { expect, test, type Page } from "@playwright/test";
import { loginScenarioUser, reviewFlowScenario, type ReviewFlowScenario } from "./reviewFlowHelpers";
import { selectText } from "./helpers";

test.setTimeout(120_000);
test.use({ actionTimeout: 15_000 });

const textPane = (page: Page) => page.locator(".text-container");
const findingRows = (page: Page) => page.locator('[data-list-key^="annotation:"]');
// The header buttons; the Undo of a message is a different button ("Undo").
const undoButton = (page: Page) => page.getByRole("button", { name: "Undo last change", exact: true });
const redoButton = (page: Page) => page.getByRole("button", { name: "Redo last change", exact: true });
const historyResponse = (page: Page, command: string) => page.waitForResponse(response =>
  response.url().endsWith("/history") && response.request().method() === "POST"
  && (response.request().postDataJSON() as { payload?: { command?: string } } | null)?.payload?.command === command);

/**
 * Holds the answers to the workspace requests ending in `/{path}` with `method`: the server handles them, the
 * editor sees the answer only after `release()`. `held` resolves once the first request is held. This puts a key
 * press exactly into the moment under test instead of relying on how fast the server answers.
 */
async function holdAnswers(page: Page, method: string, path: "commands" | "history") {
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  let isHeld!: () => void;
  const held = new Promise<void>(resolve => { isHeld = resolve; });
  let released = false;
  const answering: Promise<void>[] = [];
  // The route stays (an unroute can strand a request passing through it); once released it holds nothing.
  await page.route(url => /^\/api\/v1\/workspaces\/[^/]+\//.test(url.pathname) && url.pathname.endsWith(`/${path}`), async route => {
    if (released || route.request().method() !== method) { await route.fallback(); return; }
    const answered = (async () => {
      const response = await route.fetch();
      isHeld();
      await gate;
      await route.fulfill({ response });
    })();
    answering.push(answered);
    await answered;
  });
  return { held, release: async () => { released = true; release(); await Promise.all(answering); } };
}

async function openLoop(page: Page): Promise<ReviewFlowScenario> {
  await page.setViewportSize({ width: 1440, height: 900 });
  const s = await reviewFlowScenario(page, "ANNOTATION_LOOP");
  await loginScenarioUser(page, s, "annotator");
  await page.goto(`/#/tasks/${s.assignments["loop-en"]}`);
  await expect(textPane(page)).toHaveText(s.texts["loop-en"]);
  return s;
}

test("undo and redo step through the changes, survive a reload, and reset returns to the start", async ({ page }) => {
  const s = await openLoop(page);
  await expect(undoButton(page)).toBeDisabled();
  await expect(redoButton(page)).toBeDisabled();
  // Nothing to reset yet: the item says so and does nothing.
  await page.getByRole("button", { name: "More actions" }).click();
  const unavailable = page.getByRole("menuitem", { name: "Reset all my changes…" });
  await expect(unavailable).toHaveAttribute("aria-disabled", "true");
  await expect(unavailable).toHaveAccessibleDescription("Nothing changed in this round yet");
  await page.keyboard.press("Escape");

  // Two steps: add Seizure, then confirm its default values.
  const start = s.texts["loop-en"].indexOf("seizure");
  await selectText(page, start, start + "seizure".length);
  await expect(page.getByRole("listbox", { name: "Terms", exact: true }).locator('[aria-selected="true"]')).toContainText("Seizure");
  await page.keyboard.press("Enter");
  await expect(page.locator("[data-confirm-defaults]")).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.locator("[data-confirm-defaults]")).toHaveCount(0);
  await expect(findingRows(page)).toHaveCount(1);

  await expect(undoButton(page)).toHaveAttribute("title", "Undo: change the values of Seizure");
  const undone = historyResponse(page, "undo_step");
  await undoButton(page).click();
  expect((await undone).ok()).toBeTruthy();
  await expect(page.locator("[data-confirm-defaults]")).toHaveText(/^Confirm defaults \(3\)/);
  await expect(undoButton(page)).toHaveAttribute("title", "Undo: add finding Seizure");
  await expect(redoButton(page)).toHaveAttribute("title", "Redo: change the values of Seizure");

  // Ctrl+Z outside a text field takes back the finding itself.
  await page.locator("h1.case-title").click();
  const second = historyResponse(page, "undo_step");
  await page.keyboard.press("Control+z");
  expect((await second).ok()).toBeTruthy();
  await expect(findingRows(page)).toHaveCount(0);
  await expect(undoButton(page)).toBeDisabled();

  // The history is built from the saved edits: after a reload both redo steps are still there.
  await page.reload();
  await expect(textPane(page)).toHaveText(s.texts["loop-en"]);
  await expect(redoButton(page)).toHaveAttribute("title", "Redo: add finding Seizure");
  await page.locator("h1.case-title").click();
  const redone = historyResponse(page, "redo_step");
  await page.keyboard.press("Control+Shift+z");
  expect((await redone).ok()).toBeTruthy();
  await expect(findingRows(page)).toHaveCount(1);

  // Reset asks first, names what is lost, and is itself one step.
  await page.getByRole("button", { name: "More actions" }).click();
  await page.getByRole("menuitem", { name: "Reset all my changes…" }).click();
  const dialog = page.getByRole("dialog", { name: "Reset all my changes?" });
  await expect(dialog).toContainText("The task has no findings again");
  const reset = historyResponse(page, "reset_changes");
  await dialog.getByRole("button", { name: "Reset all my changes" }).click();
  expect((await reset).ok()).toBeTruthy();
  await expect(findingRows(page)).toHaveCount(0);
  await expect(undoButton(page)).toHaveAttribute("title", "Undo: reset all my changes");
  await undoButton(page).click();
  await expect(findingRows(page)).toHaveCount(1);
});

/** Adds Seizure with its defaults confirmed and waits until the history has both steps. */
async function addSeizure(page: Page, s: ReviewFlowScenario): Promise<void> {
  const start = s.texts["loop-en"].indexOf("seizure");
  await selectText(page, start, start + "seizure".length);
  await expect(page.getByRole("listbox", { name: "Terms", exact: true }).locator('[aria-selected="true"]')).toContainText("Seizure");
  await page.keyboard.press("Enter");
  await expect(page.locator("[data-confirm-defaults]")).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.locator("[data-confirm-defaults]")).toHaveCount(0);
  await expect(undoButton(page)).toHaveAttribute("title", "Undo: change the values of Seizure");
}

test("Ctrl+Z right after a value change undoes that change (review F1)", async ({ page }) => {
  const s = await openLoop(page);
  await addSeizure(page, s);
  const assertion = page.getByRole("group", { name: /^Assertion/ });
  const radio = (name: string) => assertion.getByRole("radio", { name: new RegExp(`^${name}`) });
  await expect(radio("Present")).toBeChecked();
  const refused: string[] = [];
  page.on("response", response => { if (response.url().endsWith("/history") && response.status() >= 400) refused.push(`${response.status()}`); });

  // The undo is pressed while the change is still saving: it waits for the save and takes that change back.
  const saving = await holdAnswers(page, "POST", "commands");
  const undone = historyResponse(page, "undo_step");
  await radio("Absent").check();
  await saving.held;
  await page.keyboard.press("Control+z");
  await saving.release();
  expect((await undone).ok()).toBeTruthy();
  await expect(radio("Present")).toBeChecked();
  await expect(undoButton(page)).toHaveAttribute("title", "Undo: change the values of Seizure");
  await expect(redoButton(page)).toHaveAttribute("title", "Redo: change the values of Seizure");

  // Pressed once the change is saved but while the history of the new revision is still being read: the key
  // used to be dropped then, as the controls knew no step for that revision.
  const reading = await holdAnswers(page, "GET", "history");
  const saved = page.waitForResponse(response => response.request().method() === "POST" && response.url().endsWith("/commands"));
  const afterSave = historyResponse(page, "undo_step");
  await radio("Absent").check();
  await saved;
  await reading.held;
  await expect(undoButton(page)).toBeEnabled();
  await page.keyboard.press("Control+z");
  await reading.release();
  expect((await afterSave).ok()).toBeTruthy();
  await expect(radio("Present")).toBeChecked();
  await expect(undoButton(page)).toHaveAttribute("title", "Undo: change the values of Seizure");

  // Two quick changes are one step (handbook): the second comes while the first is still saving, and one
  // Ctrl+Z takes both back.
  const first = await holdAnswers(page, "POST", "commands");
  const second = historyResponse(page, "undo_step");
  await radio("Uncertain").check();
  await first.held;
  await radio("Absent").check();
  await first.release();
  await page.keyboard.press("Control+z");
  expect((await second).ok()).toBeTruthy();
  await expect(radio("Present")).toBeChecked();
  await expect(page.getByRole("alert")).toHaveCount(0);
  expect(refused).toEqual([]);
});
