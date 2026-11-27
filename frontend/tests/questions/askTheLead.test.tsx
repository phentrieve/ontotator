import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { api, ApiError, type AssignmentView, type ProblemReportView } from "../../src/api/client";
import { errorMessage } from "../../src/admin/errors";
import { toolbarEntry } from "../../src/problems/labels";
import { pausedByProblem, pausedByQuestion, pauseNotice, QUESTION_PAUSE_TITLE, REPORT_WAY_OUT } from "../../src/tasks/pauseLabels";
import { AnswerQuestionDialog } from "../../src/questions/AnswerQuestionDialog";
import { AskLeadDialog } from "../../src/questions/AskLeadDialog";
import { QuestionItem, TaskQuestionList } from "../../src/questions/TaskQuestionList";
import { QuestionsPage } from "../../src/questions/QuestionsPage";
import type { TaskQuestions } from "../../src/questions/useTaskQuestions";
import { askConsequence, questionStatus } from "../../src/questions/labels";
import { event, hold, report } from "../problems/fixtures";

afterEach(() => { cleanup(); vi.restoreAllMocks(); });
// The dialog reads the task as it is now before it sends (issue 590): an earlier pause moved its revision.
beforeEach(() => { vi.spyOn(api, "getAssignmentMetadata").mockResolvedValue({ id: 7, workflow_revision: 3, active_round_id: "round-1" } as AssignmentView); });

const task = { id: 7, workflow_revision: 3, active_round_id: "round-1" };
const question = (over: Partial<ProblemReportView> = {}): ProblemReportView => report({
  kind: "question", reason: "Is the short form meant?", quote: "hypotonia", proposed_text: "muscular hypotonia", pauses: false,
  held_assignment_ids: [], holds: [], viewer_is_lead: true, task: "translation_review", ...over,
});

it("sends a question with quote and wording without pausing by default", async () => {
  const create = vi.spyOn(api, "createProblemReport").mockResolvedValue(question());
  const asked = vi.fn();
  render(<AskLeadDialog assignment={task} quote="hypotonia" withProposal onAsked={asked} onClose={vi.fn()} />);
  expect(screen.getByText(askConsequence(false))).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Send question" }));
  await screen.findByText("Write your question.");
  expect(create).not.toHaveBeenCalled();
  fireEvent.change(screen.getByRole("textbox", { name: /Your question/ }), { target: { value: "Is the short form meant?" } });
  fireEvent.change(screen.getByRole("textbox", { name: /Your wording for this passage/ }), { target: { value: "muscular hypotonia" } });
  fireEvent.click(screen.getByRole("button", { name: "Send question" }));
  await waitFor(() => expect(create).toHaveBeenCalledWith(7, {
    request_id: expect.any(String), expected_workflow_revision: 3, round_id: "round-1", submission_id: null,
    reason: "Is the short form meant?", kind: "question", quote: "hypotonia", proposed_text: "muscular hypotonia", pause: false,
  }));
  expect(asked).toHaveBeenCalledWith(expect.objectContaining({ kind: "question" }), false);
});

it("pauses only when the asker ticks it, and sends no wording equal to the quote", async () => {
  const create = vi.spyOn(api, "createProblemReport").mockResolvedValue(question({ pauses: true }));
  render(<AskLeadDialog assignment={task} quote="hypotonia" withProposal onAsked={vi.fn()} onClose={vi.fn()} />);
  fireEvent.change(screen.getByRole("textbox", { name: /Your question/ }), { target: { value: "Can I go on?" } });
  fireEvent.click(screen.getByRole("checkbox", { name: "Pause my task until the lead answers" }));
  expect(screen.getByText(askConsequence(true))).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Send question" }));
  await waitFor(() => expect(create).toHaveBeenCalledWith(7, expect.objectContaining({ pause: true, quote: "hypotonia", proposed_text: null })));
});

