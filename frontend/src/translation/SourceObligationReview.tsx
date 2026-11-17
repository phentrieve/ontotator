import { useEffect, useRef, useState, type MutableRefObject } from 'react';
import { api, type SourceObligationView } from '../api/client';
import { ErrorNotice } from '../admin/ErrorNotice';
import { Button, Dialog, InlineMessage } from '../ui';
import { DiffView, TextView } from './DiffView';

interface Props {
  assignmentId: number; username: string; documentId: string; translationText: string;
  canResolve: boolean; busy: boolean; readOnly: boolean; error: unknown;
  onResolve: (cause: SourceObligationView) => Promise<boolean>;
  /** Told how many source updates of this translation are not reviewed, so the ordinary submit can name them. */
  onPending?: (count: number) => void;
  /** Set to a function that opens the dialog of the first open source update (from the submit confirmation). */
  openRef?: MutableRefObject<(() => void) | null>;
}
export function SourceObligationReview(props: Props): JSX.Element | null {
  return <SourceReview key={JSON.stringify([props.assignmentId, props.username, props.documentId])} {...props} />;
}
function SourceReview({ assignmentId, documentId, translationText, canResolve, busy, readOnly, error, onResolve, onPending, openRef }: Props): JSX.Element | null {
  const [causes, setCauses] = useState<SourceObligationView[] | null>(null), [loadError, setLoadError] = useState<unknown>();
  const [attempt, setAttempt] = useState(0), [selected, setSelected] = useState<SourceObligationView | null>(null);
  const active = useRef(false), writing = useRef(false), introduction = useRef<HTMLParagraphElement>(null);
  useEffect(() => { active.current = true; return () => { active.current = false; }; }, []);
  useEffect(() => {
    let live = true; setLoadError(undefined);
    api.listSourceObligations(assignmentId).then(value => { if (live) setCauses(value.filter(cause => cause.document_id === documentId)); }, failure => { if (live) setLoadError(failure); });
    return () => { live = false; };
  }, [assignmentId, documentId, attempt]);
  const pending = causes?.length ?? 0;
  useEffect(() => { onPending?.(pending); }, [onPending, pending]);
  useEffect(() => {
    if (!openRef) return;
    const openFirst = () => { if (causes?.[0]) setSelected(causes[0]); };
    openRef.current = openFirst;
    return () => { if (openRef.current === openFirst) openRef.current = null; };
  }, [openRef, causes]);
  const resolve = async () => {
    if (!selected || !canResolve || busy || readOnly || writing.current) return;
    writing.current = true;
    try { if (await onResolve(selected) && active.current) { setSelected(null); setAttempt(value => value + 1); } }
    finally { writing.current = false; }
  };
  if (!selected && !loadError && (!causes || causes.length === 0)) return null;
  return <section className="review-history source-obligation-review" aria-label="Source updates to review"><h3>Source updates to review</h3>
    {loadError != null && <><ErrorNotice error={loadError} /><Button onClick={() => setAttempt(value => value + 1)}>Reload source updates</Button></>}
    {causes?.map(cause => <div key={cause.cause_id}><p>{cause.reason}</p><Button size="sm" disabled={busy || readOnly}
      aria-label={`Review source update to ${cause.new_source_document_id}`} onClick={() => setSelected(cause)}>Review source update</Button></div>)}
    {readOnly && !!causes?.length && <InlineMessage tone="info">This submitted review cannot resolve another source update. Ask your lead for another translation review.</InlineMessage>}
    {selected && <Dialog open size="lg" title="Review source update" initialFocus={introduction} onClose={busy ? undefined : () => setSelected(null)} footer={<>
      <Button disabled={busy} onClick={() => setSelected(null)}>Keep editing</Button>
      <Button variant="primary" disabled={!canResolve || busy || readOnly} loading={busy} onClick={() => { void resolve(); }}>Submit review and resolve source update</Button>
    </>}>
      <p>{selected.reason}</p><p ref={introduction} tabIndex={-1}>Compare the original and updated source with your current translation. Submitting records your review and resolves only this source update.</p>
      <div className="translation-columns">
        <section className="translation-column"><h3>Original source</h3><TextView text={selected.old_source_text} label="Original source" /></section>
        {/* The word diff of the review: what the update removed is struck through, what it added is underlined. */}
        <section className="translation-column"><h3>Updated source</h3><DiffView before={selected.old_source_text} after={selected.new_source_text} label="Updated source" /></section>
      </div>
      <p className="translation-column-note">In the updated source, added text is underlined and removed text is struck through.</p>
      <section className="source-obligation-current"><h3>Current translation</h3><TextView text={translationText} label="Current translation" /></section>
      {!canResolve && !busy && <InlineMessage tone="info">Choose an accepted decision, complete the review, and save your changes before resolving this update.</InlineMessage>}
      {error != null && <ErrorNotice error={error} />}
      <details className="translation-details"><summary>Source update details</summary><dl>
        <dt>Original source document</dt><dd>{selected.old_source_document_id}</dd><dt>Original source hash</dt><dd>{selected.old_source_text_sha256}</dd>
        <dt>Updated source document</dt><dd>{selected.new_source_document_id}</dd><dt>Updated source hash</dt><dd>{selected.new_source_text_sha256}</dd>
        <dt>Translation hash</dt><dd>{selected.translation_text_sha256}</dd><dt>Cause</dt><dd>{selected.cause_id}</dd>
      </dl></details>
    </Dialog>}
  </section>;
}
