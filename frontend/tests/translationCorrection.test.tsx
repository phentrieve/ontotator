import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { api, ApiError } from '../src/api/client';
import { TranslationCorrectionAction } from '../src/variants/TranslationCorrectionAction';
import { variant } from './variantFixtures';
import { assignment } from './assignmentFixtures';

const document = variant('accepted-corrected', { origin: 'correction', version: 3, translation_status: 'accepted', text_sha256: 'immutable-text-hash' });
const props = { projectKey: 'p', variant: document, username: 'lead', requiredLanguages: ['en', 'de'] };
beforeEach(() => {
  vi.spyOn(api, 'listMembers').mockResolvedValue([{ username: 'reviewer', display_name: 'Bilingual reviewer', pseudonym: 'R', roles: ['annotator'], languages: ['en', 'de'] }]);
  vi.spyOn(api, 'assignTranslationCorrection').mockResolvedValue({ ...assignment, id: 27, task: 'translation_review', project_key: 'p', document_id: document.document_id, username: 'reviewer' });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

it('requests a repeat review of the exact accepted corrected text only after reviewer and reason are explicit', async () => {
  const genericAssign = vi.spyOn(api, 'createAssignments');
  render(<TranslationCorrectionAction {...props} />);
  expect(api.listMembers).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Ask a reviewer to correct…' }));
  await screen.findByLabelText('Translation reviewer');
  expect(screen.getByRole('button', { name: 'Ask the reviewer' })).toHaveProperty('disabled', true);
  fireEvent.change(screen.getByLabelText('Translation reviewer'), { target: { value: 'reviewer' } });
  fireEvent.change(screen.getByLabelText('Reason for another review'), { target: { value: 'Check the source wording again' } });
  fireEvent.click(screen.getByRole('button', { name: 'Ask the reviewer' }));
  await screen.findByText(/Bilingual reviewer.* was asked to correct the translation/);
  expect(api.assignTranslationCorrection).toHaveBeenCalledWith('p', 'accepted-corrected', { username: 'reviewer', expected_text_sha256: 'immutable-text-hash', reason: 'Check the source wording again', confirm_language: false });
  expect(genericAssign).not.toHaveBeenCalled();
});

it('keeps the exact identity and reason after a stale correction request without choosing a newer version', async () => {
  vi.mocked(api.assignTranslationCorrection).mockRejectedValue(new ApiError(409, 'This text has changed', 'REVISION_CONFLICT'));
  const getNewer = vi.spyOn(api, 'getCase');
  render(<TranslationCorrectionAction {...props} />);
  fireEvent.click(screen.getByRole('button', { name: 'Ask a reviewer to correct…' }));
  await screen.findByLabelText('Translation reviewer');
  fireEvent.change(screen.getByLabelText('Translation reviewer'), { target: { value: 'reviewer' } });
  fireEvent.change(screen.getByLabelText('Reason for another review'), { target: { value: 'Preserved reason' } });
  fireEvent.click(screen.getByRole('button', { name: 'Ask the reviewer' }));
  await screen.findByRole('alert');
  expect(screen.getByLabelText('Reason for another review')).toHaveProperty('value', 'Preserved reason');
  expect(api.assignTranslationCorrection).toHaveBeenCalledTimes(1);
  expect(getNewer).not.toHaveBeenCalled();
});

it('requires explicit missing-language confirmation and does not offer native text as a translation correction', async () => {
  vi.mocked(api.listMembers).mockResolvedValue([{ username: 'reviewer', display_name: 'Bilingual reviewer', pseudonym: 'R', roles: ['annotator'], languages: ['de'] }]);
  const view = render(<TranslationCorrectionAction {...props} />);
  fireEvent.click(screen.getByRole('button', { name: 'Ask a reviewer to correct…' }));
  await screen.findByLabelText('Translation reviewer');
  fireEvent.change(screen.getByLabelText('Translation reviewer'), { target: { value: 'reviewer' } });
  fireEvent.change(screen.getByLabelText('Reason for another review'), { target: { value: 'Check source wording' } });
  expect(screen.getByRole('button', { name: 'Ask the reviewer' })).toHaveProperty('disabled', true);
  fireEvent.click(screen.getByRole('checkbox', { name: /missing en/ }));
  fireEvent.click(screen.getByRole('button', { name: 'Ask the reviewer' }));
  await screen.findByText(/was asked to correct the translation/);
  expect(api.assignTranslationCorrection).toHaveBeenCalledWith('p', 'accepted-corrected', expect.objectContaining({ confirm_language: true }));
  view.rerender(<TranslationCorrectionAction {...props} variant={variant('native', { translation_status: null })} />);
  expect(screen.queryByRole('button', { name: 'Ask a reviewer to correct…' })).toBeNull();
});

it('names the step in its heading and reports the request once assigned', async () => {
  render(<TranslationCorrectionAction {...props} defaultOpen />);
  expect(screen.getByRole('heading', { name: 'Ask a reviewer to correct' })).toBeTruthy();
  expect(screen.queryByText('Another translation review')).toBeNull();
  fireEvent.change(await screen.findByLabelText('Translation reviewer'), { target: { value: 'reviewer' } });
  fireEvent.change(screen.getByLabelText('Reason for another review'), { target: { value: 'Check the source wording again' } });
  fireEvent.click(screen.getByRole('button', { name: 'Ask the reviewer' }));
  expect(await screen.findByRole('heading', { name: 'Reviewer asked to correct' })).toBeTruthy();
});

it('explains the refusal while a lead correction of the version is open', async () => {
  vi.mocked(api.assignTranslationCorrection).mockRejectedValue(new ApiError(409, 'exists', 'ASSIGNMENT_EXISTS', { reason: 'lead_correction_open' }));
  render(<TranslationCorrectionAction {...props} defaultOpen />);
  fireEvent.change(await screen.findByLabelText('Translation reviewer'), { target: { value: 'reviewer' } });
  fireEvent.change(screen.getByLabelText('Reason for another review'), { target: { value: 'Dose missing' } });
  fireEvent.click(screen.getByRole('button', { name: 'Ask the reviewer' }));
  expect(await screen.findByText(/^A lead is correcting this version\. Ask a reviewer after that correction is submitted/)).toBeTruthy();
  expect(screen.queryByText(/This task already exists/)).toBeNull();
});
