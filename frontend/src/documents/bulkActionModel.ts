/**
 * Bulk lead actions of the selection bar's "More actions" menu (issue 336, decisions 336-A to 336-C): the preview of
 * an action grouped by consequence, e.g. "Reopen 9 submitted tasks · Tom Reis 5, R. Roe 4" with the texts behind
 * "Show all", "Skip 3 texts · final result chosen: use Change final… first" and "Keep 2 open tasks · not submitted
 * yet"; the menu entries with the reason when they do nothing for the selection; the toast after applying.
 */
import type { BulkTaskActionView, PersonRefView } from "../api/client";
import { plural } from "../app/labels";
import { textLabel } from "../app/identity";

export type BulkAction = "reopen" | "withdraw";
type TaskItem = BulkTaskActionView["changes"][number];
type KeptItem = BulkTaskActionView["kept"][number];

export interface PreviewGroup {
  id: string;
  /** "change": what the action does; "skip" and "keep": what stays as it is. */
  tone: "change" | "skip" | "keep";
  /** "Reopen 9 submitted tasks". */
  title: string;
  /** "Tom Reis 5, R. Roe 4" or "final result chosen: use Change final… first". */
  detail: string;
  /** The texts of the group, "EN100022 de", in list order without repeats. */
  texts: string[];
}

export const ACTION_LABELS: Readonly<Record<BulkAction, string>> = { reopen: "Reopen…", withdraw: "Withdraw open tasks…" };
export const TASK_LABELS: Readonly<Record<"annotate" | "translation_review" | "review", string>> = {
  annotate: "Annotations", translation_review: "Translation reviews", review: "Consolidations",
};

/** "Tom Reis", else the pseudonym (the preview names people briefly). */
export function shortPerson(person: PersonRefView): string {
  return person.display_name?.trim() || person.pseudonym;
}

/** "Tom Reis 5, R. Roe 4": people by number of tasks, most first. */
export function peopleCounts(items: readonly TaskItem[]): string {
  const counts = new Map<string, number>();
  for (const item of items) counts.set(shortPerson(item.person), (counts.get(shortPerson(item.person)) ?? 0) + 1);
  return [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([name, count]) => `${name} ${count}`).join(", ");
}

const textsOf = (items: readonly { case_id: string; language: string }[]): string[] => [...new Set(items.map(item => textLabel(item)))];

/** Why a task stays: the noun of its group ("open task") and the words after the dot. */
const KEEP: Readonly<Record<string, readonly [string, string]>> = {
  not_submitted: ["open task", "not submitted yet"],
  lead_correction: ["lead correction", "a lead correction made a newer version"],
  discarded: ["task", "the version was discarded"],
  lead_correction_open: ["translation review", "a lead correction of the version is open"],
  person_unavailable: ["task", "the person can no longer take it"],
  submitted: ["submitted task", "submitted work stays"],
  started: ["started task", "work has begun: tick “Also withdraw started tasks”"],
  paused: ["paused task", "paused by a problem report: decide the report first"],
  within_limit: ["annotation", "within the limit of annotators per text"],
  lead_correction_task: ["lead correction", "remove it in the text card"],
};

/** The preview's groups: what changes first, then the skipped texts, then the kept tasks by reason. */
export function previewGroups(preview: BulkTaskActionView): PreviewGroup[] {
  const groups: PreviewGroup[] = [];
  if (preview.action === "reopen") {
    if (preview.changes.length) groups.push({ id: "reopen", tone: "change", title: `Reopen ${plural(preview.changes.length, "submitted task")}`, detail: peopleCounts(preview.changes), texts: textsOf(preview.changes) });
  } else {
    const fresh = preview.changes.filter(item => item.status === "open");
    const started = preview.changes.filter(item => item.status !== "open");
    if (fresh.length) groups.push({ id: "withdraw", tone: "change", title: `Withdraw ${plural(fresh.length, "open task")}`, detail: peopleCounts(fresh), texts: textsOf(fresh) });
    if (started.length) groups.push({ id: "withdraw-started", tone: "change", title: `Withdraw ${plural(started.length, "started task")}, drafts kept`, detail: peopleCounts(started), texts: textsOf(started) });
  }
  if (preview.skipped.length) {
    groups.push({ id: "skip-final", tone: "skip", title: `Skip ${plural(preview.skipped.length, "text")}`, detail: "final result chosen: use Change final… first", texts: textsOf(preview.skipped) });
  }
  const reasons = new Map<string, KeptItem[]>();
  for (const item of preview.kept) reasons.set(item.reason, [...(reasons.get(item.reason) ?? []), item]);
  for (const [reason, items] of reasons) {
    const [noun, detail] = KEEP[reason] ?? ["task", items[0].message];
    groups.push({ id: `keep-${reason}`, tone: "keep", title: `Keep ${plural(items.length, noun)}`, detail, texts: textsOf(items) });
  }
  return groups;
}

/** "Will change: 14 assignments in 12 texts" (mockup 336-A), or why nothing changes. */
export function willChangeText(preview: BulkTaskActionView): string {
  const tasks = preview.changes.length;
  if (!tasks) return preview.action === "reopen" ? "Nothing to reopen in the selected texts." : "No open tasks to withdraw in the selected texts.";
  return `${plural(tasks, "assignment")} in ${plural(textsOf(preview.changes).length, "text")}`;
}

/** The dialog's action button: "Reopen 14 assignments", "Withdraw 3 assignments". */
export function applyLabel(action: BulkAction, tasks: number): string {
  return `${action === "reopen" ? "Reopen" : "Withdraw"} ${plural(tasks, "assignment")}`;
}

/** The consequences step (step 2, as in the Work plan dialog): what the people notice. */
export function consequenceLines(preview: BulkTaskActionView): string[] {
  const people = new Set(preview.changes.map(item => item.person.pseudonym)).size;
  const who = plural(people, "person", "people");
  if (preview.action === "reopen") return [
    `${who} ${people === 1 ? "gets" : "get"} their tasks back in My tasks, with your reason.`,
    "Their submissions stay in the history; a result chosen later uses what they submit again.",
    // A reopened review restarts from the current text: the server offers no Undo then.
    preview.changes.some(item => item.task === "translation_review")
      ? "Translation reviews start again from the current text of their version. This cannot be undone."
      : "Undo in the message submits the tasks again while nobody has changed them.",
  ];
  return [
    `The tasks leave My tasks of ${who}. Drafts are kept; submitted work stays.`,
    "The texts need the work again: assign it, for example with Assign annotation….",
    "Undo in the message brings the tasks back while nothing else changed on the texts.",
  ];
}

/** "Reopened 14 assignments in 12 texts." / "Withdrew 3 assignments in 2 texts." */
export function appliedText(result: BulkTaskActionView): string {
  const texts = plural(textsOf(result.changes).length, "text");
  return `${result.action === "reopen" ? "Reopened" : "Withdrew"} ${plural(result.changes.length, "assignment")} in ${texts}.`;
}

/** A menu entry that does nothing for the selection gives its reason (decision 336-C); null when it acts. Reads the counts only (`summary_only`). */
export function unavailableReason(action: BulkAction, preview: BulkTaskActionView | null | undefined): string | null {
  if (!preview || preview.change_count) return null;
  if (action === "reopen") return preview.skipped_count && preview.skipped_count >= preview.texts
    ? "The selected texts have a final result: use Change final… first."
    : "No submitted tasks in the selected texts.";
  return "No open tasks in the selected texts.";
}
