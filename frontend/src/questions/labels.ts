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
  // Issue 590: "paused" only while this question's pause is in force (a resume ends it, the question stays open).
  const paused = question.holds ? question.holds.some(hold => hold.assignment_id === question.assignment_id && hold.active)
    : (question.held_assignment_ids ?? []).includes(question.assignment_id);
  return paused ? "Waiting for the lead's answer. Your task is paused." : "Waiting for the lead's answer";
}

/** The asker resumes a task their own question paused (issue 590); the question stays open. */
export const RESUME_LABEL = "Resume my task";
export const RESUME_CONFIRM = "Your task opens again. The question stays open and the lead can still answer it.";
export const RESUME_HINT = "Recorded with your question. Project leads see it.";
export const RESUMED_NOTICE = "Resumed. Your question stays open.";

/** The asker reads what the answer did to their text. */
export const TOOK_PROPOSED = "The lead put your wording into your text.";
export const SHOW_IN_TEXT = "Show it in my text";
/** Issue 616: the lead took the wording, but the reviewer had changed the passage, so their text was kept. */
export const TOOK_PROPOSED_KEPT = "The lead chose your wording. It is not in your text now: you changed that passage.";
export const SHOW_WORDING = "Show the lead's wording";

/** Issue 610: the reviewer's screen merges a taken wording into the text on screen, without losing an edit. */
export function wordingApplied(wording: string): string {
  return `The lead's wording is in your text now: “${wording}”. Your own edits are kept.`;
}
export const WORDING_KEPT_TITLE = "Your text was kept";
export function wordingKept(quote: string, wording: string): string {
  return `You changed “${quote}” after you asked, so the lead's wording was not put in: “${wording}”.`;
}
export const USE_WORDING = "Use the lead's wording";
/** Issue 616: what "Use the lead's wording" replaces, so a rewrite of several words is seen before it goes. */
export function wordingReplaces(mine: string): string {
  return `Replaces “${mine}” in your text.`;
}
export const WORDING_KEPT_HINT = "To use it, change the passage in your text.";
export const UNMERGED_TITLE = "This review was changed elsewhere";
export const UNMERGED_TEXT = "Your text here is not saved yet. Keep my text saves it over the other change. Load the saved review discards your edits here.";
export const KEEP_MINE = "Keep my text";
export const LOAD_SAVED = "Load the saved review…";
export const SYNC_FAILED = "The saved review could not be read, so the change made elsewhere is not in your text yet. Your text stays here.";

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

/**
 * Issue 616: the lead's side cannot know whether the wording stays in the text: a reviewer who changed the passage
 * meanwhile keeps their text. So both lines say what the answer did, not what the text holds now.
 */
export const ANSWERED_TOOK = "Answer sent. The proposed wording was put into the reviewer's saved text. If they had changed that passage meanwhile, their text is kept and they decide.";
export const TOOK_AT_ANSWER = "The proposed wording was put into the reviewer's saved text with this answer.";

/** Issue 611: the lead's line of a question whose pause the asker ended. */
export function resumedNote(reason: string | null | undefined): string {
  return reason?.trim() ? `resumed: ${reason.trim()}` : "resumed";
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
