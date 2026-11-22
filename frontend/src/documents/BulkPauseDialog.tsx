import { useEffect, useId, useRef, useState } from "react";
import { api, ApiError, type RowRefView, type TextPauseActionView } from "../api/client";
import { ErrorNotice } from "../admin/ErrorNotice";
import { plural } from "../app/labels";
import { Button, Checkbox, Dialog, InlineMessage, Textarea } from "../ui";
import { GroupLine } from "./BulkTaskDialog";
import { pauseApplyLabel, pauseConsequences, pauseGroups, pauseSummaryText, PAUSE_TITLES, type PauseAction } from "./bulkPauseModel";

export interface BulkPauseDialogProps {
  projectKey: string;
  action: PauseAction;
  /** The selected texts. */
  rows: readonly RowRefView[];
  onClose: () => void;
  /** After a successful apply; the caller closes the dialog and shows the message. */
  onApplied: (result: TextPauseActionView) => void;
}

const CHECKING = "Checking the selected texts…";
const STALE = "The texts changed since the preview. Check the new preview.";

/**
 * "Pause texts…" and "Release texts…" for the selected texts, in the shared frame "bulk action with preview" (issue
 * 464; decisions 336-A, 336-B): the preview grouped by consequence and the reason, then the consequences step with
 * "I understand", then the action. A pause needs a reason, as "Reopen…" does: the people see it in My tasks and in
 * the task. Applying sends the preview's token: every listed text changes or none; when the texts changed meanwhile
 * the dialog shows the new preview. No Undo: the other action is the way back. Below 700 px a full-screen sheet.
 */
export function BulkPauseDialog({ projectKey, action, rows, onClose, onApplied }: BulkPauseDialogProps): JSX.Element {
  const ids = useId().replace(/:/g, "");
  const blockedId = `${ids}-blocked`;
  const [reason, setReason] = useState("");
  const [preview, setPreview] = useState<TextPauseActionView | null>(null);
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
  useEffect(() => {
    setPreview(null); setPreviewError(undefined);
    const abort = new AbortController();
    api.pauseTexts(projectKey, action, { rows: [...rows], preview: true }, abort.signal).then(found => { if (alive.current && !abort.signal.aborted) setPreview(found); },
      (failure: unknown) => { if (alive.current && !abort.signal.aborted) setPreviewError(failure); });
    return () => abort.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- rowsKey stands for the selection
  }, [projectKey, action, rowsKey, reload]);

  const pausing = action === "pause";
  const groups = preview ? pauseGroups(preview) : [];
  const count = preview?.changes.length ?? 0;

  let blocked: string | null = null;
  if (!preview) blocked = CHECKING;
  else if (!count) blocked = pauseSummaryText(preview, rows.length);
  else if (confirming && !understood) blocked = "Confirm that you understand the consequences first.";
  else if (pausing && !reason.trim()) blocked = "Enter the reason first.";

  const apply = async () => {
    if (!preview || saving) return;
    setSaving(true); setError(undefined); setNotice(null);
    try {
      const result = await api.pauseTexts(projectKey, action, { rows: [...rows], preview_token: preview.preview_token, ...(reason.trim() ? { reason: reason.trim() } : {}) });
      if (alive.current) onApplied(result);
    } catch (failure: unknown) {
      if (!alive.current) return;
      const details = failure instanceof ApiError && typeof failure.details === "object" && failure.details !== null ? failure.details as { preview?: TextPauseActionView } : null;
      if (failure instanceof ApiError && failure.code === "PREVIEW_STALE" && details?.preview) {
        setPreview(details.preview);
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
      onClick={primary}>{pauseApplyLabel(action, preview ? count : null)}</Button>
  </>;

  return <Dialog open title={`${PAUSE_TITLES[action]}: ${plural(rows.length, "text")}`} size="md" onClose={saving ? undefined : onClose} footer={footer}>
    <div className="bulk-dialog">
      {notice && <InlineMessage tone="info">{notice}</InlineMessage>}
      {!confirming && <p className="field-hint">{pausing
        ? "Open tasks on a paused text stay in My tasks and can be read, but not saved. Submitted work and final results are untouched."
        : "Open tasks on a released text can be saved again."}</p>}
      {!preview && previewError === undefined && <p className="field-hint">{CHECKING}</p>}
      {previewError !== undefined && <><ErrorNotice error={previewError} /><Button size="sm" onClick={() => setReload(value => value + 1)}>Retry</Button></>}
      {preview && groups.length > 0 && <ul className="bulk-groups" aria-label="Preview">
        {groups.filter(group => !confirming || group.tone !== "skip").map(group => <GroupLine key={group.id} group={group} id={`${ids}-${group.id}`} />)}
      </ul>}
      {preview && <p className="work-plan-summary" aria-live="polite"><strong>Will change:</strong> {pauseSummaryText(preview, rows.length)}</p>}
      {!confirming && <Textarea id={`${ids}-reason`} label={pausing ? "Reason" : "Reason (optional)"} required={pausing} maxLength={2000} value={reason}
        onChange={event => setReason(event.target.value)}
        hint={pausing ? "The people see it in My tasks and in the task. It is kept in the audit log." : "Kept with each release in the audit log."} />}
      {confirming && preview && <div className="work-plan-confirm">
        <div className="work-plan-warning">
          <strong>What happens</strong>
          <ul>{pauseConsequences(preview).map(line => <li key={line}>{line}</li>)}</ul>
          {reason.trim() && <p>Reason: {reason.trim()}</p>}
        </div>
        <Checkbox id={`${ids}-understood`} label={pausing ? "I understand — pause the work on these texts" : "I understand"} checked={understood} onChange={event => setUnderstood(event.target.checked)} />
      </div>}
      {error !== undefined && <ErrorNotice error={error} />}
    </div>
  </Dialog>;
}
