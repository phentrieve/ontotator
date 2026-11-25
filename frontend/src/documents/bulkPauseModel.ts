/**
 * "Pause texts…" and "Release texts…" in the selection bar's "More actions" menu (issue 464): a lead pauses the work
 * on the selected texts and releases it again. A paused text keeps its tasks: the people see them in My tasks, marked
 * "Paused by lead" with the reason, and can read them, but no open task can be saved, also one assigned later.
 * Submitted work and final results are untouched. The preview is grouped by consequence like the other bulk actions
 * (`bulkActionModel`): the texts that change with their open tasks (not submitted), then the skipped texts by reason. A pause
 * from a problem report is a separate cause: a release names the tasks a report still pauses. No Undo: the other
 * action is the way back.
 */
import type { PersonRefView, TextPauseActionView } from "../api/client";
import { plural } from "../app/labels";
import { textLabel } from "../app/identity";
import type { PreviewGroup } from "./bulkActionModel";
import { shortName } from "./stageLabels";

export type PauseAction = "pause" | "release";
type Change = TextPauseActionView["changes"][number];
type Task = Change["tasks"][number];

export const PAUSE_ACTION_LABELS: Readonly<Record<PauseAction, string>> = { pause: "Pause texts…", release: "Release texts…" };
/** Issue 613: the menu entry for one selected text reads in the singular, as the other entries do (#588). */
export function pauseActionLabel(action: PauseAction, count: number): string {
  return count === 1 ? (action === "pause" ? "Pause text…" : "Release text…") : PAUSE_ACTION_LABELS[action];
}
export function pauseTitle(action: PauseAction, count: number): string {
  return pauseActionLabel(action, count).replace(/…$/, "");
}

const textsOf = (items: readonly { case_id: string; language: string }[]): string[] => [...new Set(items.map(item => textLabel(item)))];
const tasksOf = (changes: readonly Change[]): Task[] => changes.flatMap(item => item.tasks);

/** "Tom Reis 5, R. Roe 4": people by number of open tasks, most first. */
export function taskPeople(tasks: readonly { person: PersonRefView }[]): string {
  const counts = new Map<string, number>();
  for (const task of tasks) counts.set(shortName(task.person), (counts.get(shortName(task.person)) ?? 0) + 1);
  return [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([name, count]) => `${name} ${count}`).join(", ");
}

/** The preview's groups: texts with open tasks, texts without, then the skipped texts by reason. */
export function pauseGroups(preview: TextPauseActionView): PreviewGroup[] {
  const groups: PreviewGroup[] = [];
  const pausing = preview.action === "pause";
  const working = preview.changes.filter(item => item.tasks.length);
  const idle = preview.changes.filter(item => !item.tasks.length);
  if (working.length) {
    const tasks = tasksOf(working);
    groups.push({
      id: "working", tone: "change",
      title: `${pausing ? "Pause" : "Release"} ${plural(working.length, "text")} with ${plural(tasks.length, "open task")}`,
      detail: taskPeople(tasks), texts: textsOf(working),
    });
  }
  if (idle.length) groups.push({
    id: "idle", tone: "change", title: `${pausing ? "Pause" : "Release"} ${plural(idle.length, "text")} without open tasks`,
    detail: pausing ? "tasks assigned later are paused from the start" : "tasks assigned later can be worked on", texts: textsOf(idle),
  });
  if (!pausing) {
    const still = preview.changes.filter(item => item.tasks.some(task => task.paused_by_report));
    const count = tasksOf(still).filter(task => task.paused_by_report).length;
    if (count) groups.push({
      id: "still-paused", tone: "keep", title: `${plural(count, "task")} ${count === 1 ? "stays" : "stay"} paused`,
      detail: "paused by a problem report as well: decide the report under Problem reports", texts: textsOf(still),
    });
  }
  const reasons = new Map<string, TextPauseActionView["skipped"]>();
  for (const item of preview.skipped) reasons.set(item.reason, [...(reasons.get(item.reason) ?? []), item]);
  for (const [reason, items] of reasons) groups.push({
    id: `skip-${reason}`, tone: "skip", title: `Skip ${plural(items.length, "text")}`,
    detail: reason === "already_paused" ? "already paused by a lead" : reason === "not_paused" ? "not paused by a lead" : items[0].message, texts: textsOf(items),
  });
  return groups;
}

