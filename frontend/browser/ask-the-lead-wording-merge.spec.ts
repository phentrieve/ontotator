/**
 * Issue 610: "Take the proposed wording" while the reviewer keeps working in the open review (two browser contexts).
 * - An edit waiting in the autosave delay at the moment of the answer, and every edit after it, are kept; the
 *   lead's wording reaches the text on screen without a reload, and the status never says Saved for a stale text.
 * - Paused variant: the answer reopens the task with the wording in the text; the first edit saves.
 * - A clash (the reviewer changed the passage meanwhile) keeps the reviewer's text and offers the wording in one click.
 * Screenshots for human review only (never baselines): ONTOTATOR_SHOTS_DIR, else build/ask-the-lead-wording-merge.
 */
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { expect, test, type Browser, type Page, type TestInfo } from "@playwright/test";
import { loginThroughForm } from "./helpers";
import { leadScenario } from "./leadWorkflowHelpers";

test.setTimeout(240_000);
test.use({ actionTimeout: 15_000 });

const QUOTE = "generalized hypotonia";
const WORDING = "generalized muscular hypotonia";
const QUESTION = "Is muscular hypotonia meant here?";
const ANSWER = "Yes, muscular hypotonia. I put it into your text.";

async function shot(page: Page, name: string) {
  const dir = process.env.ONTOTATOR_SHOTS_DIR ?? resolve(test.info().config.rootDir, "../../build/ask-the-lead-wording-merge");
  mkdirSync(dir, { recursive: true });
  await page.screenshot({ path: resolve(dir, `${name}.png`) });
}

function consoleErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on("console", message => { if (message.type() === "error" && !/409|Conflict/.test(message.text())) errors.push(message.text()); });
  page.on("pageerror", error => errors.push(error.message));
  return errors;
}

/** The reviewer and the lead, each in their own browser context at 1440 × 900. */
async function twoPeople(browser: Browser, page: Page, info: TestInfo) {
  await page.setViewportSize({ width: 1440, height: 900 });
  const s = await leadScenario(page, "QUESTION_FOR_LEAD");
  const context = await browser.newContext({ baseURL: info.project.use.baseURL, viewport: { width: 1440, height: 900 } });
  const lead = await context.newPage();
  await loginThroughForm(page, s.users.ana, s.display_names.ana);
  await loginThroughForm(lead, s.users.lead, s.display_names.lead, { lastProject: s.project });
  await page.goto(`/#/tasks/${s.tasks!.ask}`);
  await expect(page.getByRole("region", { name: "Translation review" })).toBeVisible();
  return { s, lead, close: () => context.close() };
}

const editor = (page: Page) => page.locator("#review-translation");
const status = (page: Page) => page.locator(".translation-save-status");
const questions = (page: Page) => page.getByRole("region", { name: "Questions to the lead" });

async function typeAt(page: Page, after: string | null, text: string) {
  await editor(page).evaluate((element, at) => {
    const textarea = element as HTMLTextAreaElement;
    const index = at === null ? textarea.value.length : textarea.value.indexOf(at) + at.length;
    textarea.focus(); textarea.setSelectionRange(index, index);
  }, after);
  await page.keyboard.type(text);
}

