/**
 * The lead decides a translation review submitted as a query (issue 483), from "Resolve…" on the Documents row:
 * - `reviewer_text`, "Accept the reviewer's text as v2…": the reviewer's proposed text, which the lead may still change,
 *   with its changes against the version; it becomes the next version, accepted. The answer is optional.
 * - `unchanged`, "Accept v1 as it is…": the version is accepted unchanged; the answer is required.
 * Both are recorded as the lead's decision on the query, and the reviewer reads the answer at the submitted task.
 */
import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import { api, ApiError, type DocumentRowView, type QueryDecisionPreview, type QueryDecisionResult } from "../api/client";
import { textLabel } from "../app/identity";
import { ErrorNotice } from "../admin/ErrorNotice";
import { DiffView, scrollToFirstChange } from "../translation/DiffView";
import { TranslationEditor } from "../translation/TranslationEditor";
import { diffTextBounded } from "../translation/textDiff";
import { Button, Dialog, InlineMessage, Textarea } from "../ui";
import { correctionConsequences } from "./LeadCorrectionPanel";
import { changedPassages } from "./UploadVersionDialog";

export type QueryDecisionKind = QueryDecisionResult["kind"];

/** Why the query cannot be decided here (`QUERY_DECISION_NOT_AVAILABLE` reasons). */
export function queryRefusal(reason: string | null | undefined, short: string): string | null {
  switch (reason) {
    case "already_decided": return "This query was already decided. Reload the row to see its current state.";
    case "not_a_query": return "This version is no longer queried. Reload the row to see its current state.";
    case "review_open": return "A translation review of this version is open. Withdraw it with Remove… in the reviewer’s row of the Translation part before you decide the query.";
    case "not_newest": return "A newer version of this translation exists. Reload the row to see it.";
    case "discarded": return "This translation was discarded. Reload the row to see its current state.";
    case "unchanged": return `This text is the same as ${short}. To accept ${short} without changes, use Accept ${short} as it is…`;
    case "answer_required": return "Enter the answer to the reviewer.";
    default: return null;
  }
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);

function refusedSave(error: unknown, short: string): string | null {
  if (!(error instanceof ApiError)) return null;
  if (error.code === "VARIANT_REVIEW_STALE") return "The text of this version or its review changed. Reload the row to see the current state.";
  if (error.code === "TEXT_EMPTY") return "The text is empty.";
  if (error.code !== "QUERY_DECISION_NOT_AVAILABLE") return null;
  return queryRefusal(isRecord(error.details) && typeof error.details.reason === "string" ? error.details.reason : null, short);
}

/** What the page announces after the decision. */
export function queryDecisionMessage(row: Pick<DocumentRowView, "case_id" | "language">, saved: QueryDecisionResult, answered: boolean): string {
  const name = textLabel(row);
  const tail = answered ? " The reviewer sees your answer at their submitted task." : "";
  return saved.kind === "reviewer_text"
    ? `${name}: the reviewer’s text was saved as v${saved.version} and accepted.${tail}`
    : `${name} v${saved.version} was accepted as it is.${tail}`;
}

export interface QueryDecisionDialogProps {
  kind: QueryDecisionKind;
  row: DocumentRowView;
  /** The version to decide on: the row's queried version, or its typo fix. */
  documentId: string;
  projectKey: string;
  /** The reviewer's name ("Ana Weber"), or "The reviewer". */
  reviewer: string;
  onDecided: (message: string) => void;
  onClose: () => void;
  returnFocus?: () => HTMLElement | null | undefined;
}

