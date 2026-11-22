import { useEffect, useId, useRef, useState } from "react";
import { api, ApiError, type BulkModeChangeView, type RowRefView } from "../api/client";
import { ErrorNotice } from "../admin/ErrorNotice";
import { plural } from "../app/labels";
import { Button, Checkbox, Dialog, InlineMessage, Textarea } from "../ui";
import { GroupLine } from "./BulkTaskDialog";
import { affectedLine, affectedPeople, modeApplyLabel, modeConsequences, modeGroups, modeSummaryText, MODE_CHOICES, type ModeName } from "./bulkModeModel";

export interface BulkModeDialogProps {
  projectKey: string;
  /** The selected texts. */
  rows: readonly RowRefView[];
  /** How many selected texts each mode would change, when the menu already knows it. */
  reach?: Partial<Record<ModeName, number>>;
  onClose: () => void;
  /** After a successful apply; the caller closes the dialog and shows the message. */
  onApplied: (result: BulkModeChangeView) => void;
}

const CHECKING = "Checking the selected texts…";
const STALE = "The texts changed since the preview. Check the new preview.";
const MODES: readonly ModeName[] = ["scratch", "proposals"];

/**
 * "Change mode…" for the selected texts, in the shared frame "bulk action with preview" (issue 336 step 4; decisions
 * 336-A, 336-B): the new mode (the only choice the single "Change mode…" has) and the reason, the preview grouped by
 * consequence with a list of the people affected, then the consequences step with "I understand", then the action.
 * No mode is preselected: the change discards submitted work, so the choice is deliberate. Applying sends the
 * preview's token: every listed text changes or none; when the texts changed meanwhile the dialog shows the new
 * preview. There is no bulk Undo; the consequences step names "Restore…" in the text card. Below 700 px a
 * full-screen sheet.
 */
export function BulkModeDialog({ projectKey, rows, reach, onClose, onApplied }: BulkModeDialogProps): JSX.Element {
  const ids = useId().replace(/:/g, "");
  const blockedId = `${ids}-blocked`;
  const [mode, setMode] = useState<ModeName | null>(null);
  const [reason, setReason] = useState("");
  const [preview, setPreview] = useState<BulkModeChangeView | null>(null);
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
    if (!mode) return;
    // A changed mode aborts the preview still under way.
    const abort = new AbortController();
    api.bulkChangeMode(projectKey, { rows: [...rows], mode, preview: true }, abort.signal).then(found => { if (alive.current && !abort.signal.aborted) setPreview(found); },
      (failure: unknown) => { if (alive.current && !abort.signal.aborted) setPreviewError(failure); });
    return () => abort.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- rowsKey stands for the selection
  }, [projectKey, mode, rowsKey, reload]);

  const fresh = preview && preview.mode === mode ? preview : null;
  const groups = fresh ? modeGroups(fresh) : [];
  const people = fresh ? affectedPeople(fresh) : [];
  const count = fresh?.changes.length ?? 0;
  const discards = (fresh?.submission_count ?? 0) > 0;

  let blocked: string | null = null;
  if (!mode) blocked = "Choose the new mode first.";
  else if (!fresh) blocked = CHECKING;
  else if (!count) blocked = modeSummaryText(fresh, rows.length);
  else if (confirming && !understood) blocked = "Confirm that you understand the consequences first.";
  else if (!reason.trim()) blocked = "Enter the reason first.";

  const apply = async () => {
    if (!fresh || !mode || saving) return;
    setSaving(true); setError(undefined); setNotice(null);
    try {
      const result = await api.bulkChangeMode(projectKey, { rows: [...rows], mode, preview_token: fresh.preview_token, reason: reason.trim() });
      if (alive.current) onApplied(result);
    } catch (failure: unknown) {
      if (!alive.current) return;
      const details = failure instanceof ApiError && typeof failure.details === "object" && failure.details !== null ? failure.details as { preview?: BulkModeChangeView } : null;
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
    <Button variant={confirming ? "danger" : "primary"} loading={saving} aria-disabled={blocked ? true : undefined} aria-describedby={blocked ? blockedId : undefined}
      onClick={primary}>{modeApplyLabel(fresh ? count : null)}</Button>
  </>;

  return <Dialog open title={`Change mode: ${plural(rows.length, "text")}`} size="md" onClose={saving ? undefined : onClose} footer={footer}>
    <div className="bulk-dialog">
      {notice && <InlineMessage tone="info">{notice}</InlineMessage>}
      {!confirming && <fieldset className="plan-step">
        <legend>Annotate the texts</legend>
        {MODES.map(value => {
          const reached = reach?.[value];
          return <div key={value} className="plan-option">
            <input type="radio" id={`${ids}-mode-${value}`} name={`${ids}-mode`} checked={mode === value} aria-describedby={`${ids}-mode-${value}-help`}
              onChange={() => { setMode(value); setNotice(null); setError(undefined); }} />
            <label htmlFor={`${ids}-mode-${value}`}>{MODE_CHOICES[value].label}</label>
            <p id={`${ids}-mode-${value}-help`} className="plan-option-help">
              {MODE_CHOICES[value].help}{reached !== undefined && ` ${reached ? `Changes ${plural(reached, "selected text")}.` : rows.length === 1 ? "Does not change the selected text." : "Changes none of the selected texts."}`}
            </p>
          </div>;
        })}
        <p className="field-hint">Only texts whose mode is fixed by annotation work change here. Their annotation starts again; the work on them is discarded.</p>
      </fieldset>}
      {mode && !fresh && previewError === undefined && <p className="field-hint">{CHECKING}</p>}
      {previewError !== undefined && <><ErrorNotice error={previewError} /><Button size="sm" onClick={() => setReload(value => value + 1)}>Retry</Button></>}
      {fresh && groups.length > 0 && <ul className="bulk-groups" aria-label="Preview">
        {groups.filter(group => !confirming || group.tone === "change").map(group => <GroupLine key={group.id} group={group} id={`${ids}-${group.id}`} />)}
      </ul>}
      {fresh && count > 0 && <div className="bulk-people">
        <strong>{people.length ? `Work of ${plural(people.length, "person", "people")} is affected:` : "Nobody's work is affected."}</strong>
        {people.length > 0 && <ul aria-label="Affected people">{people.map(person => <li key={person.name}>{affectedLine(person)}</li>)}</ul>}
      </div>}
      {fresh && <p className="work-plan-summary" aria-live="polite"><strong>Will change:</strong> {modeSummaryText(fresh, rows.length)}</p>}
      {!confirming && mode && <Textarea id={`${ids}-reason`} label="Reason" required maxLength={2000} value={reason}
        onChange={event => setReason(event.target.value)} hint="Recorded with each text's mode change." />}
      {confirming && fresh && <div className="work-plan-confirm">
        <div className="work-plan-warning">
          <strong>What happens</strong>
          <ul>{modeConsequences(fresh).map(line => <li key={line}>{line}</li>)}</ul>
          <p>Reason: {reason.trim()}</p>
        </div>
        <Checkbox id={`${ids}-understood`} label={discards ? "I understand — discard the work and change the mode" : "I understand"} checked={understood} onChange={event => setUnderstood(event.target.checked)} />
      </div>}
      {error !== undefined && <ErrorNotice error={error} />}
    </div>
  </Dialog>;
}
