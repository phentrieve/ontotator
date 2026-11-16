/**
 * Bulk actions on final results in the selection bar's "More actions" menu (issue 336 step 2; issues 354 and 339 f;
 * decisions 336-A to 336-C, 354-C): "Accept agreeing results…" for the selected texts without a final result and
 * "Change final…" with the rule "newest submission" for the ones that have one. The previews are grouped by
 * consequence like the task actions (`bulkActionModel`): what becomes final first, then the skipped texts by reason.
 * Neither action has an Undo; the consequences step says so.
 */
import type { AcceptAgreeingView, BulkChangeFinalView } from "../api/client";
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

/** The consequences step: what the action does and that it has no Undo. */
export function finalConsequences(preview: FinalPreview): string[] {
  const count = finalCount(preview);
  if (preview.action === "accept") return [
    `${plural(count, "text")} ${count === 1 ? "gets" : "get"} a final result: the earliest of the agreeing submissions you may accept.`,
    "Each text is recorded in its history like a single Accept result.",
    "This cannot be undone here; use Withdraw final… or Change final… in a text card.",
  ];
  const uncompared = preview.data.changes.filter(item => item.kind === "annotation" && item.eligible_submissions > 1).length;
  return [
    `${plural(count, "text")} ${count === 1 ? "gets" : "get"} the newest submission as final result. The earlier final result stays in each text's history.`,
    ...(uncompared ? [`In ${plural(uncompared, "text")} the newest submission is one of several annotations; it becomes final without comparing them.`] : []),
    "Warnings acknowledged for the earlier final results do not carry over. Final exports already made stay as they are.",
    "This cannot be undone here; Change final… in a text card sets one text back.",
  ];
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
