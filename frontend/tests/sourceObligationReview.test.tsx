import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { api, ApiError, type SourceObligationView } from '../src/api/client';
import { TranslationReviewScreen } from '../src/translation/TranslationReviewScreen';
import { reviewRecord, reviewWorkspace } from './translationFixtures';
import { shownText } from './support/shownText';

const cause: SourceObligationView = { cause_id: 'exact-cause', cause_revision: 1, code: 'SOURCE_UPDATE_UNREVIEWED', case_id: 'case', language: 'de', document_id: 'target',
  old_source_document_id: 'original-v1', new_source_document_id: 'original-v2', translation_text_sha256: 'sha', old_source_text_sha256: 'old-hash', new_source_text_sha256: 'new-hash',
  reason: 'Original source wording changed', destination: '#/tasks/17', old_source_text: 'Original source: no seizures.', new_source_text: 'Updated source: seizures.' };
beforeEach(() => {
  vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() })));
  vi.spyOn(api, 'openTranslationReview').mockResolvedValue(reviewWorkspace());
  vi.spyOn(api, 'listSourceObligations').mockResolvedValue([cause]);
  vi.spyOn(api, 'saveTranslationReviewDraft').mockResolvedValue({ revision: 41 });
  vi.spyOn(api, 'resolveSourceObligation').mockImplementation(async () => {
    vi.mocked(api.listSourceObligations).mockResolvedValue([]);
    return reviewRecord({ decision: 'accepted_unchanged', proposed_text: 'Übersetzt.', created_variant_id: null });
  });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers(); });

it('shows old and updated sources before deliberately saving/submitting the exact no-change resolution', async () => {
  const ordinarySubmit = vi.spyOn(api, 'submitTranslationReview');
  render(<TranslationReviewScreen assignmentId={17} username="alice" onNavigate={vi.fn()} routeLeaveRef={{ current: null }} leaveGuardRef={{ current: null }} />);
  await screen.findByText(cause.reason);
  expect(api.resolveSourceObligation).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('radio', { name: 'Accepted unchanged' }));
  fireEvent.change(screen.getByRole('textbox', { name: 'Rationale' }), { target: { value: 'Units checked' } });
  await waitFor(() => expect(api.saveTranslationReviewDraft).toHaveBeenCalled());
  fireEvent.click(screen.getByRole('button', { name: 'Review source update to original-v2' }));
  const dialog = await screen.findByRole('dialog', { name: 'Review source update' });
  expect(document.activeElement?.textContent).toContain('Compare the original and updated source');
  expect(within(dialog).getByText(cause.old_source_text)).toBeTruthy();
  // The updated source marks the differences with the review's word diff.
  const updated = within(dialog).getByRole('region', { name: 'Updated source' });
  expect([...updated.querySelectorAll('del')].map(shownText).join('|')).toBe('Original|no ');
  expect([...updated.querySelectorAll('ins')].map(node => node.textContent).join('|')).toBe('Updated');
  // Deleted words are generated content: the text itself, which find and copy see, is the updated source (issue 533).
  expect(updated.textContent).toBe(cause.new_source_text);
  expect(within(dialog).getByText('In the updated source, added text is underlined and removed text is struck through.')).toBeTruthy();
  expect(within(dialog).getByText('Übersetzt.')).toBeTruthy();
  fireEvent.click(within(dialog).getByRole('button', { name: 'Submit review and resolve source update' }));
  await waitFor(() => expect(api.resolveSourceObligation).toHaveBeenCalledWith(17, 'exact-cause', {
    expected_revision: 41, translation_text_sha256: 'sha', old_source_text_sha256: 'old-hash', new_source_text_sha256: 'new-hash',
  }));
  await screen.findByText('Review submitted');
  expect(ordinarySubmit).not.toHaveBeenCalled();
  expect(screen.queryByRole('dialog', { name: 'Review source update' })).toBeNull();
});

it('retains the same unresolved cause and current draft after a refused exact resolution', async () => {
  vi.mocked(api.openTranslationReview).mockResolvedValue(reviewWorkspace({ draft: { text: 'Übersetzt.', form: { decision: 'accepted_unchanged', clinical_change: false, rationale: 'Units checked' }, revision: 6 } }));
  vi.mocked(api.resolveSourceObligation).mockRejectedValue(new ApiError(409, 'Source update changed elsewhere', 'REVISION_CONFLICT'));
  render(<TranslationReviewScreen assignmentId={17} username="alice" onNavigate={vi.fn()} routeLeaveRef={{ current: null }} leaveGuardRef={{ current: null }} />);
  fireEvent.click(await screen.findByRole('button', { name: 'Review source update to original-v2' }));
  const dialog = await screen.findByRole('dialog', { name: 'Review source update' });
  fireEvent.click(within(dialog).getByRole('button', { name: 'Submit review and resolve source update' }));
  await within(dialog).findByRole('alert');
  expect(api.resolveSourceObligation).toHaveBeenCalledTimes(1);
  expect(within(dialog).getByRole('region', { name: 'Updated source' }).querySelector('ins')!.textContent).toBe('Updated');
  expect(screen.getByRole('textbox', { name: 'Translation (de)' })).toHaveProperty('value', 'Übersetzt.');
});

