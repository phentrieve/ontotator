import { forwardRef, useId, type ReactNode } from "react";
import type { AssignmentView, DocumentRowView, DocumentVersionView, Member, VariantSummary } from "../api/client";
import { labelFor, taskLabels } from "../app/labels";
import type { ProjectDocumentsQuery, Route } from "../app/router";
import { personLabel as identityLabel, type PersonRef } from "../app/identity";
import { formatTime } from "../app/submissionLabels";
import { Button, StatusBadge, type StatusTone } from "../ui";
import { TranslationCorrectionAction } from "../variants/TranslationCorrectionAction";
import { originLabels } from "../admin/variantMetadata";
import { pausedWord, statusBadgeText, versionName } from "./labels";
import { RouteLink, rowName } from "./RowCells";
import type { CardWorkItem } from "./textCard/cardModel";
import { PersonList, PersonRow, useFocusAfterRemoval } from "./textCard/PersonRow";
import { workerName, WorkPersonRow, workStatus } from "./textCard/WorkPersonRow";

/** Page-level data the version actions need; without it Text versions is read-only. */
export interface TextVersionsTools {
  username: string;
  assignments: readonly AssignmentView[];
  members: Member[];
  /** Variant metadata by document id (correct translation). */
  variants: ReadonlyMap<string, VariantSummary>;
  /** Languages a translation reviewer needs (`reviewLanguages`). */
  requiredLanguages: (documentId: string) => readonly string[] | null;
  onAssignmentsChanged: () => void;
  /** Opens the translation review history of a version. */
  onShowTranslationReviews?: (documentId: string) => void;
  /** Opens the page's "Request translation correction" dialog for an accepted version (else the inline form). */
  onRequestCorrection?: (row: DocumentRowView, variant: VariantSummary) => void;
  /** The lead: "Correct it myself…" on the newest accepted version (issue 341 b). */
  onCorrectTranslation?: (row: DocumentRowView, version: DocumentVersionView) => void;
  /** The lead: "Accept this version…" on the newest version that is not reviewed or accepted (issue 341 d). */
  onAcceptVersion?: (row: DocumentRowView, version: DocumentVersionView) => void;
  /** The lead: "Upload a corrected text…" on the newest version of a translation (issue 341 a). */
  onUploadVersion?: (row: DocumentRowView, version: DocumentVersionView) => void;
  /** The lead: "Fix typos…" (an editorial correction) on the newest version of a translation (issue 453). */
  onEditorialCorrection?: (row: DocumentRowView, version: DocumentVersionView) => void;
}

/** Issue 341 d: a newest translation version that is neither reviewed nor accepted, not discarded. */
export function acceptableVersion(row: Pick<DocumentRowView, "plan_row">, version: DocumentVersionView): boolean {
  return version.is_newest_in_chain && version.translation_status != null && !["accepted", "reviewed"].includes(version.translation_status)
    && !isDiscarded(row, version);
}

/** Issue 341 b: the newest accepted translation version the lead may correct, not discarded. */
export function correctableVersion(row: Pick<DocumentRowView, "plan_row">, version: DocumentVersionView): boolean {
  return version.is_newest_in_chain && version.translation_status === "accepted" && !isDiscarded(row, version);
}

/** Issues 341 a and 453: the newest version of a translation the lead may upload a new version after or correct editorially, not discarded. */
export function uploadableVersion(row: Pick<DocumentRowView, "plan_row">, version: DocumentVersionView): boolean {
  return version.is_newest_in_chain && version.translation_status != null && !isDiscarded(row, version);
}

/** What tells "Fix typos…" apart from "Correct it myself…" and "Upload a corrected text…" (the button's tooltip). */
export const FIX_TYPOS_HINT = "Spacing, typos, grammar. Keeps the status; no review.";

/**
 * The lead's actions that change the text of a version, named by who does the work, and what tells them apart in a
 * few words: the hint line under the buttons of a version row (visible, not a tooltip: it must work on a phone).
 */
