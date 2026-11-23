import { useEffect, useRef, useState } from "react";
import { api, type ProblemReportView } from "../api/client";
import { ErrorNotice } from "../admin/ErrorNotice";
import { textLabel } from "../app/identity";
import { routeHref, type Route } from "../app/router";
import { formatTime } from "../app/submissionLabels";
import { reporterName } from "../problems/labels";
import { DiffView } from "../translation/DiffView";
import { Button, EmptyState, InlineMessage } from "../ui";
import { tabId, Tabs } from "../ui/Tabs";
import { AnswerQuestionDialog } from "./AnswerQuestionDialog";
import { ANSWER_LABEL, openCount, QUESTIONS_PAGE_TITLE, taskNoun } from "./labels";
import { notifyQuestionsChanged, QUESTIONS_CHANGED } from "./questionsEvents";
import "./questions.css";

type Segment = "open" | "answered";

/** One question as the lead reads it, with "Answer…" while it is open. */
function LeadQuestion({ question, projectKey, target, onAnswer, onNavigate }: {
  question: ProblemReportView; projectKey: string; onAnswer: () => void; onNavigate: (route: Route) => void;
  /** The question a notification opened (issue 557): marked, scrolled into view and focused once. */
  target?: boolean;
}): JSX.Element {
  const open = question.state === "open";
  const documents: Route = { name: "projectDocuments", key: projectKey, case: question.case_id, language: question.language };
  const item = useRef<HTMLLIElement>(null);
  useEffect(() => {
    if (!target || !item.current) return;
    item.current.scrollIntoView?.({ block: "center" });
    item.current.focus({ preventScroll: true });
  }, [target]);
  return <li ref={item} className={`lead-question${open ? " lead-question--open" : ""}${target ? " lead-question--target" : ""}`}
    {...(target ? { tabIndex: -1, "aria-current": true } : {})}>
    <p className="lead-question-meta">{`${reporterName(question)} · ${taskNoun(question.task)} of ${textLabel(question)} · ${formatTime(question.created_at ?? "")}`}
      {question.pauses && open && " · task paused"}</p>
    <p className="lead-question-text">{question.reason}</p>
    {question.quote && question.proposed_text
      ? <div className="question-passage"><DiffView before={question.quote} after={question.proposed_text} label={`Proposed wording, ${textLabel(question)}`} lang={question.language} /></div>
      : question.quote && <p><span className="task-question-term">About:</span> <q>{question.quote}</q></p>}
    {question.answer != null && <p><strong>Your answer{question.answered_at ? `, ${formatTime(question.answered_at)}` : ""}:</strong> {question.answer}
      {question.took_proposed_text && " The proposed wording was taken into the text."}</p>}
    <div className="lead-question-actions">
      {open && <Button size="sm" variant="primary" onClick={onAnswer}>{ANSWER_LABEL}</Button>}
      <a className="btn btn-secondary btn-sm" href={routeHref(documents)} onClick={event => {
        if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
        event.preventDefault(); onNavigate(documents);
      }}>Open the text in Documents</a>
    </div>
  </li>;
}

/**
 * The lead's questions of a project (issue 553, prototype): open ones first, with "Answer…"; answered ones below.
 * The server lists every question to a lead and refuses nothing here; other members see only their own.
 */
export function QuestionsPage({ projectKey, question: targetId, onNavigate }: {
  projectKey: string;
  /** A question to show (from a notification, issue 557): its tab is selected and the question is marked. */
  question?: string;
  onNavigate: (route: Route) => void;
}): JSX.Element {
  const [questions, setQuestions] = useState<ProblemReportView[] | null>(null);
  const [error, setError] = useState<unknown>(null), [reload, setReload] = useState(0);
  const [segment, setSegment] = useState<Segment>("open");
  const [answering, setAnswering] = useState<ProblemReportView | null>(null), [notice, setNotice] = useState<string | null>(null);
  // Issue 619: loaded again when a notification opens another question here, on `questions-changed` (an own answer,
  // the sidebar link while this page is open) and on window focus, as "Questions (n)" in the sidebar is, so the Open
  // tab counts what the sidebar counts. The shown list stays until the new one arrives.
  useEffect(() => {
    let active = true;
    let request = 0;
    const load = () => {
      const mine = ++request;
      api.listQuestions(projectKey).then(list => { if (active && mine === request) { setQuestions(list); setError(null); } },
        failure => { if (active && mine === request) setError(failure); });
    };
    load();
    window.addEventListener(QUESTIONS_CHANGED, load);
    window.addEventListener("focus", load);
    return () => { active = false; window.removeEventListener(QUESTIONS_CHANGED, load); window.removeEventListener("focus", load); };
  }, [projectKey, reload, targetId]);
  // The tab of the question a notification opened, once the list is there (answered since: Answered). Only once per
  // opening, so answering it here does not switch the tab.
  const targetState = questions?.find(q => q.report_id === targetId)?.state;
  const shownTarget = useRef<string | null>(null);
  useEffect(() => {
    if (!targetId) { shownTarget.current = null; return; }
    if (!targetState || shownTarget.current === targetId) return;
    shownTarget.current = targetId;
    setSegment(targetState === "open" ? "open" : "answered");
  }, [targetId, targetState]);
  const open = (questions ?? []).filter(q => q.state === "open");
  const answered = (questions ?? []).filter(q => q.state !== "open");
  const shown = segment === "open" ? open : answered;
  return <section className="questions-page" aria-labelledby="questions-heading">
    <h1 id="questions-heading">{QUESTIONS_PAGE_TITLE}</h1>
    <p className="field-hint">Questions people asked with Ask the lead. Their tasks stay open unless they chose to pause them.</p>
    <Tabs label="Questions" active={segment} panelId="questions-panel" onSelect={value => setSegment(value as Segment)}
      tabs={[{ id: "open", label: "Open", count: open.length, href: "#", emphasised: open.length > 0 }, { id: "answered", label: "Answered", count: answered.length, href: "#" }]} />
    <div id="questions-panel" role="tabpanel" aria-labelledby={tabId("questions-panel", segment)} className="questions-page">
    {notice && <InlineMessage tone="success" onDismiss={() => setNotice(null)}>{notice}</InlineMessage>}
    {error != null && <><ErrorNotice error={error} /><Button onClick={() => setReload(n => n + 1)}>Retry</Button></>}
    {questions === null && error == null && <p role="status">Loading questions…</p>}
    {questions !== null && shown.length === 0 && <EmptyState title={segment === "open" ? "No open questions" : "No answered questions yet"} />}
    {shown.length > 0 && <ul className="lead-question-list" aria-label={segment === "open" ? openCount(open.length) : "Answered questions"}>
      {shown.map(question => <LeadQuestion key={question.report_id} question={question} projectKey={projectKey} onNavigate={onNavigate}
        target={question.report_id === targetId}
        onAnswer={() => { setNotice(null); setAnswering(question); }} />)}
    </ul>}
    {answering && <AnswerQuestionDialog question={answering} onClose={() => setAnswering(null)} onAnswered={done => {
      setAnswering(null);
      setQuestions(list => (list ?? []).map(q => q.report_id === done.report_id ? done : q));
      // Issue 590: "Questions (n)" in the sidebar follows the Open tab.
      notifyQuestionsChanged();
      setNotice(done.took_proposed_text ? "Answer sent. The proposed wording is in the reviewer's text." : "Answer sent.");
    }} />}
    </div>
  </section>;
}
