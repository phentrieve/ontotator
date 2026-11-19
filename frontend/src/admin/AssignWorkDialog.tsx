import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import { api, ApiError, type BatchAssignRequest, type BatchPersonView, type BatchPreview, type BatchSkipView, type DocumentRowFilters, type DocumentRowView, type RowRefView } from "../api/client";
import { personLabel, textLabel } from "../app/identity";
import { assignedText } from "../app/assignedDate";
import { plural } from "../app/labels";
import { versionName } from "../documents/labels";
import { reopenableReviews, workPersonName } from "../documents/reviewReason";
import { Button, Checkbox, Dialog, InlineConfirm, InlineMessage, Popover, Select, StatusBadge, Textarea } from "../ui";
import { DistributionDialog } from "./DistributionDialog";
import { ErrorNotice } from "./ErrorNotice";
import { errorMessage } from "./errors";
import { holdersLine, leftLines, MAX_ANNOTATORS_PER_TEXT, memberReason, memberUnavailable, onePersonSummary, partlyAssignedLines, personName, resultMessage, skippedLines, stepLabel, stepName, stepShortLabel, stepsOverview } from "./assignSummary";

export type AssignWorkTask = "translation_review" | "annotate";
export type AssignWorkDialogProps =
  | { mode: "row"; projectKey: string; row: DocumentRowView; task: AssignWorkTask; newReviewOfAccepted?: boolean; reviewReason?: "source_changed";
    /** The lead: listed as "<name> (you)" for annotation; picking them uses the self-assignment (P3 grants the annotator role). */
    me?: { username: string; name: string };
    /** Project rule "the consolidator is not an annotator": its hint shows with the lead's own entry. */
    consolidatorRule?: boolean;
    onClose: () => void; onAssigned: (message: string) => void; onLimitChanged?: () => void }
  | { mode: "cases"; projectKey: string; caseIds: readonly string[]; sort: "case" | "import" | "activity"; filters: DocumentRowFilters;
    /** The selected texts: the dialog says how many of them a lead paused (issue 464). */
    rows?: readonly RowRefView[];
    /** The lead: without the annotator role their row offers "Add me as annotator". */
    me?: { username: string; name: string };
    onClose: () => void; onAssigned: (message: string, skipped: readonly string[]) => void; onLimitChanged?: () => void };

/**
 * Issue 464: assigning on a text a lead paused stays possible; the task is paused from the start. "This text is paused by a
 * lead …" for one text, "2 of the selected texts are paused by a lead …" for a selection.
 */
export function pausedAssignText(texts: number, single: boolean): string {
  const tail = "paused from the start (“Paused by lead” in My tasks) until";
  return single ? `This text is paused by a lead. A task assigned now is ${tail} you release the text.`
    : `${texts === 1 ? "1 of the selected texts is" : `${texts} of the selected texts are`} paused by a lead. Tasks assigned there are ${tail} you release ${texts === 1 ? "the text" : "the texts"}.`;
}

type Preview = BatchPreview;
/** `later`: annotation that becomes assignable once the review of its text is assigned; shown, not yet walked to. */
type Step = { task: AssignWorkTask; language: string; versions: number; later?: boolean };
/** `steps` are done, `passed` were skipped; `assigned` and `skipped` are cases. */
type Walked = { steps: string[]; passed: string[]; messages: string[]; assigned: string[]; skipped: string[] };
type CasesProps = Extract<AssignWorkDialogProps, { mode: "cases" }>;
type Refused = { case_id: string; language: string; username: string; code: string };
const stepKey = (task: string, language: string) => `${task}:${language}`;
const isTask = (value: string): value is AssignWorkTask => value === "translation_review" || value === "annotate";

export function AssignWorkDialog(props: AssignWorkDialogProps): JSX.Element {
  const identity = props.mode === "row" ? ["row", props.projectKey, props.row.case_id, props.row.language, props.task, !!props.newReviewOfAccepted, props.reviewReason ?? null] : ["cases", props.projectKey, props.caseIds];
  return <AssignWorkEditor key={JSON.stringify(identity)} {...props} />;
}

const rank = (person: BatchPersonView) => memberUnavailable(person) ? 2 : person.language_mismatch ? 1 : 0;
/** Reads the task language(s) first, then fewest open tasks, then name; unavailable people last. */
export const sortMembers = (people: readonly BatchPersonView[]): BatchPersonView[] => [...people].sort((a, b) =>
  rank(a) - rank(b) || a.open_before - b.open_before || personName(a.person).localeCompare(personName(b.person)) || a.username.localeCompare(b.username));

/** A text the limit popover can change on its own (issue 422). */
export type LimitText = { case_id: string; language: string;
  /** The text's limit now (its own value, else the project's) and the annotators it holds. */
  limit: number; assigned: number };
/** Where the popover's value goes: the selected texts (their own value) or the project setting. */
export type LimitScope = "texts" | "project";
const annotators = (n: number) => n === 1 ? "1 annotator" : `${n} annotators`;

/**
 * M2 D5, B7-5 (mockup 03 variant A): "Change…" beside "1 of N possible" (issue 469; earlier a small (i)) opens a popover
 * that explains the limit and changes it right away. Issue 422 (422-B): "Only for the selected text(s)" gives those texts their own value (the same as the
 * project's follows the project again), "For all texts" changes the project setting. Lowering it only warns; no assignment
 * is ever removed. Saving reloads the member list with the new limit; the dialog and its selection stay.
 */
