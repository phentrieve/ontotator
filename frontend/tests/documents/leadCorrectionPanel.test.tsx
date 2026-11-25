import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { api, ApiError, type AssignmentView, type LeadCorrectionPreview, type VariantSummary } from "../../src/api/client";
import { annotationConsequence, correctionConsequences, LeadCorrectionPanel, reviewedAgain } from "../../src/documents/LeadCorrectionPanel";
import { planRow, rejectedRow, stepOf, version } from "./fixtures";

const assignment = (id: number) => ({ id, project_key: "p", document_id: "case-0101-de", task: "translation_review", status: "open", lead_correction: true }) as AssignmentView;

function renderPanel(row = rejectedRow("case-0101", "de", { version: 2 })) {
  const props = { row, projectKey: "p", onNavigate: vi.fn(), onCancel: vi.fn() };
  render(<LeadCorrectionPanel {...props} />);
  return props;
}
const panel = () => screen.getByRole("group", { name: "Correct it myself (counts as accepted), case-0101 de" });
const open = () => within(panel()).getByRole("button", { name: "Open translation review" });

beforeEach(() => {
  vi.spyOn(api, "getVariantMetadata").mockResolvedValue({ document_id: "case-0101-de", text_sha256: "sha-v2" } as VariantSummary);
  vi.spyOn(api, "startLeadCorrection");
  vi.spyOn(api, "getProfile").mockResolvedValue({ qualification: "physician" } as Awaited<ReturnType<typeof api.getProfile>>);
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

it("explains v{n} → v{n+1} and opens the translation review", async () => {
  vi.mocked(api.startLeadCorrection).mockResolvedValue(assignment(41));
  const props = renderPanel();
  expect(within(panel()).getByText("You review v2 yourself and submit it as Accepted with corrections. The corrected text becomes v3 and counts as accepted.")).toBeTruthy();
  await waitFor(() => expect(document.activeElement).toBe(within(panel()).getByRole("heading", { name: "Correct it myself (counts as accepted), case-0101 de" })));
  expect(within(panel()).queryByRole("checkbox")).toBeNull();
  fireEvent.click(open());
  await waitFor(() => expect(api.startLeadCorrection).toHaveBeenCalledWith("p", "case-0101-de", { expected_text_sha256: "sha-v2", confirm_language: false }));
  await waitFor(() => expect(props.onNavigate).toHaveBeenCalledWith({ name: "task", assignmentId: 41 }));
  fireEvent.click(within(panel()).getByRole("button", { name: "Cancel" }));
  expect(props.onCancel).toHaveBeenCalled();
});

it("asks for language confirmation only on LANGUAGE_CONFIRMATION_REQUIRED", async () => {
  vi.mocked(api.startLeadCorrection)
    .mockRejectedValueOnce(new ApiError(409, "confirm", "LANGUAGE_CONFIRMATION_REQUIRED", { document_language: "de", user_languages: ["en"], required_languages: ["de", "en"] }))
    .mockResolvedValueOnce(assignment(42));
  const props = renderPanel();
  fireEvent.click(open());
  const checkbox = await within(panel()).findByRole("checkbox", { name: "Correct despite missing de in your profile" });
  expect(open().getAttribute("aria-disabled")).toBe("true");
  fireEvent.click(open());
  expect(api.startLeadCorrection).toHaveBeenCalledTimes(1);
  fireEvent.click(checkbox);
  fireEvent.click(open());
  await waitFor(() => expect(api.startLeadCorrection).toHaveBeenLastCalledWith("p", "case-0101-de", { expected_text_sha256: "sha-v2", confirm_language: true }));
  await waitFor(() => expect(props.onNavigate).toHaveBeenCalledWith({ name: "task", assignmentId: 42 }));
});

// Issue 629: the profile languages are known in advance, so the first click does not meet a 409.
it("shows the language confirmation before the first attempt when the preview names missing languages", async () => {
  vi.spyOn(api, "getLeadCorrectionPreview").mockResolvedValue(preview({ document_id: "case-0101-de", version: 2, next_version: 3, translation_status: "reviewed",
    reviewed_again: false, annotations: { submitted: 0, open: 0 }, missing_languages: ["es"] }));
  vi.mocked(api.startLeadCorrection).mockResolvedValue(assignment(44));
  const props = renderPanel();
  const checkbox = await within(panel()).findByRole("checkbox", { name: "Correct despite missing es in your profile" });
  expect(api.getLeadCorrectionPreview).toHaveBeenCalledWith("p", "case-0101-de");
  expect(open().getAttribute("aria-disabled")).toBe("true");
  fireEvent.click(open());
  expect(api.startLeadCorrection).not.toHaveBeenCalled();
  fireEvent.click(checkbox);
  fireEvent.click(open());
  await waitFor(() => expect(api.startLeadCorrection).toHaveBeenCalledWith("p", "case-0101-de", { expected_text_sha256: "sha-v2", confirm_language: true }));
  expect(api.startLeadCorrection).toHaveBeenCalledTimes(1);
  await waitFor(() => expect(props.onNavigate).toHaveBeenCalledWith({ name: "task", assignmentId: 44 }));
});

it("shows the qualification message with a profile link", async () => {
  vi.mocked(api.startLeadCorrection).mockRejectedValueOnce(new ApiError(409, "qualification", "QUALIFICATION_REQUIRED"));
  const props = renderPanel();
  fireEvent.click(open());
  const link = await within(panel()).findByRole("link", { name: "Add your qualification in your profile" });
  expect(within(panel()).getByText("A translation review records your qualification. Your profile has none yet.")).toBeTruthy();
  fireEvent.click(link);
  expect(props.onNavigate).toHaveBeenCalledWith({ name: "me", documents: "p" });
  expect(within(panel()).queryByRole("checkbox")).toBeNull();
});

it("says up front that the profile has no qualification and keeps Open unavailable (issue 613)", async () => {
  vi.mocked(api.getProfile).mockResolvedValue({ qualification: "  " } as Awaited<ReturnType<typeof api.getProfile>>);
  const props = renderPanel();
  await within(panel()).findByText("A translation review records your qualification. Your profile has none yet.");
  expect(open().getAttribute("aria-disabled")).toBe("true");
  expect(document.getElementById(open().getAttribute("aria-describedby")!)?.textContent).toBe("A translation review records your qualification. Your profile has none yet.");
  fireEvent.click(open());
  expect(api.startLeadCorrection).not.toHaveBeenCalled();
  fireEvent.click(within(panel()).getByRole("link", { name: "Add your qualification in your profile" }));
  expect(props.onNavigate).toHaveBeenCalledWith({ name: "me", documents: "p" });
});

it("shows LEAD_CORRECTION_NOT_AVAILABLE reasons in words", async () => {
  const cases: Array<[string, string]> = [
    ["not_newest", "A newer version of this translation exists. Reload the row to see it."],
    ["not_rejected_or_queried", "This version is no longer rejected, queried or accepted. Reload the row to see its current state."],
    ["review_open", "A translation review of this version is open. Withdraw it with Remove… in the reviewer’s row of the Translation part before you correct the translation yourself."],
  ];
  for (const [reason, text] of cases) {
    vi.mocked(api.startLeadCorrection).mockRejectedValueOnce(new ApiError(409, "nope", "LEAD_CORRECTION_NOT_AVAILABLE", { reason }));
    const props = renderPanel();
    fireEvent.click(open());
    expect(await within(panel()).findByText(text)).toBeTruthy();
    expect(props.onNavigate).not.toHaveBeenCalled();
    cleanup();
  }
});

it("explains TASK_HELD, NOT_IN_WORK_PLAN and VARIANT_REVIEW_STALE for the correction", async () => {
  const cases: Array<[string, string]> = [
    ["TASK_HELD", "Your earlier review of this version is paused. Resume it in the version list before you correct the translation yourself."],
    ["NOT_IN_WORK_PLAN", "This translation was discarded. Reload the row to see its current state."],
    ["VARIANT_REVIEW_STALE", "The text of this version changed. Reload the row to see the current text."],
  ];
  for (const [code, text] of cases) {
    vi.mocked(api.startLeadCorrection).mockRejectedValueOnce(new ApiError(409, "nope", code, {}));
    const props = renderPanel();
    fireEvent.click(open());
    expect(await within(panel()).findByText(text)).toBeTruthy();
    expect(props.onNavigate).not.toHaveBeenCalled();
    cleanup();
  }
});

it("names the lead pause when the earlier review is paused with its text (issue 464)", async () => {
  vi.mocked(api.startLeadCorrection).mockRejectedValueOnce(new ApiError(409, "nope", "TASK_HELD", { causes: ["lead"], reason: "Clinic is checking", lead_reason: "Clinic is checking" }));
  renderPanel();
  fireEvent.click(open());
  expect(await within(panel()).findByText(/^This text is paused by a lead, so your earlier review of this version cannot continue\. Release the text first/)).toBeTruthy();
});

// Issue 341 b: the correction of an accepted version, from its version row (in a dialog).
const acceptedRow = () => planRow("case-0101", "de", stepOf("annotation_in_progress"), {
  versions: [version({ document_id: "case-0101-de", version: 1, chain_name: "DeepL", origin: "machine_translation", translation_status: "accepted" })],
});
const preview = (overrides: Partial<LeadCorrectionPreview> = {}): LeadCorrectionPreview => ({
  document_id: "case-0101-de", version: 1, next_version: 2, translation_status: "accepted", available: true, reason: null, missing_languages: [],
  reviewed_again: true, review_on: false, annotate_accepted_only: false, annotations: { submitted: 2, open: 1 }, open_consolidations: 0, final_result: false, ...overrides,
});

it("annotationConsequence counts the annotations that stay on the version", () => {
  expect(annotationConsequence(preview())).toBe("3 annotations (2 submitted, 1 open) stay on v1. After saving, the row offers Handle text change….");
  expect(annotationConsequence(preview({ annotations: { submitted: 1, open: 0 }, annotate_accepted_only: true })))
    .toBe("1 annotation (1 submitted) stays on v1. After saving, the row offers Handle text change… once v2 is accepted.");
  expect(annotationConsequence(preview({ annotations: { submitted: 0, open: 0 } }))).toBeNull();
});

it("lists the annotation work on an accepted version before the correction starts", async () => {
  vi.spyOn(api, "getLeadCorrectionPreview").mockResolvedValue(preview());
  vi.mocked(api.startLeadCorrection).mockResolvedValue(assignment(43));
  const props = { row: acceptedRow(), projectKey: "p", onNavigate: vi.fn(), onCancel: vi.fn() };
  render(<LeadCorrectionPanel {...props} documentId="case-0101-de" inDialog />);
  const group = screen.getByRole("group", { name: "Correct it myself, case-0101 de v1" });
  expect(within(group).queryByRole("heading")).toBeNull();
  // Rule 6 (issue 591): in its own dialog, focus starts on the primary action.
  await waitFor(() => expect(document.activeElement).toBe(within(group).getByRole("button", { name: "Open translation review" })));
  expect(within(group).getByText("You correct the accepted v1 yourself in the translation review and submit it as Accepted with corrections. The corrected text becomes v2.")).toBeTruthy();
  expect(await within(group).findByText("Annotation has work on v1.")).toBeTruthy();
  expect(within(group).getByText("3 annotations (2 submitted, 1 open) stay on v1. After saving, the row offers Handle text change….")).toBeTruthy();
  expect(within(group).getByText("v2 starts as a correction with review On.")).toBeTruthy();
  expect(api.getLeadCorrectionPreview).toHaveBeenCalledWith("p", "case-0101-de");
  fireEvent.click(within(group).getByRole("button", { name: "Open translation review" }));
  await waitFor(() => expect(props.onNavigate).toHaveBeenCalledWith({ name: "task", assignmentId: 43 }));
});

it("explains a preview that is not available and does not start", async () => {
  vi.spyOn(api, "getLeadCorrectionPreview").mockResolvedValue(preview({ available: false, reason: "review_open" }));
  render(<LeadCorrectionPanel row={acceptedRow()} projectKey="p" documentId="case-0101-de" inDialog onNavigate={vi.fn()} onCancel={vi.fn()} />);
  expect(await screen.findByText(/A translation review of this version is open/)).toBeTruthy();
  const button = screen.getByRole("button", { name: "Open translation review" });
  expect(button.getAttribute("aria-disabled")).toBe("true");
  // Rule 4 (issue 591): the reason is the greyed button's accessible description and tooltip.
  const reason = "A translation review of this version is open. Withdraw it with Remove… in the reviewer’s row of the Translation part before you correct the translation yourself.";
  expect(document.getElementById(button.getAttribute("aria-describedby") ?? "")?.textContent).toBe(reason);
  expect(button.getAttribute("title")).toBe(reason);
  fireEvent.click(button);
  expect(api.startLeadCorrection).not.toHaveBeenCalled();
});

it("correctionConsequences adds open consolidations and a final result on the version", () => {
  expect(correctionConsequences(preview({ annotations: { submitted: 0, open: 0 }, open_consolidations: 1, final_result: true })))
    .toEqual(["1 open consolidation stays on v1.", "The final result stays on v1."]);
  expect(correctionConsequences(preview({ open_consolidations: 2 }))).toHaveLength(2);
});

it("a rejected correction of an accepted version: the next correction is reviewed again", async () => {
  const row = planRow("case-0101", "de", stepOf("resolve_rejected", { document_id: "case-0101-de-v2" }), {
    versions: [
      version({ document_id: "case-0101-de", version: 1, chain_name: "DeepL", origin: "machine_translation", translation_status: "accepted", is_newest_in_chain: false }),
      version({ document_id: "case-0101-de-v2", version: 2, chain_name: "DeepL", origin: "correction", derived_from: "case-0101-de", translation_status: "reviewed", latest_review_decision: "rejected" }),
    ],
  });
  expect(reviewedAgain(row, "case-0101-de-v2")).toBe(true);
  expect(reviewedAgain(rejectedRow("case-0101", "de"), "case-0101-de")).toBe(false);
  vi.spyOn(api, "getLeadCorrectionPreview").mockResolvedValue(preview({ document_id: "case-0101-de-v2", version: 2, next_version: 3, translation_status: "reviewed", annotations: { submitted: 0, open: 0 } }));
  render(<LeadCorrectionPanel row={row} projectKey="p" onNavigate={vi.fn()} onCancel={vi.fn()} />);
  expect(screen.getByText("You review v2 yourself and submit it as Accepted with corrections. The corrected text becomes v3 and is reviewed again.")).toBeTruthy();
  expect(await screen.findByText("v3 starts as a correction with review On.")).toBeTruthy();
  expect(screen.queryByText(/counts as accepted/)).toBeNull();
  // Rule 2 (issue 591): the step repeats the label that opened it.
  expect(screen.getByRole("heading", { name: "Correct it myself (reviewed again), case-0101 de" })).toBeTruthy();
});
