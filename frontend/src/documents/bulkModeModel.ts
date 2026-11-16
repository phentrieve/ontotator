/**
 * Bulk "Change mode…" in the selection bar's "More actions" menu (issue 336 step 4): the annotation mode of the
 * selected texts changes as "Change mode…" in a text card changes one. The preview is grouped by consequence like the
 * other bulk actions (`bulkActionModel`): the texts that change with the work that is discarded, then the skipped
 * texts by reason; a list names every person affected. No bulk Undo: each text is restored in its card.
 */
import type { BulkModeChangeView, PersonRefView } from "../api/client";
import { plural } from "../app/labels";
import { textLabel } from "../app/identity";
import type { PreviewGroup } from "./bulkActionModel";
import { MODE_WORDS, shortName } from "./stageLabels";

export type ModeName = "proposals" | "scratch";

export const MODE_ACTION_LABEL = "Change mode…";
/** The two modes, as the text card's plan control names them. */
export const MODE_CHOICES: Readonly<Record<ModeName, { label: string; help: string }>> = {
  scratch: { label: "From scratch", help: "The annotators mark the findings themselves." },
  proposals: { label: "From proposals", help: "The annotators check the tool proposals of the text." },
};

const textsOf = (items: readonly { case_id: string; language: string }[]): string[] => [...new Set(items.map(item => textLabel(item)))];

/** Why a text keeps its mode: the words after the dot. */
const SKIPS: Readonly<Record<string, string>> = {
  final_result: "final result chosen: use Withdraw final… first",
  not_locked: "no annotation work yet: set the mode with Plan…",
  no_proposals: "no tool proposals for the text",
  no_current_version: "no version of the text is in use",
};

/** "discards 7 submissions, removes 2 unsubmitted assignments" over the changed texts; "no work to discard" without any. */
export function workText(preview: Pick<BulkModeChangeView, "changes">): string {
  const submissions = preview.changes.reduce((sum, item) => sum + item.submissions.length, 0);
  const open = preview.changes.reduce((sum, item) => sum + item.assignments.filter(task => task.status !== "submitted").length, 0);
  const parts = [
    submissions ? `discards ${plural(submissions, "submission")}` : null,
    open ? `removes ${plural(open, "unsubmitted assignment")}` : null,
  ].filter(Boolean);
  return parts.length ? parts.join(", ") : "no work to discard";
}

/** The preview's groups: the texts that change, then the skipped texts by reason. */
export function modeGroups(preview: BulkModeChangeView): PreviewGroup[] {
  const groups: PreviewGroup[] = [];
  if (preview.changes.length) groups.push({
    id: "change-mode", tone: "change", title: `Annotate ${plural(preview.changes.length, "text")} ${MODE_WORDS[preview.mode]}`, detail: workText(preview), texts: textsOf(preview.changes),
  });
  const reasons = new Map<string, BulkModeChangeView["skipped"]>();
  for (const item of preview.skipped) reasons.set(item.reason, [...(reasons.get(item.reason) ?? []), item]);
  for (const [reason, items] of reasons) groups.push({
    id: `skip-${reason}`, tone: "skip", title: `Skip ${plural(items.length, "text")}`,
    detail: reason === "unchanged" ? `already annotated ${MODE_WORDS[preview.mode]}` : SKIPS[reason] ?? items[0].message, texts: textsOf(items),
  });
  return groups;
}

/** One person the change affects: their discarded submissions and their removed unsubmitted assignments. */
export interface AffectedPerson {
  name: string;
  submissions: number;
  consolidations: number;
  /** Unsubmitted annotation assignments removed. */
  removed: number;
  /** Unsubmitted consolidations removed. */
  removedConsolidations: number;
}

/** Everyone whose work the change touches: discarded work first (most first), then by name. */
export function affectedPeople(preview: Pick<BulkModeChangeView, "changes">): AffectedPerson[] {
  const people = new Map<string, AffectedPerson>();
  const entry = (person: PersonRefView): AffectedPerson => {
    let found = people.get(person.pseudonym);
    if (!found) { found = { name: shortName(person), submissions: 0, consolidations: 0, removed: 0, removedConsolidations: 0 }; people.set(person.pseudonym, found); }
    return found;
  };
  for (const change of preview.changes) {
    for (const item of change.submissions) {
      if (item.mode === "review") entry(item.author).consolidations += 1; else entry(item.author).submissions += 1;
    }
    for (const item of change.assignments) {
      if (item.status === "submitted") continue;
      if (item.task === "review") entry(item.person).removedConsolidations += 1; else entry(item.person).removed += 1;
    }
  }
  const discarded = (person: AffectedPerson) => person.submissions + person.consolidations;
  return [...people.values()].sort((a, b) => discarded(b) - discarded(a) || a.name.localeCompare(b.name));
}

