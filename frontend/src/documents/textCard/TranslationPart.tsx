import { textLabel } from "../../app/identity";
import { useState, type ReactNode } from "react";
import type { DocumentRowView } from "../../api/client";
import type { ProjectDocumentsQuery, Route } from "../../app/router";
import { Button } from "../../ui/Button";
import { RouteLink } from "../RowCells";
import { pausedWord, versionName } from "../labels";
import { TextVersions, type TextVersionsTools } from "../TextVersions";
import { textViewRoute } from "./cardModel";
import { PersonList, useFocusAfterRemoval } from "./PersonRow";
import { CorrectionReasonDialog, CorrectionRequestReason } from "./CorrectionReasonDialog";
import { assignedLine, workerName, WorkPersonRow } from "./WorkPersonRow";

/** Steps under which the plain review dialog has a version to assign (`assignments/batch.py`). */
const PLAIN_REVIEW_STEPS: ReadonlySet<string> = new Set(["assign_translation_review", "resolve_rejected", "resolve_queried"]);

/** The document this text was translated from: follow `derived_from` out of the row's own versions. */
function sourceDocument(row: DocumentRowView, documentId: string): string | null {
  const own = new Map(row.versions.map(version => [version.document_id, version]));
  let from = own.get(documentId)?.derived_from ?? null;
  for (let step = 0; from && own.has(from) && step < row.versions.length; step++) from = own.get(from)!.derived_from;
  return from && !own.has(from) ? from : null;
}

/**
 * Translation part of the text card: one row per open reviewer with their status and the lead's Reassign… and
 * Remove…, the part's actions, then the newest version of each chain with its status and actions; older versions are collapsed.
 */
export function TranslationPart({ row, projectKey, query, canManage, onAssign, onNavigate, onChanged, textVersionTools, now, planControl, steps, actions }: {
  row: DocumentRowView;
  projectKey: string;
  query: ProjectDocumentsQuery;
  canManage: boolean;
  onAssign: (row: DocumentRowView, task: "translation_review") => void;
  onNavigate: (route: Route) => void;
  onChanged: () => void;
  textVersionTools?: TextVersionsTools;
  now?: Date;
  /** "Review" On / Off in the header (planned translations). */
  planControl?: ReactNode;
  /** The lead's steps of this part ("Next step: …" with their buttons, issue 332). */
  steps?: ReactNode;
  /** The stage's admin actions (Assign a new review…, Change final…), joined to the part's action row. */
  actions?: ReactNode;
}): JSX.Element {
  const shown = row.versions.find(version => version.document_id === row.open.document_id) ?? row.versions[row.versions.length - 1];
  const native = row.is_source || shown?.origin === "native";
  const source = shown && !native ? sourceDocument(row, shown.document_id) : null;
  // Submitted reviews are listed under their version; the rows are the open ones.
  const reviewers = row.work.filter(item => item.task === "translation_review" && item.moved_to_version == null && item.status !== "submitted");
  const focusAfterRemoval = useFocusAfterRemoval();
  // "Add to the reason…" of a correction request (issue 483): the assignment whose dialog is open.
  const [adding, setAdding] = useState<number | null>(null);
  const addingTo = reviewers.find(item => item.assignment_id === adding && item.correction_request);
  const reviewOf = (documentId: string) => {
    const version = row.versions.find(entry => entry.document_id === documentId);
    return version ? `Review of ${versionName(version.version, version.chain_name, row.parallel_roots)}` : null;
  };
  // Issue 129, U5: a planned review nobody holds yet is the part's one next step (primary, on its own line);
  // Compare with source and the version actions follow as secondary tools.
  const reviewNext = canManage && !native && reviewers.length === 0 && row.stages?.review.state === "unassigned";
  // Issue 574 F2: the plain "Assign review…" only where its dialog can assign a review (the row's step
  // assigns one, or the lead resolves a rejected or queried version). An accepted version gets a new
  // review through "Assign a new review…" or "Ask a reviewer to correct…".
  const assignOther = canManage && !native && !reviewNext && (row.steps ?? []).some(step => PLAIN_REVIEW_STEPS.has(step.code));
  return <section className="text-card-part" aria-labelledby="text-card-translation">
    <div className="text-card-part-head">
      <h3 id="text-card-translation" className="text-card-part-title">Translation</h3>
      {planControl}
    </div>
    {native && <p>Source text</p>}
    {steps}
    {reviewers.length > 0 && <PersonList label="Translation reviewers">
      {reviewers.map(item => {
        const review = reviewOf(item.document_id);
        // "Paused by lead" first, as on an annotator's row (issue 464).
        const paused = pausedWord(item);
        const assigned = assignedLine(item, now, !review && !paused);
        const parts = [paused, review, assigned].filter(Boolean);
        const request = item.correction_request;
        const line = parts.length > 0 ? parts.map((part, index) => <span key={index}>{index > 0 && " · "}{part}</span>) : null;
        return <WorkPersonRow key={item.assignment_id} item={item} caseId={row.case_id} textName={textLabel(row)} canManage={canManage} tools={textVersionTools} onChanged={onChanged}
          onRemoved={focusAfterRemoval} details={request ? <>{line}<CorrectionRequestReason request={request} /></> : line ?? undefined}
          open={canManage && request ? <Button size="sm" aria-label={`Add to the reason for ${workerName(item)}`} onClick={() => setAdding(item.assignment_id)}>Add to the reason…</Button> : undefined} />;
      })}
    </PersonList>}
    {addingTo?.correction_request && <CorrectionReasonDialog assignmentId={addingTo.assignment_id} name={workerName(addingTo)} request={addingTo.correction_request}
      onCancel={() => setAdding(null)} onAdded={() => { setAdding(null); onChanged(); }} />}
    {reviewNext && <div className="text-card-next" role="group" aria-labelledby="text-card-translation-next">
      <p id="text-card-translation-next" className="text-card-next-label"><strong>Next step:</strong> {`assign someone to review this ${shown?.origin === "machine_translation" ? "machine translation" : "translation"}.`}</p>
      <Button variant="primary" size="sm" onClick={() => onAssign(row, "translation_review")}>Assign review…</Button>
    </div>}
    {(assignOther || source || actions) && <div className="text-card-actions">
      {assignOther && <Button size="sm" onClick={() => onAssign(row, "translation_review")}>Assign review…</Button>}
      {source && <RouteLink route={textViewRoute(projectKey, row.case_id, shown!.document_id, query, { compare: source })} onNavigate={onNavigate}
        className="btn btn-secondary btn-sm">Compare with source</RouteLink>}
      {actions}
    </div>}
    <TextVersions row={row} projectKey={projectKey} query={query} onNavigate={onNavigate} tools={textVersionTools} canManage={canManage} now={now} hideOpenWork collapseOlder />
  </section>;
}
