import { formatDateTime } from "../app/labels";

/** What a task carries about why the lead asked for it: `TaskSummary` and the translation review's workspace both do. */
export interface LeadReasonFacts {
  status: string;
  reopened_at?: string | null;
  reopen_reason?: string | null;
  second_review_at?: string | null;
  second_review_reason?: string | null;
}

const on = (at: string | null | undefined) => at ? ` on ${formatDateTime(at)}` : "";

/** "Second review requested by the lead on 17 Nov 2026, 14:30: Check the dose in paragraph 2."; null without such a request. */
export function secondReviewText(task: LeadReasonFacts): string | null {
  if (!task.second_review_at && !task.second_review_reason) return null;
  return `Second review requested by the lead${on(task.second_review_at)}${task.second_review_reason ? `: ${task.second_review_reason}` : "."}`;
}

/**
 * "Reopened by the lead on 17 Nov 2026, 14:30: The unit is mg in my copy."; null unless the lead reopened the task.
 * A reopen from before the request for a second review belongs to the earlier review and is not repeated.
 */
export function reopenedText(task: LeadReasonFacts): string | null {
  if (task.status !== "reopened" || !task.reopened_at) return null;
  if (task.second_review_at && Date.parse(task.reopened_at) < Date.parse(task.second_review_at)) return null;
  return `Reopened by the lead${on(task.reopened_at)}${task.reopen_reason ? `: ${task.reopen_reason}` : ". No reason given."}`;
}

/** The lead's reasons for a task, in the order they were given. */
export function leadReasonLines(task: LeadReasonFacts): string[] {
  return [secondReviewText(task), reopenedText(task)].filter((line): line is string => line !== null);
}

/**
 * The lead's reason where the person works: in the translation review above Decision, in the consolidation under its
 * header, in My tasks under the task name. Renders nothing when the lead gave none.
 */
export function LeadReason({ task, className = "lead-reason" }: { task: LeadReasonFacts; className?: string }): JSX.Element | null {
  const lines = leadReasonLines(task);
  if (lines.length === 0) return null;
  return <div className={className} role="note" aria-label="From the lead">{lines.map(line => <p key={line}>{line}</p>)}</div>;
}
