import { useEffect, useId, useRef, useState } from "react";
import { api, ApiError, type RowRefView } from "../api/client";
import { ErrorNotice } from "../admin/ErrorNotice";
import { plural } from "../app/labels";
import { Button, Checkbox, Dialog, InlineMessage } from "../ui";
import { GroupLine } from "./BulkTaskDialog";
import { finalApplyLabel, finalConsequences, finalCount, finalGroups, finalSummaryLabel, finalSummaryText, FINAL_TITLES, type FinalAction, type FinalPreview } from "./bulkFinalModel";

export interface BulkFinalDialogProps {
  projectKey: string;
  action: FinalAction;
  /** The selected texts. */
  rows: readonly RowRefView[];
  onClose: () => void;
  /** After a successful apply; the caller closes the dialog and shows the message. */
  onApplied: (result: FinalPreview) => void;
}

const CHECKING = "Checking the selected texts…";
const STALE = "The texts changed since the preview. Check the new preview.";

/**
 * "Accept agreeing results…" and "Change final…" for the selected texts, in the shared frame "bulk action with
 * preview" (issue 336 step 2; issues 354, 339 f; decisions 336-A, 336-B, 354-C): the preview grouped by consequence,
 * then the consequences step with "I understand", then the action. Applying sends the preview's token: every listed
 * text changes or none; when the texts changed meanwhile the dialog shows the new preview. "Accept agreeing results…"
 * only takes texts without a final result; "Change final…" replaces existing final results by the rule "newest
 * submission"; the message after it offers Undo (`SelectionBar`). "Accept agreeing results…" has no Undo (its
 * consequences step says how to go back). Below 700 px a full-screen sheet.
 */
export function BulkFinalDialog({ projectKey, action, rows, onClose, onApplied }: BulkFinalDialogProps): JSX.Element {
  const ids = useId().replace(/:/g, "");
  const blockedId = `${ids}-blocked`;
  const [preview, setPreview] = useState<FinalPreview | null>(null);
  const [previewError, setPreviewError] = useState<unknown>();
  const [reload, setReload] = useState(0);
  const [confirming, setConfirming] = useState(false);
  const [understood, setUnderstood] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<unknown>();
  const [notice, setNotice] = useState<string | null>(null);
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);

  const rowsKey = JSON.stringify(rows);
  const send = async (body: { preview: true } | { preview_token: string }, signal?: AbortSignal): Promise<FinalPreview> => {
    const request = { rows: [...rows], ...body };
    return action === "accept"
      ? { action, data: await api.acceptAgreeing(projectKey, request, signal) }
      : { action, data: await api.bulkChangeFinal(projectKey, { ...request, rule: "newest_submission" }, signal) };
  };

  useEffect(() => {
    const abort = new AbortController();
    setPreview(null); setPreviewError(undefined);
    send({ preview: true }, abort.signal).then(found => { if (alive.current && !abort.signal.aborted) setPreview(found); },
      (failure: unknown) => { if (alive.current && !abort.signal.aborted) setPreviewError(failure); });
    return () => abort.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- rowsKey stands for the selection
  }, [projectKey, action, rowsKey, reload]);

  const groups = preview ? finalGroups(preview) : [];
  const count = preview ? finalCount(preview) : 0;

  let blocked: string | null = null;
  if (!preview) blocked = CHECKING;
  else if (!count) blocked = finalSummaryText(preview, rows.length);
  else if (confirming && !understood) blocked = "Confirm that you understand the consequences first.";

  const apply = async () => {
    if (!preview || saving) return;
    setSaving(true); setError(undefined); setNotice(null);
    try {
      const result = await send({ preview_token: preview.data.preview_token });
      if (alive.current) onApplied(result);
    } catch (failure: unknown) {
      if (!alive.current) return;
      const details = failure instanceof ApiError && typeof failure.details === "object" && failure.details !== null ? failure.details as { preview?: FinalPreview["data"] } : null;
      if (failure instanceof ApiError && failure.code === "PREVIEW_STALE" && details?.preview) {
        setPreview({ action, data: details.preview } as FinalPreview);
        setNotice(STALE); setConfirming(false); setUnderstood(false);
      } else setError(failure);
    } finally { if (alive.current) setSaving(false); }
  };
  const primary = () => {
    if (blocked || saving) return;
    if (!confirming) { setConfirming(true); setUnderstood(false); return; }
    void apply();
  };

  const footer = <>
    <span id={blockedId} className="dialog-footer-reason" hidden={!blocked}>{blocked}</span>
    {confirming ? <Button onClick={() => { setConfirming(false); setUnderstood(false); }}>Back</Button> : <Button onClick={onClose}>Cancel</Button>}
    <Button variant="primary" loading={saving} aria-disabled={blocked ? true : undefined} aria-describedby={blocked ? blockedId : undefined}
      onClick={primary}>{finalApplyLabel(action, count)}</Button>
  </>;

  return <Dialog open title={`${FINAL_TITLES[action]}: ${plural(rows.length, "text")}`} size="md" onClose={saving ? undefined : onClose} footer={footer}>
    <div className="bulk-dialog">
      {notice && <InlineMessage tone="info">{notice}</InlineMessage>}
      {!confirming && (action === "accept"
        ? <p className="bulk-rule"><strong>Rule:</strong> a text without a final result gets one when at least two annotations are submitted, nothing else is open on it and all findings agree in full.</p>
        : <p className="bulk-rule"><strong>Rule:</strong> a text&apos;s final result is replaced by its newest submission on the current version when that was submitted after the final result was chosen and is a consolidation, the only submission, or an annotation that agrees in full with the others.</p>)}
      {!preview && previewError === undefined && <p className="field-hint">{CHECKING}</p>}
      {previewError !== undefined && <><ErrorNotice error={previewError} /><Button size="sm" onClick={() => setReload(value => value + 1)}>Retry</Button></>}
      {preview && groups.length > 0 && <ul className="bulk-groups" aria-label="Preview">
        {groups.filter(group => !confirming || group.tone === "change").map(group => <GroupLine key={group.id} group={group} id={`${ids}-${group.id}`} />)}
      </ul>}
      {preview && <p className="work-plan-summary" aria-live="polite"><strong>{finalSummaryLabel(action)}</strong> {finalSummaryText(preview, rows.length)}</p>}
      {confirming && preview && <div className="work-plan-confirm">
        <div className="work-plan-warning">
          <strong>What happens</strong>
          <ul>{finalConsequences(preview).map(line => <li key={line}>{line}</li>)}</ul>
        </div>
        <Checkbox id={`${ids}-understood`} label="I understand" checked={understood} onChange={event => setUnderstood(event.target.checked)} />
      </div>}
      {error !== undefined && <ErrorNotice error={error} />}
    </div>
  </Dialog>;
}
