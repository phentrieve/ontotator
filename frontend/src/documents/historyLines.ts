/**
 * Activity lines of the row panel (acceptance fixes WP-A): one line per review, submission or open
 * task, change, pause and the final choice, in time order, oldest first (issue 545), each with its stage, e.g.
 * "Review: Ana Weber (ann-0003), Accepted unchanged, 20 Oct, 22:09",
 * "Annotation: Tom Reis (ann-0004), Round 1, 1 finding, 21 Oct, 22:15"; a consolidation adds "4 kept automatically (all
 * matched)" (U14). A change by a lead or an annotator reads "what by whom, date time: reason": "Annotation: task of
 * Tom Reis (ann-0004) reopened by you, 21 Oct, 22:40: Guideline 2.3", "Final: changed from the result of Tom Reis
 * (ann-0004) to the result of R. Roe (ann-0007) by you, 21 Oct, 22:50", "Final: change undone by you, …". A lead's
 * pause of the text and its release: "Text: paused by you, 17 Nov, 17:24: Source is checked", "Text: released by you, …".
 */
import type { DocumentRowView, RowChangeView, RowSubmissionView } from "../api/client";
import { assignmentStatusLabels, labelFor, plural } from "../app/labels";
import { formatTime, personLabel } from "../app/submissionLabels";
import { decisionLabels } from "../translation/labels";
import { pausedWord } from "./labels";
import { acceptanceLabel, acceptanceOf, isDiscarded } from "./TextVersions";
import { HISTORY_LINE_PREFIX, MODE_WORDS, STAGE_TITLES } from "./stageLabels";

/**
 * Stage of an activity line (the row panel's stage tag and filter). "text": what a lead did to the text as a whole,
 * a pause and its release (issue 464), which belong to no single stage.
 */
export type HistoryStage = "review" | "annotation" | "final" | "text";
/** The tag of a line in the card's History, and the word before its text ("Text: paused by you, …"). */
export const HISTORY_TAGS: Readonly<Record<HistoryStage, string>> = { ...STAGE_TITLES, text: "Text" };
export const HISTORY_PREFIXES: Readonly<Record<HistoryStage, string>> = { ...HISTORY_LINE_PREFIX, text: "Text" };

export interface HistoryLine {
  key: string;
  /** Stage the line belongs to: translation review, annotation work or the final choice. */
  stage: HistoryStage;
  text: string;
  /** When it happened (ISO); null for a line without a time, which sorts before every dated line. */
  at: string | null;
  /** Problem report behind a paused task ("Open report"). */
  reportId?: string | null;
}

export interface HistoryOptions {
  /** Pseudonym of the signed-in lead ("chosen by you"). */
  me?: string | null;
  now?: Date;
  /** Reassignments and mode changes of the row (with the submissions). */
  changes?: readonly RowChangeView[] | null;
}

type WorkItem = DocumentRowView["work"][number];

const join = (...parts: (string | null | undefined | false)[]): string => parts.filter(Boolean).join(", ");

/** Always date and time, "20 Oct, 22:09" (the year outside the current one): a line is read days later too. */
function timeText(iso: string, now: Date): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return formatTime(date, { now });
}

type ChangePerson = RowChangeView["by"];
const named = (person: ChangePerson): string => personLabel(person?.pseudonym ?? "", !!person?.is_me, person ?? undefined);
/** " by you" / " by Carla Diaz (lead-0002)"; nothing for a change made without an account (the admin CLI). */
const byText = (person: ChangePerson): string => (person ? ` by ${person.is_me ? "you" : named(person)}` : "");
/** "what by whom, date time: reason" - the pattern of every change line. */
const changeText = (what: string, when: string, reason?: string | null): string => `${what}, ${when}${reason?.trim() ? `: ${reason.trim()}` : ""}`;
/** A submission as a final result: "the result of Tom Reis (ann-0004)", "the consolidation by Ana Weber (ann-0003)". */
function resultName(result: RowChangeView["from_result"]): string {
  if (!result) return "another result";
  return `${result.consolidation ? "the consolidation by" : "the result of"} ${named(result.author)}`;
}
const FINAL_KINDS: ReadonlySet<RowChangeView["kind"]> = new Set(["final_chosen", "final_changed", "final_restored"]);

