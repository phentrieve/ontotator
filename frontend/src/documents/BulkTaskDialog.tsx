import { useEffect, useId, useRef, useState } from "react";
import { api, ApiError, type BulkTaskActionView, type RowRefView } from "../api/client";
import { ErrorNotice } from "../admin/ErrorNotice";
import { plural } from "../app/labels";
import { Button, Checkbox, Dialog, InlineMessage, Textarea } from "../ui";
import { applyLabel, consequenceLines, previewGroups, TASK_LABELS, willChangeText, type BulkAction, type PreviewGroup } from "./bulkActionModel";

export interface BulkTaskDialogProps {
  projectKey: string;
  action: BulkAction;
  /** The selected texts. */
  rows: readonly RowRefView[];
  onClose: () => void;
  /** After a successful apply; the caller closes the dialog and shows the Undo toast. */
  onApplied: (result: BulkTaskActionView) => void;
}

type TaskKind = keyof typeof TASK_LABELS;
const DEBOUNCE_MS = 250;
const CHECKING = "Checking the selected texts…";
const STALE = "The texts changed since the preview. Check the new preview.";
/** Texts a collapsed group names before "Show all". */
const SHOWN_TEXTS = 3;
const TITLES: Readonly<Record<BulkAction, string>> = { reopen: "Reopen", withdraw: "Withdraw open tasks" };

/** One group of a bulk preview: its title, its detail and its texts, the first three before "Show all". */
export function GroupLine({ group, id }: { group: PreviewGroup; id: string }): JSX.Element {
  const [all, setAll] = useState(false);
  const more = group.texts.length > SHOWN_TEXTS;
  const listId = `${id}-texts`;
  return <li className={`bulk-group bulk-group--${group.tone}`}>
    <p className="bulk-group-title"><strong>{group.title}</strong>{group.detail && <span className="bulk-group-detail"> · {group.detail}</span>}</p>
    <p id={listId} className="bulk-group-texts">
      {(all ? group.texts : group.texts.slice(0, SHOWN_TEXTS)).join(", ")}{more && !all && ", …"}
      {more && <> <Button size="sm" variant="quiet" className="btn-link" aria-expanded={all} aria-controls={listId} onClick={() => setAll(value => !value)}>
        {all ? "Show fewer" : `Show all ${group.texts.length}`}</Button></>}
    </p>
  </li>;
}

/**
 * The shared frame "bulk action with preview" (issue 336; decisions 336-A, 336-B): like the Work plan dialog, first
 * the choices with a live preview grouped by consequence and the reason, then a consequences step with "I
 * understand", then the action. Applying sends the preview's token: every listed task changes or none; when the texts
 * changed meanwhile the dialog shows the new preview. Below 700 px the dialog is a full-screen sheet.
 */
