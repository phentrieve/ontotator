/** Issue 483: the lead decides a queried translation under "Resolve…": take the reviewer's text, or answer and accept the version as it is. */
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { api, ApiError, type QueryDecisionPreview, type QueryDecisionResult } from "../../src/api/client";
import { QueryDecisionDialog, queryDecisionMessage, queryRefusal, type QueryDecisionKind } from "../../src/documents/QueryDecisionDialog";
import { ResolveTranslation } from "../../src/documents/ResolveTranslation";
import { planRow, stepOf, version, work } from "./fixtures";
import { reviewRecord } from "../translationFixtures";

const OLD = "Bei der Untersuchung zeigt sie eine Hypotonie.";
const PROPOSED = "Bei der Untersuchung zeigt sie eine muskuläre Hypotonie.";
const QUESTION = "The source says muscular hypotonia. Is the short form meant?";
const ana = { pseudonym: "ann-0003", display_name: "Ana Weber", is_me: false };
const row = planRow("case-0101", "de", stepOf("resolve_queried", { document_id: "case-0101-de" }), {
  versions: [version({ document_id: "case-0101-de", chain_name: "DeepL", origin: "machine_translation", translation_status: "reviewed", latest_review_decision: "query" })],
  work: [work({ assignment_id: 12, document_id: "case-0101-de", task: "translation_review", status: "submitted", person: ana })],
});

function preview(overrides: Partial<QueryDecisionPreview> = {}): QueryDecisionPreview {
  return {
    document_id: "case-0101-de", case_id: "case-0101", language: "de", version: 1, next_version: 2, translation_status: "reviewed", text_sha256: "sha-v1", text: OLD,
    available: true, reason: null, proposes_changes: true, review_on: true, annotate_accepted_only: true, annotations: { submitted: 0, open: 0 }, open_consolidations: 0, final_result: false,
    review: { id: 7, assignment_id: 12, document_id: "case-0101-de", version: 1, rationale: QUESTION, categories: ["terminology"], proposed_text: PROPOSED, created_at: "2026-11-18T09:00:00Z" },
    ...overrides,
  };
}
const saved = (overrides: Partial<QueryDecisionResult> = {}): QueryDecisionResult => ({
  case_id: "case-0101", language: "de", kind: "reviewer_text", document_id: "case-0101~de~v2", version: 2, decided_document_id: "case-0101-de", decided_version: 1,
  translation_status: "accepted", text_sha256: "sha-v2", edited: false, ...overrides,
});