const SUBMISSION_PREFIX: Readonly<Record<RowSubmissionView["kind"], string>> = {
  annotation: "Annotation", carry_forward: "Annotation", consolidation: "Consolidation", proposal_check: "Annotation",
};
const workPrefix = (item: WorkItem) => (item.task === "review" ? "Consolidation" : "Annotation");
const who = (item: WorkItem) => personLabel(item.author_label, item.is_me, item.person);
/**
 * Who gave the work and when (issue 545): "assigned by you, 20 Oct, 16:13"; a consolidation is "started by …", the
 * consolidation start assigns it. Nothing without a date.
 */
function assignedText(item: WorkItem, now: Date): string | null {
  if (!item.assigned_at) return null;
  const by = item.assigned_by ? ` by ${item.assigned_by.is_me ? "you" : named(item.assigned_by)}` : "";
  return `${item.task === "review" ? "started" : "assigned"}${by}, ${timeText(item.assigned_at, now)}`;
}

/** Milliseconds of a line's time; NaN without one. */
const timeOf = (line: HistoryLine) => (line.at ? Date.parse(line.at) : Number.NaN);

/**
 * Time order, oldest first (issue 545). Lines without a time come first (the oldest: package records), and lines
 * of the same moment keep the order they were written in (a typo fix before the annotations it moved).
 */
export function inTimeOrder(lines: readonly HistoryLine[]): HistoryLine[] {
  return lines.map((line, index) => ({ line, index, time: timeOf(line) }))
    .sort((a, b) => {
      const aNone = Number.isNaN(a.time), bNone = Number.isNaN(b.time);
      if (aNone || bNone) return aNone === bNone ? a.index - b.index : aNone ? -1 : 1;
      return a.time - b.time || a.index - b.index;
    })
    .map(entry => entry.line);
}

/** U14: "4 kept automatically (all matched)" on a consolidation that took matching findings over; else nothing. */
function keptText(item: RowSubmissionView): string | null {
  const kept = item.kind === "consolidation" ? item.kept_automatically ?? 0 : 0;
  return kept > 0 ? `${kept} kept automatically (all matched)` : null;
}

