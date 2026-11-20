/** Issue 453: "Fix typos…" (one page: the translation editor, the changes below it, a notice about changed numbers, the reason by click, the consequences, Save). */
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { api, ApiError, type EditorialCorrectionPreview, type EditorialCorrectionResult, type VariantText } from "../../src/api/client";
import { CARRY_REASONS, editorialConsequences, EditorialCorrectionDialog, editorialRefusal, numberNotice, PREVIEW_DELAY_MS, reasonText } from "../../src/documents/EditorialCorrectionDialog";
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
    tasks_following: 0, text: null, previous_text: null, new_text_sha256: null, inserted_characters: null, deleted_characters: null,
    changed_characters: null, number_changes: null, diff: null, findings: null, proposals: null, ...overrides,
  };
}

const checkedPreview = (text: string, overrides: Partial<EditorialCorrectionPreview> = {}) => preview({
  text, previous_text: OLD, new_text_sha256: "sha-v3", inserted_characters: 0, deleted_characters: 1, changed_characters: 1, number_changes: [],
  diff: [{ old_start: 29, old_end: 30, new_start: 29, new_end: 29, old_text: " ", new_text: "" }],
  findings: { submitted: 0, needs_check: 0 }, proposals: { sets: 0, carried: 0, needs_check: 0 }, annotation_carry: [], ...overrides,
});

