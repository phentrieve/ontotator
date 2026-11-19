/**
 * Why a task is paused (issue 464). Two causes hold a task, each released on its own: a problem report (`report`)
 * and the lead pausing the text (`lead`). A task with neither can be worked on. The words name the cause that
 * remains: "Paused by lead" with the lead's reason, "Paused" with the report's.
 */
export type PauseCause = "report" | "lead";

export interface PausedTask {
  held?: boolean;
  hold_reason?: string | null;
  pause_causes?: readonly PauseCause[];
  lead_pause_reason?: string | null;
}

export const PAUSED_BY_LEAD = "Paused by lead";
/** The way out of a pause from a problem report, as the paused banner says it. */
export const REPORT_WAY_OUT = "To continue, open “Text problems” and choose “Resume my task…”, or wait for the project lead's decision.";
const NO_REASON = "A project problem needs attention.";

const causesOf = (task: PausedTask): readonly PauseCause[] => task.pause_causes?.length ? task.pause_causes : task.held ? ["report"] : [];

/** The lead paused the task's text. */
export function pausedByLead(task: PausedTask): boolean {
  return causesOf(task).includes("lead");
}

/** One entry per cause, the report first: the badge and the reason under it. */
export function pauseMarks(task: PausedTask): { cause: PauseCause; badge: string; reason: string }[] {
  return causesOf(task).map(cause => cause === "lead"
    ? { cause, badge: PAUSED_BY_LEAD, reason: task.lead_pause_reason?.trim() || "The project lead paused the work on this text." }
    : { cause, badge: "Paused", reason: task.hold_reason?.trim() || NO_REASON });
}

/** The editor's paused banner: its title and its reason line. With both causes the banner names both. */
export function pauseNotice(task: PausedTask): { title: string; reason: string | null; kept?: string } {
  const lead = task.lead_pause_reason?.trim() || "The project lead paused the work on this text.";
  if (!pausedByLead(task)) return { title: "Task paused", reason: task.hold_reason ?? null, kept: REPORT_WAY_OUT };
  if (causesOf(task).includes("report")) return { title: "Paused by a problem report and by lead", reason: `${task.hold_reason?.trim() || NO_REASON} · Lead: ${lead}`, kept: "It opens again when the report's pause is released (“Text problems”, “Resume my task…”) and the project lead has released the text." };
  return { title: PAUSED_BY_LEAD, reason: lead, kept: "It opens again when the project lead releases the text." };
}
