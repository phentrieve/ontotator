import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { api, ApiError, type AssignmentView, type DiscardResult, type PlanRowResult, type VariantSummary } from "../../src/api/client";
import { ResolveTranslation, type ResolveTranslationProps } from "../../src/documents/ResolveTranslation";
import { planRow, rejectedRow, stageCell, stages, stepOf, version, work } from "./fixtures";
import { reviewRecord } from "../translationFixtures";

const rejected = () => planRow("case-0101", "de", stepOf("resolve_rejected", { document_id: "case-0101-de" }), {
  versions: [version({ document_id: "case-0101-de", chain_name: "DeepL", origin: "machine_translation", translation_status: "reviewed", latest_review_decision: "rejected" })],
});
const notAccepted = () => planRow("case-0101", "de", stepOf("translation_not_accepted", { document_id: "case-0101-de" }), {
  plan_row: { review: false, annotate: true, review_applicable: true, discarded: false },
});

function renderResolve(overrides: Partial<ResolveTranslationProps> = {}) {
  const props: ResolveTranslationProps = {
    mode: "resolve", row: rejected(), projectKey: "p", revision: 3,
    onAssignReview: vi.fn(), onNavigate: vi.fn(), onDone: vi.fn(), onChanged: vi.fn(), onAnnounce: vi.fn(), onCancel: vi.fn(),
    ...overrides,
  };
  render(<ResolveTranslation {...props} />);
  return props;
}

/** The Resolve dialog (issue 554: a dialog, not a panel under the row). */
const resolveDialog = () => screen.getByRole("dialog", { name: "Resolve rejected translation, case-0101 de" });
/** The visible actions of the dialog's footer, without its Close button. */
const footerButtons = () => [...resolveDialog().querySelectorAll(".modal-actions button")].map(button => button.textContent);
/** Opens "Other ways…" and returns the names of its items. */
function otherWays(): string[] {
  fireEvent.click(within(resolveDialog()).getByRole("button", { name: "Other ways to resolve case-0101 de" }));
  return screen.getAllByRole("menuitem").map(item => item.getAttribute("aria-label") ?? item.textContent ?? "");
}
const chooseOther = (name: string) => fireEvent.click(screen.getByRole("menuitem", { name }));

const discarded = (overrides: Partial<DiscardResult> = {}): DiscardResult => ({
  case_id: "case-0101", language: "de", discarded_document_ids: ["case-0101-de"],
  flags: { review: false, annotate: false, review_applicable: true, discarded: true }, revision: 4, withdrawn: [], ...overrides,
});