function LimitInfo({ projectKey, current, project, texts, textName, onSaved, onFailed }: {
  projectKey: string;
  /** The limit of the selected texts (their own value, else the project's). */
  current: number;
  /** The project setting. */
  project: number;
  /** The selected texts of this step; empty: only the project setting can change. */
  texts: readonly LimitText[];
  textName?: string;
  onSaved: (value: number, scope: LimitScope, texts: number) => void;
  /** A save was refused: the caller reloads what the dialog shows. */
  onFailed?: () => void;
}): JSX.Element {
  const id = useId();
  const anchor = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState(String(current));
  const [scope, setScopeState] = useState<LimitScope>(texts.length ? "texts" : "project");
  /** The lead typed a number: it stays when the scope changes (issue 469). */
  const [typed, setTyped] = useState(false);
  /** The lead typed or chose a scope: from then on the popover says why its button cannot act. */
  const [touched, setTouched] = useState(false);
  /**
   * An untouched field starts each scope from its own value: the project field never takes over a text's value
   * silently. A typed number is the lead's and is kept.
   */
  const setScope = (next: LimitScope) => { setScopeState(next); setTouched(true); if (!typed) setValue(String(next === "project" ? project : current)); };
  const [over, setOver] = useState<{ target: number; rows: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>();
  const target = Number(value);
  const valid = Number.isInteger(target) && target >= 1 && target <= MAX_ANNOTATORS_PER_TEXT;
  const forTexts = scope === "texts" && texts.length > 0;
  // Texts with different limits: no single "current" value; each text is compared with its own.
  const mixed = texts.some(text => text.limit !== current);
  const unchanged = forTexts ? texts.every(text => text.limit === target) : target === project;
  const own = texts.length > 0 && !mixed && current !== project;
  const limits = texts.map(text => text.limit);
  /** Texts that already hold more annotators than the entered limit: they keep them. */
  const overTexts = forTexts && valid ? texts.filter(text => text.assigned > target).length : 0;
  useEffect(() => {
    if (!open || forTexts || !valid || target >= project) return;
    let active = true;
    const timer = window.setTimeout(() => {
      api.annotationTargetPreview(projectKey, target).then(result => { if (active) setOver({ target, rows: result.rows_over_target }); }, () => { if (active) setOver(null); });
    }, 250);
    return () => { active = false; window.clearTimeout(timer); };
  }, [open, projectKey, target, valid, project, forTexts]);
  const rows = !forTexts && valid && target < project && over?.target === target ? over.rows : null;
  const close = () => { if (!busy) { setOpen(false); setError(undefined); setScopeState(texts.length ? "texts" : "project"); setValue(String(current)); setTyped(false); setTouched(false); } };
  /** Why "Change for …" cannot act with this number in this scope; null while it can. */
  const idle = !valid ? `Enter a whole number from 1 to ${MAX_ANNOTATORS_PER_TEXT}.`
    : !unchanged ? null
    : forTexts ? `${texts.length === 1 ? "This text already has" : "These texts already have"} the limit ${target}. Enter another number, or choose "For all texts".`
    : `The project setting is already ${target}. Enter another number${texts.length ? `, or choose "${texts.length === 1 ? "Only for the selected text" : "Only for the selected texts"}"` : ""}.`;
  const save = async () => {
    if (busy) return;
    // Nothing to change: the popover says why (issue 469), it does not close in silence.
    if (idle) { setTouched(true); return; }
    setBusy(true); setError(undefined);
    try {
      // The project's value again: the texts follow the project setting (no own value). One request, all or nothing;
      // the server compares each text with its own value.
      if (forTexts) await api.setAnnotationsPerTexts(projectKey, texts.map(text => ({ case_id: text.case_id, language: text.language })), target === project ? null : target);
      else await api.updateProjectSettings(projectKey, { annotations_per_text: target });
      setOpen(false); onSaved(target, forTexts ? "texts" : "project", texts.length);
    }
    catch (failure: unknown) { setError(failure); onFailed?.(); }
    finally { setBusy(false); }
  };
  const selectedLabel = texts.length === 1 ? `Only for the selected text${textName ? ` (${textName})` : ""}` : `Only for the selected texts (${texts.length})`;
  return <>
    {/* Issue 469: a labelled button; the name says what it changes. */}
    <Button ref={anchor} size="sm" className="assign-limit-change" aria-label={`Change… (limit: ${annotators(current)} per text)`}
      aria-expanded={open} aria-controls={open ? `${id}-limit` : undefined} onClick={() => open ? close() : setOpen(true)}>Change…</Button>
    <Popover open={open} anchorRef={anchor} label="Annotators per text" onClose={close} footer={<>
      <Button size="sm" disabled={busy} onClick={close}>Cancel</Button>
      <Button size="sm" variant="primary" loading={busy} aria-disabled={!valid || unchanged || undefined} aria-describedby={idle && touched ? `${id}-idle` : undefined} onClick={() => { void save(); }}>
        {forTexts ? `Change for ${plural(texts.length, "text")}` : "Change for all texts"}</Button>
    </>}>
      <div id={`${id}-limit`} className="assign-limit-popover">
        {/* The title says whose limit it is; the explanation follows the chosen scope (issue 422). */}
        <h3>{mixed ? `Limits differ: ${Math.min(...limits)} to ${Math.max(...limits)} annotators per text (project: ${project})`
          : own ? `Up to ${annotators(current)} for ${texts.length === 1 ? "this text" : "these texts"} (project: ${project})` : `Up to ${annotators(current)} per text`}</h3>
        {forTexts
          ? <p>{`Sets the most annotators for ${texts.length === 1 ? "this text" : `these ${texts.length} texts`} only (project: ${project}). Fewer is fine.`}</p>
          : <p>This is a <strong>project setting</strong>: the most annotators any text can get. Fewer is fine.</p>}
        {/* R-11: a compact inline number field, as high as the small buttons. */}
        <p className="assign-limit-field"><label htmlFor={`${id}-per-text`}>Annotators per text</label>
          <input id={`${id}-per-text`} className="form-control assign-limit-input" type="number" min={1} max={MAX_ANNOTATORS_PER_TEXT} step={1} required value={value} disabled={busy}
            onChange={event => { setValue(event.target.value); setTyped(true); setTouched(true); }}
            onKeyDown={event => { if (event.key === "Enter") { event.preventDefault(); void save(); } }} /></p>
        {texts.length > 0 && <div role="radiogroup" aria-label="Change it for" className="assign-limit-scope">
          <label className="form-checkbox-row"><input type="radio" name={`${id}-scope`} checked={scope === "texts"} disabled={busy} onChange={() => setScope("texts")} />
            <span>{selectedLabel}</span></label>
          <label className="form-checkbox-row"><input type="radio" name={`${id}-scope`} checked={scope === "project"} disabled={busy} onChange={() => setScope("project")} />
            <span>For all texts</span></label>
        </div>}
        {overTexts > 0 && <p role="status" className="assign-limit-warn">{texts.length === 1 ? "This text already has more; its assignments stay."
          : `${overTexts === 1 ? "1 text already has" : `${overTexts} texts already have`} more; their assignments stay.`}</p>}
        {rows !== null && rows > 0 && <p role="status" className="assign-limit-warn">{`${rows === 1 ? "1 text already has" : `${rows} texts already have`} more; their assignments stay.`}</p>}
        {!forTexts && <p className="assign-limit-warn">Changing it changes the limit for <strong>all texts</strong> in this project{textName ? `, not only ${textName}` : ""}. Texts with their own value keep it.</p>}
        {forTexts && valid && target === project && (own || mixed) && <p className="assign-muted">The project setting again: {texts.length === 1 ? "the text follows" : "the texts follow"} the project from now on.</p>}
        {idle && touched && <p id={`${id}-idle`} role="status" className="assign-limit-warn">{idle}</p>}
        {error !== undefined && <ErrorNotice error={error} />}
      </div>
    </Popover>
  </>;
}

/** Issue 488: in which order a person sees the tasks this dialog creates (My tasks and the editor's next task). */
export const TASK_ORDER_NOTE = "My tasks lists a person's tasks by status, then in the order of assignment. New tasks come after the tasks the person already has.";
export const TASK_ORDER_NOTE_TEXTS = "These texts are assigned in the order shown above.";

/** Texts the batch dialog names before "Show all" (issue 129, U4). */
export const NAMED_TEXTS = 6;

/** "case-0101 de, case-0102 de v2": the texts that get the task, in the preview's order, each once. */
export function targetTextNames(targets: readonly { case_id: string; language: string; version: number }[]): string[] {
  return [...new Set(targets.map(item => textLabel(item, { withVersion: item.version > 1 })))];
}

/** Why one text cannot get an annotator now (R-12), from the preview's skip reason. */
function rowBlockedText(reason: BatchSkipView["reason"] | undefined, perText: number, language: string, assigned: number): string {
  switch (reason) {
    case "waiting_for_review": return "This text has no translation review under way. Annotation can be assigned once a review is assigned or the translation is accepted.";
    case "not_in_plan": return `Annotation of this text is not in the plan for ${language}. Turn it on with Plan… first.`;
    // Issue 469: both numbers; a text can hold more than its limit (the limit was lowered).
    case "already_assigned": return `Limit reached: ${assigned} assigned, limit ${perText}.`;
    case "step_differs": return "This text is at another step of the plan.";
    case "discarded": return `The ${language} version of this text is discarded.`;
    case "no_proposals_on_version": return "This text's annotation started from tool proposals, but its newest version has none. Change the plan to annotate from scratch.";
    case "other_root_in_review": return "A parallel translation of this text is still in review. Annotation can be assigned once that review is accepted.";
    default: return "This text cannot get an annotator now.";
  }
}

function refusedRows(error: ApiError): Refused[] {
  const rows = error.details && typeof error.details === "object" ? (error.details as { refused?: unknown }).refused : undefined;
  return Array.isArray(rows) ? rows.filter((row): row is Refused => !!row && typeof row === "object" && typeof row.case_id === "string" && typeof row.username === "string" && typeof row.code === "string") : [];
}

const casesPreview = (props: CasesProps, task: AssignWorkTask, language: string) => api.previewAssignmentBatch(props.projectKey,
  { task, language, case_ids: [...props.caseIds], sort: props.sort, filters: props.filters, mode: task === "annotate" ? "each" : "one", usernames: [] });

/** Reviews first: annotation may depend on them (issue 218). */
const walkOrder = (steps: readonly Step[]): Step[] => [...steps].sort((a, b) => Number(a.task === "annotate") - Number(b.task === "annotate"));

/** The selection's steps as the server sees them now. */
async function loadSteps(props: CasesProps): Promise<Step[]> {
  const summary = await api.selectionSummary(props.projectKey, props.caseIds, props.filters);
  const found: Step[] = summary.steps.filter(step => isTask(step.task)).map(step => ({ task: step.task as AssignWorkTask, language: step.language, versions: step.versions }));
  const held = [...new Set(found.filter(step => step.task === "translation_review").map(step => step.language))].filter(language => !found.some(step => step.task === "annotate" && step.language === language));
  const later = await Promise.all(held.map(async language => ({ language, versions: (await casesPreview(props, "annotate", language)).skipped.filter(item => item.reason === "waiting_for_review").length })));
  return walkOrder([...found, ...later.filter(item => item.versions).map(item => ({ ...item, task: "annotate" as const, later: true }))]);
}

/** What the selection still needs and nobody took: a text with some annotators is not left, the limit is an upper bound. */
async function leftUnassigned(props: CasesProps) {
  const open = (await loadSteps(props)).filter(step => !step.later);
  const previews = await Promise.all(open.map(step => casesPreview(props, step.task, step.language)));
  return open.map((step, at) => ({ task: step.task, targets: previews[at].targets.filter(target => target.remaining === target.per_text) })).filter(item => item.targets.length);
}

function AssignWorkEditor(props: AssignWorkDialogProps): JSX.Element {
  const id = useId();
  const isRow = props.mode === "row";
  // Issue 464: how many of the texts a lead paused; their new tasks are paused from the start.
  const selectedRows = props.mode === "cases" ? props.rows : undefined;
  const [pausedSelected, setPausedSelected] = useState(0);
  useEffect(() => {
    if (!selectedRows?.length) return;
    let active = true;
    // A release preview counts the paused texts of the selection; without it the note is left out.
    api.pauseTexts(props.projectKey, "release", { rows: [...selectedRows], preview: true, summary_only: true }).then(found => { if (active) setPausedSelected(found.change_count); }, () => undefined);
    return () => { active = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the dialog is keyed by its selection
  }, []);
  const pausedTexts = props.mode === "row" ? (props.row.lead_pause ? 1 : 0) : pausedSelected;
  const [steps, setSteps] = useState<Step[] | null>(isRow ? [] : null);
  const [stepsError, setStepsError] = useState<unknown>();
  const [stepsRetry, setStepsRetry] = useState(0);
  const [current, setCurrent] = useState<string | null>(props.mode === "row" ? stepKey(props.task, props.row.language) : null);
  const [changingTask, setChangingTask] = useState(false);
  const [chosen, setChosen] = useState<string[]>([]);
  const [self, setSelf] = useState(false);
  const [reload, setReload] = useState(0);
  const [preview, setPreview] = useState<{ key: string; step: string; value: Preview } | null>(null);
  const [previewError, setPreviewError] = useState<{ key: string; error: unknown } | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [refused, setRefused] = useState<Refused[]>([]);
  const [failure, setFailure] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [randomOpen, setRandomOpen] = useState(false);
  const [acknowledged, setAcknowledged] = useState(false);
  const [limitSaved, setLimitSaved] = useState<string | null>(null);
  const [allTexts, setAllTexts] = useState(false);
  const [reopening, setReopening] = useState<DocumentRowView["work"][number] | null>(null);
  const [reopenReason, setReopenReason] = useState("");
  const [reopenError, setReopenError] = useState<unknown>();
  /** Cases mode walks through the selection's steps (issues 195, 218): what earlier steps of this dialog assigned. */
  const [done, setDone] = useState<Walked>({ steps: [], passed: [], messages: [], assigned: [], skipped: [] });
  const randomChanged = useRef(false);
  const writing = useRef(false);
  const alive = useRef(true);
  const sequence = useRef(0);
  const inputs = useRef(new Map<string, HTMLInputElement>());
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);

  // Cases mode: the assignable steps of the selection; it starts on the first of them.
  const caseIdsKey = props.mode === "cases" ? JSON.stringify(props.caseIds) : "";
  const filtersKey = props.mode === "cases" ? JSON.stringify(props.filters) : "";
  useEffect(() => {
    if (props.mode !== "cases") return;
    let active = true;
    setSteps(null); setStepsError(undefined);
    void loadSteps(props).then(found => {
      if (!active) return;
      setSteps(found);
      const first = found.find(step => !step.later);
      setCurrent(first ? stepKey(first.task, first.language) : null);
    }, error => { if (active) setStepsError(error); });
    return () => { active = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the keys stand for caseIds and filters
  }, [props.projectKey, caseIdsKey, filtersKey, stepsRetry]);

  const [taskText, language] = current ? [current.slice(0, current.indexOf(":")), current.slice(current.indexOf(":") + 1)] : ["", ""];
  const task: AssignWorkTask | null = isTask(taskText) ? taskText : null;
  /** Annotation takes several people per text: tick them (checkboxes) up to the limit; a review takes one (radios). */
  const multi = task === "annotate";
  const rowMulti = isRow && multi;
  /** "Assign review…" for a changed source: the review resolves the source-change obligation (spec V5). */
  const sourceChanged = props.mode === "row" && props.reviewReason === "source_changed" && task === "translation_review";
  // A step's preview stays while its people are ticked, never under the next step's title.
  const shown = preview?.step === current ? preview.value : null;
  const me = props.mode === "row" && task === "annotate" ? props.me ?? null : null;
  const people = shown ? sortMembers(shown.people.filter(person => person.username !== me?.username)) : [];
  /** One text: people who already hold this task show a status instead of a choice (F24). */
  const holds = (person: BatchPersonView) => isRow && person.already_assigned > 0;
  /** Issue 340: a holder whose translation review is submitted gets "Reopen their review…", not a new assignment. */
  const submittedReview = (person: BatchPersonView) => props.mode === "row" && task === "translation_review" && holds(person)
    && !props.row.work.some(item => item.task === task && item.status !== "submitted" && item.moved_to_version == null && item.person?.pseudonym === person.person.pseudonym)
    ? reopenableReviews(props.row).find(item => item.person?.pseudonym === person.person.pseudonym) : undefined;
  const heldBy = people.filter(holds);
  const submittedBy = heldBy.filter(person => submittedReview(person));
  const openBy = heldBy.filter(person => !submittedReview(person));
  const order = people.map(person => person.username);
  const usernames = order.filter(name => chosen.includes(name));
  const picked = usernames.length + (self ? 1 : 0);
  // One rule for one text and many: every ticked person gets every text up to the limit ("each"); "Distribute evenly…" splits a batch.
  const apiMode: BatchAssignRequest["mode"] = multi ? "each" : "one";
  const request: BatchAssignRequest | null = !task ? null : props.mode === "row"
    ? { task, language, case_ids: [props.row.case_id], mode: apiMode, usernames, ...(props.newReviewOfAccepted && task === "translation_review" ? { review_accepted_translation: true } : {}), ...(sourceChanged ? { review_reason: "source_changed" as const } : {}) }
    : { task, language, case_ids: [...props.caseIds], sort: props.sort, filters: props.filters, mode: apiMode, usernames };
  const requestKey = request ? JSON.stringify([request, reload]) : "";

  useEffect(() => {
    if (!requestKey) return;
    const seq = ++sequence.current;
    const [body] = JSON.parse(requestKey) as [BatchAssignRequest];
    void api.previewAssignmentBatch(props.projectKey, body).then(value => {
      if (alive.current && seq === sequence.current) { setPreview({ key: requestKey, step: stepKey(body.task, body.language), value }); setPreviewError(null); }
    }, error => { if (alive.current && seq === sequence.current) setPreviewError({ key: requestKey, error }); });
  }, [props.projectKey, requestKey]);

  // People who left the project or became unavailable are dropped from the choice.
  useEffect(() => {
    if (!shown) return;
    setChosen(names => {
      const kept = names.filter(name => shown.people.some(person => person.username === name && !memberUnavailable(person)));
      return kept.length === names.length ? names : kept;
    });
  }, [shown]);

  const calculating = !!requestKey && preview?.key !== requestKey && previewError?.key !== requestKey;
  const fresh = shown && !calculating ? shown : null;
  const radios = !multi;
  const chosenPeople = fresh ? people.filter(person => usernames.includes(person.username)) : [];
  const assignments = fresh ? fresh.targets.reduce((sum, target) => sum + target.usernames.length, 0) : 0;
  const count = assignments || fresh?.versions || shown?.versions || 0;
  // R-12: a text the preview has no target for has no free place (its skip reason says why); never a made-up 1.
  // Several texts: as many people as the text with the highest limit takes (issue 422); the server gives each text
  // only as many as it has places.
  const perTextCap = shown ? Math.max(shown.per_text, ...shown.targets.map(target => target.per_text)) : 1;
  const limit = rowMulti ? shown?.targets[0]?.remaining ?? (shown ? 0 : 1) : multi ? perTextCap : Infinity;
  /** R-13: annotators the text already has (the limit is an upper bound, never a required number). */
  const assignedCount = shown?.targets[0] ? shown.targets[0].per_text - shown.targets[0].remaining
    : props.mode === "row" ? props.row.work.filter(item => item.task === "annotate" && item.moved_to_version == null).length : 0;
  const skip = shown?.skipped[0];
  const blocked = rowMulti && !!shown && !shown.targets.length ? rowBlockedText(skip?.reason, skip?.per_text ?? shown.per_text, language, skip?.assigned ?? assignedCount) : null;
  /** Issue 469: why a row is grey once every place is taken. It is the text's limit, not the person's. */
  const noPlace = `no free place (${shown && shown.targets.some(target => target.per_text !== perTextCap) ? "up to " : ""}${perTextCap} per text)`;
  // Row mode knows it before the preview, so the acknowledgement is there from the start (no jump).
  const unreviewed = task === "annotate" && shown ? shown.targets.filter(target => target.unreviewed_translation) : [];
  const unreviewedText = unreviewed.length > 0 || (props.mode === "row" && task === "annotate" && props.row.unreviewed_translation);
  const unacknowledged = unreviewedText && !acknowledged;
  // One text: a random draw needs more available people than open places.
  const randomUseful = !!fresh && fresh.targets.some(item => item.remaining > 0)
    && fresh.people.filter(person => !memberUnavailable(person)).length > Math.max(...fresh.targets.map(item => item.remaining));
  const meHolds = !!me && props.mode === "row" && props.row.work.some(item => item.task === "annotate" && item.is_me && item.moved_to_version == null);

  /** "Add me as annotator" (F23): the lead adds the role (Documents is lead-only, and leads manage members), then the preview reloads. */
  const addMeAsAnnotator = async () => {
    const username = props.me?.username;
    if (!username || writing.current) return;
    writing.current = true; setBusy(true); reset();
    try {
      const roles = (await api.listMembers(props.projectKey)).find(member => member.username === username)?.roles ?? [];
      await api.setMemberRoles(props.projectKey, username, [...new Set([...roles, "annotator"])]);
      if (alive.current) setReload(value => value + 1);
    } catch (error: unknown) {
      if (alive.current) setFailure(errorMessage(error));
    } finally { if (alive.current) { writing.current = false; setBusy(false); } }
  };

  const reset = () => { setConfirming(false); setRefused([]); setFailure(null); setNotice(null); };
  const choose = (username: string, checked: boolean) => {
    if (busy) return;
    reset();
    if (radios) setChosen([username]);
    else setChosen(names => checked ? (names.includes(username) || names.length + (self ? 1 : 0) >= limit ? names : [...names, username]) : names.filter(name => name !== username));
  };
  const chooseSelf = (checked: boolean) => {
    if (busy) return;
    reset();
    setSelf(checked && (picked < limit || self));
  };

  const reason = stepsError !== undefined ? "The tasks could not load. Use Retry."
    : !task || steps === null ? "Loading…"
    : previewError && !fresh ? "The preview could not load. Use Retry."
    : calculating || !fresh ? "Calculating…"
    : !fresh.targets.length ? blocked ?? "No cases in the selection need this task."
    : unacknowledged ? "Confirm annotating before the translation review is accepted."
    : !picked ? (radios ? "Choose a person first." : "Choose people first.")
    : usernames.length && !assignments ? "The chosen people already hold these tasks."
    : null;

  /** Closes with everything assigned so far and what the selection still needs: a case with work on one text can be left on another. */
  const finish = async (walked: Walked) => {
    const text = walked.messages.join(". ");
    if (props.mode === "row") { props.onAssigned(text); return; }
    const left = await leftUnassigned(props).catch(() => null);
    if (!alive.current) return;
    const cases = (left ?? []).flatMap(item => item.targets.map(target => target.case_id));
    const passedOver = walked.skipped.filter(caseId => !walked.assigned.includes(caseId) && !cases.includes(caseId));
    const lines = left ? leftLines(left.map(item => ({ task: item.task, texts: targetTextNames(item.targets) })), passedOver) : ["Could not check what is left unassigned"];
    props.onAssigned([text, ...lines].filter(Boolean).join(". "), [...new Set([...cases, ...passedOver])]);
  };
  /** The first step of the selection not yet through in this dialog, or null. */
  const nextStep = (through: readonly string[], known: readonly Step[] = steps ?? []): Step | null => known.find(step => !step.later && !through.includes(stepKey(step.task, step.language))) ?? null;
  /** One step is through (assigned, distributed or skipped): on to the next, else close. The steps reload: an assigned review opens the annotation of its text. */
  const advance = async ({ message = "", skipped = [], assigned = [], skip = false }: { message?: string; skipped?: readonly string[]; assigned?: readonly string[]; skip?: boolean }) => {
    const here = current ? [current] : [];
    const walked: Walked = { steps: skip ? done.steps : [...done.steps, ...here], passed: skip ? [...done.passed, ...here] : done.passed.filter(key => key !== current), messages: message ? [...done.messages, message] : done.messages, assigned: [...done.assigned, ...assigned], skipped: [...done.skipped, ...skipped] };
    const through = [...walked.steps, ...walked.passed];
    const latest = props.mode === "cases" ? await loadSteps(props).catch(() => null) : null;
    if (!alive.current) return;
    // The list keeps its order: the server's changes as tasks get assigned.
    const known = steps ?? [];
    const before = known.map(step => stepKey(step.task, step.language));
    const at = (step: Step) => { const index = before.indexOf(stepKey(step.task, step.language)); return index < 0 ? before.length : index; };
    const kept = known.filter(step => through.includes(stepKey(step.task, step.language)) && !latest?.some(item => item.task === step.task && item.language === step.language));
    const ordered = latest ? walkOrder([...kept, ...latest].sort((a, b) => at(a) - at(b))) : known;
    const next = props.mode === "cases" ? nextStep(through, ordered) : null;
    if (!next) { await finish(walked); return; }
    setDone(walked);
    setChosen([]); setAcknowledged(false); setAllTexts(false);
    setSteps(ordered);
    setCurrent(stepKey(next.task, next.language));
  };
  /** `advance` and `finish` report what they could not check, so nothing here can fail. */
  const whileBusy = (work: () => Promise<void>) => {
    if (writing.current) return;
    writing.current = true; setBusy(true); reset();
    void work().finally(() => { if (alive.current) { writing.current = false; setBusy(false); } });
  };

  const commit = async (confirmLanguage: boolean) => {
    if (writing.current || !request || !fresh || !task) return;
    writing.current = true; setBusy(true); reset();
    try {
      const messages: string[] = [];
      if (usernames.length) {
        const result = await api.commitAssignmentBatch(props.projectKey, { ...request, expected_preview_digest: fresh.digest, confirm_language: confirmLanguage, confirm_unreviewed_translation: acknowledged });
        if (!alive.current) return;
        messages.push(resultMessage(task, result.created.length, chosenPeople.map(person => ({ person: person.person, count: result.created.filter(item => item.username === person.username).length }))));
      }
      if (self && me && props.mode === "row") {
        const response = await api.createAssignments(props.projectKey, { rows: [{ document_id: props.row.open.document_id, username: me.username }], task: "annotate", confirm_language: true, confirm_unreviewed_translation: acknowledged });
        if (!alive.current) return;
        if (!response.created.length) throw new ApiError(409, "You could not be assigned to this text.", response.refused[0]?.code ?? "ASSIGNMENT_REFUSED");
        messages.push(`You annotate ${props.row.case_id} ${props.row.language}.`);
      }
      await advance({ message: messages.join(" "), skipped: fresh.skipped.map(item => item.case_id), assigned: fresh.targets.filter(item => item.usernames.length > 0).map(item => item.case_id) });
    } catch (error: unknown) {
      if (!alive.current) return;
      if (error instanceof ApiError && error.code === "ASSIGNMENT_BATCH_STALE") { setNotice(errorMessage(error)); setReload(value => value + 1); }
      else if (error instanceof ApiError && error.code === "ASSIGNMENT_BATCH_REFUSED") {
        const rows = refusedRows(error);
        if (rows.length && rows.every(row => row.code === "LANGUAGE_CONFIRMATION_REQUIRED") && !confirmLanguage) setConfirming(true);
        else { setFailure(errorMessage(error)); setRefused(rows); }
      } else setFailure(errorMessage(error));
    } finally { if (alive.current) { writing.current = false; setBusy(false); } }
  };
  const reopenReview = async () => {
    if (writing.current || !reopening || props.mode !== "row") return;
    writing.current = true; setBusy(true); setReopenError(undefined);
    try {
      await api.reopenAssignment(reopening.assignment_id, reopenReason.trim() || undefined);
      if (alive.current) props.onAssigned(`${workPersonName(reopening)}'s review of ${textLabel(props.row)} was reopened.`);
    } catch (error: unknown) {
      if (alive.current) setReopenError(error);
    } finally { if (alive.current) { writing.current = false; setBusy(false); } }
  };
  const mismatched = chosenPeople.filter(person => person.language_mismatch && person.gets > 0);
  const assign = () => {
    if (reason || busy) return;
    if (mismatched.length && !confirming) { setConfirming(true); return; }
    // While confirming (also after the server asked for it), this is "Assign anyway".
    void commit(confirming || mismatched.length > 0);
  };

  // One roving tab stop for the member radios; arrow keys skip aria-disabled members.
  const enabled = people.filter(person => !memberUnavailable(person) && !holds(person)).map(person => person.username);
  const tabStop = radios ? (usernames[0] ?? enabled[0]) : undefined;
  const rove = (event: KeyboardEvent<HTMLInputElement>, username: string) => {
    if (!radios || !enabled.length) return;
    const at = order.indexOf(username);
    const after = enabled.find(name => order.indexOf(name) > at) ?? enabled[0];
    const before = [...enabled].reverse().find(name => order.indexOf(name) < at) ?? enabled.at(-1)!;
    const target = { ArrowDown: after, ArrowRight: after, ArrowUp: before, ArrowLeft: before, Home: enabled[0], End: enabled.at(-1)! }[event.key];
    if (!target) return;
    event.preventDefault();
    choose(target, true);
    inputs.current.get(target)?.focus();
  };

  const title = props.mode === "cases" ? `Assign ${plural(props.caseIds.length, "case")}`
    : props.newReviewOfAccepted && task === "translation_review" ? "Assign a new review"
    : sourceChanged ? "Assign review after source change" : `Assign ${(task ? stepName(task) : "task").toLowerCase()}`;

  // "Calculating…" is the footer's reason only.
  const summaryLines: string[] = [];
  if (fresh && task) {
    if (!fresh.targets.length) summaryLines.push("No cases in the selection need this task.");
    if (chosenPeople.length && assignments) {
      for (const person of sortMembers(chosenPeople)) summaryLines.push(onePersonSummary({ person: person.person, gets: person.gets, task, language, openBefore: person.open_before, openAfter: person.open_after }));
    }
    const waiting = fresh.targets.filter(target => target.waiting_for_translation_review).length;
    if (waiting) summaryLines.push(isRow ? "Still in translation review: the task opens once the review is accepted."
      : `${plural(waiting, "text")} still in translation review: their tasks open once the review is accepted`);
    if (!isRow) summaryLines.push(...partlyAssignedLines(fresh.targets, fresh.per_text));
    summaryLines.push(...skippedLines(fresh.skipped, language, task));
  }

  const now = new Date();
  const holders = props.mode === "row" && task ? props.row.work.filter(item => item.task === task).map(item => {
    const name = personLabel(item.person ?? { pseudonym: item.author_label });
    return item.assigned_at ? `${name}, ${assignedText(new Date(item.assigned_at), now)}` : name;
  }) : [];
  const textMode = props.mode === "row" && task === "annotate" ? props.row.annotation_mode ?? null : null;
  /** One status line: mode, who holds the task (of the limit), the limit. */
  const status = [
    textMode && (textMode.mode === "proposals" ? "From proposals" : `From scratch${textMode.source === "no_proposals" ? " (no tool proposals)" : ""}`),
    holders.length ? `Assigned: ${holdersLine(holders)}` : "Nobody assigned yet",
  ].filter(Boolean).join(" · ");
  /** Parallel roots of one text share its label: name the chain. */
  const rootLabel = (item: { case_id: string; language: string; document_id: string }) => {
    const version = props.mode === "row" && props.row.parallel_roots ? props.row.versions.find(entry => entry.document_id === item.document_id) : undefined;
    return version ? `${textLabel(item)} (${versionName(version.version, version.chain_name, true)})` : textLabel(item);
  };
  // The version the task is assigned on, as the preview names it (one text, one target); the newest until it is known.
  const newest = props.mode === "row" ? (shown?.targets.length === 1 ? shown.targets[0] : undefined)
    ?? props.row.versions.filter(version => version.is_newest_in_chain).at(-1) ?? props.row.versions.at(-1) : undefined;
  const reasonId = `${id}-assign-reason`;
  const limitId = `${id}-limit`;
  const limitReachedId = `${id}-limit-reached`;
  const stepOptions = props.mode === "row"
    ? (["translation_review", "annotate"] as const).filter(item => item !== "translation_review" || !props.row.is_source).map(item => ({ value: stepKey(item, props.row.language), label: stepName(item) }))
    : (steps ?? []).filter(step => !step.later).map(step => {
      const key = stepKey(step.task, step.language);
      return { value: key, label: `${stepLabel(step.task, step.language, step.versions)}${done.steps.includes(key) ? ", done" : done.passed.includes(key) ? ", skipped" : ""}` };
    });
  const targetLimits = shown ? shown.targets.map(target => target.per_text) : [];
  const limitsDiffer = new Set(targetLimits).size > 1;
  const changeStep = (value: string) => { reset(); setChosen([]); setAcknowledged(false); setCurrent(value); };
  // B7-5: one hint in normal text with the (i) popover; it also says why further rows are blocked.
  // Issue 422: the texts of this step the popover can give their own value: the row, else the selection's texts in this
  // language that have a place or are full.
  const limitTexts: LimitText[] = shown ? [...new Map([
    ...shown.targets.map(item => ({ case_id: item.case_id, language: item.language, limit: item.per_text, assigned: item.per_text - item.remaining })),
    ...shown.skipped.filter(item => item.reason === "already_assigned" && item.per_text != null)
      .map(item => ({ case_id: item.case_id, language: item.language, limit: item.per_text ?? shown.per_text, assigned: item.assigned ?? 0 })),
  ].map(item => [`${item.case_id}\u0000${item.language}`, item] as const)).values()] : [];
  // One text the preview has no place for (another reason than "full"): still its own limit to change.
  if (shown && props.mode === "row" && !limitTexts.length) limitTexts.push({ case_id: props.row.case_id, language: props.row.language,
    limit: props.row.annotations_per_text?.effective ?? shown.per_text, assigned: props.row.work.filter(item => item.task === "annotate" && item.moved_to_version == null).length });
  const limitInfo = shown && <LimitInfo key={`${shown.per_text}:${shown.project_per_text}`} projectKey={props.projectKey} current={shown.per_text}
    project={shown.project_per_text} texts={task === "annotate" ? limitTexts : []}
    textName={props.mode === "row" ? textLabel(props.row) : undefined}
    onFailed={() => setReload(count => count + 1)}
    onSaved={(value, scope, texts) => { reset(); setLimitSaved(scope === "project" ? `Annotators per text: ${value}, for all texts.` : `Annotators per text: ${value}, for ${texts === 1 && props.mode === "row" ? textLabel(props.row) : plural(texts, "text")}.`); setReload(count => count + 1); props.onLimitChanged?.(); }} />;
  /** Annotation waiting for a skipped review cannot run in this dialog: it is no step of it. */
  const listed = (steps ?? []).filter(step => !step.later || !done.passed.includes(stepKey("translation_review", step.language)));
  /** After a step was assigned or skipped, closing reports it (the selection and toast follow the assigned work). */
  const reported = done.steps.length > 0 || done.passed.length > 0 || done.messages.length > 0;
  const close = () => { if (reported) whileBusy(() => finish(done)); else props.onClose(); };
  const closing = busy ? undefined : close;

  // "Distribute evenly…" takes the dialog's place (issue 210); after a save the walk-through goes on from here.
  if (randomOpen && fresh && task) return <DistributionDialog projectKey={props.projectKey} task={task} confirmUnreviewedTranslation={acknowledged}
    documents={fresh.targets.map(item => ({ document_id: item.document_id, case_id: item.case_id, language: item.language }))}
    onChanged={() => { randomChanged.current = true; }}
    onClose={() => {
      if (!randomChanged.current) { setRandomOpen(false); return; }
      whileBusy(async () => {
        const message = "Assignments from the even distribution saved";
        // The step is through only if every text got someone (a refused row, "Nobody" or an unassignable text leaves it open).
        const after = await api.previewAssignmentBatch(props.projectKey, { ...request!, usernames: [] }).catch(() => null);
        const empty = after?.targets.filter(target => target.remaining === target.per_text) ?? [];
        if (!alive.current) return;
        if (empty.length) {
          randomChanged.current = false;
          setDone(walked => ({ ...walked, messages: [...walked.messages, message], assigned: [...walked.assigned, ...fresh.targets.filter(item => !empty.some(target => target.case_id === item.case_id)).map(item => item.case_id)] }));
          setNotice(`${message}. Still without anyone: ${targetTextNames(empty).join(", ")}. Choose someone, or close.`);
          setChosen([]); setReload(value => value + 1);
        } else await advance({ message, skipped: fresh.skipped.map(item => item.case_id), assigned: fresh.targets.map(item => item.case_id) });
        if (alive.current) setRandomOpen(false);
      });
    }} />;

  // The body's limit hint already says why the text is blocked: the footer does not repeat it.
  const reasonInBody = reason !== null && reason === blocked;
  return <Dialog open title={title} size="md" onClose={closing} footer={<>
    {reason && !reasonInBody && <span id={reasonId} className="dialog-footer-reason">{reason}</span>}
    <Button disabled={busy} onClick={close}>{reported ? "Close" : "Cancel"}</Button>
    {props.mode === "cases" && current && nextStep([...done.steps, ...done.passed, current]) && <Button disabled={busy} onClick={() => whileBusy(() => advance({ skip: true }))}>Skip this task</Button>}
    <Button variant="primary" loading={busy} aria-disabled={reason ? "true" : undefined} aria-describedby={reason ? (reasonInBody ? limitReachedId : reasonId) : undefined} onClick={assign}>{confirming ? "Assign anyway" : rowMulti
      ? (picked ? `Assign ${picked === 1 ? "1 person" : `${picked} people`}` : "Assign") : !count || (isRow && !usernames.length) ? "Assign" : `Assign ${count}`}</Button>
  </>}>
    <div className="assign-dialog">
      {pausedTexts > 0 && <InlineMessage tone="info">{pausedAssignText(pausedTexts, props.mode === "row")}</InlineMessage>}
      {props.mode === "row" && <div className="assign-context">
        <p><strong>{textLabel({ case_id: props.row.case_id, language: props.row.language, version: newest?.version }, { withVersion: (newest?.version ?? 1) > 1 })}</strong></p>
        {task === "translation_review" && openBy.length > 0 && <p>{`${stepName(task)} of ${textLabel(props.row)} is assigned to ${openBy.map(person => personLabel(person.person)).join(", ")}. Assign it to someone else?`}</p>}
        {task === "translation_review" && submittedBy.length > 0 && <p>{`${submittedBy.map(person => personLabel(person.person)).join(", ")} already submitted ${submittedBy.length === 1 ? "a review" : "reviews"} of ${textLabel(props.row)}. To let them review it again, reopen their review; or assign it to someone else.`}</p>}
        <p id={limitId} className="assign-muted">{status}</p>
      </div>}

      {props.mode === "cases" && listed.length > 1 && <div className="assign-field">
        <strong>This selection needs</strong>
        {/* Issue 233: every step on its own (one task in one language), the walked ones ticked, skipped ones named, the current one marked. */}
        <ol className="assign-steps" aria-label="Steps">{listed.map(step => {
          const key = stepKey(step.task, step.language), walked = done.steps.includes(key), passed = !walked && done.passed.includes(key), here = key === current;
          return <li key={key} aria-current={here ? "step" : undefined} className={here ? "assign-step assign-step--current" : walked || passed ? "assign-step assign-step--done" : "assign-step"}>
            {stepShortLabel(step.task, step.language)}{walked && <><span aria-hidden="true"> ✓</span><span className="visually-hidden">, done</span></>}{passed && !here && " (skipped)"}
          </li>;
        })}</ol>
        <span className="assign-muted">{`Step ${listed.findIndex(step => stepKey(step.task, step.language) === current) + 1} of ${listed.length}`}</span>
      </div>}
      {reported && task && <p className="assign-done" role="status">{`${done.messages.length ? `${done.messages.join(". ")}. ` : ""}Next: ${stepsOverview([{ task, language }])}. Close when you are done.`}</p>}
      {props.mode === "cases" && stepsError !== undefined && <><ErrorNotice error={stepsError} /><Button onClick={() => setStepsRetry(value => value + 1)}>Retry</Button></>}
      {props.mode === "cases" && steps === null && stepsError === undefined && <p className="assign-muted">Loading members…</p>}
      {props.mode === "cases" && steps !== null && !steps.length && <p>No cases in the selection need this task.</p>}

      {task && (props.mode === "row" ? stepOptions.length > 1 && <div className="assign-field">
        {changingTask
          ? <Select id={`${id}-task`} label="Task" value={current ?? ""} disabled={busy} onChange={event => changeStep(event.target.value)}>{stepOptions.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}</Select>
          : <p><strong>Task</strong> <span>{props.newReviewOfAccepted && task === "translation_review" ? "New review of the accepted translation" : sourceChanged ? "Review after a source change" : stepName(task)}</span> <Button size="sm" disabled={busy} onClick={() => setChangingTask(true)}>Change task</Button></p>}
      </div> : stepOptions.length > 1
        ? <div className="assign-field"><Select id={`${id}-task`} label="Task" hint="from the plan" value={current ?? ""} disabled={busy} onChange={event => changeStep(event.target.value)}>{stepOptions.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}</Select></div>
        : <p className="assign-field"><strong>Task</strong> <span className="assign-step">{stepOptions[0]?.label}</span> <span className="assign-muted">from the plan</span></p>)}

      {props.mode === "cases" && shown && shown.targets.length > 0 && (() => {
        // issue 129, U4: the dialog names the texts it assigns (the table behind it is covered).
        const names = targetTextNames(shown.targets);
        const listed = allTexts ? names : names.slice(0, NAMED_TEXTS);
        return <p className="assign-texts"><strong>{names.length === 1 ? "Text" : `Texts (${names.length})`}</strong>{" "}
          <span>{listed.join(", ")}{listed.length < names.length && `, and ${names.length - listed.length} more`}</span>
          {names.length > NAMED_TEXTS && <Button size="sm" aria-expanded={allTexts} onClick={() => setAllTexts(value => !value)}>{allTexts ? "Show fewer" : "Show all"}</Button>}</p>;
      })()}
      {multi && props.mode === "cases" && shown && <p id={limitId} className="assign-muted">{`Tick everyone who should annotate these texts. Each ticked person gets every selected ${language} text that still has a free place.`}</p>}
      {/* The words in their own element: "Change…" beside them is not part of the hint's text. */}
      {multi && shown && <p className="assign-limit-hint"><span id={limitReachedId}>{rowMulti
        ? blocked ?? [`${assignedCount} assigned`, picked > 0 && `${picked} selected`,
          picked >= limit ? "limit reached" : `${limit - picked} more possible (limit ${shown.per_text})`].filter(Boolean).join(" · ")
        : limitsDiffer ? `Up to ${perTextCap} per text; limits differ (${Math.min(...targetLimits)} to ${perTextCap})` : `Up to ${shown.per_text} per text`}</span>{limitInfo}</p>}
      {limitSaved && <p className="assign-muted" role="status">{limitSaved}</p>}

      {unreviewedText && <Checkbox id={`${id}-unreviewed`} label="Annotate before the translation review is accepted"
        hint={`Translation review not accepted yet: ${unreviewed.length ? unreviewed.map(rootLabel).join(", ") : props.mode === "row" ? textLabel(props.row) : ""}`}
        checked={acknowledged} disabled={busy} onChange={event => { reset(); setAcknowledged(event.target.checked); }} />}

      {task && !shown && previewError === null && <p className="assign-muted">Loading members…</p>}
      {previewError && <><ErrorNotice error={previewError.error} /><Button onClick={() => setReload(value => value + 1)}>Retry</Button></>}
      {task && shown && <table className="assign-members" aria-label="Members">
        <thead><tr><th scope="col">Person</th><th scope="col">Reads</th><th scope="col">Open tasks</th>{multi && !isRow && <th scope="col">Gets</th>}</tr></thead>
        <tbody>{people.map((person, index) => {
          const why = memberReason(person, task, language);
          const off = memberUnavailable(person);
          const checked = usernames.includes(person.username);
          const atLimit = !radios && !checked && picked >= limit;
          const inputId = `${id}-member-${index}`;
          const addMe = person.unavailable === "role_missing" && person.username === props.me?.username;
          const submitted = submittedReview(person);
          if (holds(person)) return <tr key={person.username}>
            <td><span className="assign-member assign-member--held">{personLabel(person.person)} {submitted
              ? <><StatusBadge tone="neutral">Review submitted</StatusBadge><Button size="sm" disabled={busy} aria-expanded={reopening?.assignment_id === submitted.assignment_id}
                onClick={() => { setReopenReason(""); setReopenError(undefined); setReopening(submitted); }}>Reopen their review…</Button></>
              : <StatusBadge tone="success">Already assigned</StatusBadge>}</span></td>
            <td className="assign-reads"><span className="assign-narrow-label">Reads </span>{person.reads.join(", ") || "None listed"}</td>
            <td className="assign-open"><span className="assign-narrow-label">Open </span>{person.open_before}</td>
          </tr>;
          const whyId = `${id}-why-${index}`;
          const describedBy = [why && whyId, atLimit && limitReachedId].filter(Boolean).join(" ") || undefined;
          // Muted only when the row cannot be ticked; a language mismatch stays normal with its warning.
          return <tr key={person.username} className={[off || atLimit ? "is-unavailable" : "", checked ? "is-chosen" : ""].filter(Boolean).join(" ") || undefined}>
            <td><span className="assign-member">
              <input ref={element => { if (element) inputs.current.set(person.username, element); else inputs.current.delete(person.username); }}
                id={inputId} type={radios ? "radio" : "checkbox"} name={radios ? `assign-member-${id}` : undefined} checked={checked}
                tabIndex={radios ? (person.username === tabStop ? 0 : -1) : undefined}
                aria-disabled={off || atLimit || busy ? "true" : undefined} aria-describedby={describedBy}
                onClick={event => { if (radios && (off || atLimit || busy)) event.preventDefault(); }}
                onChange={event => { if (!off && !atLimit && !busy) choose(person.username, event.target.checked); }}
                onKeyDown={event => rove(event, person.username)} />
              <label htmlFor={inputId}>{personLabel(person.person)}{why ? <span id={whyId} className="assign-reason">, {why}</span> : atLimit && !blocked && <span className="assign-reason">, {noPlace}</span>}</label>
              {/* issue 177: mark system administrators so they are not ticked by mistake. */}
              {person.system_admin && <StatusBadge tone="neutral" title="System administrator">Administrator</StatusBadge>}
              {addMe && <Button size="sm" disabled={busy} onClick={() => { void addMeAsAnnotator(); }}>Add me as annotator</Button>}
            </span></td>
            <td className="assign-reads"><span className="assign-narrow-label">Reads </span>{person.reads.length ? person.reads.map((item, at) => <span key={item}>{at > 0 && ", "}{item === language ? <strong>{item}</strong> : item}</span>) : "None listed"}</td>
            <td className="assign-open"><span className="assign-narrow-label">Open </span>{person.open_before}</td>
            {multi && !isRow && <td className="assign-gets">{person.gets > 0 ? <strong>{person.gets}</strong> : "–"}</td>}
          </tr>;
        })}
        {me && rowMulti && (() => {
          const atLimit = !self && picked >= limit;
          const off = meHolds || atLimit || busy;
          const why = meHolds ? "already annotating this text" : atLimit && !blocked ? noPlace : null;
          return <tr key="me" className={[meHolds || atLimit ? "is-unavailable" : "", self ? "is-chosen" : ""].filter(Boolean).join(" ") || undefined}>
            <td><span className="assign-member">
              <input id={`${id}-member-me`} type="checkbox" checked={self} aria-disabled={off ? "true" : undefined}
                aria-describedby={[why && `${id}-why-me`, atLimit && limitReachedId, props.mode === "row" && props.consolidatorRule && `${id}-rule`].filter(Boolean).join(" ") || undefined}
                onChange={event => { if (!off) chooseSelf(event.target.checked); }} />
              <label htmlFor={`${id}-member-me`}>{`${me.name} (you)`}{why && <span id={`${id}-why-me`} className="assign-reason">, {why}</span>}</label>
            </span></td>
            <td className="assign-reads" /><td className="assign-open" />
          </tr>;
        })()}
        </tbody>
      </table>}
      {reopening && props.mode === "row" && <InlineConfirm headingLevel={3} busy={busy} confirmLabel="Reopen review"
        title={`Reopen ${workPersonName(reopening)}'s review of ${textLabel(props.row)}`}
        message={<p>{`${workPersonName(reopening)} reviews v${reopening.version} again, starting from its current text. The earlier decision stays in the history.`}</p>}
        onConfirm={() => { void reopenReview(); }} onCancel={() => { if (!writing.current) { setReopening(null); setReopenError(undefined); } }}>
        <Textarea id={`${id}-reopen-reason`} label="Reason (optional)" maxLength={2000} value={reopenReason} disabled={busy} onChange={event => setReopenReason(event.target.value)} />
        {reopenError !== undefined && <ErrorNotice error={reopenError} />}
      </InlineConfirm>}
      {me && rowMulti && props.mode === "row" && props.consolidatorRule && <p id={`${id}-rule`} className="assign-muted">If you annotate this text yourself, you cannot consolidate it afterwards (project rule "the consolidator is not an annotator").</p>}

      {task && shown && <p className="assign-muted assign-order-note">{TASK_ORDER_NOTE}{props.mode === "cases" && targetTextNames(shown.targets).length > 1 && ` ${TASK_ORDER_NOTE_TEXTS}`}</p>}
      <div className="assign-summary" role="status" aria-live="polite" aria-label="Summary">{summaryLines.map(line => <p key={line}>{line}</p>)}</div>

      {fresh && fresh.targets.length > 0 && (!isRow || randomUseful) && <p className="assign-random"><Button size="sm" disabled={busy} aria-disabled={unacknowledged ? "true" : undefined} aria-describedby={unacknowledged && reason ? reasonId : undefined}
        onClick={() => { if (unacknowledged) return; randomChanged.current = false; setRandomOpen(true); }}>Distribute evenly…</Button></p>}

      {notice && <p className="assign-notice" role="alert">{notice}</p>}
      {failure && <p className="assign-error" role="alert">{failure}</p>}
      {refused.length > 0 && <ul className="assign-refused" aria-label="Refused assignments">{refused.map(row => {
        const person = shown?.people.find(item => item.username === row.username)?.person;
        return <li key={`${row.case_id}:${row.username}:${row.code}`}>{textLabel(row)} — {person ? personLabel(person) : "a former member"}: {errorMessage(new ApiError(409, row.code, row.code))}</li>;
      })}</ul>}
      {confirming && <section className="assign-confirm" aria-label="Confirm languages">
        {!mismatched.length && <p>Some chosen people do not read every language this task needs.</p>}
        {mismatched.map(person => <p key={person.username}>{personName(person.person)} {person.reads.includes(language) ? "does not read the source language" : `does not read ${language}`}.</p>)}
        {/* The footer's primary button turns into "Assign anyway" (one primary action); Back keeps the choice open. */}
        <p>Assign anyway?</p>
        <span className="assign-confirm-actions"><Button disabled={busy} onClick={() => setConfirming(false)}>Back</Button></span>
      </section>}
    </div>
  </Dialog>;
}
