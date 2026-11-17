/**
 * The lead's own correction of a rejected, queried or accepted translation (spec F1, FD1 to FD9): a
 * panel that explains the outcome, starts the lead correction (`startLeadCorrection`) and opens the
 * ordinary translation review screen (`#/tasks/{assignment_id}`). Shown from the inline Resolve options
 * under the Documents row ("Correct the translation…"; documents overview Change 13) and, for an accepted
 * version, in a dialog from its row in the Translation part's version list (issue 341 b): before anything
 * is saved it lists the annotation work that stays on the accepted version (`getLeadCorrectionPreview`).
 */
import { useEffect, useId, useRef, useState } from "react";
import { api, ApiError, type DocumentRowView, type LeadCorrectionPreview } from "../api/client";
import { textLabel } from "../app/identity";
import type { Route } from "../app/router";
import { ErrorNotice } from "../admin/ErrorNotice";
import { Button, Checkbox, InlineMessage } from "../ui";
import { RouteLink } from "./RowCells";

/** The version a correction acts on: the step's version, else the newest version of the row. */
export function correctionDocumentId(row: DocumentRowView): string {
  return row.next_step?.document_id ?? row.versions.find(entry => entry.is_newest_in_chain)?.document_id ?? row.open.document_id;
}

/** The lead's own open lead correction of the row (`lead_correction` on the work item, FD1). */
export function openLeadCorrection(row: DocumentRowView): DocumentRowView["work"][number] | null {
  return row.work.find(item => item.lead_correction && item.is_me && item.status !== "submitted") ?? null;
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
const strings = (value: unknown): string[] => (Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : []);

const NOT_AVAILABLE: Readonly<Record<string, string>> = {
  not_newest: "A newer version of this translation exists. Reload the row to see it.",
  not_rejected_or_queried: "This version is no longer rejected, queried or accepted. Reload the row to see its current state.",
  review_open: "A translation review of this version is open. Withdraw it with Remove… in the reviewer’s row of the Translation part before you correct the translation yourself.",
  discarded: "This translation was discarded. Reload the row to see its current state.",
};

const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? "" : "s"}`;

/**
 * Issue 341 b: what correcting an accepted version means for the annotation work on it (shown before saving):
 * "3 annotations (2 submitted, 1 open) stay on v1. After saving, the row offers Handle text change…".
 */
export function annotationConsequence(preview: Pick<LeadCorrectionPreview, "version" | "next_version" | "annotations" | "annotate_accepted_only">): string | null {
  const { submitted, open } = preview.annotations;
  const total = submitted + open;
  if (!total) return null;
  const parts = [submitted ? `${submitted} submitted` : null, open ? `${open} open` : null].filter(Boolean).join(", ");
  const when = preview.annotate_accepted_only ? ` once v${preview.next_version} is accepted` : "";
  return `${plural(total, "annotation")} (${parts}) ${total === 1 ? "stays" : "stay"} on v${preview.version}. After saving, the row offers Handle text change…${when}.`;
}

/** Every consequence line of the warning block: annotations, open consolidations and a final result on the version. */
export function correctionConsequences(preview: Pick<LeadCorrectionPreview, "version" | "next_version" | "annotations" | "annotate_accepted_only" | "open_consolidations" | "final_result">): string[] {
  const count = preview.open_consolidations;
  return [
    annotationConsequence(preview),
    count ? `${plural(count, "open consolidation")} ${count === 1 ? "stays" : "stay"} on v${preview.version}.` : null,
    preview.final_result ? `The final result stays on v${preview.version}.` : null,
  ].filter((line): line is string => line !== null);
}

/** The corrected version is reviewed again: this version or one it was corrected from is accepted (issue 341 b). */
export function reviewedAgain(row: Pick<DocumentRowView, "versions">, documentId: string): boolean {
  const seen = new Set<string>();
  let current = row.versions.find(item => item.document_id === documentId);
  while (current && !seen.has(current.document_id)) {
    if (current.translation_status === "accepted") return true;
    seen.add(current.document_id);
    const parent = current.origin === "correction" ? current.derived_from : null;
    current = parent ? row.versions.find(item => item.document_id === parent) : undefined;
  }
  return false;
}

/** Refusals whose generic admin message does not fit starting a correction. */
const START_REFUSED: Readonly<Record<string, string>> = {
  TASK_HELD: "Your earlier review of this version is paused. Resume it in the version list before you correct the translation yourself.",
  NOT_IN_WORK_PLAN: "This translation was discarded. Reload the row to see its current state.",
  VARIANT_REVIEW_STALE: "The text of this version changed. Reload the row to see the current text.",
};

export const LEAD_PAUSED = "This text is paused by a lead, so your earlier review of this version cannot continue. Release the text first (Documents, More actions, Release texts…), then correct the translation yourself.";

type Failure =
  | { kind: "languages"; missing: string[] }
  | { kind: "qualification" }
  | { kind: "not_available"; text: string }
  | { kind: "error"; error: unknown };

function failureOf(error: unknown): Failure {
  if (error instanceof ApiError && error.code === "LANGUAGE_CONFIRMATION_REQUIRED") {
    const details = isRecord(error.details) ? error.details : {};
    const own = new Set(strings(details.user_languages));
    const required = strings(details.required_languages);
    const missing = required.filter(language => !own.has(language));
    const fallback = typeof details.document_language === "string" ? [details.document_language] : [];
    return { kind: "languages", missing: missing.length ? missing : fallback };
  }
  if (error instanceof ApiError && error.code === "QUALIFICATION_REQUIRED") return { kind: "qualification" };
  if (error instanceof ApiError && error.code === "LEAD_CORRECTION_NOT_AVAILABLE") {
    const reason = isRecord(error.details) && typeof error.details.reason === "string" ? error.details.reason : "";
    if (Object.hasOwn(NOT_AVAILABLE, reason)) return { kind: "not_available", text: NOT_AVAILABLE[reason] };
  }
  // Issue 464: the earlier review is paused because a lead paused the text; resuming a report would not help.
  if (error instanceof ApiError && error.code === "TASK_HELD" && isRecord(error.details) && Array.isArray(error.details.causes) && error.details.causes.includes("lead")) {
    return { kind: "not_available", text: LEAD_PAUSED };
  }
  if (error instanceof ApiError && error.code && Object.hasOwn(START_REFUSED, error.code)) return { kind: "not_available", text: START_REFUSED[error.code] };
  return { kind: "error", error };
}

export interface LeadCorrectionPanelProps {
  row: DocumentRowView;
  projectKey: string;
  /** Opens the task (`{ name: "task", assignmentId }`) or the profile (`{ name: "me" }`). */
  onNavigate: (route: Route) => void;
  onCancel: () => void;
  /** Heading level under the row: 3 in the table (below the hidden h2 "Texts"), 5 in a card. */
  headingLevel?: 3 | 5;
  /** The version to correct (default `correctionDocumentId`): an accepted version from its version row. */
  documentId?: string;
  /** Inside a dialog whose title names the action: no heading of its own. */
  inDialog?: boolean;
}

export function LeadCorrectionPanel({ row, projectKey, onNavigate, onCancel, headingLevel = 3, documentId: chosen, inDialog = false }: LeadCorrectionPanelProps): JSX.Element {
  const Heading = `h${headingLevel}` as "h3";
  const id = useId();
  const heading = useRef<HTMLHeadingElement>(null);
  const writing = useRef(false);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<Exclude<Failure, { kind: "languages" }> | null>(null);
  /** Missing profile languages once the server asked for the confirmation (stays until answered). */
  const [missing, setMissing] = useState<string[] | null>(null);
  const [confirmLanguage, setConfirmLanguage] = useState(false);
  const documentId = chosen ?? correctionDocumentId(row);
  const entry = row.versions.find(item => item.document_id === documentId);
  const version = entry?.version ?? 1;
  const accepted = entry?.translation_status === "accepted";
  const again = reviewedAgain(row, documentId);
  const [preview, setPreview] = useState<LeadCorrectionPreview | null>(null);
  const [previewError, setPreviewError] = useState<unknown>();
  const unavailable = preview && !preview.available ? NOT_AVAILABLE[preview.reason ?? ""] ?? null : null;
  const unconfirmed = missing !== null && !confirmLanguage;
  const blocked = unconfirmed || unavailable !== null;

  useEffect(() => { if (!inDialog) heading.current?.focus(); }, [inDialog]);
  // Issue 341 b: the consequences for the work on an accepted version (or its rejected correction), before saving.
  useEffect(() => {
    if (!again) return;
    let live = true;
    api.getLeadCorrectionPreview(projectKey, documentId).then(value => { if (live) setPreview(value); }, failure => { if (live) setPreviewError(failure); });
    return () => { live = false; };
  }, [again, projectKey, documentId]);

  const start = async () => {
    if (writing.current || blocked) return;
    writing.current = true; setBusy(true); setFailure(null);
    try {
      const { text_sha256 } = await api.getVariantMetadata(projectKey, documentId);
      const assignment = await api.startLeadCorrection(projectKey, documentId, { expected_text_sha256: text_sha256, confirm_language: missing !== null && confirmLanguage });
      onNavigate({ name: "task", assignmentId: assignment.id });
    } catch (error: unknown) {
      const next = failureOf(error);
      if (next.kind === "languages") { setMissing(next.missing); setConfirmLanguage(false); } else setFailure(next);
    } finally { writing.current = false; setBusy(false); }
  };

  const next = preview?.next_version ?? version + 1;
  const consequences = preview ? correctionConsequences(preview) : [];
  const annotated = preview ? preview.annotations.submitted + preview.annotations.open > 0 : false;
  return <div className="documents-resolve" role="group" aria-labelledby={inDialog ? undefined : `${id}-title`} aria-label={inDialog ? `Correct it myself, ${textLabel(row)} v${version}` : undefined}>
    {!inDialog && <Heading id={`${id}-title`} ref={heading} tabIndex={-1} className="inline-confirm-title">{`Correct the translation, ${textLabel(row)}`}</Heading>}
    {accepted
      ? <p>{`You correct the accepted v${version} yourself in the translation review and submit it as Accepted with corrections. The corrected text becomes v${next}.`}</p>
      : again
        ? <p>{`You review v${version} yourself and submit it as Accepted with corrections. The corrected text becomes v${next} and is reviewed again.`}</p>
        : <p>{`You review v${version} yourself and submit it as Accepted with corrections. The corrected text becomes v${version + 1} and counts as accepted.`}</p>}
    {consequences.length > 0 && <InlineMessage tone="warning" title={annotated ? `Annotation has work on v${version}.` : `v${version} has work.`}>
      {consequences.map(line => <span key={line} className="lead-correction-consequence">{line} </span>)}
    </InlineMessage>}
    {again && <p className="field-hint">{`v${next} starts as a correction with review On.`}</p>}
    {unavailable && <InlineMessage tone="warning">{unavailable}</InlineMessage>}
    {previewError !== undefined && <ErrorNotice error={previewError} />}
    {missing !== null && <Checkbox id={`${id}-language`} label={`Correct despite missing ${missing.join(", ")} in your profile`}
      checked={confirmLanguage} onChange={event => setConfirmLanguage(event.target.checked)} />}
    {failure?.kind === "qualification" && <InlineMessage tone="warning">
      A translation review records your qualification. Your profile has none yet.{" "}
      <RouteLink route={{ name: "me", documents: projectKey }} className="btn btn-secondary btn-sm" onNavigate={onNavigate}>Add your qualification in your profile</RouteLink>
    </InlineMessage>}
    {failure?.kind === "not_available" && <InlineMessage tone="warning">{failure.text}</InlineMessage>}
    {failure?.kind === "error" && <ErrorNotice error={failure.error} />}
    {unconfirmed && <p id={`${id}-unconfirmed`} className="action-reason">Confirm the missing languages.</p>}
    <div className="documents-resolve-actions">
      <Button size="sm" onClick={onCancel}>Cancel</Button>
      <Button size="sm" variant="primary" loading={busy} aria-disabled={blocked || busy ? true : undefined}
        aria-describedby={unconfirmed ? `${id}-unconfirmed` : undefined} onClick={() => { void start(); }}>Open translation review</Button>
    </div>
  </div>;
}
