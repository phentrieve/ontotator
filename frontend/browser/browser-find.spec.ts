/**
 * The browser's own find (Ctrl/Cmd+F) in the translation review and the annotation editor (issue 533).
 *
 * `window.find` runs the same find machinery in Chromium as the find bar. Each test walks every hit of a phrase
 * from the top of the page and records where it landed:
 * - Editor: the layout mirror behind the textarea is inert, so a passage is found once, in the textarea, not twice.
 * - Show changes: deleted words are generated content, so `Dosis 5 mg` → `Dosis 10 mg` is found as "Dosis 10 mg"
 *   and never as "Dosis 510 mg". The deleted words still show and are still read out as deletions.
 * - The source, the comparison and the annotation editor's text are found once per occurrence.
 * - Mark checked sentences: the text is selectable, so every hit is selected and the walk steps through all of
 *   them, in the source and the translation; with Show changes on as well, the proposed text is found.
 */
import { expect, test, type Page } from '@playwright/test';
import { loginExisting } from './helpers';
import { loginScenarioUser, reviewFlowScenario } from './reviewFlowHelpers';

test.setTimeout(90_000);

type Scenario = { texts: Record<'source' | 'target' | 'failed', string>; users: Record<'reviewer', string>; assignment_id: number | null };

/** Every hit of `needle` from the top of the page, as "<where>:<text found>"; the walk stops at the end of the page. */
function findHits(page: Page, needle: string): Promise<string[]> {
  return page.evaluate(needle => {
    (document.activeElement as HTMLElement | null)?.blur?.();
    const selection = getSelection()!;
    selection.removeAllRanges(); selection.collapse(document.body, 0);
    const hits: string[] = [], seen = new Set<string>();
    for (let step = 0; step < 50; step++) {
      // caseSensitive, backwards, wrapAround: the walk ends after the last hit.
      if (!window.find(needle, true, false, false)) break;
      const active = document.activeElement;
      let where: string, found: string, at: string;
      if (active instanceof HTMLTextAreaElement && active.selectionStart !== active.selectionEnd) {
        where = 'textarea';
        found = active.value.slice(active.selectionStart, active.selectionEnd); at = String(active.selectionStart);
      } else {
        const node = selection.anchorNode, element = node instanceof Element ? node : node?.parentElement;
        where = element?.closest('.translation-editor-mirror') ? 'mirror'
          : element?.closest('[role="region"][aria-label]')?.getAttribute('aria-label')
            ?? (element?.closest('.text-container') ? 'annotation text' : 'page');
        // A sentence's start can repeat ("Dose 5 mg."), so its index is part of where a hit is.
        found = selection.toString(); at = `${selection.anchorOffset}:${element?.closest('[data-sentence]')?.getAttribute('data-sentence') ?? ''}:${node?.textContent?.slice(0, 40)}`;
        // A hit in unselectable text (the old mirror was `user-select: none`) selects nothing: Chromium still
        // counts it in the find bar ("1 of 2") but cannot show where it is.
        if (!found) where = 'unselectable';
      }
      const key = `${where}|${at}`;
      if (seen.has(key)) break;
      seen.add(key); hits.push(`${where}:${found}`);
    }
    return hits;
  }, needle);
}

async function openReview(page: Page): Promise<Scenario> {
  const response = await page.request.post(`/__test_translation_review__?${new URLSearchParams({ assignment: 'target', unequal: 'false' })}`);
  expect(response.ok()).toBeTruthy();
  const s = await response.json() as Scenario;
  await loginExisting(page, s.users.reviewer);
  await page.locator(`a[href="#/tasks/${s.assignment_id}"]`).click();
  await expect(page.getByRole('textbox', { name: 'Translation (de)', exact: true })).toHaveValue(s.texts.target);
  return s;
}