beforeEach(() => {
  vi.spyOn(api, "listTranslationReviews").mockResolvedValue([]);
  vi.spyOn(api, "discardVariant");
  vi.spyOn(api, "patchWorkPlan");
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

it("one primary action, the other ways under Other ways… with one line each (issue 556)", () => {
  const props = renderResolve();
  expect(footerButtons()).toEqual(["Other ways…", "Cancel", "Correct it myself (counts as accepted)…"]);
  expect(within(resolveDialog()).getByRole("button", { name: "Correct it myself (counts as accepted)…" }).className).toContain("btn-primary");
  expect(within(resolveDialog()).queryByText(/accept the reviewer/i)).toBeNull();
  expect(otherWays()).toEqual(["Assign a new review…", "Discard the de translation…"]);
  // Each other way says when to use it, as its accessible description (shown in the open menu only).
  expect(screen.getByRole("menuitem", { name: "Assign a new review…" }).getAttribute("aria-describedby")).toBeTruthy();
  expect(screen.getByText("Another reviewer reviews v1.")).toBeTruthy();
  chooseOther("Assign a new review…");
  expect(props.onAssignReview).toHaveBeenCalled();
});

it("offers Reopen of the reviewer who rejected it, with an optional reason (#340)", async () => {
  vi.spyOn(api, "reopenAssignment").mockResolvedValue({ id: 12, status: "reopened" } as AssignmentView);
  const ana = { pseudonym: "ann-0004", display_name: "Ana Weber", is_me: false };
  const base = rejected();
  const row = { ...base, work: [
    work({ assignment_id: 12, document_id: "case-0101-de", task: "translation_review", status: "submitted", person: ana }),
    // A lead correction and an annotation are no reviews to reopen.
    work({ assignment_id: 13, document_id: "case-0101-de", task: "translation_review", status: "submitted", lead_correction: true }),
    work({ assignment_id: 14, document_id: "case-0101-de", task: "annotate", status: "submitted" }),
  ] };
  const props = renderResolve({ row });
  expect(otherWays()).toEqual(["Reopen Ana Weber's review…", "Assign a new review…", "Discard the de translation…"]);
  expect(screen.getByText("Ana Weber reviews v1 again, from its current text.")).toBeTruthy();
  chooseOther("Reopen Ana Weber's review…");
  const confirm = screen.getByRole("group", { name: "Reopen Ana Weber's review of case-0101 de" });
  expect(within(confirm).getByText("Ana Weber reviews v1 again, starting from its current text. The earlier decision stays in the history.")).toBeTruthy();
  // Cancel returns to the options with focus on Other ways….
  fireEvent.click(within(confirm).getByRole("button", { name: "Cancel" }));
  await waitFor(() => expect(document.activeElement).toBe(screen.getByRole("button", { name: "Other ways to resolve case-0101 de" })));
  otherWays();
  chooseOther("Reopen Ana Weber's review…");
  const again = screen.getByRole("group", { name: "Reopen Ana Weber's review of case-0101 de" });
  fireEvent.change(within(again).getByLabelText("Reason (optional)"), { target: { value: "Please check the dosage" } });
  fireEvent.click(within(again).getByRole("button", { name: "Reopen review" }));
  await waitFor(() => expect(props.onDone).toHaveBeenCalledWith("Ana Weber's review of case-0101 de was reopened.", { caseId: "case-0101", revision: 3 }));
  expect(api.reopenAssignment).toHaveBeenCalledWith(12, "Please check the dosage");
});

it("a failed reopen stays open with the error", async () => {
  vi.spyOn(api, "reopenAssignment").mockRejectedValue(new ApiError(409, "Only submitted work can be reopened.", "ASSIGNMENT_NOT_SUBMITTED"));
  const row = { ...rejected(), work: [work({ assignment_id: 12, document_id: "case-0101-de", task: "translation_review", status: "submitted", person: { pseudonym: "ann-0004", display_name: "Ana Weber", is_me: false } })] };
  const props = renderResolve({ row });
  otherWays();
  chooseOther("Reopen Ana Weber's review…");
  fireEvent.click(screen.getByRole("button", { name: "Reopen review" }));
  expect(await screen.findByText("Only submitted work can be reopened.")).toBeTruthy();
  expect(props.onDone).not.toHaveBeenCalled();
  expect(api.reopenAssignment).toHaveBeenCalledWith(12, undefined);
});

it("names who waits for the decision (#234)", () => {
  const person = (display_name: string) => ({ username: display_name.toLowerCase(), pseudonym: `ann-${display_name.length}`, display_name });
  const row = { ...rejected(), stages: stages({ annotation: stageCell("after_review", "waiting", { people: [person("Ana Weber")] as never }) }) };
  renderResolve({ row });
  const box = resolveDialog();
  expect(within(box).getByText("Ana Weber is waiting for this decision to start the annotation.")).toBeTruthy();
  cleanup();
  renderResolve();
  expect(screen.queryByText(/waiting for this decision/)).toBeNull();
});

it("Correct it myself (counts as accepted)… opens the panel in the dialog", async () => {
  vi.spyOn(api, "getVariantMetadata").mockResolvedValue({ document_id: "case-0101-de", text_sha256: "sha-v1" } as VariantSummary);
  vi.spyOn(api, "startLeadCorrection").mockResolvedValue({ id: 41 } as AssignmentView);
  const props = renderResolve();
  fireEvent.click(screen.getByRole("button", { name: "Correct it myself (counts as accepted)…" }));
  expect(screen.queryByRole("group", { name: "Resolve rejected translation, case-0101 de" })).toBeNull();
  const panel = within(resolveDialog()).getByRole("group", { name: "Correct it myself (counts as accepted), case-0101 de" });
  expect(within(panel).getByText(/You review v1 yourself/)).toBeTruthy();
  expect(props.onNavigate).not.toHaveBeenCalled();
  fireEvent.click(within(panel).getByRole("button", { name: "Open translation review" }));
  await waitFor(() => expect(props.onNavigate).toHaveBeenCalledWith({ name: "task", assignmentId: 41 }));
  expect(api.startLeadCorrection).toHaveBeenCalledWith("p", "case-0101-de", { expected_text_sha256: "sha-v1", confirm_language: false });

  // Cancel returns to the options with focus on the primary action.
  cleanup();
  renderResolve();
  fireEvent.click(screen.getByRole("button", { name: "Correct it myself (counts as accepted)…" }));
  fireEvent.click(within(screen.getByRole("group", { name: "Correct it myself (counts as accepted), case-0101 de" })).getByRole("button", { name: "Cancel" }));
  await waitFor(() => expect(document.activeElement).toBe(within(resolveDialog()).getByRole("button", { name: "Correct it myself (counts as accepted)…" })));
});

it("reads Continue your correction while the lead holds one", () => {
  vi.spyOn(api, "startLeadCorrection");
  const held = rejectedRow("case-0101", "de", { correcting: true });
  const props = renderResolve({ row: { ...held, next_step: stepOf("resolve_rejected", { document_id: "case-0101-de" }) } });
  const box = resolveDialog();
  expect(within(box).queryByRole("button", { name: /Correct it myself/ })).toBeNull();
  fireEvent.click(within(box).getByRole("button", { name: "Continue your correction" }));
  expect(props.onNavigate).toHaveBeenCalledWith({ name: "task", assignmentId: 41 });
  expect(api.startLeadCorrection).not.toHaveBeenCalled();
});

it("an ordinary open review of the lead (also an annotator) is not their correction", () => {
  const held = rejectedRow("case-0101", "de", { correcting: true });
  const row = { ...held, next_step: stepOf("resolve_rejected", { document_id: "case-0101-de" }), work: held.work.map(item => ({ ...item, lead_correction: false })) };
  renderResolve({ row });
  const box = resolveDialog();
  expect(within(box).queryByRole("button", { name: "Continue your correction" })).toBeNull();
  expect(within(box).getByRole("button", { name: "Correct it myself (counts as accepted)…" })).toBeTruthy();
});

it("discards with a required reason and shows consequences", async () => {
  const consequences = {
    withdrawn: [{ assignment_id: 9, case_id: "case-0101", language: "de", task: "annotate", person: { pseudonym: "ann-0004", display_name: "Ana Weber", is_me: false } }],
    finals_leaving: [], restored: [], open_reports: [],
  };
  vi.mocked(api.discardVariant).mockRejectedValueOnce(new ApiError(409, "confirm", "WORK_PLAN_CONFIRMATION_REQUIRED", consequences)).mockResolvedValueOnce(discarded());
  const props = renderResolve();
  otherWays();
  chooseOther("Discard the de translation…");
  const confirm = screen.getByRole("group", { name: "Discard the de translation of case-0101" });
  const discard = within(confirm).getByRole("button", { name: "Discard" });
  expect(discard.getAttribute("aria-disabled")).toBe("true");
  // Rule 4 (issue 591): the reason is the description and the tooltip.
  expect(document.getElementById(discard.getAttribute("aria-describedby") ?? "")?.textContent).toBe("Enter a reason.");
  expect(discard.getAttribute("title")).toBe("Enter a reason.");
  fireEvent.click(discard);
  expect(api.discardVariant).not.toHaveBeenCalled();
  fireEvent.change(within(confirm).getByLabelText("Reason (required)"), { target: { value: "Wrong source" } });
  fireEvent.click(discard);
  await waitFor(() => expect(api.discardVariant).toHaveBeenCalledWith("p", "case-0101-de", { reason: "Wrong source", confirm: false }));
  expect(await within(confirm).findByText("1 open annotation will be withdrawn (Ana Weber, ann-0004; draft kept).")).toBeTruthy();
  // The reason stays readable and focusable (read-only, not disabled) while the consequences are shown.
  const reason = within(confirm).getByLabelText("Reason (required)") as HTMLTextAreaElement;
  expect(reason.disabled).toBe(false);
  expect(reason.readOnly).toBe(true);
  expect(reason.getAttribute("aria-disabled")).toBe("true");
  fireEvent.click(discard);
  expect(api.discardVariant).toHaveBeenCalledTimes(1);
  fireEvent.click(within(confirm).getByRole("checkbox", { name: "I understand — withdraw the open tasks" }));
  fireEvent.click(discard);
  await waitFor(() => expect(api.discardVariant).toHaveBeenLastCalledWith("p", "case-0101-de", { reason: "Wrong source", confirm: true }));
  await waitFor(() => expect(props.onDone).toHaveBeenCalledWith("The de translation of case-0101 was discarded.", { caseId: "case-0101", revision: 4 }));
});

it("Assign review or accept… offers Turn translation review on or the external-review acceptance", async () => {
  const row = notAccepted();
  const saved = { case_id: "case-0101", language: "de", flags: { review: true, annotate: true, review_applicable: true, discarded: false }, revision: 4,
    undo: { rows: [], revisions: {} }, withdrawn: [], accepted_document_ids: [] } as PlanRowResult;
  vi.mocked(api.patchWorkPlan).mockResolvedValue(saved);
  const props = renderResolve({ mode: "not_accepted", row });
  const box = screen.getByRole("group", { name: "Translation not accepted, case-0101 de" });
  fireEvent.click(within(box).getByRole("button", { name: "Turn translation review on" }));
  await waitFor(() => expect(api.patchWorkPlan).toHaveBeenCalledWith("p", "case-0101", "de", { review: true, expected_revision: 3, confirm: false }));
  await waitFor(() => expect(props.onDone).toHaveBeenCalledWith("Translation review on for case-0101 de. Next: Assign review…", { caseId: "case-0101", revision: 4 }));

  cleanup();
  vi.mocked(api.patchWorkPlan).mockClear();
  const second = renderResolve({ mode: "not_accepted", row });
  const again = screen.getByRole("group", { name: "Translation not accepted, case-0101 de" });
  expect(within(again).getByText("This translation was reviewed outside Ontotator — accept it as it is")).toBeTruthy();
  const accept = within(again).getByRole("button", { name: "Accept and annotate" });
  expect(accept.getAttribute("aria-disabled")).toBe("true");
  fireEvent.click(accept);
  expect(api.patchWorkPlan).not.toHaveBeenCalled();
  fireEvent.change(within(again).getByLabelText("Reason (required)"), { target: { value: "Clinic review" } });
  fireEvent.click(accept);
  await waitFor(() => expect(api.patchWorkPlan).toHaveBeenCalledWith("p", "case-0101", "de", {
    annotate: true, expected_revision: 3, confirm: false, accept_external_review: { reason: "Clinic review" },
  }));
  await waitFor(() => expect(second.onDone).toHaveBeenCalledWith("case-0101 de accepted as reviewed outside Ontotator.", { caseId: "case-0101", revision: 4 }));
});

it("Cancel in the discard step returns to the options with focus on Other ways…", async () => {
  const props = renderResolve();
  otherWays();
  chooseOther("Discard the de translation…");
  const confirm = screen.getByRole("group", { name: "Discard the de translation of case-0101" });
  fireEvent.click(within(confirm).getByRole("button", { name: "Cancel" }));
  expect(props.onCancel).not.toHaveBeenCalled();
  expect(footerButtons()).toHaveLength(3);
  await waitFor(() => expect(document.activeElement).toBe(within(resolveDialog()).getByRole("button", { name: "Other ways to resolve case-0101 de" })));
});

it("announces Saving… through the page and has no status region of its own", async () => {
  let finish!: (value: PlanRowResult) => void;
  vi.mocked(api.patchWorkPlan).mockImplementation(() => new Promise(done => { finish = done; }));
  const props = renderResolve({ mode: "not_accepted", row: notAccepted() });
  fireEvent.click(screen.getByRole("button", { name: "Turn translation review on" }));
  expect(props.onAnnounce).toHaveBeenLastCalledWith("Saving…");
  expect(document.querySelector("[role='status']")).toBeNull();
  await act(async () => {
    finish({ case_id: "case-0101", language: "de", flags: { review: true, annotate: true, review_applicable: true, discarded: false }, revision: 4,
      undo: { rows: [], revisions: {} }, withdrawn: [], accepted_document_ids: [] } as PlanRowResult);
  });
  expect(props.onDone).toHaveBeenCalled();
});

it("reports a plan changed elsewhere with the current revisions and the message", async () => {
  vi.mocked(api.patchWorkPlan).mockRejectedValueOnce(new ApiError(409, "changed", "WORK_PLAN_CHANGED", { cases: [{ case_id: "case-0101", revision: 7 }] }));
  const props = renderResolve({ mode: "not_accepted", row: notAccepted() });
  fireEvent.click(screen.getByRole("button", { name: "Turn translation review on" }));
  expect(await screen.findByText("This plan changed. Reloaded the current plan.")).toBeTruthy();
  expect(props.onChanged).toHaveBeenCalledWith("case-0101", 7);
  expect(props.onAnnounce).toHaveBeenLastCalledWith("");
  expect(props.onDone).not.toHaveBeenCalled();
  expect(screen.queryByRole("alert")).toBeNull();
});

// ---- Issue 554: Resolve… is a dialog; Cancel, Close and Escape cancel it ----

it("opens as a dialog with focus on the primary action; Cancel, Close and Escape cancel", async () => {
  const props = renderResolve();
  await waitFor(() => expect(document.activeElement).toBe(within(resolveDialog()).getByRole("button", { name: "Correct it myself (counts as accepted)…" })));
  fireEvent.click(within(resolveDialog()).getByRole("button", { name: "Cancel" }));
  fireEvent.click(within(resolveDialog()).getByRole("button", { name: "Close" }));
  fireEvent.keyDown(document.activeElement ?? document.body, { key: "Escape" });
  expect(props.onCancel).toHaveBeenCalledTimes(3);
  cleanup();
  renderResolve({ mode: "not_accepted", row: notAccepted() });
  expect(screen.getByRole("dialog", { name: "Translation not accepted, case-0101 de" })).toBeTruthy();
});

it("a rejected correction of an accepted version names the other consequence: reviewed again", () => {
  const base = rejected();
  const row = { ...base, versions: [
    version({ document_id: "case-0101-de-v1", version: 1, chain_name: "DeepL", origin: "machine_translation", translation_status: "accepted", is_newest_in_chain: false }),
    version({ document_id: "case-0101-de", version: 2, chain_name: "DeepL", origin: "correction", derived_from: "case-0101-de-v1", translation_status: "reviewed", latest_review_decision: "rejected" }),
  ] };
  renderResolve({ row });
  fireEvent.click(within(resolveDialog()).getByRole("button", { name: "Correct it myself (reviewed again)…" }));
  // Rule 2 (issue 591): the step repeats the label of the button.
  expect(within(resolveDialog()).getByRole("heading", { name: "Correct it myself (reviewed again), case-0101 de" })).toBeTruthy();
});

it("quotes the reviewer's reason and categories above the options, named by the review's work item", async () => {
  vi.mocked(api.listTranslationReviews).mockResolvedValue([
    reviewRecord({ id: 1, assignment_id: 7, decision: "query", rationale: "Older question", created_at: "2026-10-19T08:00:00Z" }),
    reviewRecord({ id: 2, assignment_id: 8, decision: "rejected", rationale: "Dosage is missing", categories: ["omission", "terminology"], created_at: "2026-10-20T08:00:00Z" }),
  ]);
  const row = { ...rejected(), work: [work({ assignment_id: 8, document_id: "case-0101-de", task: "translation_review", status: "submitted", person: { pseudonym: "ann-0003", display_name: "Ana Weber", is_me: false } })] };
  renderResolve({ row });
  expect(await screen.findByText("Ana Weber rejected this translation.")).toBeTruthy();
  expect(screen.getByText("“Dosage is missing”")).toBeTruthy();
  expect(screen.getByText("Categories: Omission, Terminology")).toBeTruthy();
  expect(api.listTranslationReviews).toHaveBeenCalledWith("p", "case-0101-de");
  expect(screen.queryByText(/ann-0003/)).toBeNull();
});
