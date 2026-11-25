import { useEffect, useId, useRef, useState } from "react";
import { api, type ProblemReportView } from "../api/client";
import { ErrorNotice } from "../admin/ErrorNotice";
import { DiffView } from "../translation/DiffView";
import { Button, Checkbox, Dialog, Textarea } from "../ui";
import { reporterName } from "../problems/labels";
import { ANSWER_FIELD, ANSWER_HINT, answerButton, TAKE_PROPOSED_HINT, TAKE_PROPOSED_LABEL } from "./labels";

/**
 * The lead answers a question (issue 553, prototype). With a proposed wording, "Take the proposed wording into the
 * reviewer's text" replaces the quoted passage in the open review in the same step; the reviewer still submits.
 */
export function AnswerQuestionDialog({ question, onAnswered, onClose }: {
  question: ProblemReportView; onAnswered: (question: ProblemReportView) => void; onClose: () => void;
}): JSX.Element {
  const id = useId();
  const [answer, setAnswer] = useState(""), [take, setTake] = useState(false), [busy, setBusy] = useState(false);
  const [fieldError, setFieldError] = useState<string | null>(null), [error, setError] = useState<unknown>(null);
  const textarea = useRef<HTMLTextAreaElement>(null), requestId = useRef(crypto.randomUUID()), active = useRef(true);
  useEffect(() => () => { active.current = false; }, []);
  const proposal = question.quote != null && question.proposed_text != null;

  const send = async () => {
    if (busy) return;
    if (!answer.trim()) { setFieldError("Write your answer."); textarea.current?.focus(); return; }
    setBusy(true); setError(null);
    try {
      const done = await api.actOnProblemReport(question.report_id, {
        request_id: requestId.current, expected_revision: question.revision, action: "answer", reason: answer.trim(),
        assignment_ids: [], take_proposed_text: proposal && take,
      });
      if (active.current) onAnswered(done);
    } catch (failure) {
      if (active.current) { setError(failure); requestId.current = crypto.randomUUID(); }
    } finally { if (active.current) setBusy(false); }
  };

  return <Dialog open title={`Answer ${reporterName(question)}`} size="md" className="ask-lead-dialog" initialFocus={textarea} onClose={busy ? undefined : onClose} footer={<>
    <Button variant="primary" loading={busy} onClick={() => { void send(); }}>{answerButton(proposal && take)}</Button>
    <Button aria-disabled={busy || undefined} onClick={() => { if (!busy) onClose(); }}>Cancel</Button>
  </>}>
    <div className="ask-lead-form">
      <div>
        <p className="lead-question-meta">Question</p>
        <p className="lead-question-text">{question.reason}</p>
      </div>
      {question.quote && !proposal && <p className="task-question-quote"><span className="task-question-term">About:</span> <q>{question.quote}</q></p>}
      {proposal && <div>
        <p className="lead-question-meta">Proposed wording (changes to the quoted passage)</p>
        <div className="question-passage"><DiffView before={question.quote!} after={question.proposed_text!} label="Proposed wording" lang={question.language} /></div>
      </div>}
      <Textarea ref={textarea} id={`${id}-answer`} label={ANSWER_FIELD} rows={4} required value={answer} readOnly={busy} hint={ANSWER_HINT}
        error={fieldError} onChange={event => { setAnswer(event.target.value); if (fieldError) setFieldError(null); }} />
      {proposal && <Checkbox id={`${id}-take`} label={TAKE_PROPOSED_LABEL} hint={TAKE_PROPOSED_HINT} checked={take} disabled={busy}
        onChange={event => { setTake(event.target.checked); setError(null); }} />}
      {error != null && <ErrorNotice error={error} />}
    </div>
  </Dialog>;
}