/** "the work on 12 texts", or why nothing changes; `count` selected texts, one gets the singular (issue 585). */
export function pauseSummaryText(preview: TextPauseActionView, count: number): string {
  if (preview.changes.length) return `${preview.action === "pause" ? "the work on" : "the pause of"} ${plural(preview.changes.length, "text")}`;
  return nothingText(preview.action, count);
}

/** Why pausing or releasing changes nothing for the selection: the dialog's summary and the menu's reason. */
function nothingText(action: PauseAction, count: number): string {
  if (count === 1) return action === "pause" ? "The selected text is already paused." : "The selected text is not paused by a lead.";
  return action === "pause" ? "The selected texts are already paused." : "None of the selected texts is paused by a lead.";
}

/** The dialog's action button: "Pause 12 texts", "Release 3 texts". */
export function pauseApplyLabel(action: PauseAction, count: number | null): string {
  const verb = action === "pause" ? "Pause" : "Release";
  return count === null ? verb : `${verb} ${plural(count, "text")}`;
}

/** The consequences step: what the people notice, what stays untouched and the way back. */
export function pauseConsequences(preview: TextPauseActionView): string[] {
  const tasks = tasksOf(preview.changes);
  const people = new Set(tasks.map(task => task.person.pseudonym)).size;
  const who = plural(people, "person", "people");
  const texts = plural(preview.changes.length, "text");
  if (preview.action === "pause") return [
    tasks.length
      ? `${who} ${people === 1 ? "keeps" : "keep"} ${plural(tasks.length, "task")} in My tasks, marked “Paused by lead” with your reason. They can read the task but not save or submit it. A person who has the task open gets this message with the next save; what they typed stays in their editor.`
      : "Nobody has an open task on these texts now.",
    `Tasks assigned, reopened or given a new round on ${preview.changes.length === 1 ? "this text" : "these texts"} later are paused from the start, until you release the ${preview.changes.length === 1 ? "text" : "texts"}.`,
    "Submitted work and final results are untouched and are exported as before.",
    `A pause from a problem report is separate: it stays, and deciding a report does not release this pause. ${pauseActionLabel("release", preview.changes.length)} ends it.`,
  ];
  const still = tasks.filter(task => task.paused_by_report).length;
  return [
    !tasks.length ? `No task is open on ${texts}; tasks assigned from now on can be worked on.`
      : tasks.length > still ? `${plural(tasks.length - still, "task")} of ${who} can be worked on again, as they were left.`
      : `The lead pause of ${texts} ends.`,
    ...(still ? [`${plural(still, "task")} ${still === 1 ? "stays" : "stay"} paused by a problem report until that report is decided.`] : []),
    preview.changes.length === 1 ? "Pause text… pauses it again." : "Pause texts… pauses them again.",
  ];
}

/** "Paused 12 texts." / "Released 3 texts." */
export function pauseAppliedText(result: TextPauseActionView): string {
  return `${result.action === "pause" ? "Paused" : "Released"} ${plural(result.changes.length, "text")}.`;
}

/**
 * A menu entry that does nothing for the selection gives its reason (decision 336-C); null when it acts or is unknown.
 * `count` is the number of selected texts: one text gets the singular (issue 585).
 */
export function pauseUnavailableReason(action: PauseAction, preview: TextPauseActionView | null | undefined, count: number): string | null {
  if (!preview || preview.change_count) return null;
  return nothingText(action, count);
}