async function ask(page: Page, pause: boolean) {
  await editor(page).evaluate((element, quote) => {
    const textarea = element as HTMLTextAreaElement, start = textarea.value.indexOf(quote);
    textarea.focus(); textarea.setSelectionRange(start, start + quote.length);
  }, QUOTE);
  await page.getByRole("button", { name: "Ask the lead", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Ask the lead" });
  await expect(dialog.getByRole("textbox", { name: /Passage you ask about/ })).toHaveValue(QUOTE);
  await dialog.getByRole("textbox", { name: /Your question/ }).fill(QUESTION);
  await dialog.getByRole("textbox", { name: /Your wording for this passage/ }).fill(WORDING);
  if (pause) await dialog.getByRole("checkbox", { name: "Pause my task until the lead answers" }).check();
  await dialog.getByRole("button", { name: "Send question" }).click();
  await expect(dialog).toHaveCount(0);
}

/** The lead opens "Answer…" on the question with "Take the proposed wording" ticked; the caller sends it. */
async function prepareAnswer(lead: Page) {
  await lead.getByRole("link", { name: /^Questions, \d+ open/ }).click();
  const item = lead.getByRole("listitem").filter({ hasText: QUESTION });
  await item.getByRole("button", { name: "Answer…" }).click();
  const dialog = lead.getByRole("dialog", { name: /^Answer / });
  await dialog.getByRole("textbox", { name: /Your answer/ }).fill(ANSWER);
  await dialog.getByRole("checkbox", { name: /Take the proposed wording/ }).check();
  return async () => {
    await dialog.getByRole("button", { name: "Answer and take the wording" }).click();
    await expect(lead.getByText("Answer sent. The proposed wording is in the reviewer's text.")).toBeVisible();
  };
}

/** Holds the reviewer's next draft save until `release`, so it reaches the server after the lead's answer. */
async function holdNextSave(page: Page) {
  let release!: () => void, caught!: () => void;
  const released = new Promise<void>(done => { release = done; });
  const sent = new Promise<void>(done => { caught = done; });
  await page.route(/\/api\/v1\/translation-reviews\/\d+\/draft$/, async route => {
    if (route.request().method() !== "PUT") return route.fallback();
    caught(); await released; return route.fallback();
  }, { times: 1 });
  return { sent, release };
}

async function savedText(page: Page, assignmentId: number): Promise<string> {
  const response = await page.request.get(`/api/v1/translation-reviews/${assignmentId}`);
  expect(response.ok()).toBeTruthy();
  return ((await response.json()) as { draft: { text: string } }).draft.text;
}

/** Waits until the save status settles (on a fixed screen Saved, before the fix Conflict: reload). */
async function settled(page: Page) {
  await expect(status(page)).not.toHaveText(/Saving|Changes not saved/, { timeout: 10_000 });
}

test("1440 px: an edit waiting at the answer and the edits after it are kept, with the lead's wording in the text", async ({ browser, page }, info) => {
  const errors = consoleErrors(page);
  const { s, lead, close } = await twoPeople(browser, page, info);
  const task = s.tasks!.ask;

  // 1–3: EDITA saved, a question with a wording (no pause), EDITB saved.
  await typeAt(page, null, " EDITA");
  await expect(status(page)).toHaveText("Saved");
  await ask(page, false);
  await expect(questions(page)).toContainText("Question sent. You can keep working.");
  await typeAt(page, null, " EDITB");
  await expect(status(page)).toHaveText("Saved");

  // 4–5: the lead prepares the answer; EDITC waits in the autosave delay while the lead takes the wording.
  const send = await prepareAnswer(lead);
  const save = await holdNextSave(page);
  await typeAt(page, QUOTE, " EDITC");
  await save.sent;
  await send();
  save.release();
  await settled(page);
  await shot(page, "1-reviewer-after-answer-1440");
  await expect(status(page)).toHaveText("Saved");
  await expect(page.getByText(`The lead's wording is in your text now: “${WORDING}”. Your own edits are kept.`)).toBeVisible();

  // 6: the reviewer keeps working; that is saved as well.
  await typeAt(page, "EDITA", " EDITD");
  await settled(page);
  await expect(status(page)).toHaveText("Saved");
  const shown = await editor(page).inputValue();
  for (const part of ["EDITA", "EDITB", "EDITC", "EDITD", WORDING]) expect(shown).toContain(part);
  expect(shown).not.toContain(QUOTE);
  expect(await savedText(page, task)).toBe(shown);

  // 7–8: focus and "Show it in my text" select the wording; nothing asks to discard.
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await questions(page).getByRole("button", { name: "Show it in my text" }).click();
  await expect(page.getByRole("dialog", { name: "Changes not saved" })).toHaveCount(0);
  await expect.poll(() => editor(page).evaluate(element => {
    const textarea = element as HTMLTextAreaElement;
    return textarea.value.slice(textarea.selectionStart, textarea.selectionEnd);
  })).toBe(WORDING);
  await shot(page, "2-reviewer-show-in-text-1440");

  // After reopening the task, every edit is there.
  await page.reload();
  await expect(editor(page)).toHaveValue(shown);
  await close();
  expect(errors).toEqual([]);
});

test("1440 px, paused: the answer reopens the task with the wording in the text and the first edit saves", async ({ browser, page }, info) => {
  const errors = consoleErrors(page);
  const { s, lead, close } = await twoPeople(browser, page, info);
  const task = s.tasks!.ask;
  await typeAt(page, null, " EDITA");
  await expect(status(page)).toHaveText("Saved");
  await ask(page, true);
  await expect(status(page)).toHaveText("Read-only");

  const send = await prepareAnswer(lead);
  await send();
  // The reviewer comes back to the window.
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect(editor(page)).toBeEditable();
  await settled(page);
  await shot(page, "3-paused-after-focus-1440");
  await expect(editor(page)).toHaveValue(new RegExp(WORDING));
  await expect(status(page)).toHaveText("Saved");

  await typeAt(page, null, " EDITE");
  await settled(page);
  await shot(page, "4-paused-after-edit-1440");
  await expect(status(page)).toHaveText("Saved");
  const text = await savedText(page, task);
  for (const part of ["EDITA", "EDITE", WORDING]) expect(text).toContain(part);
  await close();
  expect(errors).toEqual([]);
});

test("1440 px: the reviewer changed the passage meanwhile, so their text wins and the wording is one click away", async ({ browser, page }, info) => {
  const errors = consoleErrors(page);
  const { s, lead, close } = await twoPeople(browser, page, info);
  const task = s.tasks!.ask;
  await ask(page, false);
  const send = await prepareAnswer(lead);
  const save = await holdNextSave(page);
  // The reviewer rewrites the passage while the lead answers.
  await editor(page).evaluate((element, quote) => {
    const textarea = element as HTMLTextAreaElement, start = textarea.value.indexOf(quote) + "generalized".length;
    textarea.focus(); textarea.setSelectionRange(start, start);
  }, QUOTE);
  await page.keyboard.type(" mild");
  await save.sent;
  await send();
  save.release();
  await settled(page);
  await expect(status(page)).toHaveText("Saved");
  const kept = page.locator(".notice").filter({ hasText: "Your text was kept" });
  await expect(kept).toContainText(`You changed “${QUOTE}” after you asked, so the lead's wording was not put in: “${WORDING}”.`);
  await expect(editor(page)).toHaveValue(/generalized mild hypotonia/);
  expect(await savedText(page, task)).toContain("generalized mild hypotonia");
  await kept.scrollIntoViewIfNeeded();
  await shot(page, "5-clash-kept-1440");

  await kept.getByRole("button", { name: "Use the lead's wording" }).click();
  await expect(kept).toHaveCount(0);
  await expect(editor(page)).toHaveValue(new RegExp(WORDING));
  await settled(page);
  expect(await savedText(page, task)).toContain(WORDING);
  await close();
  expect(errors).toEqual([]);
});