/** "Tom Reis: 4 submissions are discarded; 1 unsubmitted assignment is removed." */
export function affectedLine(person: AffectedPerson): string {
  const are = (count: number) => count === 1 ? "is" : "are";
  const parts = [
    person.submissions ? `${plural(person.submissions, "submission")} ${are(person.submissions)} discarded` : null,
    person.consolidations ? `${plural(person.consolidations, "consolidation")} ${are(person.consolidations)} discarded` : null,
    person.removed ? `${plural(person.removed, "unsubmitted assignment")} ${are(person.removed)} removed` : null,
    person.removedConsolidations ? `${plural(person.removedConsolidations, "unsubmitted consolidation")} ${are(person.removedConsolidations)} removed` : null,
  ].filter(Boolean);
  return `${person.name}: ${parts.join("; ")}.`;
}

/** "the annotation mode of 5 texts", or why nothing changes. */
export function modeSummaryText(preview: BulkModeChangeView): string {
  return preview.changes.length ? `the annotation mode of ${plural(preview.changes.length, "text")}` : `No selected text can change to annotation ${MODE_WORDS[preview.mode]}.`;
}

/** The dialog's action button: "Change mode of 5 texts"; "Change mode" before a preview. */
export function modeApplyLabel(count: number | null): string {
  return count === null ? "Change mode" : `Change mode of ${plural(count, "text")}`;
}

/** The consequences step: what is discarded and restarted, and how to go back. */
export function modeConsequences(preview: BulkModeChangeView): string[] {
  const count = preview.changes.length;
  const submissions = preview.changes.reduce((sum, item) => sum + item.submissions.length, 0);
  const open = preview.changes.reduce((sum, item) => sum + item.assignments.filter(task => task.status !== "submitted").length, 0);
  const work = [
    submissions ? `${plural(submissions, "submission")} ${submissions === 1 ? "is" : "are"} discarded` : null,
    open ? `${plural(open, "unsubmitted assignment")} ${open === 1 ? "is" : "are"} removed (drafts are kept)` : null,
  ].filter(Boolean).join(" and ");
  return [
    `The annotation of ${plural(count, "text")} starts again ${MODE_WORDS[preview.mode]}: assign ${count === 1 ? "it" : "them"} anew.`,
    work ? `${work[0].toUpperCase()}${work.slice(1)}. Discarded work is kept, not deleted: it no longer counts for progress, consolidation, the final result or exports.` : "No submitted work is discarded.",
    "This cannot be undone here. Restore… in a text card brings one text back while no new annotation has started on it.",
  ];
}

/** "Changed the annotation mode of 5 texts." */
export function modeAppliedText(preview: BulkModeChangeView): string {
  return `Changed the annotation mode of ${plural(preview.changes.length, "text")}.`;
}

/**
 * The menu entry does nothing for the selection when neither mode changes a text: its reason (decision 336-C); null
 * when it acts or is unknown. Reads the counts only (`summary_only`), one preview per mode.
 */
export function modeUnavailableReason(previews: readonly (BulkModeChangeView | null | undefined)[]): string | null {
  if (previews.some(preview => !preview) || previews.some(preview => preview!.change_count)) return null;
  const every = (reason: string) => previews.every(preview => preview!.skipped_count > 0 && (preview!.skipped_by_reason[reason] ?? 0) + (preview!.skipped_by_reason.unchanged ?? 0) >= preview!.skipped_count)
    && previews.some(preview => preview!.skipped_by_reason[reason]);
  if (every("final_result")) return "The selected texts have a final result: use Withdraw final… first.";
  if (every("not_locked")) return "No annotation work on the selected texts yet: set the mode with Plan….";
  return "No selected text can change its annotation mode.";
}
