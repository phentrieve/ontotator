import { useEffect, useId, useRef, useState } from "react";
import { api, type AssignmentView, type ProblemReportView } from "../api/client";
import { ErrorNotice } from "../admin/ErrorNotice";
import { Button, Checkbox, Dialog, Textarea } from "../ui";
import { askConsequence, ASK_LABEL, PAUSE_LABEL, PROPOSED_FIELD, PROPOSED_HINT, QUESTION_FIELD, QUOTE_FIELD, QUOTE_HINT, SEND_LABEL } from "./labels";

/**
 * "Ask the lead" (issue 553, prototype): a question, an optional quoted passage and, in a translation review, an
 * optional wording for it. By default the task stays open; "Pause my task until the lead answers" pauses it.
 */
export function AskLeadDialog({ assignment, quote: initialQuote = "", withProposal, onAsked, onClose }: {
  assignment: Pick<AssignmentView, "id" | "workflow_revision" | "active_round_id">;
  /** The passage selected in the text when the dialog opened. */
  quote?: string;
  /** Offer "Your wording for this passage" (translation review). */
  withProposal: boolean;
  onAsked: (question: ProblemReportView, pause: boolean) => void;
  onClose: () => void;
}): JSX.Element {
  const id = useId();
  const [question, setQuestion] = useState(""), [quote, setQuote] = useState(initialQuote), [proposed, setProposed] = useState(initialQuote);
  const [pause, setPause] = useState(false), [busy, setBusy] = useState(false);
  const [fieldError, setFieldError] = useState<string | null>(null), [error, setError] = useState<unknown>(null);
  const textarea = useRef<HTMLTextAreaElement>(null);
  const requestId = useRef(crypto.randomUUID());
  const active = useRef(true);
  useEffect(() => () => { active.current = false; }, []);

  const send = async () => {
    if (busy) return;
    if (!question.trim()) { setFieldError("Write your question."); textarea.current?.focus(); return; }
    setBusy(true); setError(null);
    const quoted = quote.trim() ? quote : null;
    const wording = withProposal && quoted && proposed.trim() && proposed !== quote ? proposed : null;
    try {
      const asked = await api.createProblemReport(assignment.id, {
        request_id: requestId.current, expected_workflow_revision: assignment.workflow_revision,
        round_id: assignment.active_round_id ?? null, submission_id: null,
        reason: question.trim(), kind: "question", quote: quoted, proposed_text: wording, pause,
      });
      if (active.current) onAsked(asked, pause);
    } catch (failure) {
      if (active.current) { setError(failure); requestId.current = crypto.randomUUID(); }
    } finally { if (active.current) setBusy(false); }
  };

  return <Dialog open title={ASK_LABEL} size="md" initialFocus={textarea} onClose={busy ? undefined : onClose} footer={<>
    <Button variant="primary" loading={busy} onClick={() => { void send(); }}>{SEND_LABEL}</Button>
    <Button aria-disabled={busy || undefined} onClick={() => { if (!busy) onClose(); }}>Cancel</Button>
  </>}>
    <form className="ask-lead-form" noValidate onSubmit={event => { event.preventDefault(); void send(); }}>
      <Textarea ref={textarea} id={`${id}-question`} label={QUESTION_FIELD} rows={4} required value={question} readOnly={busy}
        hint="Only you and project leads can read this." error={fieldError}
        onChange={event => { setQuestion(event.target.value); if (fieldError) setFieldError(null); }} />
      <Textarea id={`${id}-quote`} label={QUOTE_FIELD} rows={2} value={quote} readOnly={busy} hint={QUOTE_HINT}
        onChange={event => {
          const value = event.target.value;
          // The wording follows the quote until the asker changes it.
          if (proposed === quote) setProposed(value);
          setQuote(value);
        }} />
      {withProposal && <Textarea id={`${id}-proposed`} label={PROPOSED_FIELD} rows={2} value={proposed} readOnly={busy || !quote.trim()}
        hint={quote.trim() ? PROPOSED_HINT : "Quote a passage first."} onChange={event => setProposed(event.target.value)} />}
      <Checkbox id={`${id}-pause`} label={PAUSE_LABEL} checked={pause} disabled={busy} onChange={event => setPause(event.target.checked)} />
      <p className="ask-lead-consequence">{askConsequence(pause)}</p>
      {error != null && <ErrorNotice error={error} />}
    </form>
  </Dialog>;
}
