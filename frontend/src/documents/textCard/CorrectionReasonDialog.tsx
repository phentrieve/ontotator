import { useId, useRef, useState } from "react";
import { api, type DocumentRowView } from "../../api/client";
import { ErrorNotice } from "../../admin/ErrorNotice";
import { formatTime } from "../../app/submissionLabels";
import { Button, Dialog, Textarea } from "../../ui";
import { shortName } from "../stageLabels";

type CorrectionRequest = NonNullable<DocumentRowView["work"][number]["correction_request"]>;

type Addition = NonNullable<CorrectionRequest["additions"]>[number];

/** "Added by you on 19 Nov 2026, 10:12: Paragraph 3 as well." (the lead's view of one addition). */
export function additionLine(addition: Addition): string {
  const by = addition.added_by ? (addition.added_by.is_me ? "you" : shortName(addition.added_by)) : null;
  return `Added${by ? ` by ${by}` : ""} on ${formatTime(addition.added_at)}: ${addition.note}`;
}

/**
 * The reason of "Ask a reviewer to correct…" at the reviewer's row of the text card, with what the lead added to it
 * since (issue 483), oldest first.
 */
export function CorrectionRequestReason({ request }: { request: CorrectionRequest }): JSX.Element {
  // Spans: it also stands in the details line of the reviewer's row.
  return <span className="documents-review-reason correction-request-reason" role="note" aria-label="Reason of the correction request">
    <span>{`Correction requested on ${formatTime(request.requested_at)}:`}</span>
    <span className="correction-request-quote">{`“${request.reason}”`}</span>
    {(request.additions ?? []).map((addition, index) => <span key={index}>{additionLine(addition)}</span>)}
  </span>;
}

/**
 * "Add to the reason…" (issue 483): the lead adds a note to the reason of an open correction request. The reason as
 * sent is not changed; the reviewer reads the addition below it, with its date.
 */
export function CorrectionReasonDialog({ assignmentId, name, request, onCancel, onAdded }: {
  assignmentId: number;
  /** The reviewer's name ("Ana Weber"). */
  name: string;
  request: CorrectionRequest;
  onCancel: () => void;
  onAdded: () => void;
}): JSX.Element {
  const fieldId = useId();
  const writing = useRef(false);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>();
  const add = async () => {
    if (!note.trim() || writing.current) return;
    writing.current = true;
    setBusy(true);
    setError(undefined);
    try {
      await api.addCorrectionReason(assignmentId, note.trim());
      onAdded();
    } catch (failure) {
      setError(failure);
      setBusy(false);
    } finally {
      writing.current = false;
    }
  };
  // Issue 547, U2-08: the grey button says why it is grey, as the other dialogs do.
  const empty = !note.trim();
  return <Dialog open title="Add to the reason" size="md" onClose={busy ? undefined : onCancel}
    footer={<>{empty && <span id={`${fieldId}-reason`} className="dialog-footer-reason">Enter an addition first.</span>}
      <Button disabled={busy} onClick={onCancel}>Cancel</Button>
      <Button variant="primary" disabled={empty || busy} loading={busy} aria-describedby={empty ? `${fieldId}-reason` : undefined} onClick={() => { void add(); }}>Add to the reason</Button></>}>
    <div className="correction-reason-dialog">
      <p>{`${name} reads your addition below the reason, with its date. The reason as sent stays as it is.`}</p>
      <CorrectionRequestReason request={request} />
      <Textarea id={`${fieldId}-note`} label="Addition to the reason" value={note} disabled={busy} maxLength={2000} onChange={event => setNote(event.target.value)} />
      {error !== undefined && <ErrorNotice error={error} />}
    </div>
  </Dialog>;
}
