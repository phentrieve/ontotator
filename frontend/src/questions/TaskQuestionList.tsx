import { useId, useRef, useState } from "react";
import { api, type AssignmentView, type ProblemReportView } from "../api/client";
import { ErrorNotice } from "../admin/ErrorNotice";
import { ownPauseActive } from "../problems/ReporterReportCard";
import { Button, InlineMessage, Textarea } from "../ui";
import { AskLeadDialog } from "./AskLeadDialog";
import { askedNotice, ASK_LABEL, QUESTIONS_HEADING, questionStatus, RESUME_CONFIRM, RESUME_HINT, RESUME_LABEL, RESUMED_NOTICE, SHOW_IN_TEXT, TOOK_PROPOSED } from "./labels";
import { notifyQuestionsChanged } from "./questionsEvents";
import type { TaskQuestions } from "./useTaskQuestions";
import "./questions.css";

/**
 * "Resume my task…" on a question that paused the asker's task (issue 590): the pause ends, the question stays open
 * and the lead can still answer it. The reason goes into the question's history, as for a problem report.
 */
function ResumeFromQuestion({ question, onResumed }: { question: ProblemReportView; onResumed: (question: ProblemReportView) => void }): JSX.Element {
  const id = useId();
  const [open, setOpen] = useState(false), [reason, setReason] = useState(""), [busy, setBusy] = useState(false);
  const [fieldError, setFieldError] = useState<string | null>(null), [error, setError] = useState<unknown>(null);
  const textarea = useRef<HTMLTextAreaElement>(null), requestId = useRef(crypto.randomUUID());
  if (!open) return <p><Button size="sm" onClick={() => { setOpen(true); window.requestAnimationFrame(() => textarea.current?.focus()); }}>{`${RESUME_LABEL}…`}</Button></p>;
  const resume = async () => {
    if (busy) return;
    if (!reason.trim()) { setFieldError("Enter a reason."); textarea.current?.focus(); return; }
    setBusy(true); setError(null);
    try {
      const value = await api.actOnProblemReport(question.report_id, {
        request_id: requestId.current, expected_revision: question.revision, action: "resume", reason: reason.trim(), assignment_ids: [question.assignment_id],
      });
      onResumed(value);
    } catch (failure) {
      setError(failure); requestId.current = crypto.randomUUID(); setBusy(false);
    }
  };
  return <div className="task-question-resume" role="group" aria-label={RESUME_LABEL}>
    <p>{RESUME_CONFIRM}</p>
    <Textarea ref={textarea} id={`${id}-reason`} label="Why can you continue?" rows={2} required value={reason} readOnly={busy} hint={RESUME_HINT}
      error={fieldError} onChange={event => { setReason(event.target.value); if (fieldError) setFieldError(null); }} />
    {error != null && <ErrorNotice error={error} />}
    <div className="lead-question-actions">
      <Button size="sm" variant="primary" loading={busy} onClick={() => { void resume(); }}>{RESUME_LABEL}</Button>
      <Button size="sm" aria-disabled={busy || undefined} onClick={() => { if (!busy) { setOpen(false); setReason(""); setFieldError(null); setError(null); } }}>Cancel</Button>
    </div>
  </div>;
}

/** One question as the asker reads it: question, passage, wording, status and the lead's answer. */
export function QuestionItem({ question, onShowInText, onResumed }: {
  question: ProblemReportView;
  /** "Show it in my text" after the lead took the wording; left out on read-only work, where nothing is shown again. */
  onShowInText?: () => void;
  /** Offers "Resume my task…" while this question pauses the task. */
  onResumed?: (question: ProblemReportView) => void;
}): JSX.Element {
  const open = question.state === "open";
  return <li className={`task-question${open ? " task-question--open" : ""}`}>
    <p className="task-question-status">{questionStatus(question)}</p>
    <p className="task-question-text">{question.reason}</p>
    {question.quote && <p className="task-question-quote"><span className="task-question-term">About:</span> <q>{question.quote}</q></p>}
    {question.proposed_text && <p className="task-question-quote"><span className="task-question-term">Your wording:</span> <q>{question.proposed_text}</q></p>}
    {onResumed && ownPauseActive(question) && <ResumeFromQuestion question={question} onResumed={onResumed} />}
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
export function TaskQuestionList({ assignment, state, withProposal, readOnly, selectedText, onShowInText, dialogOpen, onDialogOpen, onSaveBeforePause, onAsked, onPauseChanged }: {
  assignment: Pick<AssignmentView, "id" | "workflow_revision" | "active_round_id">; state: TaskQuestions; withProposal: boolean; readOnly: boolean;
  /** The passage selected in the task's text, read when the dialog opens. */
  selectedText?: () => string;
  /** Reload the task after the lead took a proposed wording into the text. */
  onShowInText?: () => void;
  /** The dialog is controlled by the screen so that its header button opens it too. */
  dialogOpen: { quote: string } | null;
  onDialogOpen: (value: { quote: string } | null) => void;
  /** Saves pending edits before a question pauses the task. */
  onSaveBeforePause?: () => Promise<void>;
  /** A question was sent (the screen clears the selection it quoted). */
  onAsked?: () => void;
  /** A question paused the task or a resume released it: the caller reads the task again, as after a problem report (issue 590). */
  onPauseChanged?: () => void;
}): JSX.Element | null {
  const [notice, setNotice] = useState<string | null>(null);
  const list = state.questions ?? [];
  if (readOnly && list.length === 0) return null;
  const resumed = (question: ProblemReportView) => { state.put(question); setNotice(RESUMED_NOTICE); onPauseChanged?.(); void state.reload(); };
  return <section className="task-questions" aria-labelledby="task-questions-heading">
    <div className="task-questions-head">
      <h2 id="task-questions-heading" className="translation-section-title">{QUESTIONS_HEADING}</h2>
      {!readOnly && <Button size="sm" onClick={() => { setNotice(null); onDialogOpen({ quote: selectedText?.() ?? "" }); }}>{`${ASK_LABEL}…`}</Button>}
    </div>
    {notice && <InlineMessage tone="success" onDismiss={() => setNotice(null)}>{notice}</InlineMessage>}
    {list.length === 0
      ? <p className="field-hint">Not sure about something? Ask the lead. Your task stays open while you wait.</p>
      : <ul className="task-question-list">{list.map(question => <QuestionItem key={question.report_id} question={question}
        onShowInText={readOnly ? undefined : onShowInText} onResumed={resumed} />)}</ul>}
    {dialogOpen && <AskLeadDialog assignment={assignment} quote={dialogOpen.quote} withProposal={withProposal}
      onSaveBeforePause={onSaveBeforePause} onClose={() => onDialogOpen(null)}
      onAsked={(question, pause) => {
        state.put(question); setNotice(askedNotice(pause)); onDialogOpen(null); onAsked?.(); notifyQuestionsChanged();
        if (pause) onPauseChanged?.();
        void state.reload();
      }} />}
  </section>;
}