it('resolves a corrected draft using the immutable cause translation pin and its saved draft revision', async () => {
  vi.mocked(api.openTranslationReview).mockResolvedValue(reviewWorkspace({ draft: { text: 'Neue Übersetzung.', form: { decision: 'accepted_corrected', clinical_change: false }, revision: 18 } }));
  vi.mocked(api.resolveSourceObligation).mockImplementation(async () => {
    vi.mocked(api.listSourceObligations).mockResolvedValue([]);
    return reviewRecord({ decision: 'accepted_corrected', proposed_text: 'Neue Übersetzung.', created_variant_id: null });
  });
  render(<TranslationReviewScreen assignmentId={17} username="alice" onNavigate={vi.fn()} routeLeaveRef={{ current: null }} leaveGuardRef={{ current: null }} />);
  fireEvent.click(await screen.findByRole('button', { name: 'Review source update to original-v2' }));
  const dialog = await screen.findByRole('dialog', { name: 'Review source update' });
  expect(within(dialog).getByText('Neue Übersetzung.')).toBeTruthy();
  fireEvent.click(within(dialog).getByRole('button', { name: 'Submit review and resolve source update' }));
  await screen.findByText('Review submitted');
  expect(api.resolveSourceObligation).toHaveBeenCalledWith(17, 'exact-cause', { expected_revision: 18, translation_text_sha256: 'sha', old_source_text_sha256: 'old-hash', new_source_text_sha256: 'new-hash' });
});

it('names the open source update in the submit confirmation and leads to it instead of submitting past it', async () => {
  vi.mocked(api.openTranslationReview).mockResolvedValue(reviewWorkspace({ draft: { text: 'Übersetzt.', form: { decision: 'accepted_unchanged', clinical_change: false, rationale: 'Units checked' }, revision: 6 } }));
  const ordinarySubmit = vi.spyOn(api, 'submitTranslationReview').mockResolvedValue(reviewRecord({ decision: 'accepted_unchanged', created_variant_id: null }));
  render(<TranslationReviewScreen assignmentId={17} username="alice" onNavigate={vi.fn()} routeLeaveRef={{ current: null }} leaveGuardRef={{ current: null }} />);
  await screen.findByRole('button', { name: 'Review source update to original-v2' });
  fireEvent.click(screen.getByRole('button', { name: 'Submit review…' }));
  const confirm = await screen.findByRole('dialog', { name: 'Submit this review?' });
  const warning = within(confirm).getByRole('alert');
  expect(warning.textContent).toContain('1 source update is not reviewed.');
  expect(warning.textContent).toContain('leaves the update open');
  // The confirm button says what it does and is not the focused default.
  const submitAnyway = within(confirm).getByRole('button', { name: 'Submit without the source update' });
  expect(within(confirm).queryByRole('button', { name: 'Submit review' })).toBeNull();
  expect(document.activeElement).not.toBe(submitAnyway);
  fireEvent.click(within(warning).getByRole('button', { name: 'Review source update' }));
  expect(screen.queryByRole('dialog', { name: 'Submit this review?' })).toBeNull();
  expect(await screen.findByRole('dialog', { name: 'Review source update' })).toBeTruthy();
  expect(ordinarySubmit).not.toHaveBeenCalled();
});

it('does not warn about the source update when the decision does not accept the translation', async () => {
  vi.mocked(api.openTranslationReview).mockResolvedValue(reviewWorkspace({ draft: { text: 'Übersetzt.', form: { decision: 'rejected', clinical_change: true, categories: ['value'], rationale: 'Wrong dose' }, revision: 6 } }));
  render(<TranslationReviewScreen assignmentId={17} username="alice" onNavigate={vi.fn()} routeLeaveRef={{ current: null }} leaveGuardRef={{ current: null }} />);
  await screen.findByRole('button', { name: 'Review source update to original-v2' });
  fireEvent.click(screen.getByRole('button', { name: 'Submit review…' }));
  const confirm = await screen.findByRole('dialog', { name: 'Submit this review?' });
  expect(within(confirm).queryByRole('alert')).toBeNull();
  expect(within(confirm).getByRole('button', { name: 'Submit review' })).toBeTruthy();
});
