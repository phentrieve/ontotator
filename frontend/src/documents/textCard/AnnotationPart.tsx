import { textLabel } from "../../app/identity";
import { useId, useRef, type ReactNode } from "react";
import type { DocumentRowView, RowChangeView, RowProposalSetView, RowSubmissionView } from "../../api/client";
import { plural } from "../../app/labels";
import { pausedWord } from "../labels";
import type { ProjectDocumentsQuery, Route } from "../../app/router";
import { annotationTaskName } from "../../editor/modes";
import { helpHref } from "../../help/sections";
import { Button } from "../../ui/Button";
import { StatusBadge } from "../../ui/StatusBadge";
import { RouteLink } from "../RowCells";
import { shortName } from "../stageLabels";
import type { TextVersionsTools } from "../TextVersions";
import { currentAnnotateWork, dayMonth, personVersion, rowDay, textViewRoute, type CardWorkItem } from "./cardModel";
import { PersonList, PersonRow, useFocusAfterRemoval } from "./PersonRow";
import { assignedLine, workerName, WorkPersonRow } from "./WorkPersonRow";

const NO_PROPOSALS = "This text has no tool proposals, so it is annotated from scratch.";
const MODE_TEXT = { proposals: "from proposals", scratch: "from scratch" } as const;

/**
 * An open task in a round after the first: "Round 2, started by you 17 Nov" (the lead or the person who started it,
 * from the row's changes), "Round 2" while they are not loaded; null in the first round.
 */
export function roundLine(item: Pick<CardWorkItem, "assignment_id" | "round_ordinal">, changes: readonly RowChangeView[] | null | undefined): string | null {
  const ordinal = item.round_ordinal ?? 0;
  if (ordinal < 2) return null;
  const started = [...(changes ?? [])].reverse().find(change => change.kind === "round_started" && change.assignment_id === item.assignment_id && change.round_ordinal === ordinal);
  if (!started) return `Round ${ordinal}`;
  const by = started.by ? ` by ${started.by.is_me ? "you" : shortName(started.by)}` : "";
  const day = dayMonth(started.at);
  return `Round ${ordinal}, started${by}${day ? ` ${day}` : ""}`;
}

/** How exactly a set's import time is named beside its day: not at all, "14:05" or "14:05:09". */
export type SetTime = false | "minutes" | "seconds";

/** "2026-11-10": the local day a proposal set was imported (337-A); `withTime` adds "14:05" to tell two sets of one day apart. */
export function setDate(iso: string, withTime: SetTime = false): string {
  const day = new Date(iso);
  if (Number.isNaN(day.getTime())) return iso.slice(0, 10);
  const two = (value: number) => String(value).padStart(2, "0");
  return `${day.getFullYear()}-${two(day.getMonth() + 1)}-${two(day.getDate())}${withTime ? ` ${two(day.getHours())}:${two(day.getMinutes())}${withTime === "seconds" ? `:${two(day.getSeconds())}` : ""}` : ""}`;
}

/**
 * Another set of the same day is named beside this one: both then show their time (issue 472), with seconds when
 * they were imported within the same minute.
 */
export function sameDaySets(shown: RowProposalSetView | null | undefined, others: readonly (Pick<RowProposalSetView, "set_id" | "imported_at"> | null | undefined)[]): SetTime {
  if (!shown) return false;
  const same = (time: SetTime) => others.some(other => !!other && other.set_id !== shown.set_id && setDate(other.imported_at, time) === setDate(shown.imported_at, time));
  return same("minutes") ? "seconds" : same(false) ? "minutes" : false;
}

/** "set 2026-10-02 (phentrieve 1.4), 24 proposals" (issue 337, 337-A). */
export function proposalSetText(set: RowProposalSetView, withTime: SetTime = false): string {
  const tool = [set.tool, set.tool_version].filter(Boolean).join(" ");
  return `set ${setDate(set.imported_at, withTime)}${tool ? ` (${tool})` : ""}, ${plural(set.proposal_count, "proposal")}`;
}

