/**
 * Bulk actions on final results in the selection bar's "More actions" menu (issue 336 step 2; issues 354 and 339 f;
 * decisions 336-A to 336-C, 354-C): "Accept agreeing results…" for the selected texts without a final result and
 * "Change final…" with the rule "newest submission" for the ones that have one. The previews are grouped by
 * consequence like the task actions (`bulkActionModel`): what becomes final first, then the skipped texts by reason.
 * "Change final…" has an Undo in the message that follows it: the server restores the earlier final result of every
 * text, or of none when a text changed since (`finalUndoneText`, `finalUndoRefusal`). "Accept agreeing results…"
 * has none; its consequences step says so.
 */
import { ApiError, type AcceptAgreeingView, type BulkChangeFinalUndoView, type BulkChangeFinalView, type BulkUndoResult } from "../api/client";
import { plural } from "../app/labels";
import { textLabel } from "../app/identity";
import { shortPerson, type PreviewGroup } from "./bulkActionModel";

export type FinalAction = "accept" | "change";
export type FinalPreview = { action: "accept"; data: AcceptAgreeingView } | { action: "change"; data: BulkChangeFinalView };

export const FINAL_ACTION_LABELS: Readonly<Record<FinalAction, string>> = { accept: "Accept agreeing results…", change: "Change final…" };
export const FINAL_TITLES: Readonly<Record<FinalAction, string>> = { accept: "Accept agreeing results", change: "Change final" };

const textsOf = (items: readonly { case_id: string; language: string }[]): string[] => [...new Set(items.map(item => textLabel(item)))];

/** Why "Accept agreeing results…" leaves a text out: the words after the dot. */
const ACCEPT_SKIPS: Readonly<Record<string, string>> = {
  open_task: "other work on the text is still open",
  not_ready: "nothing submitted on the current version, or an earlier step is open",
  not_in_plan: "annotation is off in the work plan",
  fewer_than_two: "fewer than two submissions to compare",
  consolidation: "has a consolidation: accept it in the text card",
  differ: "the results differ: consolidate or choose in the text card",
};

/** Why "Change final…" leaves a text as it is. */
const CHANGE_SKIPS: Readonly<Record<string, string>> = {
  no_final: "no final result yet: use Accept agreeing results… or the text card",
  open_task: "other work on the text is still open",
  nothing_submitted: "nothing submitted on the current version",
  already_newest: "the final result already is the newest submission",
  not_newer: "nothing was submitted since the final result was chosen",
  own_result: "the newest submission is your own: another lead must choose it",
  differ: "submissions differ: compare or consolidate first",
};

function skipGroups(skipped: readonly { case_id: string; language: string; reason: string; message: string }[], words: Readonly<Record<string, string>>): PreviewGroup[] {
  const reasons = new Map<string, { case_id: string; language: string; message: string }[]>();
  for (const item of skipped) reasons.set(item.reason, [...(reasons.get(item.reason) ?? []), item]);
  return [...reasons].map(([reason, items]) => ({
    id: `skip-${reason}`, tone: "skip" as const, title: `Skip ${plural(items.length, "text")}`, detail: words[reason] ?? items[0].message, texts: textsOf(items),
  }));
}

/** "Tom Reis 5, R. Roe 4": whose submissions become final, most first. */
function authors(items: BulkChangeFinalView["changes"]): string {
  const counts = new Map<string, number>();
  for (const item of items) {
    const name = item.person ? shortPerson(item.person) : "someone no longer in the project";
    counts.set(name, (counts.get(name) ?? 0) + 1);
  }
  return [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([name, count]) => `${name} ${count}`).join(", ");
}