test('find counts each passage of the translation once, matches the proposed text in Show changes, and once in the source and comparison', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const s = await openReview(page);
  const target = page.getByRole('textbox', { name: 'Translation (de)', exact: true });

  // Editor: one passage, one hit, in the textarea; the mirror behind it is not searchable.
  await expect(page.locator('.translation-editor-mirror')).toHaveAttribute('inert', '');
  expect(await findHits(page, 'Absatz 3. Dosis 5 mg')).toEqual(['textarea:Absatz 3. Dosis 5 mg']);
  // The source column: once per occurrence.
  expect(await findHits(page, 'Paragraph 3. Dose 5 mg')).toEqual(['Source (en):Paragraph 3. Dose 5 mg']);

  const edited = s.texts.target.replace('Absatz 3. Dosis 5 mg', 'Absatz 3. Dosis 10 mg');
  await target.fill(edited);
  // The mirror marks the inserted word but is still not found.
  await expect(page.locator('.translation-editor-mirror ins').filter({ hasText: /^10$/ })).toHaveCount(1);
  expect(await findHits(page, 'Absatz 3. Dosis 10 mg')).toEqual(['textarea:Absatz 3. Dosis 10 mg']);

  // Show changes: the deleted "5" is shown struck through but is not part of the searchable text.
  await page.getByRole('checkbox', { name: 'Show changes', exact: true }).check();
  const diff = page.getByRole('region', { name: 'Text changes', exact: true });
  await expect(diff).toHaveText(edited);
  const deleted = diff.locator('del').filter({ has: page.locator('[data-text="5"]') });
  await expect(deleted).toHaveCount(1);
  expect(await deleted.evaluate(node => getComputedStyle(node.firstElementChild!, '::after').content)).toBe('"5"');
  expect(await deleted.evaluate(node => node.getBoundingClientRect().width)).toBeGreaterThan(4);
  expect(await findHits(page, 'Absatz 3. Dosis 10 mg')).toEqual(['Text changes:Absatz 3. Dosis 10 mg']);
  expect(await findHits(page, 'Dosis 510 mg')).toEqual([]);
  // Copying the view gives the proposed text.
  expect(await diff.evaluate(node => { const range = document.createRange(); range.selectNodeContents(node); return range.toString(); })).toBe(edited);

  // Screen readers still get the deleted word, inside a deletion (Chromium's accessibility tree).
  const cdp = await page.context().newCDPSession(page);
  const { nodes } = await cdp.send('Accessibility.getFullAXTree') as { nodes: { nodeId: string; parentId?: string; role?: { value: string }; name?: { value: string }; childIds?: string[] }[] };
  const byId = new Map(nodes.map(node => [node.nodeId, node]));
  const textOf = (id: string): string => { const node = byId.get(id); if (!node) return ''; return node.role?.value === 'StaticText' ? node.name?.value ?? '' : (node.childIds ?? []).map(textOf).join(''); };
  const deletions = nodes.filter(node => /deletion/i.test(node.role?.value ?? '')).map(node => textOf(node.nodeId));
  expect(deletions).toContain('5');

  // The comparison: once per occurrence.
  await page.getByRole('checkbox', { name: 'Show changes', exact: true }).uncheck();
  await page.getByRole('button', { name: /^Compare with/ }).click();
  const menu = page.getByRole('menu', { name: 'Compare with…', exact: true });
  if (await menu.count()) await menu.getByRole('menuitem').first().click();
  const comparison = page.getByRole('region', { name: 'Comparison', exact: true });
  await expect(comparison).toHaveText(s.texts.failed);
  const phrase = s.texts.failed.slice(0, 20);
  const expected = s.texts.failed.split(phrase).length - 1;
  const hits = await findHits(page, phrase);
  expect(hits.filter(hit => hit.startsWith('Comparison:'))).toHaveLength(expected);
  expect(hits.filter(hit => hit.startsWith('mirror:') || hit.startsWith('unselectable:'))).toEqual([]);
});

test('find selects and steps through every hit while marking checked sentences, also with Show changes', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const s = await openReview(page);
  await page.getByRole('checkbox', { name: 'Mark checked sentences', exact: true }).check();
  const translation = page.getByRole('region', { name: 'Translation (de)', exact: true });
  await expect(translation.locator('[data-sentence]').first()).toBeVisible();
  const count = (text: string, phrase: string) => text.split(phrase).length - 1;
  const phrase = 'Dosis', sourcePhrase = 'Dose';
  expect(count(s.texts.target, phrase)).toBeGreaterThan(1);
  const hits = await findHits(page, phrase);
  expect(hits).toEqual(Array.from({ length: count(s.texts.target, phrase) }, () => `Translation (de):${phrase}`));
  // "Dose" also stands in the case id outside the texts; only the source column's hits are counted here.
  const sourceHits = await findHits(page, sourcePhrase);
  expect(sourceHits.filter(hit => hit.startsWith('Source (en):'))).toEqual(Array.from({ length: count(s.texts.source, sourcePhrase) }, () => `Source (en):${sourcePhrase}`));
  // A find hit is a selection, not a mark.
  await expect(translation.locator('[aria-pressed="true"]')).toHaveCount(0);

  // Show changes while marking: the changes stand in the sentences, and find matches the proposed text.
  await page.getByRole('checkbox', { name: 'Mark checked sentences', exact: true }).uncheck();
  const edited = s.texts.target.replace('Absatz 3. Dosis 5 mg', 'Absatz 3. Dosis 10 mg');
  await page.getByRole('textbox', { name: 'Translation (de)', exact: true }).fill(edited);
  await page.getByRole('checkbox', { name: 'Show changes', exact: true }).check();
  await page.getByRole('checkbox', { name: 'Mark checked sentences', exact: true }).check();
  await expect(translation.locator('[data-sentence] ins').filter({ hasText: /^10$/ })).toHaveCount(1);
  await expect(translation.locator('[data-sentence] del [data-text="5"]')).toHaveCount(1);
  expect(await findHits(page, 'Absatz 3. Dosis 10 mg')).toEqual(['Translation (de):Absatz 3. Dosis 10 mg']);
  expect(await findHits(page, 'Dosis 510 mg')).toEqual([]);
});

test('find counts each passage of the annotation editor text once', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const s = await reviewFlowScenario(page, 'ANNOTATION_LOOP');
  await loginScenarioUser(page, s, 'annotator');
  await page.goto(`/#/tasks/${s.assignments['loop-en']}`);
  const pane = page.locator('.text-container');
  await expect(pane).not.toHaveText('');
  const text = (await pane.textContent())!;
  const words = text.split(/\s+/).filter(word => word.length > 6);
  const phrase = words.find(word => text.split(word).length === 2) ?? words[0];
  const hits = await findHits(page, phrase);
  await test.info().attach('annotation-hits', { body: JSON.stringify({ phrase, hits }), contentType: 'application/json' });
  // One hit in the text; a copy elsewhere on the page (a quote in a finding) is a real one, never a hidden layer.
  expect(hits.filter(hit => hit === `annotation text:${phrase}`)).toHaveLength(1);
  expect(hits.filter(hit => hit.startsWith('mirror:') || hit.startsWith('unselectable:'))).toEqual([]);
});
