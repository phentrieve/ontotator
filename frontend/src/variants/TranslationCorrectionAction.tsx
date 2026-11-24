import { useEffect, useId, useRef, useState, type RefObject } from 'react';
import { personLabel } from '../app/identity';
import { api, ApiError, type AssignmentView, type Member, type VariantSummary } from '../api/client';
import { eligibleMembers, unreadLanguages } from '../admin/assignmentUI';
import { ErrorNotice } from '../admin/ErrorNotice';
import { Button, Checkbox, Dialog, InlineMessage, Select, Textarea } from '../ui';
import { onSpaceActivate } from '../ui/spaceActivates';
import { notifyFinalSelectionChanged } from './finalSelectionState';

interface Props {
  projectKey: string; variant: VariantSummary; username: string; requiredLanguages: readonly string[] | null;
  /** Starts with the form open (the Documents row menu already asked), skipping the button. */
  defaultOpen?: boolean;
  /** The reviewer was asked (the dialog then offers "Close"). */
  onAssigned?: () => void;
}
/** Issue 341 b: a lead correction of this version is open; a second review of it is refused. */
export const LEAD_CORRECTING = 'A lead is correcting this version. Ask a reviewer after that correction is submitted, or withdraw it with Remove… in the lead’s row of the Translation part.';
function leadCorrecting(error: unknown): boolean {
  if (!(error instanceof ApiError) || error.code !== 'ASSIGNMENT_EXISTS') return false;
  const details = error.details;
  return typeof details === 'object' && details !== null && (details as { reason?: unknown }).reason === 'lead_correction_open';
}

export function TranslationCorrectionAction(props: Props): JSX.Element | null {
  if (props.variant.translation_status !== 'accepted') return null;
  return <CorrectionContent key={JSON.stringify([props.projectKey, props.variant.document_id, props.variant.text_sha256, props.username])} {...props} />;
}

type FormProps = Pick<Props, 'projectKey' | 'variant' | 'requiredLanguages' | 'onAssigned'> & { open: boolean };

/** Reviewers who read every required language first; the others keep their place after them (issue 613). */
function byLanguages(members: readonly Member[], required: readonly string[]): Member[] {
  const missing = (member: Member) => unreadLanguages(member.languages, required).length > 0;
  return [...members.filter(member => !missing(member)), ...members.filter(missing)];
}

/** The form's state, shared by the inline form and the dialog. */
function useCorrectionForm({ projectKey, variant, requiredLanguages, onAssigned, open }: FormProps) {
  const active = useRef(false), writing = useRef(false);
  const [attempt, setAttempt] = useState(0);
  const [members, setMembers] = useState<Member[] | null>(null), [error, setError] = useState<unknown>();
  const [reviewer, setReviewer] = useState(''), [reason, setReason] = useState('');
  const [confirmLanguage, setConfirmLanguage] = useState(false), [busy, setBusy] = useState(false);
  const [assigned, setAssigned] = useState<AssignmentView>();
  const reviewers = byLanguages(eligibleMembers(members ?? [], 'translation_review'), requiredLanguages ?? []);
  const member = reviewers.find(row => row.username === reviewer);
  const missingLanguages = member ? unreadLanguages(member.languages, requiredLanguages ?? []) : [];
  useEffect(() => { active.current = true; return () => { active.current = false; }; }, []);
  useEffect(() => {
    if (!open) return;
    let live = true; setMembers(null); setError(undefined);
    api.listMembers(projectKey).then(value => { if (live) setMembers(value); }, failure => { if (live) setError(failure); });
    return () => { live = false; };
  }, [open, projectKey, attempt]);
  /** Issue 613: what is still missing, said where the button is (it stays focusable, aria-disabled). */
  const missing = !requiredLanguages ? 'The source lineage is unavailable.'
    : !member && !reason.trim() ? 'Choose a reviewer and enter a reason.'
    : !member ? 'Choose a reviewer.'
    : !reason.trim() ? 'Enter a reason for another review.'
    : missingLanguages.length > 0 && !confirmLanguage ? `Tick the box to assign despite missing ${missingLanguages.join(', ')}.` : null;
  const assign = async () => {
    if (missing || !member || writing.current) return;
    writing.current = true; setBusy(true); setError(undefined);
    try {
      const value = await api.assignTranslationCorrection(projectKey, variant.document_id, { username: reviewer, expected_text_sha256: variant.text_sha256,
        reason: reason.trim(), confirm_language: missingLanguages.length > 0 && confirmLanguage });
      notifyFinalSelectionChanged(projectKey);
      if (active.current) { setAssigned(value); onAssigned?.(); }
    } catch (failure) { if (active.current) setError(failure); }
    finally { writing.current = false; if (active.current) setBusy(false); }
  };
  return { members, error, reviewer, setReviewer, reason, setReason, confirmLanguage, setConfirmLanguage, busy, assigned, reviewers, member,
    missingLanguages, missing, assign, reload: () => setAttempt(value => value + 1), requiredLanguages };
}
type Form = ReturnType<typeof useCorrectionForm>;

