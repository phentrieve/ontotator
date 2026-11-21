/**
 * Wording of "Ask the lead" (issue 553, prototype): the asker's dialog and list, the lead's Questions page.
 * Pure functions, no React.
 */
import type { ProblemReportView } from "../api/client";
import { formatTime } from "../app/submissionLabels";

export const ASK_LABEL = "Ask the lead";
export const QUESTIONS_HEADING = "Questions to the lead";
export const QUESTION_FIELD = "Your question";
export const QUOTE_FIELD = "Passage you ask about (optional)";
export const QUOTE_HINT = "Select it in the text before you open this dialog, or paste it here.";
export const PROPOSED_FIELD = "Your wording for this passage (optional)";
export const PROPOSED_HINT = "The lead can take it into your text with the answer.";
export const PAUSE_LABEL = "Pause my task until the lead answers";
export const SEND_LABEL = "Send question";

/** What sending does to the task, under the form. */
export function askConsequence(pause: boolean): string {
  return pause
    ? "Your task is paused until the lead answers. Your saved work stays."
    : "Your task stays open. Keep working while the lead answers; you decide yourself.";
}

/** After sending, in the asker's list. */
export function askedNotice(pause: boolean): string {
  return pause ? "Question sent. Your task is paused until the lead answers." : "Question sent. You can keep working.";
}

/** The asker's status line of one question. */
export function questionStatus(question: ProblemReportView): string {
  if (question.state === "withdrawn") return "Withdrawn";
  if (question.answer != null && question.answered_at) return `Answered by the lead, ${formatTime(question.answered_at)}`;
  if (question.state === "resolved") return "Closed by the lead";
  return question.pauses ? "Waiting for the lead's answer. Your task is paused." : "Waiting for the lead's answer";
}

/** The asker reads what the answer did to their text. */
export const TOOK_PROPOSED = "The lead put your wording into your text.";
export const SHOW_IN_TEXT = "Show it in my text";

/** The lead's side. */
export const QUESTIONS_PAGE_TITLE = "Questions";
export const ANSWER_LABEL = "Answer…";
export const ANSWER_FIELD = "Your answer";
export const ANSWER_HINT = "The person who asked reads it in their task.";
export const TAKE_PROPOSED_LABEL = "Take the proposed wording into the reviewer's text";
export const TAKE_PROPOSED_HINT = "The quoted passage is replaced in the open review. The reviewer still decides and submits.";

export function answerButton(take: boolean): string {
  return take ? "Answer and take the wording" : "Send answer";
}

/** "1 open question", "3 open questions". */
export function openCount(n: number): string {
  return `${n} open ${n === 1 ? "question" : "questions"}`;
}

/** Task nouns as in problem reports: a "review" assignment is a consolidation. */
export function taskNoun(task: ProblemReportView["task"]): string {
  switch (task) {
    case "translation_review": return "translation review";
    case "review": return "consolidation";
    case "annotate": return "annotation";
    default: return "task";
  }
}
