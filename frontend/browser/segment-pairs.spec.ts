/**
 * Check by segment pairs (issue 560, prototype): the source and the translation aligned in rows, a check per pair,
 * "changed since checked" after an edit, merge and split, find, reload, phones. With SEGMENT_SHOTS=1 the test at the
 * end writes the screenshots for the pull request to build/segment-pairs (1440 × 900, device scale 2).
 */
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import type { components } from '../src/api/generated';
import { ALIGNMENT_HELD_OUT, ALIGNMENT_SAMPLE, sampleText, type GoldDocument } from '../tests/fixtures/alignmentSample';
import { authenticatedRequest, loginExisting } from './helpers';

test.setTimeout(120_000);
type ReviewWorkspace = components['schemas']['ReviewWorkspace'];
type Scenario = { assignment_id: number | null; users: Record<'lead' | 'reviewer' | 'other', string>; texts: Record<'source' | 'target', string> };

/** An invented letter: the source with its paragraphs, the translation as one block, as translations often arrive. */
function texts(documents: GoldDocument[], times = 1) {
  const all = Array.from({ length: times }, () => documents).flat();
  return { source: all.map(document => sampleText(document, 'en').text).join('\n\n'), target: all.map(document => sampleText(document, 'de').text.replace(/\n\n/g, ' ')).join(' ') };
}
async function scenario(page: Page, body: { source: string; target: string }): Promise<Scenario> {
  const response = await page.request.post('/__test_translation_review__?assignment=target', { data: body });
  expect(response.ok()).toBeTruthy();
  return await response.json() as Scenario;
}
async function workspace(page: Page, id: number): Promise<ReviewWorkspace> {
  const response = await authenticatedRequest(page, `/api/v1/translation-reviews/${id}`);
  expect(response.ok()).toBeTruthy(); return await response.json() as ReviewWorkspace;
}
async function openPairs(page: Page, s: Scenario) {
  await loginExisting(page, s.users.reviewer);
  await page.locator(`a[href="#/tasks/${s.assignment_id}"]`).click();
  await expect(page.getByRole('textbox', { name: 'Translation (de)', exact: true })).toBeVisible();
  await page.getByRole('checkbox', { name: 'Check by segment pairs', exact: true }).check();
  await expect(table(page)).toBeVisible();
}
const table = (page: Page) => page.getByRole('table', { name: 'Segment pairs', exact: true });
const rows = (page: Page) => table(page).locator('.segment-pair');
const count = (page: Page) => page.locator('.translation-tools .sentence-count');

