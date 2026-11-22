/**
 * "Fix typos…" on the newest version row of a translation (issue 453, an editorial correction): the lead fixes
 * spacing, typos or grammar without a translation review. One page: the text in the translation editor
 * (changed words are marked while typing), below it the changes with removed text struck through, how many
 * characters changed, a notice when a number changes, the reason (chips and an optional note), what happens
 * to the work on the version, and "Save as v2". The server preview runs when the dialog opens and, briefly
 * after the last keystroke, for the text as it stands. The new version is a correction of this version with
 * its status: an accepted text stays accepted, a rejected one stays rejected.
 */
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { api, ApiError, type DocumentRowView, type DocumentVersionView, type EditorialCorrectionPreview } from "../api/client";
import { textLabel } from "../app/identity";
import { ErrorNotice } from "../admin/ErrorNotice";
import { DiffView } from "../translation/DiffView";
import { TranslationEditor } from "../translation/TranslationEditor";
import { diffTextBounded } from "../translation/textDiff";
import { Button, Dialog, InlineMessage, TextInput } from "../ui";
import { statusBadgeText, versionName } from "./labels";

const plural = (count: number, noun: string) => `${count} ${noun}${count === 1 ? "" : "s"}`;

/** Why this version cannot be corrected editorially, or why this correction is refused (`EDITORIAL_CORRECTION_NOT_AVAILABLE` reasons). */
export function editorialRefusal(reason: string | null | undefined, short: string): string | null {
  switch (reason) {
    case "review_open": return "A translation review of this version is open. Withdraw it with Remove… in the reviewer’s row of the Translation part, or make the fix in that review.";
    case "not_newest": return "A newer version of this translation exists. Reload the row to see it.";
    case "discarded": return "This translation was discarded. Reload the row to see its current state.";
    case "unchanged": return `No changes to ${short}. Nothing is saved.`;
    case "reason_required": return "Enter the reason.";
    default: return null;
  }
}

/** "Changes a number: 15 → 50", "Changes numbers: 15 → 50, adds 3, removes 2"; null when no number changes (a notice, not a refusal). */
export function numberNotice(changes: EditorialCorrectionPreview["number_changes"]): string | null {
  if (!changes?.length) return null;
  const parts = changes.map(item => (item.old != null && item.new != null ? `${item.old} → ${item.new}` : item.new != null ? `adds ${item.new}` : `removes ${item.old ?? ""}`));
  return `Changes ${changes.length === 1 ? "a number" : "numbers"}: ${parts.join(", ")}. Check that this is intended.`;
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);

function refusedSave(error: unknown, short: string): string | null {
  if (!(error instanceof ApiError)) return null;
  if (error.code === "VARIANT_REVIEW_STALE") return "The text of this version changed. Reload the row to see the current text.";
  if (error.code === "NOT_A_TRANSLATION") return "A source text has no typo fix. Import the corrected source text as an Ontospan bundle.";
  if (error.code !== "EDITORIAL_CORRECTION_NOT_AVAILABLE") return null;
  return editorialRefusal(isRecord(error.details) && typeof error.details.reason === "string" ? error.details.reason : null, short);
}

/**
 * The reasons a click gives; the stored reason is their words plus the optional note ("Spacing; Typo", "Typo: Hypotnie").
 * "Removed addition" (issue 483): words the machine added that the source does not have, e.g. a synonym in brackets.
 */
export const REASON_CHIPS = ["Spacing", "Typo", "Grammar", "Removed addition"] as const;
export function reasonText(chips: readonly string[], note: string): string {
  const chosen = REASON_CHIPS.filter(chip => chips.includes(chip)).join("; ");
  return [chosen, note.trim()].filter(Boolean).join(": ");
}

/** How long after the last keystroke the server checks the text as it stands. */
export const PREVIEW_DELAY_MS = 400;

export interface EditorialConsequences {
  /** Something stays on this version for the lead (started or submitted annotations, consolidations, a final result): the highlighted block. */
  attention: boolean;
  /** What moves to the new version (annotations that move by themselves, waiting tasks, tool proposals): plain sentences. */
  moving: string[];
  /** What stays on this version: the highlighted block "Work stays on v1" when `attention`. */
  lines: string[];
}