export function QueryDecisionDialog({ kind, row, documentId, projectKey, reviewer, onDecided, onClose, returnFocus }: QueryDecisionDialogProps): JSX.Element {
  const id = useId();
  const writing = useRef(false);
  const [state, setState] = useState<QueryDecisionPreview | null>(null);
  const [loadError, setLoadError] = useState<unknown>();
  const [text, setText] = useState<string | null>(null);
  const [answer, setAnswer] = useState("");
  const [tried, setTried] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>();

  useEffect(() => {
    let live = true;
    api.getQueryDecisionPreview(projectKey, documentId).then(value => {
      if (!live) return;
      setState(value); setText(current => current ?? value.review?.proposed_text ?? value.text);
    }, failure => { if (live) setLoadError(failure); });
    return () => { live = false; };
  }, [projectKey, documentId]);

  const short = `v${state?.version ?? row.versions.find(entry => entry.document_id === documentId)?.version ?? 1}`;
  const next = `v${state?.next_version ?? 2}`;
  const taking = kind === "reviewer_text";
  // Issue 554: the title repeats the label of the button that opened it (named by its consequence).
  const title = taking ? `Accept the reviewer’s text as ${next}, ${textLabel(row)} ${short}` : `Accept ${short} as it is, ${textLabel(row)}`;
  const value = text ?? "";
  const original = state?.text ?? "";
  const changed = state !== null && value !== original;
  const edited = state?.review != null && value !== state.review.proposed_text;
  const parts = useMemo(() => (taking && changed ? diffTextBounded(original, value) : null), [taking, changed, original, value]);
  const missingAnswer = !taking && !answer.trim();
  const invalid = taking ? !value.trim() || !changed : missingAnswer;
  const blocked = state !== null && !state.available ? queryRefusal(state.reason, short) ?? "This query cannot be decided here. Reload the row to see its current state." : null;
  const consequences = state && taking ? correctionConsequences(state) : [];
  const annotated = state ? state.annotations.submitted + state.annotations.open > 0 : false;

  const save = async () => {
    setTried(true);
    if (writing.current || invalid || state === null || state.review == null) return;
    writing.current = true; setBusy(true); setError(undefined);
    try {
      const said = answer.trim();
      const saved = await api.decideQuery(projectKey, documentId, {
        kind, expected_text_sha256: state.text_sha256, expected_review_id: state.review.id,
        ...(taking ? { text: value } : {}), ...(said ? { answer: said } : {}),
      });
      onDecided(queryDecisionMessage(row, saved, !!said));
    } catch (failure: unknown) {
      setError(failure);
    } finally { writing.current = false; setBusy(false); }
  };

  const refusedText = refusedSave(error, short);
  const failure = refusedText ? <InlineMessage tone="warning">{refusedText}</InlineMessage> : error !== undefined && <ErrorNotice error={error} />;
  const close = busy ? undefined : onClose;
  // Rule 4 of docs/design.md › Panels and actions: a greyed Accept names its reason as description and tooltip.
  const greyed = state === null ? "Loading the query…" : !invalid ? null
    : taking ? "Change the text, or accept the version as it is." : "Enter the answer to the reviewer.";
  const describedBy = greyed === null || busy ? undefined : tried && !taking && state !== null ? `${id}-answer-error` : `${id}-missing`;
  // Issue 613: "Changes to v1" opens at its first change once the text is there, not at the start of the text.
  const changesView = useRef<HTMLDivElement>(null), scrolled = useRef(false);
  const hasChanges = parts !== null;
  useLayoutEffect(() => {
    if (!hasChanges || scrolled.current || !changesView.current) return;
    scrolled.current = true;
    scrollToFirstChange(changesView.current);
  }, [hasChanges]);
  // Rule 6: focus on the primary action when the dialog opens.
  const primary = useRef<HTMLButtonElement>(null);

  if (loadError !== undefined || blocked !== null) {
    return <Dialog open size="sm" title={title} onClose={onClose} returnFocus={returnFocus} footer={<Button onClick={onClose}>Close</Button>}>
      {loadError !== undefined ? <ErrorNotice error={loadError} /> : <InlineMessage tone="warning">{blocked}</InlineMessage>}
    </Dialog>;
  }

  const question = state?.review?.rationale?.trim();
  const count = parts ? changedPassages(parts) : null;
  return <Dialog open size={taking ? "lg" : "md"} title={title} onClose={close} returnFocus={returnFocus} initialFocus={primary}
    footer={<>
      <Button disabled={busy} onClick={onClose}>Cancel</Button>
      <Button ref={primary} variant="primary" loading={busy} aria-disabled={state === null || invalid || busy ? true : undefined}
        aria-describedby={describedBy} title={busy ? undefined : greyed ?? undefined} onClick={() => { void save(); }}>{taking ? `Accept as ${next}` : `Accept ${short}`}</Button>
    </>}>
    <div className="editorial-correction query-decision">
      {state === null
        ? <InlineMessage tone="info"><span id={`${id}-missing`}>Loading the query…</span></InlineMessage>
        : <>
          <div className="documents-review-reason">
            <p>{`${reviewer} asked a question about ${short}.`}</p>
            {question ? <blockquote>{`“${question}”`}</blockquote> : <p className="cell-secondary">No reason given.</p>}
          </div>
          {taking
            ? <>
              <p>{`The text below becomes ${next}, a correction of ${short}, and is accepted. It is recorded as your decision on the query.`}</p>
              {/* Issue 613: the changes first, opened at the first one (as Show the proposed text, #591), then the text to edit. */}
              {parts !== null && <div className="editorial-correction-changes">
                <p className="upload-version-changes"><strong>{`Changes to ${short}`}</strong>{count !== null && ` · ${count} ${count === 1 ? "passage" : "passages"} changed`}</p>
                <DiffView ref={changesView} before={original} after={value} parts={parts} lang={row.language} />
              </div>}
              <div className="form-group">
                <label id={`${id}-text-label`} htmlFor={`${id}-text`} className="form-label">Reviewer’s text</label>
                <TranslationEditor id={`${id}-text`} labelledBy={`${id}-text-label`} describedBy={`${id}-text-hint`} machineText={original} value={value}
                  lang={row.language} disabled={busy} onChange={event => { setText(event.target.value); setError(undefined); }} />
                <p id={`${id}-text-hint`} className="field-hint">{edited ? "You changed the reviewer’s text. The record says so." : "You can still change the text here."}</p>
              </div>
              {changed && parts === null && <p className="field-hint">The texts differ too much to mark the changes.</p>}
              {!changed && <InlineMessage tone="warning">{queryRefusal("unchanged", short)}</InlineMessage>}
              {consequences.length > 0 && <InlineMessage tone="warning" title={annotated ? `Annotation has work on ${short}.` : `${short} has work.`}>
                {consequences.map(line => <span key={line} className="lead-correction-consequence">{line} </span>)}
              </InlineMessage>}
            </>
            : <>
              <p>{`${short} is accepted without changes. It is recorded as your decision on the query.`}</p>
              {state.proposes_changes && <p className="field-hint">The reviewer also proposed a changed text. It is not taken.</p>}
            </>}
          <Textarea id={`${id}-answer`} label={taking ? "Answer to the reviewer (optional)" : "Answer to the reviewer"} required={!taking} maxLength={2000} rows={3}
            value={answer} disabled={busy} hint={`${reviewer} reads it at the submitted task, under My tasks.`}
            error={tried && missingAnswer ? "Enter the answer to the reviewer." : undefined}
            onChange={event => { setAnswer(event.target.value); setError(undefined); }} />
        </>}
      {failure}
      {/* Without an answer the field says so itself; the button points there, not to a second copy (issue 547, U2-05). */}
      {/* Before a press the reason is the button's description only; after it, it shows in place. */}
      {state !== null && greyed !== null && (tried && taking
        ? <p id={`${id}-missing`} className="action-reason">{greyed}</p>
        : !tried && <span id={`${id}-missing`} hidden>{greyed}</span>)}
    </div>
  </Dialog>;
}
