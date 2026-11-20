import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import type { components } from '../src/api/generated';
import { authenticatedRequest, loginExisting } from './helpers';

// "Show invisible characters" in the translation review (issue 454): marks only, the text stays what it is.
test.setTimeout(90_000);
type ReviewWorkspace = components['schemas']['ReviewWorkspace'];
type Scenario = {
  project: string; documents: Record<'source' | 'target' | 'failed', string>;
  texts: Record<'source' | 'target' | 'failed', string>;
  users: Record<'lead' | 'reviewer' | 'other', string>; assignment_id: number | null;
};
// Written as code points so this file holds no invisible character.
const TAB = '\t', NBSP = String.fromCodePoint(0xa0), ZWSP = String.fromCodePoint(0x200b), SHY = String.fromCodePoint(0xad);
const FACE = String.fromCodePoint(0x1f600), ACUTE = String.fromCodePoint(0x301);
const MARKS = [String.fromCodePoint(0xb7), String.fromCodePoint(0xb6), String.fromCodePoint(0xb0), String.fromCodePoint(0x2192), String.fromCodePoint(0xac)];
const HEAD = `Fieber  und Husten ,${TAB}Dosis 10${NBSP}mg.${ZWSP} Silben${SHY}trennung \nZweite Zeile ${FACE} e${ACUTE}.`;

const target = (page: Page) => page.getByRole('textbox', { name: 'Translation (de)', exact: true });
const source = (page: Page) => page.getByRole('region', { name: 'Source (en)', exact: true });
const toggle = (page: Page) => page.getByRole('group', { name: 'Text view', exact: true }).getByRole('checkbox', { name: 'Show invisible characters', exact: true });
const marked = (page: Page, root: string, kind: string) => page.locator(`${root} .invisible-char[data-invisible="${kind}"]`);

async function open(page: Page): Promise<Scenario> {
  const response = await page.request.post('/__test_translation_review__?assignment=target');
  expect(response.ok()).toBeTruthy();
  const s = await response.json() as Scenario;
  await loginExisting(page, s.users.reviewer);
  await page.locator(`a[href="#/tasks/${s.assignment_id}"]`).click();
  await expect(target(page)).toHaveValue(s.texts.target);
  await page.evaluate(() => document.fonts.ready);
  return s;
}
/** Where the lines of both texts are: heights and the position of every paragraph start. */
const layout = (page: Page) => page.evaluate(() => {
  const tops = (root: Element) => [...root.querySelectorAll('[data-paragraph]')].map(marker => Math.round(marker.getBoundingClientRect().top - root.getBoundingClientRect().top + root.scrollTop));
  const sourceBox = document.querySelector('[aria-label="Source (en)"]')!, editor = document.querySelector('.translation-editor')!;
  const mirror = editor.querySelector('.translation-editor-mirror')!, input = editor.querySelector('textarea')!;
  return {
    source: { height: sourceBox.scrollHeight, width: sourceBox.clientWidth, paragraphs: tops(sourceBox) },
    editor: { height: editor.scrollHeight, width: editor.clientWidth, mirror: Math.round(mirror.getBoundingClientRect().height), input: input.scrollHeight, paragraphs: tops(editor) },
  };
});
const selectAll = (page: Page) => source(page).evaluate(element => {
  const range = document.createRange(); range.selectNodeContents(element);
  const selection = window.getSelection()!; selection.removeAllRanges(); selection.addRange(range);
  return selection.toString();
});
const clipboard = (page: Page) => page.evaluate(() => navigator.clipboard.readText());
const sideScroll = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
async function shot(page: Page, name: string) {
  const directory = process.env.SHOW_INVISIBLES_SHOTS;
  if (!directory) return;
  mkdirSync(directory, { recursive: true });
  // The Text view controls and the first lines of both texts.
  await page.locator('.translation-text, .translation-editor, .translation-diff').evaluateAll(boxes => { for (const box of boxes) box.scrollTop = 0; });
  await page.getByRole('group', { name: 'Text view', exact: true }).evaluate(element => element.scrollIntoView({ block: 'center' }));
  await page.screenshot({ path: resolve(directory, `${name}.png`) });
}