/**
 * What happens to the work on the version, in plain words. Quiet when nothing needs the lead afterwards
 * ("Nobody has annotated v1 yet.", "2 waiting tasks continue on v2."); when started or submitted work stays,
 * what stays and what to do next ("2 annotations stay on v1. After saving, use Handle text change… and
 * Carry to v2… on this row to move them."). With a changed text, per person: whose submitted annotation moves
 * to the new version by itself (issue 465) and whose does not, and why. Per task that is not submitted and stays, why it
 * stays (opened, paused, from tool proposals while one waits for a check), and the rule for tasks from proposals (issue 509).
 */
export function editorialConsequences(preview: EditorialCorrectionPreview): EditorialConsequences {
  const old = `v${preview.version}`, next = `v${preview.next_version}`, moving = preview.tasks_following;
  // Issue 465: submitted annotations whose findings all re-anchor move by themselves when no number changes.
  const carry = preview.annotation_carry ?? [];
  const carried = carry.filter(item => item.carried);
  const kept = carry.filter(item => !item.carried && item.status === "submitted");
  // Issue 543 (U4-04): before the text changes, nobody knows yet whose annotation moves by itself.
  const unknown = preview.annotation_carry == null ? preview.annotations.submitted : 0;
  // Issue 509: tasks that stay, each with its reason; a task from proposals before the text changes is not decided yet.
  const stayingTasks = preview.tasks_staying ?? [];
  const pending = stayingTasks.filter(item => item.reason === "from_proposals");
  const named = stayingTasks.filter(item => item.reason !== "from_proposals");
  const started = Math.max(0, preview.annotations.open - moving - pending.length), submitted = Math.max(0, preview.annotations.submitted - carried.length - unknown);
  const staying = submitted + started;
  // The row's own next steps: started work is moved with "Handle text change…", submitted work with "Carry to v2…".
  const steps = [started ? "Handle text change…" : null, submitted ? `Carry to ${next}…` : null].filter(Boolean).join(" and ");
  const count = preview.open_consolidations, findings = preview.findings, proposals = preview.proposals;
  const attention = staying > 0 || count > 0 || preview.final_result;
  // The text-change steps wait for the acceptance of a version that is not accepted yet (rule "annotate accepted translations only").
  const waits = preview.annotate_accepted_only && preview.translation_status !== "accepted";
  const others = [count ? plural(count, "open consolidation") : null, preview.final_result ? "the final result" : null].filter(Boolean).join(" and ");
  const present = (line: string | null): line is string => line !== null;
  // What moves stands apart from the block of what stays (issue 543, U4-04).
  const moves = [
    carried.length ? `${carried.length === 1 ? "Moves" : "Move"} to ${next} by ${carried.length === 1 ? "itself" : "themselves"}, nobody submits again: the ${carried.length === 1 ? "annotation" : "annotations"} of ${names(carried)}.` : null,
    unknown ? `Once you change the text, this says ${unknown === 1 ? "whether the submitted annotation moves" : `which of the ${unknown} submitted annotations move`} to ${next} by ${unknown === 1 ? "itself" : "themselves"}.` : null,
    moving ? `${plural(moving, "waiting task")} ${moving === 1 ? "continues" : "continue"} on ${next}.` : null,
    pending.length ? `Once you change the text, this says whether the ${pending.length === 1 ? "task" : "tasks"} from tool proposals of ${names(pending)} ${pending.length === 1 ? "continues" : "continue"} on ${next}. ${PROPOSALS_RULE(next)}` : null,
    proposals && proposals.carried + proposals.needs_check > 0
      ? `Tool proposals move to ${next}${proposals.needs_check ? `; ${proposals.needs_check} ${proposals.needs_check === 1 ? "marks" : "mark"} words you changed and ${proposals.needs_check === 1 ? "waits" : "wait"} for a check` : ""}.`
      : null,
  ].filter(present);
  const stays = [
    ...keptLines(kept),
    staying ? `${plural(staying, "annotation")} ${staying === 1 ? "stays" : "stay"} on ${old}. ${waits ? `Once ${next} is accepted` : "After saving"}, use ${steps} on this row to move ${staying === 1 ? "it" : "them"}.` : null,
    ...stayingLines(named, next),
    others ? `${others.charAt(0).toUpperCase()}${others.slice(1)} ${count + (preview.final_result ? 1 : 0) === 1 ? "stays" : "stay"} on ${old}${staying ? " as well" : ""}.` : null,
    findings?.needs_check ? `${findings.needs_check} of ${plural(findings.submitted, "finding")} ${findings.needs_check === 1 ? "marks" : "mark"} words you changed and will need a check when moved.` : null,
  ].filter(present);
  if (!moves.length && !stays.length) return { attention: false, moving: [], lines: [`Nobody has annotated ${old} yet.`] };
  return { attention, moving: moves, lines: stays };
}

