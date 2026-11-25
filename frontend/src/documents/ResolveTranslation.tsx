/**
 * Lead options for a translation that blocks the plan, in a dialog opened from the Documents row (issue 554; it
 * was a panel under the row, documents overview Change 13).
 * - `resolve` (rule 4, D5): what the reviewer said first, then one primary action: "Correct it myself (counts as
 *   accepted)…" for a rejected version, or, for a queried one (issue 483, legacy once Ask the lead replaces Query),
 *   the two ways to decide the query, "Accept the reviewer’s text as v2…" and "Accept v1 as it is…". The other ways
 *   sit under "Other ways…": "Reopen {reviewer}'s review…" (issue 340), "Assign a new review…", the lead's own
 *   correction for a query, and "Discard the {language} translation…" (reason required, consequences confirmed).
 * - `not_accepted` (rule 4a, D24): "Turn translation review on" or the external-review acceptance with a reason.
 */
import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { api, ApiError, type ConsequencesView, type DocumentRowView, type QueryDecisionPreview } from "../api/client";
import { textLabel } from "../app/identity";
import type { Route } from "../app/router";
import { ErrorNotice } from "../admin/ErrorNotice";
import { DiffView, scrollToFirstChange } from "../translation/DiffView";
import { diffTextBounded } from "../translation/textDiff";
import { Button, Checkbox, Dialog, InlineConfirm, InlineMessage, MenuButton, Textarea, type MenuItem } from "../ui";
import { correctionDocumentId, correctLabel, LeadCorrectionPanel, openLeadCorrection, reviewedAgain } from "./LeadCorrectionPanel";
import { stepLabel } from "./nextStepLabels";
import { QueryDecisionDialog, type QueryDecisionKind } from "./QueryDecisionDialog";
import { changedPassages } from "./UploadVersionDialog";
import { shortName } from "./stageLabels";
import { reasonDocumentId, reasonLead, reopenableReviews, reviewerName, ReviewReason, useReviewReason, workPersonName } from "./reviewReason";
import { ACCEPT_EXTERNAL_LABEL, ACCEPTANCE_RECORDED, consequenceLines, PLAN_CHANGED_MESSAGE, WITHDRAW_CHECKBOX } from "./PlanChips";

export interface ResolveTranslationProps {
  mode: "resolve" | "not_accepted";
  row: DocumentRowView;
  projectKey: string;
  /** Latest known plan revision of the case. */
  revision: number;
  /** "Assign a new review…": the assign dialog for a translation review of this row. */
  onAssignReview: () => void;
  /** Opens the lead's correction task (`{ name: "task", assignmentId }`) or the profile (`{ name: "me" }`). */
  onNavigate: (route: Route) => void;
  /** Saved: the announcement and the case's new plan revision. */
  onDone: (message: string, saved: { caseId: string; revision: number }) => void;
  /** The plan changed elsewhere (409 `WORK_PLAN_CHANGED`): a case's current revision; the page refetches. */
  onChanged: (caseId: string, revision: number) => void;
  /** The page's one shared polite live region ("Saving…"). */
  onAnnounce: (message: string) => void;
  onCancel: () => void;
  /** Where focus goes when the dialog closes (the row's action button). */
  returnFocus?: () => HTMLElement | null | undefined;
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);

/**
 * A 409 `WORK_PLAN_CHANGED`: report each case's current revision from `details.cases` (at least
 * the row's case, so the page refetches) and return true; any other failure returns false.
 */
function reportPlanChanged(failure: unknown, props: Pick<ResolveTranslationProps, "row" | "revision" | "onChanged">): boolean {
  if (!(failure instanceof ApiError) || failure.code !== "WORK_PLAN_CHANGED") return false;
  const cases = isRecord(failure.details) && Array.isArray(failure.details.cases) ? failure.details.cases : [];
  const revisions = cases.flatMap(item => (isRecord(item) && typeof item.case_id === "string" && typeof item.revision === "number" ? [[item.case_id, item.revision] as const] : []));
  if (!revisions.length) props.onChanged(props.row.case_id, props.revision);
  for (const [caseId, revision] of revisions) props.onChanged(caseId, revision);
  return true;
}

