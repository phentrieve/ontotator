import type { NotificationView } from "../api/client";
import { personLabel, textLabel } from "../app/identity";
import type { Route } from "../app/router";

/** How an entry names a task in running text (issue 557): "annotation of case-0102 de". */
const TASK_NOUNS: Readonly<Record<string, string>> = {
  annotate: "annotation",
  review: "consolidation",
  translation_review: "translation review",
};

/** "case-0102 de", from version 2 on with the version: no clinical text, only the names of texts and tasks. */
function text(item: NotificationView): string {
  if (!item.case_id || !item.language) return "a text";
  return textLabel({ case_id: item.case_id, language: item.language, version: item.version }, { withVersion: (item.version ?? 1) > 1 });
}

function task(item: NotificationView): string {
  const noun = item.task ? TASK_NOUNS[item.task] ?? "task" : "task";
  return `${noun} of ${text(item)}`;
}

/** The one line of an entry, e.g. "New task: annotation of case-0102 de". */
export function notificationText(item: NotificationView): string {
  const who = personLabel(item.actor, { fallback: "a team member" });
  switch (item.kind) {
    case "task_assigned": return `New task: ${task(item)}`;
    case "task_reopened": return `Task reopened: ${task(item)}`;
    case "task_released": return `Task released: ${task(item)}`;
    case "text_problem_received": return `Text problem from ${who}: ${text(item)}`;
    case "question_received": return `Question from ${who}: ${text(item)}`;
    case "answer_received": return `Answer from the lead on ${text(item)}`;
    case "submission_waiting": return `Waiting for your decision: ${text(item)}`;
  }
}

/** Where an entry leads: the task, the problem report, or Documents' Needs your decision. */
export function notificationRoute(item: NotificationView): Route {
  if (item.kind === "text_problem_received" && item.target_id) {
    return { name: "projectProblemReport", key: item.project_key, reportId: item.target_id };
  }
  if (item.kind === "submission_waiting") return { name: "projectDocuments", key: item.project_key, segment: "decision" };
  if (item.assignment_id !== null) return { name: "task", assignmentId: item.assignment_id };
  return { name: "tasks", project: item.project_key, status: "all" };
}

/** The bell's accessible name: "Notifications, 3 unread". */
export function bellLabel(unread: number | null): string {
  return unread ? `Notifications, ${unread} unread` : "Notifications";
}
