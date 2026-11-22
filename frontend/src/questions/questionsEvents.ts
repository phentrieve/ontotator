/** Window event fired after an own action changed which questions are open (the "Questions (n)" counter reloads, issue 590). */
export const QUESTIONS_CHANGED = "questions-changed";

export function notifyQuestionsChanged(): void {
  window.dispatchEvent(new Event(QUESTIONS_CHANGED));
}