test('the texts are aligned in pairs; a pair is checked, goes stale after an edit, is merged and split, and all of it is kept', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const s = await scenario(page, texts(ALIGNMENT_SAMPLE));
  await openPairs(page, s);
  // The one-block translation is paired with the source sentence by sentence, n:m.
  await expect(rows(page)).toHaveCount(55);
  await expect(rows(page).nth(1).locator('.segment-cell--source')).toHaveText('She was admitted with a sudden weakness of the right arm and slurred speech that had started two hours earlier.');
  await expect(rows(page).nth(1).locator('.segment-cell--translation')).toHaveText('Die Aufnahme erfolgte wegen einer plötzlichen Schwäche des rechten Arms und einer verwaschenen Sprache. Die Beschwerden hatten zwei Stunden zuvor begonnen.');
  // Rows line up: the source and its translation start on the same line.
  const sourceBox = (await rows(page).nth(1).locator('.segment-cell--source').boundingBox())!, targetBox = (await rows(page).nth(1).locator('.segment-cell--translation').boundingBox())!;
  expect(Math.abs(sourceBox.y - targetBox.y)).toBeLessThan(2);
  expect(targetBox.x).toBeGreaterThan(sourceBox.x + sourceBox.width);
  await expect(page.getByRole('checkbox', { name: 'Couple scrolling' })).toHaveCount(0);

  // Check pairs 1 to 3.
  for (const n of [1, 2, 3]) await page.getByRole('button', { name: `Pair ${n}: Not checked`, exact: true }).click();
  await expect(count(page)).toHaveText('3 of 55 pairs checked');
  await expect(rows(page).nth(0)).toHaveClass(/is-checked/);
  // Edit the translation of pair 2 in its cell: it reads "changed since checked", the others stay checked.
  await rows(page).nth(1).locator('.segment-cell--translation').click();
  const cell = page.getByRole('textbox', { name: 'Translation of pair 2', exact: true });
  await expect(cell).toBeFocused();
  await cell.press('Control+End'); await cell.pressSequentially(' Sie war wach.');
  await expect(page.getByRole('button', { name: 'Pair 2: Changed since checked', exact: true })).toBeVisible();
  await expect(count(page)).toHaveText('2 of 55 pairs checked · 1 changed');
  await cell.press('Escape');
  await expect(rows(page).nth(1).locator('.segment-cell--translation')).toContainText('zuvor begonnen. Sie war wach.');
  await expect(page.locator('.translation-save-status')).toHaveText('Saved');

  // Merge pairs 4 and 5 ("The NIHSS score was 6." and "Cranial CT …"), then split them again.
  await page.getByRole('button', { name: 'Pair 4: change the pairing', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Merge with the pair below', exact: true }).click();
  await expect(rows(page)).toHaveCount(54);
  await expect(rows(page).nth(3).locator('.segment-cell--source')).toHaveText('The NIHSS score was 6. Cranial CT showed no bleeding.');
  await page.getByRole('button', { name: 'Pair 4: change the pairing', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Split this pair', exact: true }).click();
  await expect(rows(page)).toHaveCount(55);
  await expect(rows(page).nth(4).locator('.segment-cell--translation')).toHaveText('In der kranialen CT zeigte sich keine Blutung.');
  // Merge 6 and 7 for good: kept on reload.
  await page.getByRole('button', { name: 'Pair 6: change the pairing', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Merge with the pair below', exact: true }).click();
  await expect(rows(page)).toHaveCount(54);

  // Stored: the pairs with their checks; never in the review form.
  await expect.poll(async () => (await workspace(page, s.assignment_id!)).segment_pairs?.pairs?.length).toBe(54);
  const stored = await workspace(page, s.assignment_id!);
  expect(stored.segment_pairs!.pairs!.slice(0, 3).map(pair => pair.checked !== null)).toEqual([true, true, true]);
  expect(stored.draft.form).not.toHaveProperty('segment_pairs');
  await page.reload();
  await expect(table(page)).toBeVisible();
  await expect(rows(page)).toHaveCount(54);
  await expect(page.getByRole('button', { name: 'Pair 1: Checked', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Pair 2: Changed since checked', exact: true })).toBeVisible();
  await expect(count(page)).toHaveText('2 of 54 pairs checked · 1 changed');

  // Find counts the hits of both sides, in the cells.
  await page.keyboard.press('Control+f');
  const find = page.getByRole('searchbox', { name: 'Find in the texts', exact: true });
  await expect(find).toBeFocused();
  await find.fill('mmHg');
  await expect(page.locator('.find-bar-status')).toHaveText('1 of 6Source 3 · Translation 3');
  await find.press('Escape');

  // Show changes marks the edit inside its cell, and the cells are not editable then.
  await page.getByRole('checkbox', { name: 'Show changes', exact: true }).check();
  await expect(rows(page).nth(1).locator('ins')).toContainText('Sie war wach.');
  await expect(page.getByRole('button', { name: 'Edit the translation of pair 2' })).toHaveCount(0);
  await page.getByRole('checkbox', { name: 'Show changes', exact: true }).uncheck();

  const axe = await new AxeBuilder({ page }).include('.translation-pairs-view').analyze();
  expect(axe.violations.map(v => v.id)).toEqual([]);
});

test('on a phone the source stands above its translation', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const s = await scenario(page, texts(ALIGNMENT_SAMPLE.slice(0, 1)));
  await openPairs(page, s);
  const row = rows(page).nth(1);
  const source = (await row.locator('.segment-cell--source').boundingBox())!, target = (await row.locator('.segment-cell--translation').boundingBox())!;
  expect(target.y).toBeGreaterThanOrEqual(source.y + source.height - 1);
  await page.getByRole('button', { name: 'Pair 2: Not checked', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Pair 2: Checked', exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
});

test('screenshots for the pull request', async ({ browser }) => {
  test.skip(!process.env.SEGMENT_SHOTS, 'Only with SEGMENT_SHOTS=1.');
  const folder = resolve(test.info().config.rootDir, '../../build/segment-pairs'); mkdirSync(folder, { recursive: true });
  const shoot = async (name: string, source: { source: string; target: string }, act: (page: Page) => Promise<void>, dark = false) => {
    const context = await browser.newContext({ baseURL: test.info().project.use.baseURL, viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2, colorScheme: dark ? 'dark' : 'light' });
    const page = await context.newPage();
    const s = await scenario(page, source);
    await openPairs(page, s);
    await act(page);
    await expect(page.locator('.translation-save-status')).toHaveText('Saved', { timeout: 15_000 });
    await page.mouse.move(0, 0);
    await page.screenshot({ path: resolve(folder, `${name}.png`) });
    await context.close();
  };
  const sample = texts(ALIGNMENT_SAMPLE);
  const working = async (page: Page) => {
    for (const n of [1, 2, 3, 4]) await page.getByRole('button', { name: `Pair ${n}: Not checked`, exact: true }).click();
    await rows(page).nth(2).locator('.segment-cell--translation').click();
    const cell = page.getByRole('textbox', { name: 'Translation of pair 3', exact: true });
    await cell.press('Control+End'); await cell.press('Backspace'); await cell.pressSequentially(' (Ruhe).');
    await cell.press('Escape');
    await page.getByRole('button', { name: 'Pair 5: change the pairing', exact: true }).click();
  };
  await shoot('1-pairs-1440', sample, working);
  await shoot('2-pairs-1440-dark', sample, working, true);
  await shoot('3-editing-a-pair-1440', sample, async page => {
    await page.getByRole('button', { name: 'Pair 2: Not checked', exact: true }).click();
    await rows(page).nth(1).locator('.segment-cell--translation').click();
    await page.getByRole('textbox', { name: 'Translation of pair 2', exact: true }).press('Control+End');
  });
  await shoot('4-show-changes-and-find-1440', sample, async page => {
    await working(page);
    await page.keyboard.press('Escape');
    await page.getByRole('checkbox', { name: 'Show changes', exact: true }).check();
    await page.keyboard.press('Control+f');
    await page.getByRole('searchbox', { name: 'Find in the texts', exact: true }).fill('mmHg');
  });
  const long = texts([...ALIGNMENT_SAMPLE, ...ALIGNMENT_HELD_OUT], 4);
  await shoot('5-long-text-1440', long, async page => {
    await expect(rows(page).first()).toBeVisible();
    await table(page).evaluate(element => { element.scrollTop = element.scrollHeight * 0.62; });
  });
  await shoot('6-long-text-1440-dark', long, async page => {
    await table(page).evaluate(element => { element.scrollTop = element.scrollHeight * 0.3; });
  }, true);
});
