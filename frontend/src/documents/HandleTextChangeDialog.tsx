import { useEffect, useId, useRef, useState, type RefObject } from "react";
import { api, ApiError, type DocumentRowView, type NextStepView, type TextChangePreview } from "../api/client";
import { textLabel } from "../app/identity";
import { errorMessage } from "../admin/errors";
import { personName } from "../admin/assignSummary";
import { Button, ConfirmDialog, Dialog } from "../ui";
import {
  CHECKING, finishDescription, finishingMessage, finishLabel, handleTitle, heldLine, moveDescription, movedMessage, moveLabel, nextAfterWithdrawLine,
  CHOOSE_WITHDRAW, noTargetOptionLine, noTargetProposalsLine, notNewerLine, openWorkLine, RELOADED_MESSAGE, unplacedLine, WITHDRAW_LABEL, withdrawDescription, withdrawnMessage,
} from "./textChangeText";

export type TextChangeChoice = "move" | "finish" | "withdraw";

export interface HandleTextChangeDialogProps {
  projectKey: string;
  /** The current row (the page passes the reloaded row after a conflict). */
  row: DocumentRowView;
  /** The row's `handle_text_change` step: `assignment_id` is the open work, `document_id` the target. */
  step: NextStepView;
  onClose: () => void;
  /** The choice was applied; the message is the page's toast. */
  onDone: (message: string) => void;
  /** The text or the task changed: the page reloads the rows. */
  onReload: () => void;
  /** "Decide on report…" for a paused task. */
  onDecideReport?: () => void;
}

/** Codes after which the row is reloaded and the choice kept (spec "States and edge cases › Conflict"). */
export const isTextChangeConflict = (error: unknown): boolean =>
  error instanceof ApiError && (error.code === "TEXT_CHANGE_CHANGED" || error.code === "WORKFLOW_REVISION_CONFLICT");

/** The new version has no proposals yet (issue 414): this can change, so the choices stay and Retry is offered. */
export const isNoTargetProposals = (error: unknown): boolean =>
  error instanceof ApiError && error.code === "TEXT_CHANGE_NOT_APPLICABLE" && typeof error.details === "object" && error.details !== null
  && error.details.reason === "no_target_proposals";

/** A domain refusal (4xx with a code, not a conflict, not a wait for proposals): retrying cannot help, and the refused choices would fail again. */
export const isTextChangeRefusal = (error: unknown): boolean =>
  error instanceof ApiError && !!error.code && error.status >= 400 && error.status < 500 && !isTextChangeConflict(error) && !isNoTargetProposals(error);

/** A failure retrying may cure: network, no code, or a server error (5xx). */
export const isTransientError = (error: unknown): boolean => !(error instanceof ApiError) || !error.code || error.status >= 500;

/**
 * Retry replaces its own button while the preview reloads: focus would fall to the page. After the reload,
 * focus goes to the new Retry button, else to the first choice that can be taken.
 */
export function useRetryFocus(preview: unknown, previewError: unknown): { body: RefObject<HTMLDivElement>; retried: () => void } {
  const body = useRef<HTMLDivElement>(null);
  const pending = useRef(false);
  useEffect(() => {
    if (!pending.current || (preview === null && previewError === null)) return;
    pending.current = false;
    body.current?.querySelector<HTMLElement>("[data-retry], input[type=radio]:not(:disabled)")?.focus();
  }, [preview, previewError]);
  return { body, retried: () => { pending.current = true; } };
}

