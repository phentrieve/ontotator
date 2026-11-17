/** Issue 453: "Editorial correction…" (the translation editor, the reason, the guards in words, changes and consequences before saving). */
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { api, ApiError, type EditorialCorrectionPreview, type EditorialCorrectionResult, type VariantText } from "../../src/api/client";
import { editorialConsequences, EditorialCorrectionDialog, editorialRefusal } from "../../src/documents/EditorialCorrectionDialog";
import { planRow, stepOf, version } from "./fixtures";

const v2 = version({ document_id: "case-0101-de-v2", version: 2, chain_name: "DeepL", origin: "correction", derived_from: "case-0101-de", translation_status: "accepted" });
const row = planRow("case-0101", "de", stepOf("assign_annotation"), {
  versions: [version({ document_id: "case-0101-de", version: 1, chain_name: "DeepL", origin: "machine_translation", translation_status: "accepted", is_newest_in_chain: false }), v2],
});
const OLD = "Bei Aufnahme: Puls regelmäßig , Temperatur 38,2 °C.";
const NEW = "Bei Aufnahme: Puls regelmäßig, Temperatur 38,2 °C.";

function preview(overrides: Partial<EditorialCorrectionPreview> = {}): EditorialCorrectionPreview {
  return {
    document_id: "case-0101-de-v2", case_id: "case-0101", language: "de", version: 2, next_version: 3, translation_status: "accepted", text_sha256: "sha-v2",
    available: true, reason: null, review_on: true, annotate_accepted_only: false, annotations: { submitted: 0, open: 0 }, open_consolidations: 0, final_result: false,
    tasks_following: 0, changed_characters_limit: 20, text: null, previous_text: null, new_text_sha256: null, inserted_characters: null, deleted_characters: null,
    changed_characters: null, digits_changed: null, diff: null, findings: null, proposals: null, ...overrides,
  };
}

const checkedPreview = (text: string, overrides: Partial<EditorialCorrectionPreview> = {}) => preview({
  text, previous_text: OLD, new_text_sha256: "sha-v3", inserted_characters: 0, deleted_characters: 1, changed_characters: 1, digits_changed: false,
  diff: [{ old_start: 29, old_end: 30, new_start: 29, new_end: 29, old_text: " ", new_text: "" }],
  findings: { submitted: 0, needs_check: 0 }, proposals: { sets: 0, carried: 0, needs_check: 0 }, ...overrides,
});

