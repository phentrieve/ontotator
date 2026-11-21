import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { api, type ProblemReportView } from "../../src/api/client";
import { AnswerQuestionDialog } from "../../src/questions/AnswerQuestionDialog";
import { AskLeadDialog } from "../../src/questions/AskLeadDialog";
import { QuestionItem } from "../../src/questions/TaskQuestionList";
import { askConsequence, questionStatus } from "../../src/questions/labels";
import { report } from "../problems/fixtures";

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

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