/** A person row names their set only when it differs from the text's: "newest set" or "set 2026-10-02". */
export function personSetText(item: Pick<CardWorkItem, "proposal_set" | "proposal_set_unrecorded">, shown: RowProposalSetView | null | undefined, withTime: SetTime = false): string | null {
  const own = item.proposal_set;
  // Started before sets were recorded: said per person only when the text's line names a set.
  if (item.proposal_set_unrecorded && shown) return "set not recorded";
  if (!own || !shown || own.set_id === shown.set_id) return null;
  return own.newest ? "newest set" : `set ${setDate(own.imported_at, withTime)}`;
}

/** "Annotators: 4 for this text (project: 1)" when the text has its own value (issue 422, 422-B). */
export function ownLimitText(row: Pick<DocumentRowView, "annotations_per_text">): string | null {
  const limit = row.annotations_per_text;
  if (!limit || limit.override == null) return null;
  return `Annotators: ${limit.override} for this text (project: ${limit.project})`;
}

/** Joins the parts of a details line with " · ". */
function joined(parts: readonly ReactNode[]): ReactNode {
  return parts.filter(Boolean).map((part, index) => <span key={index}>{index > 0 && " · "}{part}</span>);
}

/**
 * Submissions that are annotation layers: from scratch, a check of the tool proposals, or a person's work carried to a
 * newer text version (Carry to vN…, or moved by a typo fix, issue 530): the same person's annotation (issue 543).
 */
const LAYER_KINDS: ReadonlySet<RowSubmissionView["kind"]> = new Set(["annotation", "proposal_check", "carry_forward"]);

/**
 * "moved from v1" for a carried submission: the newest earlier version with the person's annotate work or submission on
 * this text (a task moved by a typo fix is withdrawn, so its submission is what is left of it).
 */
function carriedFrom(row: Pick<DocumentRowView, "work" | "moved_work">, item: CardWorkItem, submissions: readonly RowSubmissionView[] | null): string {
  const earlier = [
    ...[...row.work, ...(row.moved_work ?? [])].filter(other => other.task === "annotate" && other.author_label === item.author_label).map(other => other.version),
    ...(submissions ?? []).filter(other => LAYER_KINDS.has(other.kind) && other.author_label === item.author_label).map(other => other.version),
  ].filter(version => version < item.version);
  return earlier.length ? `moved from v${Math.max(...earlier)}` : "moved from an earlier version";
}

/** Order of the rows: unsubmitted first (needs the lead), then submitted; each by assignment date. */
const byAssignment = (a: CardWorkItem, b: CardWorkItem) => (a.assigned_at ?? "").localeCompare(b.assigned_at ?? "") || a.assignment_id - b.assignment_id;
function ordered(people: readonly CardWorkItem[]): CardWorkItem[] {
  return [...people.filter(item => item.status !== "submitted").sort(byAssignment), ...people.filter(item => item.status === "submitted").sort(byAssignment)];
}

/**
 * Annotation part of the text card (M1 card mockups v1, v3; person rows variant A): the plan control in the header (planned
 * texts), how many annotators the text has of its limit, one row per person with their status and their own actions
 * (the lead's Reassign…, Reopen…, Remove…), removed people whose submission stays in the history, and one
 * "Assign annotators…" that opens the assign dialog (also for another person beside the current ones; the lead can
 * pick themselves there).
 */