export function BulkTaskDialog({ projectKey, action, rows, onClose, onApplied }: BulkTaskDialogProps): JSX.Element {
  const ids = useId().replace(/:/g, "");
  const blockedId = `${ids}-blocked`;
  const [tasks, setTasks] = useState<TaskKind[]>(["annotate"]);
  const [includeStarted, setIncludeStarted] = useState(false);
  const [overLimit, setOverLimit] = useState(false);
  const [reason, setReason] = useState("");
  const [preview, setPreview] = useState<{ request: string; data: BulkTaskActionView } | null>(null);
  const [previewError, setPreviewError] = useState<unknown>();
  const [reload, setReload] = useState(0);
  const [confirming, setConfirming] = useState(false);
  const [understood, setUnderstood] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<unknown>();
  const [notice, setNotice] = useState<string | null>(null);
  const alive = useRef(true);
  const generation = useRef(0);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);

  const options = action === "reopen" ? { tasks } : { tasks, include_started: includeStarted, over_limit_only: overLimit };
  const requestKey = JSON.stringify(options);
  const rowsKey = JSON.stringify(rows);
  const send = (body: { preview?: boolean; preview_token?: string; reason?: string }, signal?: AbortSignal) => {
    const request = { rows: [...rows], ...options, ...body };
    return action === "reopen" ? api.bulkReopen(projectKey, request, signal) : api.bulkWithdraw(projectKey, request, signal);
  };

  useEffect(() => {
    if (!tasks.length) return;
    const id = ++generation.current;
    // Changed options abort the preview still under way.
    const abort = new AbortController();
    const timer = window.setTimeout(() => {
      send({ preview: true }, abort.signal).then(data => {
        if (!alive.current || generation.current !== id) return;
        setPreview({ request: requestKey, data }); setPreviewError(undefined);
      }, (failure: unknown) => { if (alive.current && generation.current === id && !abort.signal.aborted) setPreviewError(failure); });
    }, preview ? DEBOUNCE_MS : 0);
    return () => { window.clearTimeout(timer); abort.abort(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- requestKey and rowsKey stand for the request
  }, [projectKey, action, requestKey, rowsKey, reload]);

  const fresh = preview !== null && preview.request === requestKey ? preview.data : null;
  const groups = fresh ? previewGroups(fresh) : [];
  const changes = fresh?.changes.length ?? 0;
  const reasonRequired = action === "reopen";

  let blocked: string | null = null;
  if (!tasks.length) blocked = "Choose at least one kind of task.";
  else if (!fresh) blocked = CHECKING;
  else if (!changes) blocked = willChangeText(fresh);
  else if (confirming && !understood) blocked = "Confirm that you understand the consequences first.";
  else if (reasonRequired && !reason.trim()) blocked = "Enter the reason first.";

  const apply = async () => {
    if (!fresh || saving) return;
    setSaving(true); setError(undefined); setNotice(null);
    try {
      const result = await send({ preview_token: fresh.preview_token, ...(reason.trim() ? { reason: reason.trim() } : {}) });
      if (alive.current) onApplied(result);
    } catch (failure: unknown) {
      if (!alive.current) return;
      const details = failure instanceof ApiError && typeof failure.details === "object" && failure.details !== null ? failure.details as { preview?: BulkTaskActionView } : null;
      if (failure instanceof ApiError && failure.code === "PREVIEW_STALE" && details?.preview) {
        setPreview({ request: requestKey, data: details.preview });
        setNotice(STALE); setConfirming(false); setUnderstood(false);
      } else setError(failure);
    } finally { if (alive.current) setSaving(false); }
  };
  const primary = () => {
    if (blocked || saving) return;
    if (!confirming) { setConfirming(true); setUnderstood(false); return; }
    void apply();
  };
  const toggleTask = (task: TaskKind, on: boolean) => {
    setTasks(current => on ? [...new Set([...current, task])] : current.filter(item => item !== task));
    setNotice(null); setError(undefined);
  };

  const footer = <>
    <span id={blockedId} className="dialog-footer-reason" hidden={!blocked}>{blocked}</span>
    {confirming ? <Button onClick={() => { setConfirming(false); setUnderstood(false); }}>Back</Button> : <Button onClick={onClose}>Cancel</Button>}
    <Button variant={action === "withdraw" && confirming ? "danger" : "primary"} loading={saving} aria-disabled={blocked ? true : undefined} aria-describedby={blocked ? blockedId : undefined}
      onClick={primary}>{applyLabel(action, changes)}</Button>
  </>;

  return <Dialog open title={`${TITLES[action]}: ${plural(rows.length, "text")}`} size="md" onClose={saving ? undefined : onClose} footer={footer}>
    <div className="bulk-dialog">
      {notice && <InlineMessage tone="info">{notice}</InlineMessage>}
      {!confirming && <fieldset className="plan-step">
        <legend>Tasks</legend>
        {(Object.keys(TASK_LABELS) as TaskKind[]).map(task => <Checkbox key={task} id={`${ids}-task-${task}`} label={TASK_LABELS[task]}
          checked={tasks.includes(task)} disabled={action === "withdraw" && overLimit && task !== "annotate"} onChange={event => toggleTask(task, event.target.checked)} />)}
      </fieldset>}
      {!confirming && action === "withdraw" && <fieldset className="plan-step">
        <legend>Which open tasks</legend>
        <Checkbox id={`${ids}-started`} label="Also withdraw started tasks" hint="Tasks in progress or reopened. Their drafts are kept." checked={includeStarted} onChange={event => setIncludeStarted(event.target.checked)} />
        <Checkbox id={`${ids}-limit`} label="Only annotations above the limit of annotators per text" hint="Keeps submitted work first, then started work, then the earliest assigned." checked={overLimit} onChange={event => setOverLimit(event.target.checked)} />
      </fieldset>}
      {!fresh && previewError === undefined && tasks.length > 0 && <p className="field-hint">{CHECKING}</p>}
      {previewError !== undefined && <><ErrorNotice error={previewError} /><Button size="sm" onClick={() => setReload(value => value + 1)}>Retry</Button></>}
      {fresh && groups.length > 0 && <ul className="bulk-groups" aria-label="Preview">
        {groups.filter(group => !confirming || group.tone === "change").map(group => <GroupLine key={group.id} group={group} id={`${ids}-${group.id}`} />)}
      </ul>}
      {fresh && <p className="work-plan-summary" aria-live="polite"><strong>Will change:</strong> {willChangeText(fresh)}</p>}
      {!confirming && <Textarea id={`${ids}-reason`} label={reasonRequired ? "Reason" : "Reason (optional)"} required={reasonRequired} maxLength={2000} value={reason}
        onChange={event => setReason(event.target.value)}
        hint={reasonRequired ? "The people see it in My tasks. It is kept in each text's history." : "Kept with each withdrawal in the text's history."} />}
      {confirming && fresh && <div className="work-plan-confirm">
        <div className="work-plan-warning">
          <strong>What happens</strong>
          <ul>{consequenceLines(fresh).map(line => <li key={line}>{line}</li>)}</ul>
          {reason.trim() && <p>Reason: {reason.trim()}</p>}
        </div>
        <Checkbox id={`${ids}-understood`} label={action === "withdraw" ? "I understand — withdraw the open tasks" : "I understand"} checked={understood} onChange={event => setUnderstood(event.target.checked)} />
      </div>}
      {error !== undefined && <ErrorNotice error={error} />}
    </div>
  </Dialog>;
}