/** The preview's groups: what becomes final first, then the skipped texts by reason, then the texts kept as they are. */
export function finalGroups(preview: FinalPreview): PreviewGroup[] {
  if (preview.action === "accept") {
    const { texts, skipped, already_final: final, already_final_rows: finalRows = [] } = preview.data;
    const groups: PreviewGroup[] = [];
    if (texts.length) groups.push({ id: "accept", tone: "change", title: `Accept the result of ${plural(texts.length, "text")}`, detail: "all annotations agree in full", texts: textsOf(texts) });
    groups.push(...skipGroups(skipped, ACCEPT_SKIPS));
    if (final) groups.push({ id: "keep-final", tone: "keep", title: `Keep ${plural(final, "final result")}`, detail: "already final: use Change final… for them", texts: textsOf(finalRows) });
    return groups;
  }
  const { changes, skipped } = preview.data;
  const consolidations = changes.filter(item => item.kind === "consolidation");
  const annotations = changes.filter(item => item.kind === "annotation");
  const groups: PreviewGroup[] = [];
  if (consolidations.length) groups.push({ id: "change-consolidation", tone: "change", title: `Use the newest consolidation for ${plural(consolidations.length, "text")}`, detail: authors(consolidations), texts: textsOf(consolidations) });
  if (annotations.length) groups.push({ id: "change-annotation", tone: "change", title: `Use the newest annotation for ${plural(annotations.length, "text")}`, detail: authors(annotations), texts: textsOf(annotations) });
  groups.push(...skipGroups(skipped, CHANGE_SKIPS));
  return groups;
}

/** How many texts the action changes. */
export function finalCount(preview: FinalPreview): number {
  return preview.action === "accept" ? preview.data.texts.length : preview.data.changes.length;
}

/** The summary line's label: "Will become final:" (mockup 354-C) / "Will change:". */
export function finalSummaryLabel(action: FinalAction): string {
  return action === "accept" ? "Will become final:" : "Will change:";
}

/** "38 texts" / "the final result of 8 texts", or why nothing changes. */
export function finalSummaryText(preview: FinalPreview): string {
  const count = finalCount(preview);
  if (preview.action === "accept") return count ? plural(count, "text") : "No selected text has annotations that agree in full.";
  return count ? `the final result of ${plural(count, "text")}` : "No selected text has a newer submission than its final result.";
}

/** The dialog's action button: "Accept 38 results", "Change 8 final results". */
export function finalApplyLabel(action: FinalAction, count: number): string {
  return action === "accept" ? `Accept ${plural(count, "result")}` : `Change ${plural(count, "final result")}`;
}

/** The consequences step: what the action does and how to go back. */
export function finalConsequences(preview: FinalPreview): string[] {
  const count = finalCount(preview);
  if (preview.action === "accept") return [
    `${plural(count, "text")} ${count === 1 ? "gets" : "get"} a final result: the earliest of the agreeing submissions you may accept.`,
    "Each text is recorded in its history like a single Accept result.",
    "This cannot be undone here; use Withdraw final… or Change final… in a text card.",
  ];
  return [
    `${plural(count, "text")} ${count === 1 ? "gets" : "get"} the newest submission as final result. The earlier final result stays in each text's history.`,
    "Warnings acknowledged for the earlier final results do not carry over. Final exports already made stay as they are.",
    "Undo in the message brings the earlier final results back while nothing else changed on the texts.",
  ];
}

/**
 * "The earlier final results of 8 texts are back.", and for final exports made between the change and its Undo
 * " 1 final export made meanwhile stays as it is, with the changed results." (one message: it wraps on a phone).
 * `name`: the one text of a change made in the text card ("The earlier final result of EN100022 en is back.").
 */
export function finalUndoneText(view: Pick<BulkChangeFinalUndoView, "restore_count" | "exports_since">, name?: string): string {
  const { restore_count: count, exports_since: exports } = view;
  const back = `The earlier final ${count === 1 ? "result" : "results"} of ${name ?? plural(count, "text")} ${count === 1 ? "is" : "are"} back.`;
  return exports ? `${back} ${plural(exports, "final export")} made meanwhile ${exports === 1 ? "stays as it is" : "stay as they are"}, with the changed results.` : back;
}