export function historyLines(row: DocumentRowView, submissions: readonly RowSubmissionView[] | null, options: HistoryOptions = {}): HistoryLine[] {
  const now = options.now ?? new Date();
  const lines: HistoryLine[] = [];
  const versionOf = (documentId: string) => row.versions.find(entry => entry.document_id === documentId);
  // Moved tasks ("moved to v2") come in `moved_work`, outside the row's live work.
  const allWork = [...row.work, ...(row.moved_work ?? [])];

  // Review: every translation review, then the acceptance records of the newest versions.
  const reviews = allWork.filter(item => item.task === "translation_review");
  const lastSubmitted = [...reviews].reverse().find(item => item.status === "submitted" && item.moved_to_version == null);
  for (const item of reviews) {
    let outcome: string;
    if (item.moved_to_version != null) outcome = `moved to v${item.moved_to_version}`;
    else if (item.status === "submitted") {
      const reviewed = versionOf(item.document_id);
      const decision = reviewed?.latest_review_decision;
      const corrected = reviewed && decision === "accepted_corrected" ? row.versions.find(entry => entry.derived_from === reviewed.document_id) : undefined;
      outcome = join(decision ? labelFor(decisionLabels, decision) : "Submitted", corrected && reviewed ? `v${reviewed.version} → v${corrected.version}` : null);
    } else outcome = join(labelFor(assignmentStatusLabels, item.status), pausedWord(item));
    const open = item.moved_to_version == null && item.status !== "submitted";
    // A submitted review: when it was submitted (issue 545); an open one: who gave it and when.
    const at = item.moved_to_version != null ? null
      : item.status === "submitted" ? item.submitted_at ?? (item === lastSubmitted ? row.stages?.review.detail.at ?? null : null)
      : item.assigned_at ?? null;
    lines.push({ key: `work-${item.assignment_id}`, stage: "review", at,
      text: `Review: ${join(who(item), outcome, open ? assignedText(item, now) : at && timeText(at, now))}` });
  }
  for (const entry of row.versions) {
    const acceptance = entry.is_newest_in_chain && !isDiscarded(row, entry) ? acceptanceOf(entry) : null;
    if (acceptance) lines.push({ key: `acceptance-${entry.document_id}`, stage: "review", at: acceptance.accepted_at ?? null, text: `Review: ${acceptanceLabel(acceptance, now)}` });
  }

  // "Fix typos…" (review 2, F6): one line per fix, like the other lead actions: what by whom, date time: reason.
  for (const entry of row.versions) {
    const fix = entry.editorial_correction;
    if (!fix) continue;
    const what = `typos fixed in v${entry.version}${byText(fix.corrected_by ?? null)}`;
    lines.push({ key: `typos-${entry.document_id}`, stage: "review", at: fix.corrected_at ?? null, text: `Review: ${fix.corrected_at ? changeText(what, timeText(fix.corrected_at, now), fix.reason) : `${what}: ${fix.reason.trim()}`}` });
  }

  // The lead's decision on a query (issue 483): what by whom, date time: the answer to the reviewer.
  for (const entry of row.versions) {
    const decision = entry.query_decision;
    if (!decision) continue;
    const decided = versionOf(decision.decided_document_id);
    const what = decision.kind === "unchanged"
      ? `query decided${byText(decision.decided_by ?? null)}, v${entry.version} accepted as it is`
      : `query decided${byText(decision.decided_by ?? null)}, the reviewer’s text ${decision.edited ? "taken with changes" : "taken"}${decided ? `, v${decided.version} → v${entry.version}` : ` as v${entry.version}`}`;
    lines.push({ key: `query-${entry.document_id}`, stage: "review", at: decision.decided_at ?? null, text: `Review: ${decision.decided_at ? changeText(what, timeText(decision.decided_at, now), decision.answer) : what}` });
  }

  // Annotation: submissions (once loaded), then the tasks not submitted yet. A typo fix's copy of a submission is
  // no line of its own: the change line "moved to v2 by itself" names it (issue 545).
  const several = row.versions.length > 1;
  if (submissions) {
    for (const item of submissions) {
      if (item.moved_by_typo_fix) continue;
      const round = item.kind === "consolidation" ? null : item.round_ordinal == null ? "Initial submission" : `Round ${item.round_ordinal}`;
      lines.push({
        key: `submission-${item.submission_id}`,
        // A consolidation is Finalization work: its lines stand with the final result, not under Annotation.
        stage: item.kind === "consolidation" ? "final" : "annotation",
        at: item.recorded_at,
        text: `${SUBMISSION_PREFIX[item.kind] ?? "Annotation"}: ${join(personLabel(item.author_label, item.is_me, item.author), round,
          plural(item.finding_count, "finding"), keptText(item), several && `v${item.version}`, timeText(item.recorded_at, now))}`,
      });
    }
  }
  for (const item of allWork) {
    if (item.task === "translation_review") continue;
    if (item.task === "annotate" && item.unreviewed_translation) {
      const by = item.assigned_by ? personLabel(item.assigned_by.pseudonym, !!item.assigned_by.is_me, item.assigned_by) : "the lead";
      lines.push({ key: `unreviewed-${item.assignment_id}`, stage: "annotation", at: item.assigned_at ?? null, text: `Annotation assigned before the translation review was accepted (confirmed by ${by})` });
    }
    if (item.status === "submitted" && submissions && item.moved_to_version == null) continue;
    const status = item.moved_to_version != null ? `moved to v${item.moved_to_version}` : join(labelFor(assignmentStatusLabels, item.status), pausedWord(item));
    const round = item.moved_to_version == null && item.round_ordinal != null ? `Round ${item.round_ordinal}` : null;
    const moved = item.moved_to_version != null;
    lines.push({ key: `work-${item.assignment_id}`, stage: item.task === "review" ? "final" : "annotation", at: moved ? null : item.assigned_at ?? null,
      text: `${workPrefix(item)}: ${join(who(item), round, status, !moved && assignedText(item, now))}` });
  }

  (options.changes ?? []).forEach((change, index) => {
    const stage: HistoryStage = change.task === "translation_review" ? "review" : change.task === "review" ? "final" : "annotation";
    const prefix = stage === "review" ? "Review" : change.task === "review" ? "Consolidation" : "Annotation";
    const when = timeText(change.at, now);
    const key = `change-${index}`;
    const push = (lineStage: HistoryStage, text: string) => lines.push({ key, stage: lineStage, at: change.at, text });
    switch (change.kind) {
      case "reassigned":
        push(stage, `${prefix}: ${changeText(`reassigned from ${named(change.from_person)} to ${named(change.to_person)}`, when)}`);
        break;
      case "reopened":
        push(stage, `${prefix}: ${changeText(`task of ${named(change.to_person)} reopened${byText(change.by)}`, when, change.reason)}`);
        break;
      // "Ask a reviewer to correct…" and each addition to its reason (issue 483): the reason as sent stays.
      case "correction_requested":
        push(stage, `${prefix}: ${changeText(`correction requested from ${named(change.to_person)}${byText(change.by)}`, when, change.reason)}`);
        break;
      case "correction_reason_added":
        push(stage, `${prefix}: ${changeText(`addition to the correction request for ${named(change.to_person)}${byText(change.by)}`, when, change.reason)}`);
        break;
      case "reopen_undone":
        push(stage, `${prefix}: ${changeText(`reopening of the task of ${named(change.to_person)} undone${byText(change.by)}`, when)}`);
        break;
      case "round_started": {
        const own = !!change.by && change.by.pseudonym === change.to_person?.pseudonym;
        const round = `Round ${change.round_ordinal ?? "?"}`;
        push(stage, `${prefix}: ${changeText(own ? `${round} started by ${named(change.by)}` : `${round} for ${named(change.to_person)} started${byText(change.by)}`, when, change.reason)}`);
        break;
      }
      case "final_chosen":
        push("final", `Final: ${changeText(`${resultName(change.to_result)} chosen${byText(change.by)}`, when)}`);
        break;
      case "final_changed":
        push("final", `Final: ${changeText(`changed from ${resultName(change.from_result)} to ${resultName(change.to_result)}${byText(change.by)}`, when)}`);
        break;
      case "final_restored":
        push("final", `Final: ${changeText(`change undone${byText(change.by)}, ${resultName(change.to_result)} is final again`, when)}`);
        break;
      // Issue 464, review 2 F6: every pause and its release stay, also after the release.
      case "text_paused":
        push("text", `Text: ${changeText(`paused${byText(change.by)}`, when, change.reason)}`);
        break;
      case "text_released":
        push("text", `Text: ${changeText(`released${byText(change.by)}`, when, change.reason)}`);
        break;
      // Issue 465: a submitted annotation moved to a typo fix by itself (nobody clicked).
      case "carried_by_typo_fix":
        push(stage, `${prefix}: ${changeText(`annotation of ${named(change.to_person)} moved to v${change.to_version ?? "?"} by itself after the typo fix`, when)}`);
        break;
      case "final_withdrawn":
        push("final", `Final: ${changeText(`withdrawn${byText(change.from_person)}`, when, change.reason)}`);
        break;
      default: {
        const mode = change.to_mode === "proposals" || change.to_mode === "scratch" ? MODE_WORDS[change.to_mode] : change.to_mode;
        push(stage, `Annotation: ${changeText(`${change.kind === "mode_restored" ? "mode restored" : "mode changed"}${byText(change.by)}, now annotated ${mode}`, when, change.reason)}`);
      }
    }
  });

  // A task on hold stays a history line (spec "Expansion": TASK_ON_HOLD).
  for (const entry of [...row.issues, ...row.notes]) {
    if (entry.code !== "TASK_ON_HOLD") continue;
    lines.push({ key: `hold-${entry.cause_id}`, stage: "annotation", at: entry.report?.created_at ?? null, text: `Task paused${entry.author_label ? `: ${entry.author_label}` : ""}`, reportId: entry.report_id ?? null });
  }

  // Issue 464: the lead pause in place, while its event line above is not loaded yet.
  if (row.lead_pause && !(options.changes ?? []).some(change => change.kind === "text_paused")) {
    lines.push({ key: "lead-pause", stage: "text", at: row.lead_pause.paused_at, text: `Text: ${changeText(`paused${byText(row.lead_pause.paused_by ?? null)}`, timeText(row.lead_pause.paused_at, now), row.lead_pause.reason)}` });
  }

  // The final result: its event lines above say which result, who and when. Without them (the submissions are not
  // loaded yet, or a project imported without its event log) one line names the lead who chose it.
  const chosen = row.final;
  if (chosen && !(options.changes ?? []).some(change => FINAL_KINDS.has(change.kind))) {
    const by = chosen.selected_by ? (options.me && chosen.selected_by === options.me ? "you" : chosen.selected_by) : null;
    lines.push({ key: "final", stage: "final", at: chosen.selected_at ?? null, text: `Final: ${join(by ? `chosen by ${by}` : "chosen", chosen.selected_at && timeText(chosen.selected_at, now))}` });
  }
  return inTimeOrder(lines);
}