export function AnnotationPart({ row, projectKey, query, submissions, changes, canManage, onAssign, onNavigate, onChanged, tools, now, planControl, steps, actions }: {
  row: DocumentRowView;
  projectKey: string;
  query: ProjectDocumentsQuery;
  /** The row's submissions ("Open annotation" opens the person's layer); null while loading. */
  submissions: readonly RowSubmissionView[] | null;
  /** The row's changes (with the submissions): who started a person's new round, and when. */
  changes?: readonly RowChangeView[] | null;
  canManage: boolean;
  onAssign: (row: DocumentRowView, task: "annotate") => void;
  onNavigate: (route: Route) => void;
  onChanged: () => void;
  /** Assignments and members for the rows' Reassign…, Reopen… and Remove…. */
  tools?: TextVersionsTools;
  now?: Date;
  /** The annotation plan control in the header (planned texts). */
  planControl?: ReactNode;
  /** The lead's steps of this part ("Next step: …" with their buttons, issue 332). */
  steps?: ReactNode;
  /** The stage's admin actions (Assign a new review…, Change final…), joined to the part's action row. */
  actions?: ReactNode;
}): JSX.Element {
  const id = useId();
  // After a removal focus moves to the next person's first button, else "Assign annotators…".
  const assignButton = useRef<HTMLButtonElement>(null);
  const focusAfterRemoval = useFocusAfterRemoval(assignButton);
  const mode = row.annotation_mode ?? null;
  const people = ordered(currentAnnotateWork(row));
  const documents = new Set(row.versions.map(version => version.document_id));
  // The newest annotation layer per person on this text.
  const layers = new Map<string, RowSubmissionView>();
  for (const item of submissions ?? []) {
    if (!LAYER_KINDS.has(item.kind) || !documents.has(item.document_id)) continue;
    const key = `${item.author_label}\u0000${item.document_id}`;
    const seen = layers.get(key);
    if (!seen || seen.recorded_at < item.recorded_at) layers.set(key, item);
  }
  const layerOf = (authorLabel: string, documentId: string) => layers.get(`${authorLabel}\u0000${documentId}`);
  // Removed after submitting: the row's work holds active assignments only, but the submission stays in the history,
  // so its author stays listed as "Removed" (people moved to a newer version are not removed).
  const current = new Set([...row.work, ...(row.moved_work ?? [])].filter(item => item.task === "annotate").map(item => item.author_label));
  const removedPeople = [...layers.values()].filter(item => !current.has(item.author_label)).sort((a, b) => a.recorded_at.localeCompare(b.recorded_at));
  const detail = row.stages?.annotation.detail;
  const target = detail?.target ?? 0;
  const assigned = detail?.assigned ?? people.length;
  const full = target > 0 && assigned >= target;
  const annotating = row.stages?.annotation.state !== "not_planned";
  const status = target > 0 ? (assigned === 0 ? `Nobody assigned yet (limit ${target} per text).` : `${assigned} of ${target} annotators assigned.`) : null;
  const ownLimit = ownLimitText(row);
  // Version-aware as `CardPlanSelect`: "no_proposals" means the current version has none.
  const proposals = mode?.source === "no_proposals" ? 0 : mode?.proposal_count ?? row.proposal_count ?? 0;
  const setTimes = sameDaySets(row.proposal_set, [row.newer_proposal_set, ...people.map(item => item.proposal_set)]);
  const openLayer = (name: string, documentId: string, submissionId: string, removed = false) =>
    <RouteLink route={textViewRoute(projectKey, row.case_id, documentId, query, { show: `submission:${submissionId}` })} onNavigate={onNavigate}
      className="btn btn-secondary btn-sm" aria-label={`Open annotation of ${name}${removed ? " (assignment removed)" : ""}`}>Open annotation</RouteLink>;

  return <section className="text-card-part" aria-labelledby={`${id}-title`}>
    <div className="text-card-part-head">
      <h3 id={`${id}-title`} className="text-card-part-title">Annotation</h3>
      {planControl}
    </div>
    {steps}
    {/* Without the plan control (texts outside the plan, annotators) the mode is a line of its own. */}
    {!planControl && mode && <p>{annotationTaskName(mode.mode)}</p>}
    {!planControl && mode?.source === "no_proposals" && <p className="text-card-muted">{NO_PROPOSALS}</p>}
    {proposals > 0 && (row.proposal_set
      ? <p className="text-card-muted text-card-proposal-set"><span className="text-card-label">Proposals</span> {proposalSetText(row.proposal_set, setTimes)}
        {mode?.mode === "proposals" && row.newer_proposal_set && <>
          {" "}<StatusBadge tone="info">{`Newer set available: ${setDate(row.newer_proposal_set.imported_at, setTimes)}`}</StatusBadge>
          {" "}<a href={helpHref("newerProposals")} target="_blank" rel="noopener noreferrer">How to use it</a>
        </>}</p>
      : row.proposal_set_unrecorded
        ? <p className="text-card-muted text-card-proposal-set"><span className="text-card-label">Proposals</span> set not recorded (the tasks started before sets were recorded)</p>
        : <p className="text-card-muted">{plural(proposals, "tool proposal")}</p>)}
    {ownLimit && <p className="text-card-muted">{ownLimit}</p>}
    {annotating && row.unreviewed_translation && <p className="text-card-muted">Translation not reviewed yet</p>}
    {annotating && status && <p id={`${id}-status`}>{status}</p>}
    {(people.length > 0 || removedPeople.length > 0) && <PersonList label="Annotators">
      {people.map(item => {
        const layer = item.status === "submitted" ? layerOf(item.author_label, item.document_id) : undefined;
        const day = layer ? rowDay(layer.recorded_at, now) : null;
        const submittedText = layer ? `Submitted${day ? ` ${day}` : ""}, ${plural(layer.finding_count, "finding")}` : null;
        // "Assigned 18 Oct by you, from proposals · v2"; "Submitted 22 Oct, 14 findings · assigned 15 Oct · v1" (the
        // version only when the text has several, issue 445).
        // A new round of submitted work (issue: lead review F3): "Round 2, started by you 17 Nov" before the assignment.
        const roundText = item.status !== "submitted" ? roundLine(item, changes) : null;
        // A carried submission was not assigned by anyone at that moment: it says where it came from instead.
        const assignedText = layer?.kind === "carry_forward" ? carriedFrom(row, item, submissions)
          : assignedLine(item, now, !submittedText && !item.held && !roundText);
        const modeText = item.status !== "submitted" && item.annotation_mode ? MODE_TEXT[item.annotation_mode] : null;
        const details = joined([
          pausedWord(item),
          submittedText,
          roundText,
          assignedText ? <>{assignedText}{modeText && `, ${modeText}`}</> : modeText,
          personVersion(row, item),
          personSetText(item, row.proposal_set, setTimes),
        ]);
        return <WorkPersonRow key={item.assignment_id} item={item} caseId={row.case_id} textName={textLabel(row)} details={details} canManage={canManage} tools={tools}
          onChanged={onChanged} onRemoved={focusAfterRemoval} open={layer ? openLayer(workerName(item), item.document_id, layer.submission_id) : undefined} />;
      })}
      {removedPeople.map(layer => {
        const name = layer.author ? shortName(layer.author) : layer.author_label;
        // The removal date when the page's assignments still list the revoked assignment.
        const revoked = tools?.assignments.find(entry => entry.pseudonym === layer.author_label && entry.document_id === layer.document_id && entry.revoked_at)?.revoked_at;
        const submittedDay = rowDay(layer.recorded_at, now);
        return <PersonRow key={layer.submission_id} name={name} pseudonym={layer.author_label} removed status={{ tone: "neutral", label: "Removed" }}
          details={joined([revoked ? `Removed ${rowDay(revoked, now)}` : "Assignment removed", `${submittedDay ? `submitted ${submittedDay}` : "submitted"}, kept in the history`, personVersion(row, layer)])}>
          {openLayer(name, layer.document_id, layer.submission_id, true)}
        </PersonRow>;
      })}
    </PersonList>}
    {((canManage && annotating) || actions) && <div className="text-card-actions">
      {canManage && annotating && <Button ref={assignButton} size="sm" variant="primary" aria-disabled={full ? "true" : undefined} aria-describedby={full ? `${id}-status` : undefined}
        onClick={() => { if (!full) onAssign(row, "annotate"); }}>Assign annotators…</Button>}
      {actions}
    </div>}
  </section>;
}