export const VERSION_ACTIONS = {
  ask: { label: "Ask a reviewer to correct…", hint: ["Ask a reviewer", "a reviewer corrects it in a new review."] },
  correct: { label: "Correct it myself…", hint: ["Correct it myself", "you edit it here; it is reviewed again."] },
  typos: { label: "Fix typos…", hint: ["Fix typos", "spacing, typos, grammar; the status stays, no review."] },
  upload: { label: "Upload a corrected text…", hint: ["Upload", "a text made elsewhere becomes the next version."] },
} as const;
export type VersionAction = keyof typeof VERSION_ACTIONS;

/** "Ask a reviewer: … Correct it myself: …" for the actions a version offers; nothing for fewer than two. */
export function VersionActionsHint({ actions }: { actions: readonly VersionAction[] }): JSX.Element | null {
  if (actions.length < 2) return null;
  return <p className="text-version-hint">
    {actions.map((action, index) => <span key={action}>{index > 0 && " "}<span className="text-version-hint-name">{VERSION_ACTIONS[action].hint[0]}:</span> {VERSION_ACTIONS[action].hint[1]}</span>)}
  </p>;
}

const uploadMethodLabels: Readonly<Record<NonNullable<DocumentVersionView["upload"]>["method"], string>> = {
  machine_translation: "Machine translation", human_translation: "Human translation", manual_correction: "Corrected by hand",
};

/** How an uploaded version was made: "Machine translation, DeepL, deepl-2026-10"; "Human translation"; "Corrected by hand". */
export function uploadMethodLabel(upload: NonNullable<DocumentVersionView["upload"]>): string {
  return [uploadMethodLabels[upload.method], upload.provider?.trim(), upload.model?.trim()].filter(Boolean).join(", ");
}

/** "12 Nov 2026" from a calendar date ("2026-11-12"), without a time zone shift. */
function calendarDate(value: string): string {
  const [year, month, day] = value.split("-").map(Number);
  if (!year || !month || !day) return value;
  return `${day} ${["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][month - 1] ?? month} ${year}`;
}

/** "Uploaded by Project lead (ann-0002), 16 Nov, 10:12 · Made on 12 Nov 2026 by Dr. Roe · Checked against the source". */
export function uploadLabel(upload: NonNullable<DocumentVersionView["upload"]>, now?: Date): string {
  const who = ["Uploaded", upload.uploaded_by ? `by ${identityLabel(upload.uploaded_by)}` : null].filter(Boolean).join(" ");
  const made = [upload.made_on ? `on ${calendarDate(upload.made_on)}` : null, upload.made_by?.trim() ? `by ${upload.made_by.trim()}` : null].filter(Boolean).join(" ");
  return [[who, upload.uploaded_at ? formatTime(upload.uploaded_at, { now }) : null].filter(Boolean).join(", "), made ? `Made ${made}` : null, upload.note?.trim()].filter(Boolean).join(" · ");
}

/** "Typo fix by Project lead (ann-0002), 17 Nov, 10:12 · Spacing; Typo" (issue 453: the record of an editorial correction). */
export function editorialCorrectionLabel(record: NonNullable<DocumentVersionView["editorial_correction"]>, now?: Date): string {
  const who = ["Typo fix", record.corrected_by ? `by ${identityLabel(record.corrected_by)}` : null].filter(Boolean).join(" ");
  return [[who, record.corrected_at ? formatTime(record.corrected_at, { now }) : null].filter(Boolean).join(", "), record.reason.trim()].filter(Boolean).join(" · ");
}

/** Acceptance record of a translation version (spec "Annotate without review: acceptance record"). */
export interface VersionAcceptance {
  source: "package" | "lead" | "override";
  reason?: string | null;
  accepted_at?: string | null;
  accepted_by?: PersonRef | null;
  /** Package metadata (`translation.review`), kept only as given. */
  reviewer?: string | null;
  reviewed_at?: string | null;
}