/**
 * What changed on a text since the action, so that the Undo cannot run: the first five block the Undo of a changed
 * final result and of a bulk Reopen or Withdraw; the last three only the latter (issue 469).
 */
const UNDO_BLOCKS: Readonly<Record<string, string>> = {
  final: "its final result was changed, confirmed again or withdrawn",
  versions: "a version of the text was added, discarded or restored",
  plan: "its work plan changed",
  tasks: "a task was assigned, reopened, withdrawn or paused, or got a new round",
  submissions: "something was submitted or discarded",
  drafts: "work on a task was saved",
  not_in_plan: "the text no longer plans the task, or its version was discarded",
  person_unavailable: "a person of a task is no longer an active member with this role",
};

interface UndoBlock { case_id: string; language: string; reason: string; message: string }

/** "Undo is not possible: 2 of 8 texts changed since (EN100023 en: its work plan changed; and 1 more text). Nothing was undone." */
function undoRefusalText(blocked: readonly UndoBlock[], texts: number): string | null {
  const first = blocked[0];
  if (!first) return null;
  const more = blocked.length - 1;
  const why = `${textLabel(first)}: ${UNDO_BLOCKS[first.reason] ?? first.message}${more ? `; and ${plural(more, "more text")}` : ""}`;
  return `Undo is not possible: ${blocked.length} of ${plural(texts, "text")} changed since (${why}). Nothing was undone.`;
}

/** The answer a refused Undo carries (`details.preview`); null for any other failure. */
function refusedUndoView<T>(error: unknown): T | null {
  if (!(error instanceof ApiError) || error.code !== "BULK_UNDO_STALE" || typeof error.details !== "object" || error.details === null) return null;
  return (error.details.preview as T | undefined) ?? null;
}

/**
 * A refused Undo names the first text in its way: "Undo is not possible: 2 of 8 texts changed since (EN100023 en: its
 * final result was changed, confirmed again or withdrawn; and 1 more text). Nothing was undone."; null for any other failure.
 */
export function finalUndoRefusal(error: unknown): string | null {
  const view = refusedUndoView<BulkChangeFinalUndoView>(error);
  return view?.blocked ? undoRefusalText(view.blocked, view.texts) : null;
}

/**
 * The same for the Undo of a bulk Reopen or Withdraw (issue 469): "Undo is not possible: 1 of 7 texts changed since
 * (EN100022 en: a task was assigned, reopened, withdrawn or paused, or got a new round). Nothing was undone."; null
 * when the refusal names no text (an expired or used Undo).
 */
export function taskUndoRefusal(error: unknown): string | null {
  const view = refusedUndoView<BulkUndoResult>(error);
  return view?.blocked_texts ? undoRefusalText(view.blocked_texts, view.texts ?? view.blocked_texts.length) : null;
}

/** "Accepted the results of 38 texts." / "Changed the final result of 8 texts." */
export function finalAppliedText(preview: FinalPreview): string {
  const count = finalCount(preview);
  return preview.action === "accept"
    ? `Accepted the ${count === 1 ? "result" : "results"} of ${plural(count, "text")}.`
    : `Changed the final result of ${plural(count, "text")}.`;
}

/** A menu entry that does nothing for the selection gives its reason (decision 336-C); null when it acts or is unknown. */
export function finalUnavailableReason(preview: FinalPreview | null | undefined): string | null {
  if (!preview) return null;
  if (preview.action === "accept") {
    const { texts, skipped, already_final: final } = preview.data;
    if (texts.length) return null;
    return final && !skipped.length ? "The selected texts already have a final result: use Change final…." : "No selected text has annotations that agree in full.";
  }
  const { change_count: changes, skipped_count: skipped, skipped_by_reason: reasons } = preview.data;
  if (changes) return null;
  return skipped && (reasons.no_final ?? 0) >= skipped
    ? "The selected texts have no final result yet."
    : "No selected text has a newer submission than its final result.";
}