/** "Handle text change…": an open annotation on an old version (spec V5). */
export function HandleTextChangeDialog(props: HandleTextChangeDialogProps): JSX.Element {
  const { projectKey, row, step } = props;
  const id = useId();
  const item = row.work.find(entry => entry.assignment_id === step.assignment_id);
  const person = item ? personName(item.person ?? { pseudonym: item.author_label }) : "The annotator";
  const target = row.versions.find(version => version.document_id === step.document_id);
  const from = `v${item?.version ?? 1}`;
  const to = `v${target?.version ?? (item?.version ?? 1) + 1}`;
  const held = item?.held ?? false;
  const assignmentId = step.assignment_id ?? item?.assignment_id ?? null;
  const targetId = step.document_id ?? target?.document_id ?? "";

  const fromProposals = item?.annotation_mode === "proposals";
  // A correction that does not count has no way back, and a refused preview refuses move and finish too: only Withdraw works.
  // No proposals on the new version yet is no refusal of that kind: they may still arrive (Retry).
  const notNewer = !!item && !!target && target.version < (item.version ?? 0);

  const [chosen, setChoice] = useState<TextChangeChoice>("move");
  const [preview, setPreview] = useState<TextChangePreview | null>(null);
  const [previewError, setPreviewError] = useState<unknown>(null);
  const previewFailed = previewError !== null;
  const withdrawOnly = notNewer || isTextChangeRefusal(previewError);
  // No proposals on the new version: Move and Finish would be refused, so nothing but Withdraw can be chosen.
  const noTarget = isNoTargetProposals(previewError);
  const choice: TextChangeChoice | null = withdrawOnly ? "withdraw" : noTarget && chosen !== "withdraw" ? null : chosen;
  const [reload, setReload] = useState(0);
  const { body, retried } = useRetryFocus(preview, previewError);
  const retry = () => { retried(); setReload(value => value + 1); };
  const [checking, setChecking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const [unreviewed, setUnreviewed] = useState(false);
  const writing = useRef(false);
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);

  useEffect(() => {
    // No preview for this state (also when it changes during a request): nothing stays busy or kept.
    if (held || notNewer || assignmentId === null || !targetId) { setChecking(false); setPreview(null); setPreviewError(null); return; }
    let active = true;
    // Missing proposals stay shown while Retry reloads: Move and Finish stay disabled and Move does not
    // flash selected before the answer (issue 419). Retry shows busy and keeps focus.
    setPreview(null); setPreviewError((current: unknown) => isNoTargetProposals(current) ? current : null);
    setChecking(true);
    void api.previewTextChange(projectKey, { assignment_id: assignmentId, target_document_id: targetId }).then(
      value => { if (active) { setPreview(value); setPreviewError(null); setChecking(false); } },
      // A Retry that fails on the network or the server says nothing about the proposals: the reason, its Retry
      // and the disabled Move and Finish stay.
      error => { if (active) { setPreviewError((current: unknown) => isNoTargetProposals(current) && isTransientError(error) ? current : error); setChecking(false); } },
    );
    return () => { active = false; };
  }, [projectKey, assignmentId, targetId, held, notNewer, reload]);

  const apply = async (confirmUnreviewed = false) => {
    if (writing.current || assignmentId === null || !choice) return;
    writing.current = true; setBusy(true); setFailure(null);
    try {
      const current = (await api.listAssignments(projectKey, { document_id: item?.document_id })).find(entry => entry.id === assignmentId);
      if (!current) throw new ApiError(409, RELOADED_MESSAGE, "TEXT_CHANGE_CHANGED");
      const expected_workflow_revision = current.workflow_revision;
      if (choice === "move") {
        await api.moveToVersion(assignmentId, { target_document_id: targetId, expected_workflow_revision, request_id: crypto.randomUUID(), confirm_unreviewed_translation: confirmUnreviewed });
        if (alive.current) props.onDone(movedMessage(person, to));
      } else {
        await api.resolveTextChange(assignmentId, { resolution: choice === "finish" ? "finish_then_carry" : "withdrawn", target_document_id: targetId, expected_workflow_revision });
        if (alive.current) props.onDone(choice === "finish" ? finishingMessage(person, from, to) : withdrawnMessage(person, to));
      }
    } catch (error: unknown) {
      if (!alive.current) return;
      setUnreviewed(false);
      if (isTextChangeConflict(error)) { setFailure(RELOADED_MESSAGE); props.onReload(); setReload(value => value + 1); }
      else if (error instanceof ApiError && error.code === "TRANSLATION_NOT_REVIEWED" && !confirmUnreviewed) setUnreviewed(true);
      // Shown once, by the no-proposals line with its Retry (it also disables Move and Finish).
      else if (isNoTargetProposals(error)) setPreviewError(error);
      else setFailure(errorMessage(error));
    } finally {
      writing.current = false;
      if (alive.current) setBusy(false);
    }
  };

  const options: { value: TextChangeChoice; label: string; description: string; extra?: string | null; disabled?: boolean }[] = [
    ...(withdrawOnly ? [] : [
      { value: "move" as const, label: moveLabel(to), description: moveDescription(person, fromProposals), disabled: noTarget,
        extra: noTarget ? noTargetOptionLine(to) : preview ? (preview.unplaced > 0 ? unplacedLine(preview.unplaced, preview.findings, person, fromProposals) : null) : previewFailed ? null : CHECKING },
      { value: "finish" as const, label: finishLabel(person, from), description: finishDescription(person, to), disabled: noTarget,
        extra: noTarget ? noTargetOptionLine(to) : null },
    ]),
    { value: "withdraw", label: WITHDRAW_LABEL, description: withdrawDescription(person, to) },
  ];
  const text = textLabel(row);

  return <Dialog open size="sm" title={handleTitle(text)} onClose={busy ? undefined : props.onClose} footer={<>
    {failure && <p className="text-change-error" role="alert">{failure}</p>}
    {!held && !choice && <span id={`${id}-reason`} className="dialog-footer-reason">{CHOOSE_WITHDRAW}</span>}
    <Button disabled={busy} onClick={props.onClose}>Cancel</Button>
    {!held && <Button variant="primary" loading={busy} aria-disabled={choice ? undefined : "true"} aria-describedby={choice ? undefined : `${id}-reason`}
      onClick={() => { void apply(); }}>Apply</Button>}
  </>}>
    <div className="text-change-dialog" ref={body}>
      <p>{openWorkLine(person, from, to)}</p>
      {noTarget && !held && <p className="text-change-error"><span role="alert">{noTargetProposalsLine(to)}</span>{" "}
        <Button size="sm" data-retry loading={checking} onClick={retry}>Retry</Button></p>}
      {withdrawOnly && !held && <>
        <p>{notNewer ? notNewerLine(from, to) : `${errorMessage(previewError)} That is why Withdraw is the only choice.`}</p>
        <p>{nextAfterWithdrawLine(to)}</p>
      </>}
      {held ? <p className="text-change-held">
        {heldLine(person)}{" "}
        {props.onDecideReport && <Button size="sm" onClick={props.onDecideReport}>Decide on report…</Button>}
      </p> : <fieldset className="text-change-options">
        <legend className="visually-hidden">How to continue</legend>
        {options.map(option => {
          const inputId = `${id}-${option.value}`;
          const descriptionId = `${inputId}-description`;
          const extraId = `${inputId}-extra`;
          return <div key={option.value} className="text-change-option">
            <input id={inputId} type="radio" name={`${id}-choice`} value={option.value} checked={choice === option.value} disabled={option.disabled}
              aria-describedby={[descriptionId, option.extra && extraId].filter(Boolean).join(" ")}
              onChange={() => { if (!busy) { setChoice(option.value); setFailure(null); } }} />
            <label htmlFor={inputId}>{option.label}</label>
            <p id={descriptionId} className="text-change-description">{option.description}</p>
            {option.extra && <p id={extraId} className="text-change-description">{option.extra}</p>}
          </div>;
        })}
      </fieldset>}
    </div>
    <ConfirmDialog open={unreviewed} title="Annotate before the review is accepted?" message={<p>Translation not reviewed yet.</p>} confirmLabel="Annotate before the review is accepted" busy={busy}
      onCancel={() => setUnreviewed(false)} onConfirm={() => { void apply(true); }} />
  </Dialog>;
}