beforeEach(() => {
  vi.spyOn(api, "previewEditorialCorrection").mockImplementation(async (_key, _id, text) => (text === undefined ? preview() : checkedPreview(text)));
  vi.spyOn(api, "getVariantText").mockResolvedValue({ document_id: "case-0101-de-v2", text: OLD, text_sha256: "sha-v2" } as VariantText);
  vi.spyOn(api, "editorialCorrection").mockResolvedValue({ document_id: "case-0101-de~de~v3", version: 3 } as EditorialCorrectionResult);
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

async function renderDialog() {
  const props = { row, version: v2, projectKey: "p", onCorrected: vi.fn(), onClose: vi.fn() };
  render(<EditorialCorrectionDialog {...props} />);
  const dialog = screen.getByRole("dialog", { name: "Editorial correction, case-0101 de v2" });
  const editor = await within(dialog).findByRole("textbox", { name: "Corrected text" }) as HTMLTextAreaElement;
  return { props, dialog, editor };
}

it("edits the current text, asks for the reason, shows the changes and saves the correction with the status kept", async () => {
  const { props, dialog, editor } = await renderDialog();
  expect(api.previewEditorialCorrection).toHaveBeenCalledWith("p", "case-0101-de-v2");
  expect(within(dialog).getByText("Fix spacing, typos or grammar. The corrected text becomes v3 and keeps the status of v2 (Accepted); it is not reviewed again.")).toBeTruthy();
  // The editor starts with the text of the version.
  expect(editor.value).toBe(OLD);
  expect(within(dialog).getByText("Changed words are marked. At most 20 characters may change, and every number stays as it is. A larger change belongs in a translation review.")).toBeTruthy();
  const check = within(dialog).getByRole("button", { name: "Check changes" });
  fireEvent.click(check);
  expect(within(dialog).getByText("Change the text first.")).toBeTruthy();
  expect(within(dialog).getAllByText("Enter the reason.").length).toBeGreaterThan(0);
  expect(api.previewEditorialCorrection).toHaveBeenCalledTimes(1);
  fireEvent.change(editor, { target: { value: NEW } });
  fireEvent.change(within(dialog).getByRole("textbox", { name: /^Reason/ }), { target: { value: " Space before a comma " } });
  fireEvent.click(check);
  await waitFor(() => expect(api.previewEditorialCorrection).toHaveBeenLastCalledWith("p", "case-0101-de-v2", NEW));
  expect(await within(dialog).findByText("Changes to v2")).toBeTruthy();
  expect(within(dialog).getByText(/1 character changed, at most 20/)).toBeTruthy();
  expect(within(dialog).getByRole("region", { name: "Text changes" }).querySelector("del")).toBeTruthy();
  expect(within(dialog).getByText(/Space before a comma/)).toBeTruthy();
  expect(within(dialog).getByText("v3 keeps the status of v2: Accepted. No translation review is started.")).toBeTruthy();
  // Nothing on v2: no consequence block.
  expect(within(dialog).queryByText("What happens to the work on v2")).toBeNull();
  expect(api.editorialCorrection).not.toHaveBeenCalled();
  // Back keeps what was entered.
  fireEvent.click(within(dialog).getByRole("button", { name: "Back" }));
  expect((within(dialog).getByRole("textbox", { name: "Corrected text" }) as HTMLTextAreaElement).value).toBe(NEW);
  fireEvent.click(within(dialog).getByRole("button", { name: "Check changes" }));
  fireEvent.click(await within(dialog).findByRole("button", { name: "Save as v3" }));
  await waitFor(() => expect(props.onCorrected).toHaveBeenCalledWith("case-0101 de v3 saved as an editorial correction of v2. It stays Accepted."));
  expect(api.editorialCorrection).toHaveBeenCalledWith("p", "case-0101-de-v2", { text: NEW, expected_text_sha256: "sha-v2", reason: "Space before a comma" });
});

it("names the guards' refusals in words and keeps the text", async () => {
  const { dialog, editor } = await renderDialog();
  fireEvent.change(within(dialog).getByRole("textbox", { name: /^Reason/ }), { target: { value: "Typo" } });
  const check = within(dialog).getByRole("button", { name: "Check changes" });
  for (const [text, refused, message] of [
    [OLD.replace("38,2", "39,2"), { reason: "digits_changed", digits_changed: true },
      "A number would change. An editorial correction leaves every digit as it is; change numbers in a translation review."],
    [`${OLD} Der Patient wurde danach stationär aufgenommen.`, { reason: "too_large", changed_characters: 47 },
      "This change is too large for an editorial correction (47 characters changed, at most 20 here). Make it in a translation review with Correct the translation… or Request correction…."],
  ] as const) {
    vi.mocked(api.previewEditorialCorrection).mockResolvedValueOnce(checkedPreview(text, { available: false, ...refused }));
    fireEvent.change(editor, { target: { value: text } });
    fireEvent.click(check);
    expect(await within(dialog).findByText(message)).toBeTruthy();
    // Still on the text; nothing can be saved.
    expect(within(dialog).queryByRole("button", { name: "Save as v3" })).toBeNull();
    expect(editor.value).toBe(text);
  }
  // The message goes when the text changes.
  fireEvent.change(editor, { target: { value: NEW } });
  expect(within(dialog).queryByText(/too large for an editorial correction/)).toBeNull();
  expect(api.editorialCorrection).not.toHaveBeenCalled();
});

it("says in words why a version cannot be corrected, without the editor", async () => {
  vi.mocked(api.previewEditorialCorrection).mockResolvedValue(preview({ available: false, reason: "review_open" }));
  render(<EditorialCorrectionDialog row={row} version={v2} projectKey="p" onCorrected={vi.fn()} onClose={vi.fn()} />);
  const dialog = screen.getByRole("dialog", { name: "Editorial correction, case-0101 de v2" });
  expect(await within(dialog).findByText(/^A translation review of this version is open\./)).toBeTruthy();
  expect(within(dialog).queryByRole("textbox")).toBeNull();
  expect(within(dialog).queryByRole("button", { name: "Check changes" })).toBeNull();
});

it("shows a refusal at saving in words", async () => {
  const { dialog, editor } = await renderDialog();
  fireEvent.change(editor, { target: { value: NEW } });
  fireEvent.change(within(dialog).getByRole("textbox", { name: /^Reason/ }), { target: { value: "Typo" } });
  fireEvent.click(within(dialog).getByRole("button", { name: "Check changes" }));
  const save = await within(dialog).findByRole("button", { name: "Save as v3" });
  vi.mocked(api.editorialCorrection).mockRejectedValueOnce(new ApiError(409, "nope", "EDITORIAL_CORRECTION_NOT_AVAILABLE", { reason: "not_newest" }));
  fireEvent.click(save);
  expect(await within(dialog).findByText("A newer version of this translation exists. Reload the row to see it.")).toBeTruthy();
  vi.mocked(api.editorialCorrection).mockRejectedValueOnce(new ApiError(409, "nope", "VARIANT_REVIEW_STALE"));
  fireEvent.click(save);
  expect(await within(dialog).findByText("The text of this version changed. Reload the row to see the current text.")).toBeTruthy();
});

it("lists what follows: tasks that move, work that stays, findings and proposals to check", async () => {
  const lines = editorialConsequences(checkedPreview(NEW, {
    annotations: { submitted: 2, open: 3 }, tasks_following: 2, open_consolidations: 1, final_result: true,
    findings: { submitted: 7, needs_check: 1 }, proposals: { sets: 1, carried: 5, needs_check: 2 },
  }));
  expect(lines).toEqual([
    "2 annotation tasks nobody opened move to v3.",
    "3 annotations (2 submitted, 1 open) stay on v2. After saving, the row offers Handle text change….",
    "1 open consolidation stays on v2.",
    "The final result stays on v2.",
    "1 of 7 findings in submitted annotations marks changed words and needs a check when carried to v3.",
    "5 tool proposals are carried to v3; 2 mark changed words and wait for a check.",
  ]);
  expect(editorialConsequences(checkedPreview(NEW, { annotations: { submitted: 0, open: 1 }, tasks_following: 1, findings: { submitted: 0, needs_check: 0 }, proposals: { sets: 1, carried: 1, needs_check: 0 } })))
    .toEqual(["1 annotation task nobody opened moves to v3.", "1 tool proposal is carried to v3."]);
  expect(editorialConsequences(checkedPreview(NEW, { annotations: { submitted: 1, open: 0 }, findings: { submitted: 4, needs_check: 0 } }))[1])
    .toBe("All 4 findings in submitted annotations can be placed on v3.");
  expect(editorialConsequences(checkedPreview(NEW))).toEqual([]);
  // With "annotate accepted translations only": an accepted correction waits for nothing, an unreviewed one for its acceptance.
  const waiting = { annotate_accepted_only: true, annotations: { submitted: 1, open: 0 } };
  expect(editorialConsequences(checkedPreview(NEW, waiting))).toEqual(["1 annotation (1 submitted) stays on v2. After saving, the row offers Handle text change…."]);
  expect(editorialConsequences(checkedPreview(NEW, { ...waiting, translation_status: "ready_for_review" })))
    .toEqual(["1 annotation (1 submitted) stays on v2. After saving, the row offers Handle text change… once v3 is accepted."]);

  vi.mocked(api.previewEditorialCorrection).mockImplementation(async (_key, _id, text) => (text === undefined ? preview() : checkedPreview(text, { annotations: { submitted: 1, open: 1 }, tasks_following: 1 })));
  const { dialog, editor } = await renderDialog();
  fireEvent.change(editor, { target: { value: NEW } });
  fireEvent.change(within(dialog).getByRole("textbox", { name: /^Reason/ }), { target: { value: "Typo" } });
  fireEvent.click(within(dialog).getByRole("button", { name: "Check changes" }));
  expect(await within(dialog).findByText("What happens to the work on v2")).toBeTruthy();
  expect(within(dialog).getByText(/1 annotation task nobody opened moves to v3\./)).toBeTruthy();
});

it("has words for every refusal reason", () => {
  for (const reason of ["review_open", "not_newest", "discarded", "rejected_or_queried", "unchanged", "digits_changed", "too_large", "reason_required"]) {
    expect(editorialRefusal(reason, "v2"), reason).toBeTruthy();
  }
  expect(editorialRefusal("too_large", "v2")).toBe("This change is too large for an editorial correction. Make it in a translation review with Correct the translation… or Request correction….");
  expect(editorialRefusal("something_else", "v2")).toBeNull();
});