it("lets the lead answer and take the proposed wording in one step", async () => {
  const act = vi.spyOn(api, "actOnProblemReport").mockResolvedValue(question({ state: "resolved", answer: "Yes.", took_proposed_text: true }));
  const answered = vi.fn();
  render(<AnswerQuestionDialog question={question()} onAnswered={answered} onClose={vi.fn()} />);
  expect(screen.getByRole("region", { name: "Proposed wording" })).toBeTruthy();
  fireEvent.change(screen.getByRole("textbox", { name: /Your answer/ }), { target: { value: "Yes." } });
  expect(screen.getByRole("button", { name: "Send answer" })).toBeTruthy();
  fireEvent.click(screen.getByRole("checkbox", { name: /Take the proposed wording/ }));
  fireEvent.click(screen.getByRole("button", { name: "Answer and take the wording" }));
  await waitFor(() => expect(act).toHaveBeenCalledWith("r1", {
    request_id: expect.any(String), expected_revision: 1, action: "answer", reason: "Yes.", assignment_ids: [], take_proposed_text: true,
  }));
  expect(answered).toHaveBeenCalled();
});

it("offers no take without a proposed wording", () => {
  render(<AnswerQuestionDialog question={question({ quote: null, proposed_text: null })} onAnswered={vi.fn()} onClose={vi.fn()} />);
  expect(screen.queryByRole("checkbox")).toBeNull();
});

it("shows the asker a pending question and then the answer", () => {
  const pending = question({ viewer_is_lead: false });
  expect(questionStatus(pending)).toBe("Waiting for the lead's answer");
  const show = vi.fn();
  const { rerender } = render(<ul><QuestionItem question={pending} onShowInText={show} /></ul>);
  expect(screen.getByText("Is the short form meant?")).toBeTruthy();
  expect(screen.queryByText(/Answer from the lead/)).toBeNull();
  rerender(<ul><QuestionItem question={question({ state: "resolved", answer: "Yes, it is.", answered_at: "2026-11-20T10:12:00Z", took_proposed_text: true })} onShowInText={show} /></ul>);
  expect(screen.getByText(/Answer from the lead/)).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Show it in my text" }));
  expect(show).toHaveBeenCalled();
});