beforeEach(() => {
  vi.spyOn(api, "getQueryDecisionPreview").mockResolvedValue(preview());
  vi.spyOn(api, "decideQuery").mockResolvedValue(saved());
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

function renderDialog(kind: QueryDecisionKind) {
  const props = { kind, row, documentId: "case-0101-de", projectKey: "p", reviewer: "Ana Weber", onDecided: vi.fn(), onClose: vi.fn() };
  render(<QueryDecisionDialog {...props} />);
  return props;
}

it("Accept the reviewer's text: the proposed text, its changes against the version, an optional answer", async () => {
  const props = renderDialog("reviewer_text");
  const dialog = screen.getByRole("dialog", { name: "Accept the reviewer’s text as v2, case-0101 de v1" });
  const editor = await within(dialog).findByRole("textbox", { name: "Reviewer’s text" }) as HTMLTextAreaElement;
  expect(api.getQueryDecisionPreview).toHaveBeenCalledWith("p", "case-0101-de");
  // The editor starts with the reviewer's text, not with the version's text.
  expect(editor.value).toBe(PROPOSED);
  expect(within(dialog).getByText("Ana Weber asked a question about v1.")).toBeTruthy();
  expect(within(dialog).getByText(`“${QUESTION}”`)).toBeTruthy();
  expect(within(dialog).getByText("The text below becomes v2, a correction of v1, and is accepted. It is recorded as your decision on the query.")).toBeTruthy();
  const changes = within(dialog).getByRole("region", { name: "Text changes" });
  expect(changes.querySelector("ins")?.textContent).toContain("muskuläre");
  expect(within(dialog).getByText(/· 1 passage changed$/)).toBeTruthy();
  expect(within(dialog).getByText("You can still change the text here.")).toBeTruthy();
  // The answer is optional here.
  expect(within(dialog).getByRole("textbox", { name: "Answer to the reviewer (optional)" })).toBeTruthy();
  fireEvent.click(within(dialog).getByRole("button", { name: "Accept as v2" }));
  await waitFor(() => expect(api.decideQuery).toHaveBeenCalledWith("p", "case-0101-de",
    { kind: "reviewer_text", expected_text_sha256: "sha-v1", expected_review_id: 7, text: PROPOSED }));
  await waitFor(() => expect(props.onDecided).toHaveBeenCalledWith("case-0101 de: the reviewer’s text was saved as v2 and accepted."));
});

it("the lead may change the reviewer's text; the version's own text is not a new version", async () => {
  renderDialog("reviewer_text");
  const dialog = screen.getByRole("dialog", { name: "Accept the reviewer’s text as v2, case-0101 de v1" });
  const editor = await within(dialog).findByRole("textbox", { name: "Reviewer’s text" });
  fireEvent.change(editor, { target: { value: `${PROPOSED} Geprüft.` } });
  expect(within(dialog).getByText("You changed the reviewer’s text. The record says so.")).toBeTruthy();
  fireEvent.change(within(dialog).getByRole("textbox", { name: "Answer to the reviewer (optional)" }), { target: { value: " Yes, as proposed. " } });
  fireEvent.click(within(dialog).getByRole("button", { name: "Accept as v2" }));
  await waitFor(() => expect(api.decideQuery).toHaveBeenCalledWith("p", "case-0101-de",
    { kind: "reviewer_text", expected_text_sha256: "sha-v1", expected_review_id: 7, text: `${PROPOSED} Geprüft.`, answer: "Yes, as proposed." }));
  // Back at the version's text: nothing to save, and the other option is named.
  vi.mocked(api.decideQuery).mockClear();
  fireEvent.change(editor, { target: { value: OLD } });
  expect(within(dialog).getByText("This text is the same as v1. To accept v1 without changes, use Accept v1 as it is…")).toBeTruthy();
  expect(within(dialog).queryByRole("region", { name: "Text changes" })).toBeNull();
  const accept = within(dialog).getByRole("button", { name: "Accept as v2" });
  expect(accept.getAttribute("aria-disabled")).toBe("true");
  fireEvent.click(accept);
  expect(api.decideQuery).not.toHaveBeenCalled();
});

it("work on the version is named before the reviewer's text becomes a new version", async () => {
  vi.mocked(api.getQueryDecisionPreview).mockResolvedValue(preview({ annotate_accepted_only: false, annotations: { submitted: 1, open: 1 } }));
  renderDialog("reviewer_text");
  const dialog = screen.getByRole("dialog", { name: "Accept the reviewer’s text as v2, case-0101 de v1" });
  expect(await within(dialog).findByText("Annotation has work on v1.")).toBeTruthy();
  expect(within(dialog).getByText(/^2 annotations \(1 submitted, 1 open\) stay on v1\. After saving, the row offers Handle text change…\./)).toBeTruthy();
});

it("Accept v1 as it is: the answer is required", async () => {
  vi.mocked(api.decideQuery).mockResolvedValue(saved({ kind: "unchanged", document_id: "case-0101-de", version: 1 }));
  const props = renderDialog("unchanged");
  const dialog = screen.getByRole("dialog", { name: "Accept v1 as it is, case-0101 de" });
  expect(await within(dialog).findByText("v1 is accepted without changes. It is recorded as your decision on the query.")).toBeTruthy();
  expect(within(dialog).getByText("The reviewer also proposed a changed text. It is not taken.")).toBeTruthy();
  expect(within(dialog).queryByRole("textbox", { name: "Reviewer’s text" })).toBeNull();
  const accept = within(dialog).getByRole("button", { name: "Accept v1" });
  fireEvent.click(accept);
  // One hint, at the field (issue 547, U2-05); the button points to it.
  expect(within(dialog).getAllByText("Enter the answer to the reviewer.")).toHaveLength(1);
  const fieldError = within(dialog).getByText("Enter the answer to the reviewer.");
  expect(fieldError.classList.contains("field-hint-error")).toBe(true);
  expect(accept.getAttribute("aria-describedby")).toBe(fieldError.id);
  expect(api.decideQuery).not.toHaveBeenCalled();
  fireEvent.change(within(dialog).getByRole("textbox", { name: /^Answer to the reviewer/ }), { target: { value: "The short form is meant." } });
  fireEvent.click(accept);
  await waitFor(() => expect(api.decideQuery).toHaveBeenCalledWith("p", "case-0101-de",
    { kind: "unchanged", expected_text_sha256: "sha-v1", expected_review_id: 7, answer: "The short form is meant." }));
  await waitFor(() => expect(props.onDecided).toHaveBeenCalledWith("case-0101 de v1 was accepted as it is. The reviewer sees your answer at their submitted task."));
});

it("says in place why the query cannot be decided, before and at saving", async () => {
  vi.mocked(api.getQueryDecisionPreview).mockResolvedValue(preview({ available: false, reason: "review_open" }));
  const first = renderDialog("unchanged");
  expect(await screen.findByText(queryRefusal("review_open", "v1")!)).toBeTruthy();
  expect(screen.queryByRole("button", { name: "Accept v1" })).toBeNull();
  fireEvent.click(screen.getAllByRole("button", { name: "Close" }).at(-1)!);
  expect(first.onClose).toHaveBeenCalled();
  cleanup();
  vi.mocked(api.getQueryDecisionPreview).mockResolvedValue(preview());
  vi.mocked(api.decideQuery).mockRejectedValue(new ApiError(409, "refused", "QUERY_DECISION_NOT_AVAILABLE", { reason: "already_decided" }));
  const second = renderDialog("reviewer_text");
  const dialog = screen.getByRole("dialog", { name: "Accept the reviewer’s text as v2, case-0101 de v1" });
  await within(dialog).findByRole("textbox", { name: "Reviewer’s text" });
  fireEvent.click(within(dialog).getByRole("button", { name: "Accept as v2" }));
  expect(await within(dialog).findByText("This query was already decided. Reload the row to see its current state.")).toBeTruthy();
  expect(second.onDecided).not.toHaveBeenCalled();
});

it("words every refusal and the announcement", () => {
  for (const reason of ["already_decided", "not_a_query", "review_open", "not_newest", "discarded", "unchanged", "answer_required"]) expect(queryRefusal(reason, "v1")).toBeTruthy();
  expect(queryRefusal("other", "v1")).toBeNull();
  expect(queryDecisionMessage(row, saved(), true)).toBe("case-0101 de: the reviewer’s text was saved as v2 and accepted. The reviewer sees your answer at their submitted task.");
});

it("Resolve… on a queried translation shows the question and the proposed text first, then both decisions; a rejected one does not (issue 554)", async () => {
  vi.spyOn(api, "listTranslationReviews").mockResolvedValue([reviewRecord({ assignment_id: 12, decision: "query", rationale: QUESTION, categories: ["terminology"] })]);
  const props = { mode: "resolve" as const, row, projectKey: "p", revision: 3, onAssignReview: vi.fn(), onNavigate: vi.fn(), onDone: vi.fn(), onChanged: vi.fn(), onAnnounce: vi.fn(), onCancel: vi.fn() };
  render(<ResolveTranslation {...props} />);
  const box = screen.getByRole("dialog", { name: "Resolve queried translation, case-0101 de" });
  await within(box).findByText("Ana Weber asked a question about this translation.");
  // The proposed text with its changes, on demand, before any decision.
  const proposal = await within(box).findByText("Show the proposed text (1 passage changed)");
  expect(within(box).getByRole("region", { name: "Ana Weber’s proposed text, changes to v1", hidden: true }).querySelector("ins")?.textContent).toContain("muskuläre");
  expect(proposal.tagName).toBe("SUMMARY");
  // One primary decision, one alternative, the rest under Other ways….
  expect(within(box).getAllByRole("button").filter(button => !button.closest("details")).map(button => button.textContent)).toEqual([
    "", "Other ways…", "Cancel", "Accept v1 as it is…", "Accept the reviewer’s text as v2…",
  ]);
  expect(within(box).getByRole("button", { name: "Accept the reviewer’s text as v2…" }).className).toContain("btn-primary");
  fireEvent.click(within(box).getByRole("button", { name: "Other ways to resolve case-0101 de" }));
  expect(screen.getAllByRole("menuitem").map(item => item.getAttribute("aria-label"))).toEqual([
    "Reopen Ana Weber's review…", "Assign a new review…", "Correct it myself (counts as accepted)…", "Discard the de translation…",
  ]);
  fireEvent.keyDown(screen.getByRole("menu"), { key: "Escape" });
  fireEvent.click(within(box).getByRole("button", { name: "Accept the reviewer’s text as v2…" }));
  const dialog = screen.getByRole("dialog", { name: "Accept the reviewer’s text as v2, case-0101 de v1" });
  await within(dialog).findByRole("textbox", { name: "Reviewer’s text" });
  fireEvent.click(within(dialog).getByRole("button", { name: "Accept as v2" }));
  await waitFor(() => expect(props.onDone).toHaveBeenCalledWith("case-0101 de: the reviewer’s text was saved as v2 and accepted.", { caseId: "case-0101", revision: 3 }));
  cleanup();
  const rejected = planRow("case-0101", "de", stepOf("resolve_rejected", { document_id: "case-0101-de" }), {
    versions: [version({ document_id: "case-0101-de", chain_name: "DeepL", origin: "machine_translation", translation_status: "reviewed", latest_review_decision: "rejected" })],
  });
  render(<ResolveTranslation {...props} row={rejected} />);
  expect(screen.queryByRole("button", { name: /Accept the reviewer’s text/ })).toBeNull();
  expect(screen.queryByRole("button", { name: /as it is…/ })).toBeNull();
});

it("a query without a proposed change offers only Accept v1 as it is… (no greyed Accept the reviewer’s text)", async () => {
  vi.mocked(api.getQueryDecisionPreview).mockResolvedValue(preview({ proposes_changes: false, review: { ...preview().review!, proposed_text: OLD } }));
  vi.spyOn(api, "listTranslationReviews").mockResolvedValue([reviewRecord({ assignment_id: 12, decision: "query", rationale: QUESTION })]);
  render(<ResolveTranslation mode="resolve" row={row} projectKey="p" revision={3} onAssignReview={vi.fn()} onNavigate={vi.fn()} onDone={vi.fn()}
    onChanged={vi.fn()} onAnnounce={vi.fn()} onCancel={vi.fn()} />);
  const box = screen.getByRole("dialog", { name: "Resolve queried translation, case-0101 de" });
  expect(await within(box).findByText("Ana Weber proposed no change to the text.")).toBeTruthy();
  expect(within(box).queryByRole("button", { name: /Accept the reviewer’s text/ })).toBeNull();
  expect(within(box).getByRole("button", { name: "Accept v1 as it is…" }).className).toContain("btn-primary");
});

// ---- Issue 591: focus, the position of the proposed text, rules 4 and 6 in the decision dialogs ----

/** The accessible description from `aria-describedby` (hidden elements count, as for a screen reader). */
const description = (element: HTMLElement) => (element.getAttribute("aria-describedby") ?? "").split(/\s+/).filter(Boolean)
  .map(id => document.getElementById(id)?.textContent ?? "").join(" ");
const renderResolve = () => render(<ResolveTranslation mode="resolve" row={row} projectKey="p" revision={3} onAssignReview={vi.fn()} onNavigate={vi.fn()}
  onDone={vi.fn()} onChanged={vi.fn()} onAnnounce={vi.fn()} onCancel={vi.fn()} />);

it("a query without a proposed change opens with focus on Accept v1 as it is…, not on <body> (issue 591)", async () => {
  vi.mocked(api.getQueryDecisionPreview).mockResolvedValue(preview({ proposes_changes: false, review: { ...preview().review!, proposed_text: OLD } }));
  vi.spyOn(api, "listTranslationReviews").mockResolvedValue([reviewRecord({ assignment_id: 12, decision: "query", rationale: QUESTION })]);
  renderResolve();
  const box = screen.getByRole("dialog", { name: "Resolve queried translation, case-0101 de" });
  await within(box).findByText("Ana Weber proposed no change to the text.");
  await waitFor(() => expect(document.activeElement).toBe(within(box).getByRole("button", { name: "Accept v1 as it is…" })));
});

it("Show the proposed text opens at the first change (issue 591)", async () => {
  const far = `${"Erster Absatz ohne Änderung.\n\n".repeat(8)}${OLD}`;
  vi.mocked(api.getQueryDecisionPreview).mockResolvedValue(preview({ text: far, review: { ...preview().review!, proposed_text: far.replace("eine Hypotonie", "eine muskuläre Hypotonie") } }));
  vi.spyOn(api, "listTranslationReviews").mockResolvedValue([reviewRecord({ assignment_id: 12, decision: "query", rationale: QUESTION })]);
  renderResolve();
  const box = screen.getByRole("dialog", { name: "Resolve queried translation, case-0101 de" });
  const summary = await within(box).findByText("Show the proposed text (1 passage changed)");
  const view = within(box).getByRole("region", { name: "Ana Weber’s proposed text, changes to v1", hidden: true });
  // jsdom has no layout: the view is 240 px high, 100 px from the top; the change starts 600 px into it.
  Object.defineProperty(view, "clientHeight", { configurable: true, value: 240 });
  view.getBoundingClientRect = () => ({ top: 100 }) as DOMRect;
  view.querySelector<HTMLElement>("ins")!.getBoundingClientRect = () => ({ top: 700 }) as DOMRect;
  const details = summary.closest("details")!;
  details.open = true;
  fireEvent(details, new Event("toggle"));
  // A third of the view stays above the change as context.
  expect(view.scrollTop).toBe(600 - 80);
});

it("the decision dialogs open with focus on their primary action (rule 6, issue 591)", async () => {
  renderDialog("reviewer_text");
  const taking = screen.getByRole("dialog", { name: "Accept the reviewer’s text as v2, case-0101 de v1" });
  await within(taking).findByRole("textbox", { name: "Reviewer’s text" });
  expect(document.activeElement).toBe(within(taking).getByRole("button", { name: "Accept as v2" }));
  cleanup();
  renderDialog("unchanged");
  const unchanged = screen.getByRole("dialog", { name: "Accept v1 as it is, case-0101 de" });
  await within(unchanged).findByText("v1 is accepted without changes. It is recorded as your decision on the query.");
  expect(document.activeElement).toBe(within(unchanged).getByRole("button", { name: "Accept v1" }));
});

it("a greyed Accept names its reason as accessible description and tooltip before any press (rule 4, issue 591)", async () => {
  renderDialog("unchanged");
  const dialog = screen.getByRole("dialog", { name: "Accept v1 as it is, case-0101 de" });
  await within(dialog).findByText("v1 is accepted without changes. It is recorded as your decision on the query.");
  const accept = within(dialog).getByRole("button", { name: "Accept v1" });
  expect(accept.getAttribute("aria-disabled")).toBe("true");
  expect(description(accept)).toBe("Enter the answer to the reviewer.");
  expect(accept.getAttribute("title")).toBe("Enter the answer to the reviewer.");
  // Before the press it is not a visible hint.
  expect(within(dialog).getByText("Enter the answer to the reviewer.").closest("[hidden]")).toBeTruthy();
  fireEvent.change(within(dialog).getByRole("textbox", { name: /^Answer to the reviewer/ }), { target: { value: "The short form is meant." } });
  expect(accept.getAttribute("aria-disabled")).toBeNull();
  expect(accept.getAttribute("title")).toBeNull();
  expect(accept.getAttribute("aria-describedby")).toBeNull();
  cleanup();
  renderDialog("reviewer_text");
  const taking = screen.getByRole("dialog", { name: "Accept the reviewer’s text as v2, case-0101 de v1" });
  fireEvent.change(await within(taking).findByRole("textbox", { name: "Reviewer’s text" }), { target: { value: OLD } });
  const save = within(taking).getByRole("button", { name: "Accept as v2" });
  expect(description(save)).toBe("Change the text, or accept the version as it is.");
  expect(save.getAttribute("title")).toBe("Change the text, or accept the version as it is.");
});
