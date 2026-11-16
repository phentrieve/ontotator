/**
 * Bulk lead actions of the selection bar's "More actions" menu (issue 336, decisions 336-A to 336-C): the preview of
 * an action grouped by consequence, e.g. "Reopen 9 submitted tasks · Tom Reis 5, R. Roe 4" with the texts behind
 * "Show all", "Skip 3 texts · final result chosen: use Change final… first" and "Keep 2 open tasks · not submitted
 * yet"; the menu entries with the reason when they do nothing for the selection; the toast after applying.
 * "Start a round…" (issue 336 step 3) gives the submitted annotations a new work round: continued from the submission
 * or restarted without the earlier findings. It has no Undo; the consequences step says so.
 */
import type { BulkTaskActionView, PersonRefView } from "../api/client";
import { plural } from "../app/labels";
import { textLabel } from "../app/identity";

export type BulkAction = "reopen" | "withdraw" | "start_round";
export type RoundKind = "carry_forward" | "clean_restart";
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

export const ACTION_LABELS: Readonly<Record<BulkAction, string>> = { reopen: "Reopen…", withdraw: "Withdraw open tasks…", start_round: "Start a round…" };
/** The two rounds a lead starts for a submitted annotation, as the dialog offers them. */
export const ROUND_KINDS: Readonly<Record<RoundKind, { label: string; help: string }>> = {
  carry_forward: { label: "Continue from the submission", help: "The new round starts with what the person submitted. They check it, change it and submit again." },
  clean_restart: { label: "Restart", help: "The new round has none of the earlier findings. A task from tool proposals starts again from the newest proposals, all open." },
};
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
  not_current_version: ["task", "not on the current version of the text: use the text card"],
  translation_not_accepted: ["task", "the translation is not accepted yet"],
  no_round: ["submitted task", "no work round to restart (older or imported work): use Reopen…"],
};

/** Why a whole text is skipped: the words after the dot. */
const SKIP: Readonly<Record<string, string>> = {
  final_chosen: "final result chosen: use Change final… first",
  final_result: "final result chosen: use Withdraw final… first",
  consolidation_open: "a consolidation is open: finish or withdraw it first",
};

/** The preview's groups: what changes first, then the skipped texts, then the kept tasks by reason. */
export function previewGroups(preview: BulkTaskActionView): PreviewGroup[] {
  const groups: PreviewGroup[] = [];
  if (preview.action === "reopen") {
    if (preview.changes.length) groups.push({ id: "reopen", tone: "change", title: `Reopen ${plural(preview.changes.length, "submitted task")}`, detail: peopleCounts(preview.changes), texts: textsOf(preview.changes) });
  } else if (preview.action === "start_round") {
    const verb = preview.kind === "clean_restart" ? "Restart" : "Continue";
    if (preview.changes.length) groups.push({ id: "start-round", tone: "change", title: `${verb} ${plural(preview.changes.length, "submitted task")} in a new round`, detail: peopleCounts(preview.changes), texts: textsOf(preview.changes) });
  } else {
    const fresh = preview.changes.filter(item => item.status === "open");
    const started = preview.changes.filter(item => item.status !== "open");
    if (fresh.length) groups.push({ id: "withdraw", tone: "change", title: `Withdraw ${plural(fresh.length, "open task")}`, detail: peopleCounts(fresh), texts: textsOf(fresh) });
    if (started.length) groups.push({ id: "withdraw-started", tone: "change", title: `Withdraw ${plural(started.length, "started task")}, drafts kept`, detail: peopleCounts(started), texts: textsOf(started) });
  }
  const skips = new Map<string, BulkTaskActionView["skipped"]>();
  for (const item of preview.skipped) skips.set(item.reason, [...(skips.get(item.reason) ?? []), item]);
  for (const [reason, items] of skips) {
    groups.push({ id: reason === "final_chosen" ? "skip-final" : `skip-${reason}`, tone: "skip", title: `Skip ${plural(items.length, "text")}`, detail: SKIP[reason] ?? items[0].message, texts: textsOf(items) });
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
  if (!tasks && preview.action === "start_round") return "No submitted annotation in the selected texts can start a round.";
  if (!tasks) return preview.action === "reopen" ? "Nothing to reopen in the selected texts." : "No open tasks to withdraw in the selected texts.";
  return `${plural(tasks, "assignment")} in ${plural(textsOf(preview.changes).length, "text")}`;
}

/** The dialog's action button: "Reopen 14 assignments", "Withdraw 3 assignments", "Start 14 rounds". */
export function applyLabel(action: BulkAction, tasks: number): string {
  if (action === "start_round") return `Start ${plural(tasks, "round")}`;
  return `${action === "reopen" ? "Reopen" : "Withdraw"} ${plural(tasks, "assignment")}`;
}

/** The consequences step (step 2, as in the Work plan dialog): what the people notice. */
export function consequenceLines(preview: BulkTaskActionView): string[] {
  const people = new Set(preview.changes.map(item => item.person.pseudonym)).size;
  const who = plural(people, "person", "people");
  if (preview.action === "start_round") {
    const tasks = plural(preview.changes.length, "task");
    return preview.kind === "clean_restart" ? [
      `${who} ${people === 1 ? "gets" : "get"} ${tasks} back in My tasks, in a new round without any of the earlier findings. Tasks from tool proposals start again from the newest proposals, all open.`,
      `The submitted work of ${preview.changes.length === 1 ? "this task" : `these ${tasks}`} is set aside: it no longer counts as submitted and is not carried into the new round. The earlier rounds stay readable under More › Work rounds.`,
      "This cannot be undone here, and no action on a single text brings the set-aside work back into the task.",
    ] : [
      `${who} ${people === 1 ? "gets" : "get"} ${tasks} back in My tasks, in a new round that starts with what they submitted.`,
      "The earlier submissions no longer count as submitted: each task must be submitted again. The earlier rounds stay readable under More › Work rounds.",
      "This cannot be undone here. There is no way back for a single text either: the person submits the new round.",
    ];
  }
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
  if (result.action === "start_round") return `Started ${plural(result.changes.length, "round")} in ${texts}.`;
  return `${result.action === "reopen" ? "Reopened" : "Withdrew"} ${plural(result.changes.length, "assignment")} in ${texts}.`;
}

/** A menu entry that does nothing for the selection gives its reason (decision 336-C); null when it acts. Reads the counts only (`summary_only`). */
export function unavailableReason(action: BulkAction, preview: BulkTaskActionView | null | undefined): string | null {
  if (!preview || preview.change_count) return null;
  if (action === "start_round") return preview.skipped_count && preview.skipped_count >= preview.texts
    ? "The selected texts have a final result or an open consolidation."
    : "No submitted annotations in the selected texts.";
  if (action === "reopen") return preview.skipped_count && preview.skipped_count >= preview.texts
    ? "The selected texts have a final result: use Change final… first."
    : "No submitted tasks in the selected texts.";
  return "No open tasks in the selected texts.";
}