function CorrectionFields({ form, fieldId, username, selectRef }: { form: Form; fieldId: string; username: string; selectRef?: RefObject<HTMLSelectElement> }): JSX.Element {
  const { members, error, member, reviewer, reviewers, busy, reason, missingLanguages, confirmLanguage, assigned, requiredLanguages } = form;
  return <>
    {!assigned && <p>Review this exact accepted text again. A submitted correction creates a separate text version and keeps the earlier review.</p>}
    {!requiredLanguages && <InlineMessage tone="warning">The exact source lineage is unavailable. Reload the text metadata before assigning another review.</InlineMessage>}
    {!members && error == null && <InlineMessage tone="info">Loading translation reviewers…</InlineMessage>}
    {!assigned && members && <>
      <Select ref={selectRef} id={`${fieldId}-reviewer`} label="Translation reviewer" value={member ? reviewer : ''} disabled={busy}
        onChange={event => { form.setReviewer(event.target.value); form.setConfirmLanguage(false); }}><option value="">Choose a reviewer</option>
        {reviewers.map(row => {
          // Issue 613: a reviewer whose profile lacks a language of this text says so in the list.
          const unread = unreadLanguages(row.languages, requiredLanguages ?? []);
          return <option key={row.username} value={row.username}>{`${personLabel(row)}${unread.length ? `, does not read ${unread.join(', ')}` : ''}`}</option>;
        })}
      </Select>
      <Textarea id={`${fieldId}-reason`} label="Reason for another review" value={reason} disabled={busy} onChange={event => form.setReason(event.target.value)} />
      {missingLanguages.length > 0 && <Checkbox id={`${fieldId}-language`} label={`Assign despite missing ${missingLanguages.join(', ')} in this reviewer's profile`}
        checked={confirmLanguage} disabled={busy} onChange={event => form.setConfirmLanguage(event.target.checked)} />}
    </>}
    {leadCorrecting(error) ? <InlineMessage tone="warning">{LEAD_CORRECTING}</InlineMessage> : error != null && <ErrorNotice error={error} />}
    {error != null && <>{!members && <Button onClick={form.reload}>Reload translation reviewers</Button>}</>}
    {assigned && <InlineMessage tone="success">{personLabel(member, { fallback: 'The reviewer' })} was asked to correct the translation.
      {assigned.username === username && <> <a className="btn btn-secondary btn-sm" href={`#/tasks/${assigned.id}`} onKeyDown={onSpaceActivate}>Open my translation review</a></>}
    </InlineMessage>}
  </>;
}

/** "Ask the reviewer": the primary action, aria-disabled with what is missing (issue 613). */
function AskButton({ form, reasonId }: { form: Form; reasonId: string }): JSX.Element {
  return <>
    {form.missing && form.members && <span id={reasonId} className="dialog-footer-reason">{form.missing}</span>}
    <Button variant="primary" loading={form.busy} aria-disabled={form.missing ? 'true' : undefined} aria-describedby={form.missing && form.members ? reasonId : undefined}
      onClick={() => { void form.assign(); }}>Ask the reviewer</Button>
  </>;
}

function CorrectionContent({ projectKey, variant, username, requiredLanguages, defaultOpen = false, onAssigned }: Props): JSX.Element {
  const fieldId = useId();
  const [open, setOpen] = useState(defaultOpen);
  const form = useCorrectionForm({ projectKey, variant, requiredLanguages, onAssigned, open });
  if (!open) return <Button size="sm" onClick={() => setOpen(true)}>Ask a reviewer to correct…</Button>;
  return <section className="detail-section" aria-label="Ask a reviewer to correct">
    <h3>{form.assigned ? 'Reviewer asked to correct' : 'Ask a reviewer to correct'}</h3>
    <CorrectionFields form={form} fieldId={fieldId} username={username} />
    {!form.assigned && form.members && <div className="toolbar"><AskButton form={form} reasonId={`${fieldId}-missing`} /></div>}
  </section>;
}

/**
 * Issue 613: "Ask a reviewer to correct…" from Documents as a dialog of its own: focus starts at the reviewer, the
 * primary "Ask the reviewer" is in the footer and says what is missing, and after it the focus moves to Close.
 */
export function AskReviewerDialog({ title, onClose, returnFocus, ...props }: Omit<Props, 'defaultOpen'> & {
  title: string; onClose: () => void; returnFocus?: () => HTMLElement | null | undefined;
}): JSX.Element {
  const fieldId = useId();
  const select = useRef<HTMLSelectElement>(null), close = useRef<HTMLButtonElement>(null);
  const form = useCorrectionForm({ ...props, open: true });
  const done = !!form.assigned;
  useEffect(() => { if (done) close.current?.focus(); }, [done]);
  // The reviewer list arrives after the dialog opens: focus moves to it once, unless the person left the dialog.
  const loaded = form.members !== null;
  useEffect(() => {
    if (!loaded) return;
    const current = document.activeElement;
    if (!current || current === document.body || current.closest('.ui-dialog')) select.current?.focus();
  }, [loaded]);
  return <Dialog open title={title} size="md" onClose={onClose} returnFocus={returnFocus} footer={done
    ? <Button ref={close} onClick={onClose}>Close</Button>
    : <>{form.members && props.variant.translation_status === 'accepted' && <AskButton form={form} reasonId={`${fieldId}-missing`} />}<Button onClick={onClose}>Cancel</Button></>}>
    <section aria-label="Ask a reviewer to correct">
      {props.variant.translation_status === 'accepted' ? <CorrectionFields form={form} fieldId={fieldId} username={props.username} selectRef={select} />
        : <InlineMessage tone="info">Only an accepted translation can be sent for correction.</InlineMessage>}
    </section>
  </Dialog>;
}
