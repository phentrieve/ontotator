import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { item } from './reanchorFixtures';
import { ReanchorPanel, anchoredDiffParts, pendingDiffParts } from '../src/variants/ReanchorPanel';
import { historical } from './variantFixtures';
import { shownText } from './support/shownText';

afterEach(cleanup);
it('shows whole changed words after validating the exact server character windows', () => {
  const before = 'Krampfanfälle', after = 'Epileptische Anfälle';
  const mounted = render(<ReanchorPanel items={[item({ old_context: { start: 0, end: before.length, text: before }, new_context: { start: 0, end: after.length, text: after }, diff: [
    { op: 'replace', old_start: 0, old_end: 8, new_start: 0, new_end: 15, old_text: 'Krampfan', new_text: 'Epileptische An' },
    { op: 'equal', old_start: 8, old_end: before.length, new_start: 15, new_end: after.length, old_text: 'fälle', new_text: 'fälle' },
  ] })]} labelFor={() => null} onContext={() => {}} />);
  expect(shownText(mounted.container.querySelector('del')!)).toBe(before);
  expect(mounted.container.querySelector('ins')?.textContent).toBe(after);
});
it.each([
  ['same same old same', 'same same new same'],
  ['\u00b5 \ud83d\ude00 old\nsecond paragraph', '\u00b5 \ud83d\ude00 new\nsecond paragraph'],
])('preserves exact repeated and Unicode display windows: %s', (before, after) => {
  const oldEnd = Array.from(before).length, newEnd = Array.from(after).length;
  const mounted = render(<ReanchorPanel items={[item({ old_context: { start: 0, end: oldEnd, text: before }, new_context: { start: 0, end: newEnd, text: after }, diff: [
    { op: 'replace', old_start: 0, old_end: oldEnd, new_start: 0, new_end: newEnd, old_text: before, new_text: after },
  ] })]} labelFor={() => null} onContext={() => {}} />);
  const parts = [...mounted.container.querySelectorAll('[data-diff-op]')];
  expect(parts.filter(part => part.getAttribute('data-diff-op') !== 'insert').map(shownText).join('')).toBe(before);
  expect(parts.filter(part => part.getAttribute('data-diff-op') !== 'delete').map(part => part.textContent).join('')).toBe(after);
  expect(mounted.container.querySelector('[data-paragraph-offset="0"]')).not.toBeNull();
});
it('shows the term, the old words and the values that differ from the defaults; the text change on demand', () => {
  const pending=item({axes_values:{assertion:'absent',temporality:'historical',experiencer:'patient'},axes_defaulted:['experiencer']});
  const mounted=render(<ReanchorPanel items={[pending]} labelFor={()=>null} onContext={()=>{}} valuesOf={()=>'assertion: absent'}
    resolutions={[{item:{proposal_set_id:pending.proposal_set_id,source_ref:pending.source_ref},outcome:'recreated',replacement:{annotation_id:'replacement-id',version:'exact-version'},reviewer_id:'alice'}]}/>);
  expect(mounted.container.querySelector('.reanchor-row__head')?.textContent).toBe('HP:1 · 😀');
  expect(mounted.container.querySelector('.reanchor-row__words')?.textContent).toBe('😀');
  expect(screen.getByLabelText('Values').textContent).toBe('assertion: absent');
  expect(screen.getByText('experiencer: patient (defaulted)')).toBeTruthy();
  const old=mounted.container.querySelector('[data-old-context]')!;
  const details=old.closest('details')!;
  expect(details.open).toBe(false);
  expect(details.querySelector('summary')?.textContent).toBe('Show text change');
  expect(mounted.container.querySelector('[data-current-context]')?.textContent).toBe(pending.new_context.text);
  fireEvent.click(details.querySelector('summary')!);
  expect(details.open).toBe(true);
  const replacement=screen.getByText(/replacement-id/);
  expect(replacement.closest('details')?.open).toBe(false);
  expect(replacement.style.overflowWrap).toBe('anywhere');
});
it('shows stale or deleted replacements as pending and preserves exact item identity', () => {
  const pending=item(), replacement=historical.annotations[0];
  const resolutions=[{item:{proposal_set_id:pending.proposal_set_id,source_ref:pending.source_ref},outcome:'recreated' as const,
    replacement:{annotation_id:replacement.annotation.annotation_id,version:replacement.version},reviewer_id:'alice'}];
  const props={items:[pending,item({proposal_set_id:5})],resolutions,labelFor:()=>null,onContext:()=>{},onRecreate:vi.fn()};
  const mounted=render(<ReanchorPanel {...props} annotations={[replacement]}/>);
  expect(screen.getByText('1 pending, 1 resolved')).toBeTruthy();expect(screen.getByText('Re-created')).toBeTruthy();
  mounted.rerender(<ReanchorPanel {...props} annotations={[{...replacement,version:'edited'}]}/>);
  expect(screen.getByText('2 pending, 0 resolved')).toBeTruthy();expect(screen.queryByText('Re-created')).toBeNull();
  mounted.rerender(<ReanchorPanel {...props} annotations={[]}/>);
  expect(screen.getAllByRole('button',{name:'Mark in text'})).toHaveLength(2);
  fireEvent.click(screen.getAllByRole('button',{name:'Mark in text'})[1]);expect(props.onRecreate).toHaveBeenCalledWith(item({proposal_set_id:5}));
});
it('offers no mutation controls without callbacks', () => {
  render(<ReanchorPanel items={[item()]} labelFor={() => null} onContext={() => {}} />);
  expect(screen.queryByRole('button', { name: 'Mark in text' })).toBeNull();
  expect(screen.queryByRole('button', { name: 'Dismiss…' })).toBeNull();
});
it('requires a dismissal reason and retains it after failure and cancellation', async () => {
  const dismiss = vi.fn().mockRejectedValueOnce(new Error('Save failed')).mockResolvedValue(undefined);
  render(<ReanchorPanel items={[item()]} labelFor={() => null} onContext={() => {}} onDismiss={dismiss} />);
  fireEvent.click(screen.getByRole('button', { name: 'Dismiss…' }));
  const reason = screen.getByRole('textbox', { name: /Reason for dismissal/ });
  expect(screen.getByRole('button', { name: 'Save dismissal' })).toHaveProperty('disabled', true);
  fireEvent.change(reason, { target: { value: '  Corrected text no longer supports this finding.  ' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save dismissal' }));
  await screen.findByText('Save failed');
  expect(reason).toHaveProperty('value', '  Corrected text no longer supports this finding.  ');
  fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
  expect(dismiss).toHaveBeenCalledTimes(1);
  fireEvent.click(screen.getByRole('button', { name: 'Dismiss…' }));
  expect(screen.getByRole('textbox')).toHaveProperty('value', '  Corrected text no longer supports this finding.  ');
  fireEvent.click(screen.getByRole('button', { name: 'Save dismissal' }));
  await waitFor(() => expect(dismiss).toHaveBeenCalledTimes(2));
  expect(dismiss).toHaveBeenLastCalledWith(item(), 'Corrected text no longer supports this finding.');
});
it('hides empty items and preserves server order, layer identity and literal codepoint mention/cue contexts', () => {
  const reveal = vi.fn();
  const mounted = render(<ReanchorPanel items={[]} labelFor={() => null} onContext={reveal} />);
  expect(screen.queryByRole('heading')).toBeNull();
  mounted.rerender(<ReanchorPanel items={[item(), item({ layer_id: 'other', proposal_set_id: 2 })]} labelFor={layer => layer === 'hpo' ? 'Finding' : null} onContext={reveal} />);
  expect(screen.getByRole('heading', { name: 'Needs review after the text change (2)' })).toBeTruthy();
  const buttons = screen.getAllByRole('button'); expect(buttons[0].textContent).toBe('Finding'); expect(buttons[1].textContent).toBe('HP:1');
  expect(mounted.container.querySelector('b')).toBeNull();
  expect([...mounted.container.querySelectorAll('[data-old-context]')].map(node => node.textContent)).toEqual([item().old_context.text, item().old_context.text]);
  expect(mounted.container.querySelector('[data-old-kind="mention"]')?.textContent).toBe('😀');
  expect(mounted.container.querySelector('[data-old-kind="cue"]')?.textContent).toBe('ld');
  fireEvent.click(buttons[0]); expect(reveal).toHaveBeenCalledWith(item().new_context);
});
it('adapts validated absolute opcodes in their original order without recomputing a word diff', () => {
  const value = item({ old_context: { start: 100, end: 105, text: 'abXZc' }, new_context: { start: 20, end: 25, text: 'abY!c' }, diff: [
    { op: 'equal', old_start: 100, old_end: 102, new_start: 20, new_end: 22, old_text: 'ab', new_text: 'ab' },
    { op: 'replace', old_start: 102, old_end: 103, new_start: 22, new_end: 23, old_text: 'X', new_text: 'Y' },
    { op: 'delete', old_start: 103, old_end: 104, new_start: 23, new_end: 23, old_text: 'Z', new_text: '' },
    { op: 'insert', old_start: 104, old_end: 104, new_start: 23, new_end: 24, old_text: '', new_text: '!' },
    { op: 'equal', old_start: 104, old_end: 105, new_start: 24, new_end: 25, old_text: 'c', new_text: 'c' },
  ] });
  expect(pendingDiffParts(value)).toEqual([{ op:'equal',text:'ab' },{op:'delete',text:'X'},{op:'insert',text:'Y'},{op:'delete',text:'Z'},{op:'insert',text:'!'},{op:'equal',text:'c'}]);
  expect(pendingDiffParts({ ...value, new_context: { ...value.new_context, text: 'wrong' } })).toBeNull();
  expect(pendingDiffParts({ ...value, diff: [{ ...value.diff[0], old_start: 99 }, ...value.diff.slice(1)] })).toBeNull();
});
it('keeps malformed contexts unavailable instead of manufacturing a highlight or diff', () => {
  const reveal = vi.fn(); render(<ReanchorPanel items={[item({ old_context: { start: 100, end: 101, text: 'corrupt' } })]} labelFor={() => null} onContext={reveal} />);
  expect(screen.getByText('Old context is unavailable.')).toBeTruthy();
  expect(screen.getByText('Text changes are unavailable.')).toBeTruthy();
});

it('keeps overlapping cues and discontiguous mentions at nonzero absolute context bases',()=>{
  const value=item({old_context:{start:50,end:57,text:'A😀BCDEF'},old_mentions:[
    {source_ref:{evidence_id:'one',version:'v'},segments:[{start:51,end:54,text:'😀BC'},{start:55,end:57,text:'EF'}],cue_segments:[{start:52,end:55,text:'BCD'}]},
    {source_ref:{evidence_id:'two',version:'v'},segments:[],cue_segments:[{start:50,end:51,text:'A'}]},
  ]});
  const mounted=render(<ReanchorPanel items={[value]} labelFor={()=>null} onContext={()=>{}}/>);
  expect(mounted.container.querySelector('[data-old-context]')?.textContent).toBe('A😀BCDEF');
  expect(mounted.container.querySelector('[data-old-kind="mention cue"]')?.textContent).toBe('BC');
  expect([...mounted.container.querySelectorAll('[data-old-kind="mention"]')].map(node=>node.textContent)).toEqual(['😀','EF']);
});

it('keeps the term ID beside the resolved label and provides a native collapsible pending section',()=>{
  const mounted=render(<ReanchorPanel items={[item()]} labelFor={()=> 'Finding'} onContext={()=>{}}/>);
  expect(screen.getByRole('button',{name:'Finding'}).title).toBe('Finding (HP:1), hpo');
  expect(screen.getByText('Finding (HP:1), hpo')).toBeTruthy();
  const details=mounted.container.querySelector('details')!;
  expect(details.open).toBe(true);
  fireEvent.click(mounted.container.querySelector('summary')!);
  expect(details.open).toBe(false);
});

it('shows unknown reason codes literally and never resolves inherited object keys',()=>{
  const unknown=(reason:string)=>item({source_ref:{annotation_id:reason,version:'v1'},reason:reason as ReturnType<typeof item>['reason']});
  const mounted=render(<ReanchorPanel items={[item(),unknown('<img src=x onerror=alert(1)>'),unknown('toString'),unknown('__proto__')]} labelFor={()=>null} onContext={()=>{}}/>);
  expect(screen.getByRole('heading',{name:'Needs review after the text change (4)'})).toBeTruthy();
  expect(screen.getByText('The evidence text changed.')).toBeTruthy();
  expect(screen.getByText('Unknown reason: <img src=x onerror=alert(1)>')).toBeTruthy();
  expect(screen.getByText('Unknown reason: toString')).toBeTruthy();
  expect(screen.getByText('Unknown reason: __proto__')).toBeTruthy();
  expect(mounted.container.querySelector('img')).toBeNull();
  expect(screen.getAllByRole('button')).toHaveLength(4);
});
it('names a changed modifier text as the reason', () => {
  render(<ReanchorPanel items={[item({ reason: 'changed_modifier_segment' })]} labelFor={() => null} onContext={() => {}} />);
  expect(screen.getByText('The text of a modifier changed.')).toBeTruthy();
});
it('names each old modifier text that needs checking', () => {
  render(<ReanchorPanel items={[item({ reason: 'changed_modifier_segment', old_modifiers: [
    { term_id: 'HP:0012828', segments: [{ start: 0, end: 7, text: 'schwere' }] },
    { term_id: 'HP:0031796', segments: [] },
  ] })]} labelFor={(_layer, term) => term === 'HP:0012828' ? 'Severe' : null} onContext={() => {}} />);
  expect(screen.getByText('Text of Severe changed: “schwere”')).toBeTruthy();
  expect(screen.queryByText(/Text of HP:0031796/)).toBeNull();
});
it('names old modifier texts only when a modifier text changed', () => {
  render(<ReanchorPanel items={[item({ reason: 'changed_segment', old_modifiers: [
    { term_id: 'HP:0012828', segments: [{ start: 0, end: 7, text: 'schwere' }] },
  ] })]} labelFor={() => 'Severe'} onContext={() => {}} />);
  expect(screen.queryByText(/Text of Severe/)).toBeNull();
});

it('offers a suggested place first: Use this location, the next place, and Mark in text', () => {
  const places = [[{ start: 20, end: 21, text: '😀' }], [{ start: 40, end: 41, text: '😀' }]];
  const use = vi.fn(), select = vi.fn(), recreate = vi.fn();
  const mounted = render(<ReanchorPanel items={[item({ suggestions: places })]} labelFor={() => 'Finding'} onContext={() => {}}
    onUseLocation={use} onSelect={select} onRecreate={recreate} onDismiss={async () => {}} selectedKey={JSON.stringify([4, 'source/1', 'v1'])} placeOf={() => 1} />);
  const actions = [...mounted.container.querySelectorAll('.reanchor-row__actions button')].map(button => button.getAttribute('aria-label') ?? button.textContent);
  expect(actions).toEqual(['Use this location', 'Next place (2 of 2)', 'Mark in text', 'Dismiss…']);
  // Issue 652: the button shows only the count, so that it fits beside "Use this location".
  expect(screen.getByRole('button', { name: 'Next place (2 of 2)' }).textContent).toBe('2 of 2 ›');
  expect(mounted.container.querySelector('[data-reanchor-primary]')?.textContent).toBe('Use this location');
  expect(mounted.container.querySelector('li')?.getAttribute('aria-current')).toBe('true');
  fireEvent.click(screen.getByRole('button', { name: 'Use this location' }));
  expect(use).toHaveBeenCalledWith(item({ suggestions: places }), 1);
  fireEvent.click(screen.getByRole('button', { name: 'Next place (2 of 2)' }));
  expect(select).toHaveBeenCalledWith(item({ suggestions: places }), 0);
  fireEvent.click(screen.getByRole('button', { name: 'Finding' }));
  expect(select).toHaveBeenLastCalledWith(item({ suggestions: places }));
});
it('names the new wording, or says that the words are not found, without a suggested place', () => {
  const mounted = render(<ReanchorPanel items={[item({ changed_at: { start: 20, end: 24, text: '😀new' } }), item({ proposal_set_id: 5 })]}
    labelFor={() => null} onContext={() => {}} onRecreate={() => {}} />);
  expect([...mounted.container.querySelectorAll('.reanchor-row__now')].map(node => node.textContent))
    .toEqual([' now “😀new”', ' · not found in the corrected text']);
  expect(screen.queryByRole('button', { name: 'Use this location' })).toBeNull();
  expect([...mounted.container.querySelectorAll('[data-reanchor-primary]')].map(node => node.textContent)).toEqual(['Mark in text', 'Mark in text']);
});

// Issue 652: a reordered sentence. The old window and the window at place 1 are compared around the moved word.
it('compares and marks the contexts at the place in use, not word by word from their starts', () => {
  const was = 'Physiotherapie wurde begonnen, nachdem eine Areflexie bemerkt wurde.';
  const now = 'und eine leichte Hörminderung.\n\nAls eine Areflexie auffiel, wurde die Physiotherapie begonnen.';
  const at = 200 + now.indexOf('Areflexie'), oldAt = 50 + was.indexOf('Areflexie');
  const value = item({
    old_context: { start: 50, end: 50 + was.length, text: was }, new_context: { start: 200, end: 200 + now.length, text: now },
    old_mentions: [{ source_ref: { evidence_id: 'ev', version: 'e1' }, segments: [{ start: oldAt, end: oldAt + 9, text: 'Areflexie' }], cue_segments: [] }],
    suggestions: [[{ start: at, end: at + 9, text: 'Areflexie' }]],
    diff: [{ op: 'replace', old_start: 50, old_end: 50 + was.length, new_start: 200, new_end: 200 + now.length, old_text: was, new_text: now }],
  });
  const parts = anchoredDiffParts(value)!;
  expect(parts.filter(part => part.op !== 'insert').map(part => part.text).join('')).toBe(was);
  expect(parts.filter(part => part.op !== 'delete').map(part => part.text).join('')).toBe(now);
  // The moved word is one equal part: the words before it are compared with those before it.
  const index = parts.findIndex(part => part.op === 'equal' && part.text.includes('Areflexie'));
  expect(parts.slice(0, index).filter(part => part.op !== 'insert').map(part => part.text).join('') + parts[index].text.split('Areflexie')[0])
    .toBe(was.slice(0, was.indexOf('Areflexie')));
  const mounted = render(<ReanchorPanel items={[value]} labelFor={() => 'Areflexia'} onContext={() => {}} />);
  const marked = mounted.container.querySelector('[data-current-context] mark');
  expect(marked?.textContent).toBe('Areflexie');
  expect(mounted.container.querySelector('[data-current-context]')?.textContent).toBe(now);
  // Without a place or new wording in the window there is no anchor: the whole windows are compared.
  expect(anchoredDiffParts(item())).toBeNull();
});