// Issue 590: the acceptance defects of "Ask the lead".
it("saves pending edits before a pausing question, and shows what sending does next to Send", async () => {
  const order: string[] = [];
  const save = vi.fn(async () => { order.push("save"); });
  vi.spyOn(api, "createProblemReport").mockImplementation(async () => { order.push("create"); return question({ pauses: true }); });
  render(<AskLeadDialog assignment={task} withProposal={false} onSaveBeforePause={save} onAsked={vi.fn()} onClose={vi.fn()} />);
  fireEvent.change(screen.getByRole("textbox", { name: /Your question/ }), { target: { value: "Can I go on?" } });
  // The consequence sits in the footer, so it stays in sight when the form scrolls.
  expect(screen.getByText(askConsequence(false)).closest(".modal-actions")).not.toBeNull();
  fireEvent.click(screen.getByRole("checkbox", { name: "Pause my task until the lead answers" }));
  expect(screen.getByRole("button", { name: "Send question" }).getAttribute("aria-describedby")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Send question" }));
  await waitFor(() => expect(order).toEqual(["save", "create"]));
});

it("sends no save before a question that does not pause", async () => {
  const save = vi.fn(async () => undefined);
  const create = vi.spyOn(api, "createProblemReport").mockResolvedValue(question());
  render(<AskLeadDialog assignment={task} withProposal={false} onSaveBeforePause={save} onAsked={vi.fn()} onClose={vi.fn()} />);
  fireEvent.change(screen.getByRole("textbox", { name: /Your question/ }), { target: { value: "Is it meant?" } });
  fireEvent.click(screen.getByRole("button", { name: "Send question" }));
  await waitFor(() => expect(create).toHaveBeenCalled());
  expect(save).not.toHaveBeenCalled();
});

it("sends the task's current revision, not the one the screen opened with", async () => {
  vi.mocked(api.getAssignmentMetadata).mockResolvedValue({ id: 7, workflow_revision: 5, active_round_id: "round-1" } as AssignmentView);
  const create = vi.spyOn(api, "createProblemReport").mockResolvedValue(question());
  render(<AskLeadDialog assignment={task} withProposal={false} onAsked={vi.fn()} onClose={vi.fn()} />);
  fireEvent.change(screen.getByRole("textbox", { name: /Your question/ }), { target: { value: "Again?" } });
  fireEvent.click(screen.getByRole("button", { name: "Send question" }));
  await waitFor(() => expect(create).toHaveBeenCalledWith(7, expect.objectContaining({ expected_workflow_revision: 5 })));
});

it("lets the asker resume a task their question paused; the question stays open", async () => {
  const paused = question({ viewer_is_lead: false, pauses: true, held_assignment_ids: [7], holds: undefined, assignment_id: 7 });
  expect(questionStatus(paused)).toBe("Waiting for the lead's answer. Your task is paused.");
  const act = vi.spyOn(api, "actOnProblemReport").mockResolvedValue({ ...paused, held_assignment_ids: [], revision: 2 });
  const resumed = vi.fn();
  render(<ul><QuestionItem question={paused} onResumed={resumed} /></ul>);
  fireEvent.click(screen.getByRole("button", { name: "Resume my task…" }));
  fireEvent.click(screen.getByRole("button", { name: "Resume my task" }));
  await screen.findByText("Enter a reason.");
  expect(act).not.toHaveBeenCalled();
  fireEvent.change(screen.getByRole("textbox", { name: /Why can you continue/ }), { target: { value: "I can go on with the rest." } });
  fireEvent.click(screen.getByRole("button", { name: "Resume my task" }));
  await waitFor(() => expect(act).toHaveBeenCalledWith("r1", {
    request_id: expect.any(String), expected_revision: 1, action: "resume", reason: "I can go on with the rest.", assignment_ids: [7],
  }));
  expect(resumed).toHaveBeenCalledWith(expect.objectContaining({ held_assignment_ids: [] }));
  // After the resume the status no longer says paused.
  expect(questionStatus({ ...paused, held_assignment_ids: [] })).toBe("Waiting for the lead's answer");
});

it("offers no resume when the question does not pause the task", () => {
  render(<ul><QuestionItem question={question({ viewer_is_lead: false })} onResumed={vi.fn()} /></ul>);
  expect(screen.queryByRole("button", { name: /Resume my task/ })).toBeNull();
});

it("names the question, not Text problems, on a task paused by the asker's own question", () => {
  const byQuestion = { held: true, hold_reason: "Can I go on?", pause_causes: ["report" as const], active_holds: [{ own_report_id: "q1", kind: "question" as const }] };
  expect(pausedByQuestion(byQuestion)).toBe(true);
  expect(pausedByProblem(byQuestion)).toBe(false);
  const notice = pauseNotice(byQuestion);
  expect(notice.title).toBe(QUESTION_PAUSE_TITLE);
  expect(notice.reason).toBe("Can I go on?");
  expect(notice.kept).toContain("Questions to the lead");
  expect(notice.kept).not.toContain("Text problems");
  // "Text problems" shows no pause for it.
  expect(toolbarEntry([], pausedByProblem(byQuestion)).paused).toBe(false);
  // A problem report as well: the report's way out, and "Text problems" shows the pause.
  const both = { ...byQuestion, active_holds: [...byQuestion.active_holds, { own_report_id: "r1", kind: "problem" as const }] };
  expect(pausedByQuestion(both)).toBe(false);
  expect(pausedByProblem(both)).toBe(true);
  expect(pauseNotice(both).kept).toBe(REPORT_WAY_OUT);
  // The lead paused the text too: both causes are named.
  const withLead = { ...byQuestion, pause_causes: ["report" as const, "lead" as const], lead_pause_reason: "Glossary" };
  expect(pausedByProblem(withLead)).toBe(true);
  expect(pauseNotice(withLead).title).toBe("Paused by your question and by lead");
});

it("tells the lead to answer without the wording when the passage is gone", () => {
  expect(errorMessage(new ApiError(409, "x", "QUESTION_ANSWER_NOT_AVAILABLE", { reason: "quote_not_found" })))
    .toBe("The quoted passage is no longer in the reviewer's text, so the wording cannot be taken. Untick “Take the proposed wording…” and send the answer without it.");
  expect(errorMessage(new ApiError(409, "x", "QUESTION_ANSWER_NOT_AVAILABLE", { reason: "not_a_question" })))
    .toBe("This question cannot be answered this way. Reload to see its current state.");
});

// Issue 611: the acceptance follow-ups of "Ask the lead".
it("clears the take error when the lead unticks Take the proposed wording", async () => {
  vi.spyOn(api, "actOnProblemReport").mockRejectedValue(new ApiError(409, "x", "QUESTION_ANSWER_NOT_AVAILABLE", { reason: "quote_not_found" }));
  render(<AnswerQuestionDialog question={question()} onAnswered={vi.fn()} onClose={vi.fn()} />);
  fireEvent.change(screen.getByRole("textbox", { name: /Your answer/ }), { target: { value: "Yes." } });
  fireEvent.click(screen.getByRole("checkbox", { name: /Take the proposed wording/ }));
  fireEvent.click(screen.getByRole("button", { name: "Answer and take the wording" }));
  await screen.findByText(/The quoted passage is no longer in the reviewer's text/);
  fireEvent.click(screen.getByRole("checkbox", { name: /Take the proposed wording/ }));
  expect(screen.queryByText(/The quoted passage is no longer in the reviewer's text/)).toBeNull();
  expect(screen.getByRole("button", { name: "Send answer" })).toBeTruthy();
});

it("tells the lead 'task paused' only while the pause is in force, and the resume reason after it", async () => {
  const paused = question({ report_id: "q1", reason: "Paused one?", pauses: true, assignment_id: 4, holds: [hold()] });
  const resumed = question({ report_id: "q2", reason: "Resumed one?", pauses: true, assignment_id: 4, holds: [hold({ hold_id: "h2", active: false })],
    events: [event({ action: "resume", reason: "I can do other paragraphs first" })] });
  vi.spyOn(api, "listQuestions").mockResolvedValue([paused, resumed]);
  render(<QuestionsPage projectKey="p" onNavigate={vi.fn()} />);
  const first = (await screen.findByText("Paused one?")).closest("li")!;
  const second = screen.getByText("Resumed one?").closest("li")!;
  expect(first.textContent).toContain("· task paused");
  expect(second.textContent).not.toContain("task paused");
  expect(second.textContent).toContain("· resumed: I can do other paragraphs first");
});

it("drops the 'Question sent' notice once the lead has answered", async () => {
  const asked = question({ report_id: "q9", viewer_is_lead: false });
  vi.spyOn(api, "createProblemReport").mockResolvedValue(asked);
  let list: ProblemReportView[] = [];
  const state = (): TaskQuestions => ({ questions: list, reload: vi.fn(async () => undefined), put: vi.fn((value: ProblemReportView) => { list = [value]; }) } as unknown as TaskQuestions);
  const props = { assignment: task, withProposal: false, readOnly: false, onDialogOpen: vi.fn() };
  const { rerender } = render(<TaskQuestionList {...props} state={state()} dialogOpen={{ quote: "" }} />);
  fireEvent.change(screen.getByRole("textbox", { name: /Your question/ }), { target: { value: "Is it meant?" } });
  fireEvent.click(screen.getByRole("button", { name: "Send question" }));
  await waitFor(() => expect(list).toHaveLength(1));
  rerender(<TaskQuestionList {...props} state={state()} dialogOpen={null} />);
  expect(screen.getByText("Question sent. You can keep working.")).toBeTruthy();
  list = [{ ...asked, state: "resolved", answer: "Yes.", answered_at: "2026-11-20T10:12:00Z" }];
  rerender(<TaskQuestionList {...props} state={state()} dialogOpen={null} />);
  expect(screen.queryByText("Question sent. You can keep working.")).toBeNull();
});

// Issue 616: after a clash the card does not say the wording is in the text.
it("says the wording is not in the text when the reviewer's text was kept", () => {
  const show = vi.fn();
  const answered = question({ state: "resolved", answer: "Yes.", answered_at: "2026-11-20T10:12:00Z", took_proposed_text: true, viewer_is_lead: false });
  render(<ul><QuestionItem question={answered} onShowInText={show} wordingInText={() => false} /></ul>);
  expect(screen.queryByText("The lead put your wording into your text.")).toBeNull();
  expect(screen.getByText(/It is not in your text now: you changed that passage/)).toBeTruthy();
  expect(screen.queryByRole("button", { name: "Show it in my text" })).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Show the lead's wording" }));
  expect(show).toHaveBeenCalled();
});
