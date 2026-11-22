import { useState } from "react";
import type { AssignmentView, ProblemReportView } from "../api/client";
import { Button, InlineMessage } from "../ui";
import { AskLeadDialog } from "./AskLeadDialog";
import { askedNotice, ASK_LABEL, QUESTIONS_HEADING, questionStatus, SHOW_IN_TEXT, TOOK_PROPOSED } from "./labels";
import type { TaskQuestions } from "./useTaskQuestions";
import "./questions.css";

/** One question as the asker reads it: question, passage, wording, status and the lead's answer. */
export function QuestionItem({ question, onShowInText }: { question: ProblemReportView; onShowInText?: () => void }): JSX.Element {
  const open = question.state === "open";
  return <li className={`task-question${open ? " task-question--open" : ""}`}>
    <p className="task-question-status">{questionStatus(question)}</p>
    <p className="task-question-text">{question.reason}</p>
    {question.quote && <p className="task-question-quote"><span className="task-question-term">About:</span> <q>{question.quote}</q></p>}
    {question.proposed_text && <p className="task-question-quote"><span className="task-question-term">Your wording:</span> <q>{question.proposed_text}</q></p>}
    {question.answer != null && <div className="task-question-answer">
      <p><strong>Answer from the lead:</strong> {question.answer}</p>
      {question.took_proposed_text && <p>{TOOK_PROPOSED}{onShowInText && <> <Button size="sm" onClick={onShowInText}>{SHOW_IN_TEXT}</Button></>}</p>}
    </div>}
  </li>;
}

/**
 * "Questions to the lead" in a task's side panel (issue 553, prototype): the asker's questions with their answers,
 * and "Ask the lead…". The header button of the screen opens the same dialog through `askRef`.
 */
export function TaskQuestionList({ assignment, state, withProposal, readOnly, selectedText, onShowInText, dialogOpen, onDialogOpen }: {
  assignment: Pick<AssignmentView, "id" | "workflow_revision" | "active_round_id">; state: TaskQuestions; withProposal: boolean; readOnly: boolean;
  /** The passage selected in the task's text, read when the dialog opens. */
  selectedText?: () => string;
  /** Reload the task after the lead took a proposed wording into the text. */
  onShowInText?: () => void;
  /** The dialog is controlled by the screen so that its header button opens it too. */
  dialogOpen: { quote: string } | null;
  onDialogOpen: (value: { quote: string } | null) => void;
}): JSX.Element | null {
  const [notice, setNotice] = useState<string | null>(null);
  const list = state.questions ?? [];
  if (readOnly && list.length === 0) return null;
  return <section className="task-questions" aria-labelledby="task-questions-heading">
    <div className="task-questions-head">
      <h2 id="task-questions-heading" className="translation-section-title">{QUESTIONS_HEADING}</h2>
      {!readOnly && <Button size="sm" onClick={() => { setNotice(null); onDialogOpen({ quote: selectedText?.() ?? "" }); }}>{`${ASK_LABEL}…`}</Button>}
    </div>
    {notice && <InlineMessage tone="success" onDismiss={() => setNotice(null)}>{notice}</InlineMessage>}
    {list.length === 0
      ? <p className="field-hint">Not sure about something? Ask the lead. Your task stays open while you wait.</p>
      : <ul className="task-question-list">{list.map(question => <QuestionItem key={question.report_id} question={question} onShowInText={onShowInText} />)}</ul>}
    {dialogOpen && <AskLeadDialog assignment={assignment} quote={dialogOpen.quote} withProposal={withProposal}
      onClose={() => onDialogOpen(null)}
      onAsked={(question, pause) => { state.put(question); setNotice(askedNotice(pause)); onDialogOpen(null); void state.reload(); }} />}
  </section>;
}