/**
 * A version with a submitted translation review (issue 547, U2-06): the review stays with the version it reviewed, and the
 * new version is not reviewed. A rejected or queried one stays to resolve, so its next review is assigned under Resolve….
 * Null for a version without a review.
 */
export function reviewNote(decision: string | null | undefined, next: number): string | null {
  if (!decision) return null;
  const stays = "A submitted translation review stays with the version it reviewed.";
  return decision === "rejected" || decision === "query" ? `${stays} To have v${next} reviewed, use Resolve… › Other ways… › Assign a new review… on this row after saving.` : stays;
}

type CarryPerson = NonNullable<EditorialCorrectionPreview["annotation_carry"]>[number];
type StayingTask = EditorialCorrectionPreview["tasks_staying"][number];
const names = (people: readonly { display_name: string; username: string }[]) => {
  const all = people.map(item => item.display_name || item.username);
  return all.length > 1 ? `${all.slice(0, -1).join(", ")} and ${all[all.length - 1]}` : all.join("");
};

/** Why a submitted annotation does not move by itself (`annotation_carry` reasons); it keeps the manual flow. */
export const CARRY_REASONS: Readonly<Record<string, string>> = {
  number_changed: "the fix changes a number",
  final_result: "the text has a final result",
  consolidation: "the text has a consolidation",
  translation_not_accepted: "the translation is not accepted yet",
  from_proposals: "annotated from tool proposals, which reach the new version later",
  task_paused: "the task is paused",
  findings_need_check: "a finding marks words you changed",
  not_carryable: "it cannot be moved automatically",
};

/** Issue 509: the rule for tasks from tool proposals, as the server applies it. */
export const PROPOSALS_RULE = (next: string): string =>
  `A task from tool proposals continues on ${next} only when nobody opened it and no proposal waits for a check.`;

/** Why a task that is not submitted stays on the corrected version (`tasks_staying` reasons, issue 509). */
export const STAY_REASONS: Readonly<Record<string, string>> = {
  opened: "already opened",
  paused: "the task is paused",
  from_proposals_needs_check: "from tool proposals, and a proposal waits for a check",
  from_proposals_none_carried: "from tool proposals, and no proposal moves to the new version",
};

/** One line per reason: "Task not moved, already opened: Eva Lang."; the rule for tasks from proposals when one stays for it. */
function stayingLines(tasks: readonly StayingTask[], next: string): string[] {
  const byReason = new Map<string, StayingTask[]>();
  for (const item of tasks) byReason.set(item.reason, [...(byReason.get(item.reason) ?? []), item]);
  const lines = [...byReason].map(([reason, people]) => `${people.length === 1 ? "Task" : "Tasks"} not moved, ${STAY_REASONS[reason] ?? reason}: ${names(people)}.`);
  if (tasks.some(item => item.reason.startsWith("from_proposals"))) lines.push(PROPOSALS_RULE(next));
  return lines;
}

/** One line per reason: "Not moved by itself, the fix changes a number: Tom Reis and Ana Weber." */
function keptLines(kept: readonly CarryPerson[]): string[] {
  const byReason = new Map<string, CarryPerson[]>();
  for (const item of kept) {
    const reason = item.reason ?? "not_carryable";
    byReason.set(reason, [...(byReason.get(reason) ?? []), item]);
  }
  return [...byReason].map(([reason, people]) => `Not moved by ${people.length === 1 ? "itself" : "themselves"}, ${CARRY_REASONS[reason] ?? CARRY_REASONS.not_carryable}: ${names(people)}.`);
}

export interface EditorialCorrectionDialogProps {
  row: DocumentRowView;
  version: DocumentVersionView;
  projectKey: string;
  /** Saved: the announcement ("Typos fixed: v3 of EN100022 de saved. It stays Accepted."). */
  onCorrected: (message: string) => void;
  onClose: () => void;
  returnFocus?: () => HTMLElement | null | undefined;
}