function ChangedMessage(): JSX.Element {
  return <InlineMessage tone="info">{PLAN_CHANGED_MESSAGE}</InlineMessage>;
}

export function ResolveTranslation(props: ResolveTranslationProps): JSX.Element {
  return props.mode === "resolve" ? <ResolveOptions {...props} /> : <NotAcceptedOptions {...props} />;
}

/**
 * Issue 234: who waits for this decision, from the Annotation cell (people with a task that opens once the
 * translation is accepted): "Ana Weber is waiting for this decision to start the annotation."; null for nobody.
 */
export function waitingLine(row: Pick<DocumentRowView, "stages">): string | null {
  const cell = row.stages?.annotation;
  if (cell?.state !== "after_review" && cell?.state !== "blocked") return null;
  const people = (cell.detail.people ?? []).map(shortName);
  if (!people.length) return null;
  const who = people.length === 1 ? people[0] : `${people.slice(0, -1).join(", ")} and ${people[people.length - 1]}`;
  return `${who} ${people.length === 1 ? "is" : "are"} waiting for this decision to start the annotation.`;
}

/**
 * Issue 554: the labels of the two ways to decide a query, named by their consequence ("Accept the reviewer’s
 * text as v2…", "Accept v1 as it is…"); the decision dialog they open carries the same words in its title.
 */
export function queryActionLabel(kind: QueryDecisionKind, version: number, nextVersion: number): string {
  return kind === "reviewer_text" ? `Accept the reviewer’s text as v${nextVersion}…` : `Accept v${version} as it is…`;
}

export { correctLabel };

/**
 * Issues 554 and 556: Resolve… is a dialog, not a panel under the row. What the reviewer said comes first; then one
 * primary action (two for a query: the two ways to decide it), and every other way under "Other ways…", each with
 * one line on when to use it. The steps (reopen, correct, discard) open in the same dialog; Cancel there comes back.
 */