beforeEach(() => {
  vi.spyOn(api, "previewEditorialCorrection").mockImplementation(async (_key, _id, text) => (text === undefined ? preview() : checkedPreview(text)));
  vi.spyOn(api, "getVariantText").mockResolvedValue({ document_id: "case-0101-de-v2", text: OLD, text_sha256: "sha-v2" } as VariantText);
  vi.spyOn(api, "editorialCorrection").mockResolvedValue({ document_id: "case-0101-de~de~v3", version: 3 } as EditorialCorrectionResult);
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

const NAME = "Fix typos, case-0101 de v2";

async function renderDialog(target = v2) {
  const props = { row, version: target, projectKey: "p", onCorrected: vi.fn(), onClose: vi.fn() };
  render(<EditorialCorrectionDialog {...props} />);
  const dialog = screen.getByRole("dialog", { name: NAME });
  const editor = await within(dialog).findByRole("textbox", { name: "Corrected text" }) as HTMLTextAreaElement;
  return { props, dialog, editor };
}

/** Type a text and wait for the server's check of it (it runs shortly after the last keystroke). */
async function type(editor: HTMLTextAreaElement, text: string) {
  fireEvent.change(editor, { target: { value: text } });
  await waitFor(() => expect(api.previewEditorialCorrection).toHaveBeenLastCalledWith("p", "case-0101-de-v2", text), { timeout: PREVIEW_DELAY_MS + 2000 });
}

it("one page: edit the text, see the changes below it, choose the reason by click and save", async () => {
  const { props, dialog, editor } = await renderDialog();
  expect(api.previewEditorialCorrection).toHaveBeenCalledWith("p", "case-0101-de-v2");
  // The editor starts with the text of the version; nothing to compare yet.
  expect(editor.value).toBe(OLD);
  expect(within(dialog).queryByRole("region", { name: "Text changes" })).toBeNull();
  expect(within(dialog).queryByRole("button", { name: "Check changes" })).toBeNull();
  // Quiet: nothing on v2, one plain sentence and no highlighted block.
  expect(within(dialog).getByText("Nobody has worked on v2 yet.")).toBeTruthy();
  expect(within(dialog).queryByText("Work stays on v2")).toBeNull();
  expect(within(dialog).getByText("v3 keeps the status of v2: Accepted. No translation review is started.")).toBeTruthy();
  const save = within(dialog).getByRole("button", { name: "Save as v3" });
  fireEvent.click(save);
  expect(within(dialog).getByText("Change the text first.")).toBeTruthy();
  expect(within(dialog).getByText("Choose what you fixed or write a note.")).toBeTruthy();
  expect(api.editorialCorrection).not.toHaveBeenCalled();

  await type(editor, NEW);
  // Removed text is visible in the changes below the field; the count comes from the server.
  const changes = within(dialog).getByRole("region", { name: "Text changes" });
  expect(changes.querySelector("del")).toBeTruthy();
  expect(await within(dialog).findByText(/· 1 character changed$/)).toBeTruthy();
  expect(within(dialog).queryByText(/^Changes a number/)).toBeNull();
  // The reason by click: several chips, plus an optional note.
  const spacing = within(dialog).getByRole("button", { name: "Spacing" });
  fireEvent.click(spacing);
  expect(spacing.getAttribute("aria-pressed")).toBe("true");
  fireEvent.click(within(dialog).getByRole("button", { name: "Typo" }));
  fireEvent.change(within(dialog).getByRole("textbox", { name: "Note" }), { target: { value: " vor dem Komma " } });
  fireEvent.click(save);
  await waitFor(() => expect(props.onCorrected).toHaveBeenCalledWith("Typos fixed: v3 of case-0101 de saved. It stays Accepted."));
  // The hash is the one of the version the dialog opened with.
  expect(api.editorialCorrection).toHaveBeenCalledWith("p", "case-0101-de-v2", { text: NEW, expected_text_sha256: "sha-v2", reason: "Spacing; Typo: vor dem Komma" });
});

it("the reason is the chips' words plus the note; one of them is enough", () => {
  expect(reasonText(["Typo", "Spacing"], "")).toBe("Spacing; Typo");
  expect(reasonText(["Typo"], " Hypotnie ")).toBe("Typo: Hypotnie");
  expect(reasonText([], "Komma fehlte")).toBe("Komma fehlte");
  expect(reasonText([], "  ")).toBe("");
});

it("checks the text shortly after the last keystroke, not on every one", async () => {
  vi.useFakeTimers();
  try {
    render(<EditorialCorrectionDialog row={row} version={v2} projectKey="p" onCorrected={vi.fn()} onClose={vi.fn()} />);
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    const editor = screen.getByRole("textbox", { name: "Corrected text" });
    for (const text of [`${OLD}x`, `${OLD}xy`, NEW]) fireEvent.change(editor, { target: { value: text } });
    await act(async () => { await vi.advanceTimersByTimeAsync(PREVIEW_DELAY_MS - 1); });
    expect(api.previewEditorialCorrection).toHaveBeenCalledTimes(1);
    await act(async () => { await vi.advanceTimersByTimeAsync(1); });
    expect(api.previewEditorialCorrection).toHaveBeenCalledTimes(2);
    expect(api.previewEditorialCorrection).toHaveBeenLastCalledWith("p", "case-0101-de-v2", NEW);
  } finally { vi.useRealTimers(); }
});

it("points out a changed number in place and still saves", async () => {
  const text = OLD.replace("38,2", "39,2");
  vi.mocked(api.previewEditorialCorrection).mockImplementation(async (_key, _id, sent) => (sent === undefined ? preview()
    : checkedPreview(sent, { changed_characters: 2, inserted_characters: 1, number_changes: [{ old: "38,2", new: "39,2" }] })));
  const { props, dialog, editor } = await renderDialog();
  await type(editor, text);
  expect(await within(dialog).findByText("Changes a number: 38,2 → 39,2. Check that this is intended.")).toBeTruthy();
  expect(within(dialog).getByText(/· 2 characters changed$/)).toBeTruthy();
  fireEvent.click(within(dialog).getByRole("button", { name: "Typo" }));
  fireEvent.click(within(dialog).getByRole("button", { name: "Save as v3" }));
  await waitFor(() => expect(props.onCorrected).toHaveBeenCalled());
  expect(api.editorialCorrection).toHaveBeenCalledWith("p", "case-0101-de-v2", { text, expected_text_sha256: "sha-v2", reason: "Typo" });
  expect(numberNotice([{ old: "15", new: "50" }, { old: null, new: "3" }, { old: "2", new: null }])).toBe("Changes numbers: 15 → 50, adds 3, removes 2. Check that this is intended.");
  expect(numberNotice([])).toBeNull();
  expect(numberNotice(null)).toBeNull();
});

it("says in place that a text the server finds unchanged saves nothing", async () => {
  const { dialog, editor } = await renderDialog();
  fireEvent.click(within(dialog).getByRole("button", { name: "Typo" }));
  const text = `${OLD} `;
  vi.mocked(api.previewEditorialCorrection).mockImplementation(async (_key, _id, sent) => (sent === undefined ? preview() : checkedPreview(sent, { available: false, reason: "unchanged" })));
  await type(editor, text);
  expect(await within(dialog).findByText("No changes to v2. Nothing is saved.")).toBeTruthy();
  fireEvent.click(within(dialog).getByRole("button", { name: "Save as v3" }));
  expect(api.editorialCorrection).not.toHaveBeenCalled();
});

it("keeps the status of a rejected version", async () => {
  const rejected = version({ document_id: "case-0101-de-v2", version: 2, chain_name: "DeepL", origin: "correction", derived_from: "case-0101-de", translation_status: "reviewed", latest_review_decision: "rejected" });
  const { props, dialog, editor } = await renderDialog(rejected);
  expect(within(dialog).getByText("v3 keeps the status of v2: Rejected in review. No translation review is started.")).toBeTruthy();
  fireEvent.change(editor, { target: { value: NEW } });
  fireEvent.click(within(dialog).getByRole("button", { name: "Grammar" }));
  fireEvent.click(within(dialog).getByRole("button", { name: "Save as v3" }));
  await waitFor(() => expect(props.onCorrected).toHaveBeenCalledWith("Typos fixed: v3 of case-0101 de saved. It stays Rejected in review."));
});

it("says in words why a version cannot be corrected, without the editor", async () => {
  vi.mocked(api.previewEditorialCorrection).mockResolvedValue(preview({ available: false, reason: "review_open" }));
  render(<EditorialCorrectionDialog row={row} version={v2} projectKey="p" onCorrected={vi.fn()} onClose={vi.fn()} />);
  const dialog = screen.getByRole("dialog", { name: NAME });
  expect(await within(dialog).findByText(/^A translation review of this version is open\./)).toBeTruthy();
  expect(within(dialog).queryByRole("textbox")).toBeNull();
  expect(within(dialog).queryByRole("button", { name: "Save as v3" })).toBeNull();
});

it("shows a refusal at saving in place", async () => {
  const { dialog, editor } = await renderDialog();
  fireEvent.change(editor, { target: { value: NEW } });
  fireEvent.click(within(dialog).getByRole("button", { name: "Typo" }));
  const save = within(dialog).getByRole("button", { name: "Save as v3" });
  vi.mocked(api.editorialCorrection).mockRejectedValueOnce(new ApiError(409, "nope", "EDITORIAL_CORRECTION_NOT_AVAILABLE", { reason: "not_newest" }));
  fireEvent.click(save);
  expect(await within(dialog).findByText("A newer version of this translation exists. Reload the row to see it.")).toBeTruthy();
  vi.mocked(api.editorialCorrection).mockRejectedValueOnce(new ApiError(409, "nope", "VARIANT_REVIEW_STALE"));
  fireEvent.click(save);
  expect(await within(dialog).findByText("The text of this version changed. Reload the row to see the current text.")).toBeTruthy();
  // The text and the reason stay.
  expect(editor.value).toBe(NEW);
});

it("consequences: quiet unless work stays on the version", async () => {
  // Nothing to do afterwards: plain sentences, no block.
  expect(editorialConsequences(checkedPreview(NEW))).toEqual({ attention: false, moving: [], lines: ["Nobody has worked on v2 yet."] });
  expect(editorialConsequences(checkedPreview(NEW, { annotations: { submitted: 0, open: 2 }, tasks_following: 2 }))).toEqual({ attention: false, moving: ["2 waiting tasks continue on v3."], lines: [] });
  expect(editorialConsequences(checkedPreview(NEW, { annotations: { submitted: 0, open: 1 }, tasks_following: 1, proposals: { sets: 1, carried: 3, needs_check: 1 } })))
    .toEqual({ attention: false, moving: ["1 waiting task continues on v3.", "Tool proposals move to v3; 1 marks words you changed and waits for a check."], lines: [] });
  // Started or submitted work stays: what stays and what to do next.
  expect(editorialConsequences(checkedPreview(NEW, {
    annotations: { submitted: 2, open: 3 }, tasks_following: 2, open_consolidations: 1, final_result: true,
    findings: { submitted: 7, needs_check: 1 }, proposals: { sets: 1, carried: 5, needs_check: 0 },
  }))).toEqual({ attention: true, moving: ["2 waiting tasks continue on v3.", "Tool proposals move to v3."], lines: [
    "3 annotations stay on v2. After saving, use Handle text change… and Carry to v3… on this row to move them.",
    "1 open consolidation and the final result stay on v2 as well.",
    "1 of 7 findings marks words you changed and will need a check when moved.",
  ] });
  // With "annotate accepted translations only": an unaccepted correction waits for its acceptance.
  const waiting = { annotate_accepted_only: true, annotations: { submitted: 1, open: 0 } };
  expect(editorialConsequences(checkedPreview(NEW, waiting)).lines).toEqual(["1 annotation stays on v2. After saving, use Carry to v3… on this row to move it."]);
  expect(editorialConsequences(checkedPreview(NEW, { ...waiting, translation_status: "ready_for_review" })).lines)
    .toEqual(["1 annotation stays on v2. Once v3 is accepted, use Carry to v3… on this row to move it."]);
  expect(editorialConsequences(checkedPreview(NEW, { final_result: true }))).toEqual({ attention: true, moving: [], lines: ["The final result stays on v2."] });

  vi.mocked(api.previewEditorialCorrection).mockImplementation(async (_key, _id, text) => (text === undefined ? preview({ annotations: { submitted: 1, open: 2 }, tasks_following: 1 })
    : checkedPreview(text, { annotations: { submitted: 1, open: 2 }, tasks_following: 1 })));
  const { dialog } = await renderDialog();
  // The highlighted block, already when the dialog opens: the started task stays; what moves stands outside it.
  const block = (await within(dialog).findByText("Work stays on v2")).closest(".notice")!;
  expect(within(dialog).getByText(/1 annotation stays on v2\. After saving, use Handle text change… on this row to move it\./)).toBeTruthy();
  expect(block.textContent).not.toContain("continues on v3");
  expect(within(dialog).getByText(/1 waiting task continues on v3\./)).toBeTruthy();
});

it("U4-04: before the text changes, a submitted annotation is not said to stay", () => {
  // The preview without a text has no per-person carry yet.
  expect(editorialConsequences(preview({ annotations: { submitted: 4, open: 0 } }))).toEqual({
    attention: false,
    moving: ["Once you change the text, this says which of the 4 submitted annotations move to v3 by themselves."],
    lines: [],
  });
});

it("has words for every refusal reason", () => {
  for (const reason of ["review_open", "not_newest", "discarded", "unchanged", "reason_required"]) {
    expect(editorialRefusal(reason, "v2"), reason).toBeTruthy();
  }
  expect(editorialRefusal("something_else", "v2")).toBeNull();
});

/** Issue 465: one person's work in the preview's per-person list. */
const person = (display_name: string, carried: boolean, reason: string | null = null, status: "submitted" | "started" = "submitted") => ({
  username: display_name.toLowerCase().replace(" ", "."), display_name, status, carried, reason, findings: 1, needs_check: reason === "findings_need_check" ? 1 : 0,
}) as NonNullable<EditorialCorrectionPreview["annotation_carry"]>[number];

it("consequences: says per person whose submitted annotation moves by itself and whose not, and why", () => {
  // Both move: nothing stays, so the line is quiet.
  expect(editorialConsequences(checkedPreview(NEW, {
    annotations: { submitted: 2, open: 0 }, annotation_carry: [person("Ana Weber", true), person("Tom Reis", true)],
  }))).toEqual({ attention: false, moving: ["Move to v3 by themselves, nobody submits again: the annotations of Ana Weber and Tom Reis."], lines: [] });
  // One moves; one stays because a finding needs a check, one because the text has a final result; a started task stays.
  const mixed = editorialConsequences(checkedPreview(NEW, {
    annotations: { submitted: 3, open: 1 },
    annotation_carry: [person("Ana Weber", true), person("Eva Roth", false, "not_submitted", "started"), person("Luc Bauer", false, "findings_need_check"), person("Tom Reis", false, "findings_need_check")],
  }));
  expect(mixed.attention).toBe(true);
  // U4-04: who moves stands outside the block "Work stays on v2"; the block names only what stays.
  expect(mixed.moving).toEqual(["Moves to v3 by itself, nobody submits again: the annotation of Ana Weber."]);
  expect(mixed.lines).toEqual([
    "Not moved by themselves, a finding marks words you changed: Luc Bauer and Tom Reis.",
    "3 annotations stay on v2. After saving, use Handle text change… and Carry to v3… on this row to move them.",
  ]);
  // A changed number keeps every annotation on the version.
  expect(editorialConsequences(checkedPreview(NEW, {
    annotations: { submitted: 1, open: 0 }, annotation_carry: [person("Tom Reis", false, "number_changed")],
  })).lines).toEqual([
    "Not moved by itself, the fix changes a number: Tom Reis.",
    "1 annotation stays on v2. After saving, use Carry to v3… on this row to move it.",
  ]);
});

it("has words for every reason an annotation does not move by itself", () => {
  for (const reason of ["number_changed", "final_result", "consolidation", "translation_not_accepted", "from_proposals", "task_paused", "findings_need_check", "not_carryable"]) {
    expect(CARRY_REASONS[reason], reason).toBeTruthy();
  }
});

it("shows in the dialog who moves by itself, and says so after saving", async () => {
  const carry = [person("Ana Weber", true), person("Tom Reis", false, "number_changed")];
  vi.mocked(api.previewEditorialCorrection).mockImplementation(async (_key, _id, text) => (text === undefined ? preview({ annotations: { submitted: 2, open: 0 } })
    : checkedPreview(text, { annotations: { submitted: 2, open: 0 }, annotation_carry: carry })));
  vi.mocked(api.editorialCorrection).mockResolvedValue({ document_id: "case-0101-de~de~v3", version: 3, annotations_carried: 1 } as EditorialCorrectionResult);
  const { props, dialog, editor } = await renderDialog();
  await type(editor, NEW);
  expect(await within(dialog).findByText(/Moves to v3 by itself, nobody submits again: the annotation of Ana Weber\./)).toBeTruthy();
  expect(within(dialog).getByText(/Not moved by itself, the fix changes a number: Tom Reis\./)).toBeTruthy();
  fireEvent.click(within(dialog).getByRole("button", { name: "Spacing" }));
  fireEvent.click(within(dialog).getByRole("button", { name: "Save as v3" }));
  await waitFor(() => expect(props.onCorrected).toHaveBeenCalled());
  expect(props.onCorrected.mock.calls[0][0]).toMatch(/1 annotation moved to v3\.$/);
});