/** Discard record of a text version (spec "Discarding a language version"). */
export interface VersionDiscard {
  reason?: string | null;
  discarded_at?: string | null;
  discarded_by?: PersonRef | null;
}

/**
 * Records the expanded row reads from a `DocumentVersionView` when the API sends them
 * (`acceptance`, `discarded`); both stay optional so rows without them render unchanged.
 */
export interface VersionRecords {
  acceptance?: VersionAcceptance | null;
  discarded?: VersionDiscard | null;
}

export function acceptanceOf(version: DocumentVersionView): VersionAcceptance | null {
  return (version as DocumentVersionView & VersionRecords).acceptance ?? null;
}

/** A version is discarded by its own record or because every version of the row is discarded. */
export function isDiscarded(row: Pick<DocumentRowView, "plan_row">, version: DocumentVersionView): boolean {
  return !!row.plan_row?.discarded || !!(version as DocumentVersionView & VersionRecords).discarded;
}

const dateOnly = (iso: string, now?: Date) => formatTime(iso, { now }).split(", ")[0];

/**
 * "Accepted: reviewed outside Ontotator, Project lead (ann-0002), 20 Oct, 11:40, {reason}",
 * "Accepted: marked as reviewed in the package, R. Roe, 1 Oct".
 */
export function acceptanceLabel(acceptance: VersionAcceptance, now?: Date): string {
  if (acceptance.source === "package") {
    const given = [acceptance.reviewer?.trim(), acceptance.reviewed_at ? dateOnly(acceptance.reviewed_at, now) : null].filter(Boolean).join(", ");
    return ["Accepted: marked as reviewed in the package", given].filter(Boolean).join(", ");
  }
  const what = acceptance.source === "lead" ? "Accepted: reviewed outside Ontotator" : "Accepted: without review at import";
  return [what, acceptance.accepted_by ? identityLabel(acceptance.accepted_by) : null, acceptance.accepted_at ? formatTime(acceptance.accepted_at, { now }) : null,
    acceptance.reason?.trim()].filter(Boolean).join(", ");
}

/** "Discarded, Project lead (ann-0002), 19 Oct, 08:00, {reason}"; "Discarded" without a record. */
export function discardLabel(version: DocumentVersionView, now?: Date): string {
  const record = (version as DocumentVersionView & VersionRecords).discarded;
  if (!record) return "Discarded";
  return ["Discarded", record.discarded_by ? identityLabel(record.discarded_by) : null, record.discarded_at ? formatTime(record.discarded_at, { now }) : null,
    record.reason?.trim()].filter(Boolean).join(", ");
}

function badgeTone(version: DocumentVersionView): StatusTone {
  if (version.accepted_without_review || version.translation_status === "accepted") return "success";
  if (version.translation_status === "automatic_check_failed") return "warning";
  if (version.translation_status === "reviewed" && ["rejected", "query"].includes(version.latest_review_decision ?? "")) return "warning";
  return "info";
}

function originText(version: DocumentVersionView, row: DocumentRowView): string {
  if (version.origin === "correction" && version.derived_from) {
    const parent = row.versions.find(entry => entry.document_id === version.derived_from);
    if (parent) return `Correction of ${versionName(parent.version, parent.chain_name, row.parallel_roots)}`;
  }
  return labelFor(originLabels, version.origin);
}

export interface TextVersionsProps {
  row: DocumentRowView;
  projectKey: string;
  /** Current Documents query, kept on case links as `documents_*`. */
  query: ProjectDocumentsQuery;
  onNavigate: (route: Route) => void;
  tools?: TextVersionsTools;
  /** The lead: Reopen… and Remove… on the people of a version (default: with `tools`). */
  canManage?: boolean;
  /** Reference time for the current-year rule (tests). */
  now?: Date;
  /** Text card: its person rows show open work with its actions and carry every annotation's actions; list only submitted and moved work, annotations without actions. */
  hideOpenWork?: boolean;
  /** Text card: the newest version of each chain stays visible, older ones sit in a closed "Older versions (n)", grouped by chain. */
  collapseOlder?: boolean;
}