function ResolveOptions(props: ResolveTranslationProps): JSX.Element {
  const { row, projectKey, onAssignReview, onNavigate, onDone, onAnnounce, onCancel, returnFocus } = props;
  const id = useId();
  const primaryButton = useRef<HTMLButtonElement | null>(null);
  const otherWays = useRef<HTMLSpanElement>(null);
  const [discarding, setDiscarding] = useState(false);
  const [correcting, setCorrecting] = useState(false);
  const [reopening, setReopening] = useState<DocumentRowView["work"][number] | null>(null);
  const queryButtons = useRef(new Map<QueryDecisionKind, HTMLButtonElement>());
  const [deciding, setDeciding] = useState<QueryDecisionKind | null>(null);
  const [backToOptions, setBackToOptions] = useState<"discard" | "correct" | number | null>(null);
  const [reason, setReason] = useState("");
  const [consequences, setConsequences] = useState<ConsequencesView | null>(null);
  const [understood, setUnderstood] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>();
  const [changed, setChanged] = useState(false);
  const [preview, setPreview] = useState<QueryDecisionPreview | null>(null);
  const title = `${stepLabel(row.next_step?.code ?? "resolve_rejected")}, ${textLabel(row)}`;
  const discardLabel = `Discard the ${row.language} translation`;
  // Issue 483 (legacy since Ask the lead): a query is decided by the lead; the reviewer's text can be taken as it is.
  const queried = row.next_step?.code === "resolve_queried";
  const documentId = correctionDocumentId(row);
  const version = row.versions.find(entry => entry.document_id === documentId)?.version ?? 1;
  const again = reviewedAgain(row, documentId);

  const own = openLeadCorrection(row);
  const reviewReason = useReviewReason(projectKey, reasonDocumentId(row));
  const reviewer = reviewReason ? reviewerName(row, reviewReason) : "The reviewer";
  // Issue 340: the person who rejected or queried the version may review it again (Reopen, not a new assignment).
  const reviewers = reopenableReviews(row, reasonDocumentId(row));

  // Issue 554: what the query is about, before any button: the reviewer's proposed text with its changes.
  useEffect(() => {
    if (!queried) return;
    let live = true;
    api.getQueryDecisionPreview(projectKey, documentId).then(value => { if (live) setPreview(value); }, () => { /* The decision dialog shows the failure. */ });
    return () => { live = false; };
  }, [queried, projectKey, documentId]);
  const proposed = preview?.review?.proposed_text ?? null;
  const proposal = useMemo(() => (preview && proposed !== null && preview.proposes_changes ? diffTextBounded(preview.text, proposed) : null), [preview, proposed]);
  const nextVersion = preview?.next_version ?? version + 1;
  // The reviewer proposed no change: taking their text is not possible, so it is not offered (rule 4 of issue 556).
  const canTake = preview === null || preview.proposes_changes;
  // Issue 591: the dialog opened with focus on "Accept the reviewer’s text…", offered until the preview said there is
  // no change. That button is gone now; focus fell to <body>, so it moves to the one decision left (rule 6).
  useLayoutEffect(() => {
    if (canTake) return;
    const active = document.activeElement;
    if (!active || active === document.body || !active.isConnected) primaryButton.current?.focus();
  }, [canTake]);
  // Issue 591: the proposed text opens at its first change, not at its start.
  const proposalView = useRef<HTMLDivElement>(null);

  // Cancel in the discard, correction or reopen step returns to the options with focus on what opened it.
  useEffect(() => {
    if (backToOptions === null || discarding || correcting || reopening) return;
    setBackToOptions(null);
    if (backToOptions === "correct" && primaryButton.current && !queried) primaryButton.current.focus();
    else otherWays.current?.querySelector<HTMLButtonElement>("button")?.focus();
  }, [backToOptions, discarding, correcting, reopening, queried]);

  const reopen = async () => {
    if (busy || !reopening) return;
    const name = workPersonName(reopening);
    setBusy(true); setError(undefined);
    onAnnounce("Saving…");
    try {
      await api.reopenAssignment(reopening.assignment_id, reason.trim() || undefined);
      onDone(`${name}'s review of ${textLabel(row)} was reopened.`, { caseId: row.case_id, revision: props.revision });
    } catch (failure: unknown) {
      onAnnounce("");
      setError(failure);
    } finally { setBusy(false); }
  };
  const backFromReopen = () => {
    const id = reopening?.assignment_id ?? null;
    setReopening(null); setReason(""); setError(undefined);
    setBackToOptions(id);
  };

  const discard = async () => {
    if (busy || !reason.trim()) return;
    const confirm = consequences !== null;
    setBusy(true); setError(undefined); setChanged(false);
    onAnnounce("Saving…");
    try {
      const result = await api.discardVariant(projectKey, documentId, { reason: reason.trim(), confirm });
      onDone(`The ${row.language} translation of ${row.case_id} was discarded.`, { caseId: result.case_id, revision: result.revision });
    } catch (failure: unknown) {
      onAnnounce("");
      if (failure instanceof ApiError && failure.code === "WORK_PLAN_CONFIRMATION_REQUIRED" && isRecord(failure.details)) {
        setConsequences(failure.details as unknown as ConsequencesView); setUnderstood(false);
      } else if (reportPlanChanged(failure, props)) {
        setConsequences(null); setUnderstood(false); setChanged(true);
      } else setError(failure);
    } finally { setBusy(false); }
  };
  const backFromDiscard = () => {
    setDiscarding(false); setConsequences(null); setUnderstood(false); setError(undefined); setChanged(false);
    setBackToOptions("discard");
  };

  const startCorrection = () => (own ? onNavigate({ name: "task", assignmentId: own.assignment_id }) : setCorrecting(true));
  const correctItem: MenuItem = own
    ? { id: "correct", label: "Continue your correction", description: "Your correction is open in the translation review.", onSelect: startCorrection }
    : { id: "correct", label: correctLabel(again), description: again ? `You correct v${version} yourself; v${version + 1} is reviewed again.` : `You correct v${version} yourself; v${version + 1} counts as accepted.`, onSelect: startCorrection };
  const items: MenuItem[] = [
    ...reviewers.map(item => ({ id: `reopen-${item.assignment_id}`, label: `Reopen ${workPersonName(item)}'s review…`,
      description: `${workPersonName(item)} reviews v${version} again, from its current text.`,
      onSelect: () => { setReason(""); setError(undefined); setReopening(item); } })),
    { id: "assign", label: "Assign a new review…", description: `Another reviewer reviews v${version}.`, onSelect: onAssignReview },
    ...(queried ? [correctItem] : []),
    { id: "discard", label: `${discardLabel}…`, description: "Its versions are marked as discarded. Nothing is deleted.", onSelect: () => setDiscarding(true) },
  ];

  let body: ReactNode;
  let footer: ReactNode = null;
  if (discarding) {
    const withdrawing = (consequences?.withdrawn.length ?? 0) > 0;
    const unavailable = !reason.trim() ? { reason: "Enter a reason." } : withdrawing && !understood ? { reason: "Confirm that the open tasks are withdrawn." } : null;
    body = <div className="documents-resolve">
      <InlineConfirm title={`${discardLabel} of ${row.case_id}`} tone="danger" busy={busy} confirmLabel="Discard"
        message={<p>Its versions are marked as discarded. Nothing is deleted.</p>}
        confirmUnavailable={unavailable} onConfirm={() => { void discard(); }}
        onCancel={backFromDiscard}>
        {/* Read-only (not disabled) once the consequences are shown: it stays focusable and readable. */}
        <Textarea id={`${id}-reason`} label="Reason" required maxLength={2000} value={reason}
          readOnly={consequences !== null} aria-disabled={consequences !== null || undefined}
          onChange={event => { if (consequences === null) setReason(event.target.value); }} />
        {consequences && <ul className="documents-plan-consequences">{consequenceLines(consequences).map(line => <li key={line}>{line}</li>)}</ul>}
        {withdrawing && <Checkbox id={`${id}-understood`} label={WITHDRAW_CHECKBOX} checked={understood} onChange={event => setUnderstood(event.target.checked)} />}
        {changed && <ChangedMessage />}
        {error !== undefined && <ErrorNotice error={error} />}
      </InlineConfirm>
    </div>;
  } else if (reopening) {
    const name = workPersonName(reopening);
    body = <div className="documents-resolve">
      <InlineConfirm title={`Reopen ${name}'s review of ${textLabel(row)}`} busy={busy} confirmLabel="Reopen review"
        message={<p>{`${name} reviews v${reopening.version} again, starting from its current text. The earlier decision stays in the history.`}</p>}
        onConfirm={() => { void reopen(); }} onCancel={backFromReopen}>
        <Textarea id={`${id}-reopen-reason`} label="Reason (optional)" maxLength={2000} value={reason} disabled={busy}
          onChange={event => setReason(event.target.value)} />
        {error !== undefined && <ErrorNotice error={error} />}
      </InlineConfirm>
    </div>;
  } else if (correcting) {
    body = <LeadCorrectionPanel row={row} projectKey={projectKey} onNavigate={onNavigate} headingLevel={3}
      onCancel={() => { setCorrecting(false); setBackToOptions("correct"); }} />;
  } else {
    const count = proposal ? changedPassages(proposal) : null;
    body = <div className="documents-resolve" role="group" aria-label={title}>
      {reviewReason && <ReviewReason record={reviewReason} lead={reasonLead(row, reviewReason)} />}
      {queried && preview && proposed !== null && (preview.proposes_changes
        ? <details className="documents-resolve-proposal" onToggle={event => { if (event.currentTarget.open && proposalView.current) scrollToFirstChange(proposalView.current); }}>
          <summary>{`Show the proposed text${count !== null ? ` (${count} ${count === 1 ? "passage" : "passages"} changed)` : ""}`}</summary>
          <DiffView ref={proposalView} before={preview.text} after={proposed} parts={proposal ?? undefined} lang={row.language} label={`${reviewer}’s proposed text, changes to v${version}`} />
        </details>
        : <p>{`${reviewer} proposed no change to the text.`}</p>)}
      {waitingLine(row) && <p className="documents-resolve-waiting">{waitingLine(row)}</p>}
    </div>;
    const decide = (kind: QueryDecisionKind, primary: boolean) => <Button key={kind} variant={primary ? "primary" : "secondary"}
      ref={element => {
        if (element) queryButtons.current.set(kind, element); else queryButtons.current.delete(kind);
        if (primary) primaryButton.current = element;
      }}
      onClick={() => setDeciding(kind)}>{queryActionLabel(kind, version, nextVersion)}</Button>;
    footer = <>
      <span ref={otherWays} className="documents-resolve-other">
        <MenuButton label={`Other ways to resolve ${textLabel(row)}`} buttonLabel="Other ways…" size="md" items={items} />
      </span>
      <Button onClick={onCancel}>Cancel</Button>
      {queried
        ? <>{canTake && decide("unchanged", false)}{decide(canTake ? "reviewer_text" : "unchanged", true)}</>
        : <Button ref={primaryButton} variant="primary" onClick={startCorrection}>{own ? "Continue your correction" : correctLabel(again)}</Button>}
    </>;
  }
  return <>
    <Dialog open size={queried ? "lg" : "md"} title={title} onClose={busy ? undefined : onCancel} initialFocus={primaryButton} returnFocus={returnFocus} footer={footer}>
      {body}
    </Dialog>
    {deciding && <QueryDecisionDialog kind={deciding} row={row} documentId={documentId} projectKey={projectKey}
      reviewer={reviewer}
      onDecided={message => { setDeciding(null); onDone(message, { caseId: row.case_id, revision: props.revision }); }}
      onClose={() => setDeciding(null)} returnFocus={() => queryButtons.current.get(deciding)} />}
  </>;
}