for (const [width, height] of [[1440, 900], [390, 844]] as const) test(`marks at ${width}px leave the text, its wrapping, selection, copy and saving unchanged`, async ({ page, context }) => {
  const errors: string[] = [];
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  page.on('pageerror', error => errors.push(String(error)));
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.setViewportSize({ width, height });
  const s = await open(page);
  // The reviewer's own text: every kind of invisible character in its first lines, then the long paragraphs.
  const text = `${HEAD}\n\n${s.texts.target}`;
  await target(page).fill(text);
  await expect(page.locator('.translation-save-status')).toHaveText('Saved');
  await expect(toggle(page)).not.toBeChecked();
  await expect(page.locator('.invisible-char')).toHaveCount(0);
  const before = await layout(page), selectedBefore = await selectAll(page);
  expect(selectedBefore).toBe(s.texts.source);
  await shot(page, `454-review-off-${width}`);

  await toggle(page).check();
  // Every kind is marked in the translation; spaces and line ends in the source.
  for (const kind of ['space', 'tab', 'nbsp', 'zero-width', 'soft-hyphen', 'line-end']) await expect(marked(page, '.translation-editor-mirror', kind).first()).toBeAttached();
  await expect(marked(page, '.translation-editor-mirror', 'tab')).toHaveCount(1);
  await expect(marked(page, '[aria-label="Source (en)"]', 'line-end')).toHaveCount(26);
  // A mark is drawn (generated content with a colour of its own, also in the transparent mirror).
  const drawn = await marked(page, '.translation-editor-mirror', 'tab').evaluate(element => { const style = getComputedStyle(element, '::before'); return { content: style.content, position: style.position, color: style.color }; });
  expect(drawn.position).toBe('absolute'); expect(drawn.content).toBe(`"${MARKS[3]}"`); expect(drawn.color).not.toBe('rgba(0, 0, 0, 0)');
  // No line moved: same heights, same paragraph positions, textarea and mirror still congruent.
  expect(await layout(page)).toEqual(before);
  expect(await sideScroll(page)).toBeLessThanOrEqual(0);
  for (const box of ['[aria-label="Source (en)"]', '.translation-editor']) expect(await page.locator(box).evaluate(element => { element.scrollLeft = 50; return element.scrollLeft; })).toBe(0);

  // Selecting and copying give the text, never a mark.
  expect(await selectAll(page)).toBe(s.texts.source);
  await source(page).focus(); await selectAll(page);
  await page.keyboard.press('ControlOrMeta+KeyC');
  expect(await clipboard(page)).toBe(s.texts.source);
  // A selection made with the pointer inside the text.
  await source(page).click({ clickCount: 3, position: { x: Math.min(160, width / 2), y: 40 } });
  const picked = await page.evaluate(() => window.getSelection()!.toString());
  expect(picked.length).toBeGreaterThan(20);
  expect(s.texts.source).toContain(picked.trim());
  for (const mark of MARKS) expect(picked).not.toContain(mark);
  await target(page).focus();
  await page.keyboard.press('ControlOrMeta+KeyA'); await page.keyboard.press('ControlOrMeta+KeyC');
  expect(await clipboard(page)).toBe(text);
  await expect(target(page)).toHaveValue(text);

  // Typing with the marks on saves exactly what was typed.
  await page.keyboard.press('ControlOrMeta+End'); await page.keyboard.type(' Ende.');
  await expect(target(page)).toHaveValue(`${text} Ende.`);
  await expect(page.locator('.translation-save-status')).toHaveText('Saved');
  const stored = await (await authenticatedRequest(page, `/api/v1/translation-reviews/${s.assignment_id}`)).json() as ReviewWorkspace;
  expect(stored.draft.text).toBe(`${text} Ende.`);
  await page.locator('.translation-editor').evaluate(element => { element.scrollTop = 0; });
  await shot(page, `454-review-on-${width}`);

  // The change view marks the same characters; its text is the translation.
  await page.getByRole('checkbox', { name: 'Show changes', exact: true }).check();
  const changes = page.getByRole('region', { name: 'Text changes', exact: true });
  await expect(marked(page, '.translation-diff', 'tab')).toHaveCount(1);
  expect(await changes.evaluate(element => [...element.querySelectorAll('ins, span[data-diff-op]')].map(part => part.textContent).join(''))).toBe(`${text} Ende.`);
  await shot(page, `454-review-changes-on-${width}`);
  await page.getByRole('checkbox', { name: 'Show changes', exact: true }).uncheck();

  // Remembered for this user in this browser.
  await page.reload();
  await expect(toggle(page)).toBeChecked();
  await expect(marked(page, '.translation-editor-mirror', 'tab')).toHaveCount(1);
  await expect(target(page)).toHaveValue(`${text} Ende.`);
  await toggle(page).uncheck();
  await expect(page.locator('.invisible-char')).toHaveCount(0);
  expect(await sideScroll(page)).toBeLessThanOrEqual(0);
  expect(errors).toEqual([]);
});

test('marks with Mark checked sentences: the text keeps its marks, the markers stand beside it', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const s = await open(page);
  await toggle(page).check();
  await page.getByRole('checkbox', { name: 'Mark checked sentences', exact: true }).check();
  await expect(marked(page, '.translation-editor-mirror', 'line-end')).toHaveCount(26);
  await expect(target(page)).toHaveValue(s.texts.target);
  const first = page.getByRole('group', { name: 'Checked sentences: Translation', exact: true }).locator('[data-sentence="0"]');
  await first.click();
  await expect(first).toHaveAttribute('aria-pressed', 'true');
  await shot(page, '454-review-sentences-on-1440');
});