/** The status pill of a person on a version: moved work says where it went, else the work item's status. */
function versionWorkStatus(item: CardWorkItem): { tone: StatusTone; label: string } {
  if (item.moved_to_version != null) return { tone: "neutral", label: `Moved to v${item.moved_to_version}` };
  return workStatus(item);
}

/** Older versions by chain (several chains: one group per chain, in the order the chains first appear), each by version. */
function chainGroups(versions: readonly DocumentVersionView[]): { chain: string; versions: DocumentVersionView[] }[] {
  const groups = new Map<string, DocumentVersionView[]>();
  for (const version of versions) groups.set(version.chain_name, [...(groups.get(version.chain_name) ?? []), version]);
  return [...groups].map(([chain, items]) => ({ chain, versions: [...items].sort((a, b) => a.version - b.version) }));
}

/**
 * Child rows per text version of a row: origin, status with review decision, chain name, then the people who worked on
 * it as person rows (name, task, status pill, the lead's Reopen… / Remove…; issue 329), then the version's actions.
 */
export const TextVersions = forwardRef<HTMLUListElement, TextVersionsProps>(function TextVersions({ row, projectKey, query, onNavigate, tools, canManage = !!tools, now, hideOpenWork = false, collapseOlder = false }, ref) {
  const id = useId();
  const documents = Object.keys(query).length ? { documents: query } : {};
  const newest = collapseOlder ? row.versions.filter(version => version.is_newest_in_chain) : [];
  const current = newest.length ? newest : row.versions;
  const older = newest.length ? row.versions.filter(version => !version.is_newest_in_chain) : [];
  const focusAfterRemoval = useFocusAfterRemoval();
  const renderVersion = (version: DocumentVersionView): JSX.Element => {
      const name = versionName(version.version, version.chain_name, row.parallel_roots);
      const badge = statusBadgeText(version.translation_status, version.latest_review_decision, version.accepted_without_review);
      const view: Route = { name: "projectCase", key: projectKey, caseId: row.case_id, variant: version.document_id, ...documents };
      // Moved tasks (text change, "Move to v2") stay listed on their old version as history.
      const work = [...row.work.filter(item => !hideOpenWork || item.status === "submitted" || item.moved_to_version != null), ...(row.moved_work ?? [])]
        .filter(item => item.document_id === version.document_id);
      const variant = tools?.variants.get(version.document_id);
      const fullName = `${name} of ${rowName(row)}`;
      const discarded = isDiscarded(row, version);
      const acceptance = acceptanceOf(version);
      let actions: ReactNode = null;
      // The actions that change this version's text, in button order (the hint line under the buttons names them).
      const offered: VersionAction[] = [];
      if (tools) {
        const ask = !!variant && variant.translation_status === "accepted";
        const correct = !!tools.onCorrectTranslation && correctableVersion(row, version);
        const typos = !!tools.onEditorialCorrection && uploadableVersion(row, version);
        const upload = !!tools.onUploadVersion && uploadableVersion(row, version);
        if (ask) offered.push("ask");
        if (correct) offered.push("correct");
        if (typos) offered.push("typos");
        if (upload) offered.push("upload");
        actions = <>
          {variant && (tools.onRequestCorrection
            ? ask && <Button size="sm" aria-label={`Ask a reviewer to correct ${fullName}…`} onClick={() => tools.onRequestCorrection?.(row, variant)}>{VERSION_ACTIONS.ask.label}</Button>
            : <TranslationCorrectionAction projectKey={projectKey} variant={variant} username={tools.username} requiredLanguages={tools.requiredLanguages(version.document_id)} />)}
          {correct && <Button size="sm" aria-label={`Correct ${fullName} myself…`}
            onClick={() => tools.onCorrectTranslation?.(row, version)}>{VERSION_ACTIONS.correct.label}</Button>}
          {tools.onAcceptVersion && acceptableVersion(row, version) && <Button size="sm" aria-label={`Accept ${fullName}…`}
            onClick={() => tools.onAcceptVersion?.(row, version)}>Accept this version…</Button>}
          {typos && <Button size="sm" aria-label={`Fix typos in ${fullName}…`} title={FIX_TYPOS_HINT}
            onClick={() => tools.onEditorialCorrection?.(row, version)}>{VERSION_ACTIONS.typos.label}</Button>}
          {upload && <Button size="sm" aria-label={`Upload a corrected text for ${fullName}…`}
            onClick={() => tools.onUploadVersion?.(row, version)}>{VERSION_ACTIONS.upload.label}</Button>}
          {version.translation_status != null && tools.onShowTranslationReviews && <Button size="sm" aria-label={`Translation reviews for ${name}`} onClick={() => tools.onShowTranslationReviews?.(version.document_id)}>Translation reviews</Button>}
        </>;
      }
      return <li key={version.document_id} className="text-version">
        <div className="text-version-head">
          <span className="text-version-name">{name}</span>
          <span className="text-version-origin">{originText(version, row)}{version.upload && ` · ${uploadMethodLabel(version.upload)}`}</span>
          {badge && <StatusBadge tone={badgeTone(version)}>{badge}</StatusBadge>}
          {discarded && <StatusBadge tone="neutral">Discarded</StatusBadge>}
          {/* With several chains the name already carries the chain. */}
          {!row.parallel_roots && <span className="text-version-chain">{version.chain_name}</span>}
          {!version.matches_filter && <span className="cell-secondary">Does not match the filters</span>}
        </div>
        {version.upload && <p className="text-version-record">{uploadLabel(version.upload, now)}</p>}
        {version.editorial_correction && <p className="text-version-record">{editorialCorrectionLabel(version.editorial_correction, now)}</p>}
        {acceptance && <p className="text-version-record">{acceptanceLabel(acceptance, now)}</p>}
        {discarded && discardLabel(version, now) !== "Discarded" && <p className="text-version-record">{discardLabel(version, now)}</p>}
        {work.length > 0 && <PersonList label={`Assignments on ${name}`}>
          {work.map(item => {
            const details = <>{labelFor(taskLabels, item.task)}{item.held && ` · ${pausedWord(item)}`}</>;
            // Moved work is history; annotations carry their actions in the Annotation part (text card).
            const plain = item.moved_to_version != null || (hideOpenWork && item.task === "annotate");
            return plain
              ? <PersonRow key={`${item.assignment_id}-${item.moved_to_version ?? ""}`} name={workerName(item)} pseudonym={item.person?.pseudonym ?? item.author_label} details={details} status={versionWorkStatus(item)} />
              : <WorkPersonRow key={item.assignment_id} item={item} caseId={row.case_id} textName={fullName} details={details} canManage={canManage} tools={tools}
                onChanged={() => tools?.onAssignmentsChanged()} onRemoved={focusAfterRemoval} />;
          })}
        </PersonList>}
        <div className="text-version-actions">
          <RouteLink route={view} onNavigate={onNavigate} className="btn btn-secondary btn-sm" aria-label={`View text ${fullName}`}>View text</RouteLink>
          {actions}
        </div>
        <VersionActionsHint actions={offered} />
      </li>;
  };
  const groups = row.parallel_roots ? chainGroups(older) : [{ chain: "", versions: older }];
  return <ul ref={ref} className="text-versions">
    {current.map(renderVersion)}
    {older.length > 0 && <li className="text-version-older">
      <details>
        <summary>{`Older versions (${older.length})`}</summary>
        {groups.map(({ chain, versions }, index) => chain
          ? <section key={chain} className="text-version-group" aria-labelledby={`${id}-chain-${index}`}>
            <h4 id={`${id}-chain-${index}`} className="text-version-group-title">{chain}</h4>
            <ul className="text-versions">{versions.map(renderVersion)}</ul>
          </section>
          : <ul key="all" className="text-versions">{versions.map(renderVersion)}</ul>)}
      </details>
    </li>}
  </ul>;
});
