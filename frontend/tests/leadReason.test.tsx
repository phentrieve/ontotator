import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { formatDateTime } from "../src/app/labels";
import { LeadReason, leadReasonLines, QueryAnswer, queryOutcomeText, reopenedText, secondReviewText } from "../src/tasks/LeadReason";

afterEach(cleanup);

const requested = "2026-11-17T09:30:00Z", reopened = "2026-11-18T10:00:00Z";

it("names the second review with its date and the lead's reason", () => {
  expect(secondReviewText({ status: "reopened", second_review_at: requested, second_review_reason: "Check the dose in paragraph 2." }))
    .toBe(`Second review requested by the lead on ${formatDateTime(requested)}: Check the dose in paragraph 2.`);
  expect(secondReviewText({ status: "open" })).toBeNull();
});

it("names a reopen only while the task is reopened, with or without a reason", () => {
  expect(reopenedText({ status: "reopened", reopened_at: reopened, reopen_reason: "The unit is mg in my copy." }))
    .toBe(`Reopened by the lead on ${formatDateTime(reopened)}: The unit is mg in my copy.`);
  expect(reopenedText({ status: "reopened", reopened_at: reopened })).toBe(`Reopened by the lead on ${formatDateTime(reopened)}. No reason given.`);
  expect(reopenedText({ status: "submitted", reopened_at: reopened, reopen_reason: "x" })).toBeNull();
  // "Ask a reviewer to correct…" to the reviewer who had submitted sets the status without a reopen of its own.
  expect(reopenedText({ status: "reopened", second_review_at: requested, second_review_reason: "x" })).toBeNull();
});

it("lists both in the order given and drops a reopen from before the second review", () => {
  const both = { status: "reopened", second_review_at: requested, second_review_reason: "First.", reopened_at: reopened, reopen_reason: "Then." };
  expect(leadReasonLines(both)).toEqual([`Second review requested by the lead on ${formatDateTime(requested)}: First.`, `Reopened by the lead on ${formatDateTime(reopened)}: Then.`]);
  expect(leadReasonLines({ ...both, reopened_at: "2026-11-16T08:00:00Z" })).toEqual([`Second review requested by the lead on ${formatDateTime(requested)}: First.`]);
});

it("renders a note with one line per reason and nothing without one", () => {
  const { container, rerender } = render(<LeadReason task={{ status: "open" }} />);
  expect(container.firstChild).toBeNull();
  rerender(<LeadReason task={{ status: "reopened", reopened_at: reopened, reopen_reason: "Look at paragraph 3 again." }} />);
  expect(screen.getByRole("note", { name: "From the lead" }).textContent).toBe(`Reopened by the lead on ${formatDateTime(reopened)}: Look at paragraph 3 again.`);
});

it("issue 483: the reviewer reads the lead's decision on a query and the answer", () => {
  const decided = "2026-11-18T10:12:00Z";
  expect(queryOutcomeText({ kind: "reviewer_text", accepted_version: 2, decided_at: decided })).toBe("Your text was accepted as v2.");
  expect(queryOutcomeText({ kind: "reviewer_text", accepted_version: 2, decided_at: decided, edited: true })).toBe("Your text was accepted as v2, with changes by the lead.");
  expect(queryOutcomeText({ kind: "unchanged", accepted_version: 1, decided_at: decided })).toBe("v1 was accepted as it is.");
  const { container, rerender } = render(<QueryAnswer answer={null} />);
  expect(container.firstChild).toBeNull();
  rerender(<QueryAnswer answer={{ kind: "unchanged", accepted_version: 1, decided_at: decided, answer: " The short form is meant. " }} />);
  expect(screen.getByRole("note", { name: "Answer from the lead" }).textContent)
    .toBe(`The lead decided your query on ${formatDateTime(decided)}. v1 was accepted as it is.Answer from the lead: The short form is meant.`);
  rerender(<QueryAnswer answer={{ kind: "reviewer_text", accepted_version: 2, decided_at: decided, answer: null }} />);
  expect(screen.getByRole("note", { name: "Answer from the lead" }).textContent)
    .toBe(`The lead decided your query on ${formatDateTime(decided)}. Your text was accepted as v2.The lead wrote no answer.`);
});