function NotAcceptedOptions(props: ResolveTranslationProps): JSX.Element {
  const { row, projectKey, revision, onDone, onAnnounce, onCancel, returnFocus } = props;
  const id = useId();
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>();
  const [changed, setChanged] = useState(false);
  const name = textLabel(row);

  const save = async (kind: "review" | "accept") => {
    if (busy || (kind === "accept" && !reason.trim())) return;
    setBusy(true); setError(undefined); setChanged(false);
    onAnnounce("Saving…");
    try {
      const result = kind === "review"
        ? await api.patchWorkPlan(projectKey, row.case_id, row.language, { review: true, expected_revision: revision, confirm: false })
        : await api.patchWorkPlan(projectKey, row.case_id, row.language, { annotate: true, expected_revision: revision, confirm: false, accept_external_review: { reason: reason.trim() } });
      onDone(kind === "review" ? `Translation review on for ${name}. Next: Assign review…` : `${name} accepted as reviewed outside Ontotator.`,
        { caseId: result.case_id, revision: result.revision });
    } catch (failure: unknown) {
      onAnnounce("");
      if (reportPlanChanged(failure, props)) setChanged(true); else setError(failure);
    } finally { setBusy(false); }
  };

  const missing = !reason.trim();
  const title = `${stepLabel("translation_not_accepted")}, ${name}`;
  return <Dialog open size="md" title={title} onClose={busy ? undefined : onCancel} returnFocus={returnFocus}
    footer={<Button onClick={onCancel}>Cancel</Button>}>
    <div className="documents-resolve" role="group" aria-label={title}>
      <p>Annotation needs an accepted translation.</p>
      <div className="documents-resolve-actions">
        <Button size="sm" aria-disabled={busy || undefined} onClick={() => { void save("review"); }}>Turn translation review on</Button>
      </div>
      <p>{ACCEPT_EXTERNAL_LABEL}</p>
      <Textarea id={`${id}-reason`} label="Reason" required maxLength={2000} value={reason} onChange={event => setReason(event.target.value)} />
      <p className="field-hint">{ACCEPTANCE_RECORDED}</p>
      {missing && <p id={`${id}-missing`} className="action-reason">Enter a reason.</p>}
      {changed && <ChangedMessage />}
      {error !== undefined && <ErrorNotice error={error} />}
      <div className="documents-resolve-actions">
        <Button size="sm" aria-disabled={missing || busy ? true : undefined} aria-describedby={missing ? `${id}-missing` : undefined}
          onClick={() => { void save("accept"); }}>Accept and annotate</Button>
      </div>
    </div>
  </Dialog>;
}