export function EditorialCorrectionDialog({ row, version, projectKey, onCorrected, onClose, returnFocus }: EditorialCorrectionDialogProps): JSX.Element {
  const id = useId();
  const writing = useRef(false);
  const short = versionName(version.version, version.chain_name, row.parallel_roots);
  const title = `Fix typos, ${row.case_id} ${row.language} ${short}`;
  /** What the server says about this version: availability and the work on it. */
  const [state, setState] = useState<EditorialCorrectionPreview | null>(null);
  /** The text of this version, as the editor starts with it. */
  const [original, setOriginal] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<unknown>();
  const [text, setText] = useState<string | null>(null);
  const [chips, setChips] = useState<string[]>([]);
  const [note, setNote] = useState("");
  const [tried, setTried] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>();
  /** The server's check of a changed text: the count, the numbers that change and what follows. */
  const [checked, setChecked] = useState<{ text: string; preview: EditorialCorrectionPreview } | null>(null);

  useEffect(() => {
    let live = true;
    Promise.all([api.previewEditorialCorrection(projectKey, version.document_id), api.getVariantText(projectKey, version.document_id)]).then(([value, stored]) => {
      if (!live) return;
      setState(value); setOriginal(stored.text); setText(current => current ?? stored.text);
    }, failure => { if (live) setLoadError(failure); });
    return () => { live = false; };
  }, [projectKey, version.document_id]);

  const value = text ?? "";
  const changed = original !== null && value !== original;
  // The check of the text as it stands, shortly after the last keystroke; an answer for an older text is dropped.
  useEffect(() => {
    if (!changed || !value.trim()) return undefined;
    let live = true;
    const timer = window.setTimeout(() => {
      api.previewEditorialCorrection(projectKey, version.document_id, value).then(preview => { if (live) setChecked({ text: value, preview }); }, () => undefined);
    }, PREVIEW_DELAY_MS);
    return () => { live = false; window.clearTimeout(timer); };
  }, [changed, value, projectKey, version.document_id]);

  const next = state?.next_version ?? version.version + 1;
  const status = statusBadgeText(version.translation_status, version.latest_review_decision, version.accepted_without_review);
  const reason = reasonText(chips, note);
  const missingReason = !reason;
  const invalid = !value.trim() || !changed || missingReason;
  const blocked = state !== null && !state.available ? editorialRefusal(state.reason, short) ?? "This version cannot be corrected here. Reload the row to see its current state." : null;
  const current = checked !== null && checked.text === value && changed ? checked.preview : null;
  const parts = useMemo(() => (changed && original !== null ? diffTextBounded(original, value) : null), [changed, original, value]);
  const refusedCheck = current !== null && !current.available ? editorialRefusal(current.reason, short) ?? "This correction cannot be saved. Reload the row to see its current state." : null;
  const numbers = current ? numberNotice(current.number_changes) : null;
  const consequences = current ?? state;
  const work = consequences ? editorialConsequences(consequences) : null;
  const rule = consequences ? PROPOSALS_RULE(`v${consequences.next_version}`) : null;
  const review = reviewNote(version.latest_review_decision, next);

  const save = async () => {
    setTried(true);
    if (writing.current || invalid || state === null || refusedCheck !== null) return;
    writing.current = true; setBusy(true); setError(undefined);
    try {
      const saved = await api.editorialCorrection(projectKey, version.document_id, { text: value, expected_text_sha256: state.text_sha256, reason });
      const moved = saved.annotations_carried ?? 0;
      onCorrected(`Typos fixed: v${saved.version} of ${textLabel(row)} saved.${status ? ` It stays ${status}.` : ""}${moved ? ` ${plural(moved, "annotation")} moved to v${saved.version}.` : ""}`);
    } catch (failure: unknown) {
      setError(failure);
    } finally { writing.current = false; setBusy(false); }
  };

  const refusedText = refusedSave(error, short);
  const failure = refusedText ? <InlineMessage tone="warning">{refusedText}</InlineMessage> : error !== undefined && <ErrorNotice error={error} />;
  const close = busy ? undefined : onClose;

  if (loadError !== undefined || blocked !== null) {
    return <Dialog open size="sm" title={title} onClose={onClose} returnFocus={returnFocus} footer={<Button onClick={onClose}>Close</Button>}>
      {loadError !== undefined ? <ErrorNotice error={loadError} /> : <InlineMessage tone="warning">{blocked}</InlineMessage>}
    </Dialog>;
  }

  const ready = state !== null && original !== null;
  return <Dialog open size="lg" title={title} onClose={close} returnFocus={returnFocus}
    footer={<>
      <Button disabled={busy} onClick={onClose}>Cancel</Button>
      <Button variant="primary" loading={busy} aria-disabled={!ready || invalid || refusedCheck !== null || busy ? true : undefined}
        aria-describedby={invalid && tried ? `${id}-missing` : undefined} onClick={() => { void save(); }}>{`Save as v${next}`}</Button>
    </>}>
    <div className="editorial-correction">
      <p>Fix spacing, typos or grammar directly in the text. A change of content belongs in a translation review.</p>
      {!ready
        ? <InlineMessage tone="info">Loading the text…</InlineMessage>
        : <>
          <div className="form-group">
            <label id={`${id}-text-label`} htmlFor={`${id}-text`} className="form-label">Corrected text</label>
            <TranslationEditor id={`${id}-text`} labelledBy={`${id}-text-label`} machineText={original} value={value}
              lang={row.language} disabled={busy} onChange={event => { setText(event.target.value); setError(undefined); }} />
            {tried && !changed && <p className="field-hint field-hint-error" role="alert">Change the text first.</p>}
          </div>
          {parts !== null && <div className="editorial-correction-changes">
            <p className="upload-version-changes"><strong>{`Changes to ${short}`}</strong>
              {current?.changed_characters != null && ` · ${plural(current.changed_characters, "character")} changed`}</p>
            <DiffView before={original} after={value} parts={parts} lang={row.language} />
          </div>}
          {changed && parts === null && <p className="field-hint">The texts differ too much to mark the changes.</p>}
          {refusedCheck !== null && <InlineMessage tone="warning">{refusedCheck}</InlineMessage>}
          {numbers !== null && <InlineMessage tone="warning">{numbers}</InlineMessage>}
          <fieldset className="plan-step editorial-correction-reason" aria-describedby={tried && missingReason ? `${id}-reason-error` : undefined}>
            <legend>What did you fix? (required)</legend>
            <div className="editorial-correction-chips">
              {REASON_CHIPS.map(chip => <button key={chip} type="button" className="ui-plan-chip" data-size="card" aria-pressed={chips.includes(chip)} disabled={busy}
                onClick={() => setChips(chosen => (chosen.includes(chip) ? chosen.filter(item => item !== chip) : [...chosen, chip]))}>{chip}</button>)}
            </div>
            <TextInput id={`${id}-note`} label="Note" maxLength={1900} value={note} disabled={busy}
              hint="Optional, for example the word you corrected. Kept with the version." onChange={event => setNote(event.target.value)} />
            {tried && missingReason && <p id={`${id}-reason-error`} className="field-hint field-hint-error" role="alert">Choose what you fixed or write a note.</p>}
          </fieldset>
          {work !== null && (work.attention
            ? <>
              {work.moving.length > 0 && <p className="editorial-correction-work">{work.moving.join(" ")}</p>}
              <InlineMessage tone="warning" title={`Work stays on v${version.version}`}>
                {/* Issue 584: one line per reason, the rule for tasks from proposals set apart below them. */}
                <ul className="editorial-correction-stays">
                  {work.lines.filter(line => line !== rule).map(line => <li key={line}>{line}</li>)}
                </ul>
                {rule !== null && work.lines.includes(rule) && <p className="editorial-correction-rule">{rule}</p>}
              </InlineMessage>
            </>
            : <p className="editorial-correction-work">{[...work.moving, ...work.lines].join(" ")}</p>)}
          <p className="field-hint">{`v${next} keeps the status of ${short}${status ? `: ${status}` : ""}. No translation review is started.`}</p>
          {review !== null && <p className="field-hint">{review}</p>}
        </>}
      {failure}
      {invalid && tried && <p id={`${id}-missing`} className="action-reason">{!changed ? "Change the text and say what you fixed." : "Say what you fixed."}</p>}
    </div>
  </Dialog>;
}
