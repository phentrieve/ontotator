/** Issue 453: "Fix typos…" (one page: the translation editor, the changes below it, a notice about changed numbers, the reason by click, the consequences, Save). */
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { api, ApiError, type EditorialCorrectionPreview, type EditorialCorrectionResult, type VariantText } from "../../src/api/client";
import { CARRY_REASONS, editorialConsequences, PROPOSALS_RULE, STAY_REASONS, EditorialCorrectionDialog, editorialRefusal, numberNotice, PREVIEW_DELAY_MS, reasonText, reviewNote } from "../../src/documents/EditorialCorrectionDialog";
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
    tasks_following: 0, tasks_staying: [], text: null, previous_text: null, new_text_sha256: null, inserted_characters: null, deleted_characters: null,
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

const NAME = "Fix typos (no review), case-0101 de v2";

async function renderDialog(target = v2) {
  const props = { row, version: target, projectKey: "p", onCorrected: vi.fn(), onClose: vi.fn() };
  render(<EditorialCorrectionDialog {...props} />);
  const dialog = screen.getByRole("dialog", { name: NAME });
  const editor = await within(dialog).findByRole("textbox", { name: "Corrected text" }) as HTMLTextAreaElement;
  return { props, dialog, editor };
}

/** The accessible description: the text of the elements named in aria-describedby. */
const describedBy = (element: HTMLElement) => (element.getAttribute("aria-describedby") ?? "").split(/\s+/).filter(Boolean)
  .map(ref => document.getElementById(ref)?.textContent ?? "").join(" ");

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
  // Issue 556: one line on top says what the fix keeps; "After saving" has one plain line.
  expect(within(dialog).getByText("Only spelling, spacing or grammar. v3 stays Accepted; no translation review is started.")).toBeTruthy();
  const after = within(dialog).getByRole("region", { name: "After saving" });
  expect(within(after).getAllByRole("listitem").map(item => item.textContent)).toEqual(["Nobody has annotated v2 yet."]);
  // Not reviewed: nothing about a review.
  expect(within(dialog).queryByText(/translation review stays/)).toBeNull();
  // The note's hint is its placeholder; there is no text under the field.
  expect(within(dialog).getByRole("textbox", { name: "Note" }).getAttribute("placeholder")).toBe("Optional, e.g. the word you corrected");
  // The greyed Save says why, as its description; a press shows what is missing at the fields.
  const save = within(dialog).getByRole("button", { name: "Save as v3 (stays Accepted)" });
  expect(save.getAttribute("aria-disabled")).toBe("true");
  expect(describedBy(save)).toBe("Change the text first.");
  fireEvent.click(save);
  expect(within(dialog).getAllByText("Change the text first.").length).toBe(2);
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
  expect(describedBy(save)).toBe("");
  expect(save.getAttribute("aria-disabled")).toBeNull();
  fireEvent.click(within(dialog).getByRole("button", { name: "Typo" }));
  fireEvent.change(within(dialog).getByRole("textbox", { name: "Note" }), { target: { value: " vor dem Komma " } });
  fireEvent.click(save);
  await waitFor(() => expect(props.onCorrected).toHaveBeenCalledWith("Typos fixed: v3 of case-0101 de saved. It stays Accepted."));
  // The hash is the one of the version the dialog opened with.
  expect(api.editorialCorrection).toHaveBeenCalledWith("p", "case-0101-de-v2", { text: NEW, expected_text_sha256: "sha-v2", reason: "Spacing; Typo: vor dem Komma" });
});

it("explains on demand behind a (?) button: toggled by click, closed by Escape without closing the dialog (issue 556)", async () => {
  const { props, dialog } = await renderDialog();
  const help = within(dialog).getByRole("button", { name: "Help: What did you fix?" });
  expect(help.getAttribute("aria-expanded")).toBe("false");
  const text = document.getElementById(help.getAttribute("aria-controls")!)!;
  expect(text.hidden).toBe(true);
  fireEvent.click(help);
  expect(help.getAttribute("aria-expanded")).toBe("true");
  expect(text.hidden).toBe(false);
  expect(text.textContent).toContain("Removed addition: words the machine added that the source does not have");
  // The fieldset is named by its legend, not by the help button inside it.
  expect(within(dialog).getByRole("group", { name: "What did you fix? (required)" })).toBeTruthy();
  fireEvent.keyDown(help, { key: "Escape" });
  expect(help.getAttribute("aria-expanded")).toBe("false");
  expect(props.onClose).not.toHaveBeenCalled();
  const after = within(dialog).getByRole("button", { name: "Help: After saving" });
  fireEvent.click(after);
  expect(document.getElementById(after.getAttribute("aria-controls")!)!.textContent).toContain("moves to v3 by itself when every finding is placed on the new text");
  fireEvent.click(after);
  expect(after.getAttribute("aria-expanded")).toBe("false");
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
  fireEvent.click(within(dialog).getByRole("button", { name: "Save as v3 (stays Accepted)" }));
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
  // In place, and as the reason of the greyed Save.
  expect(await within(dialog).findAllByText("No changes to v2. Nothing is saved.")).toHaveLength(2);
  fireEvent.click(within(dialog).getByRole("button", { name: "Save as v3 (stays Accepted)" }));
  expect(api.editorialCorrection).not.toHaveBeenCalled();
});

it("keeps the status of a rejected version", async () => {
  const rejected = version({ document_id: "case-0101-de-v2", version: 2, chain_name: "DeepL", origin: "correction", derived_from: "case-0101-de", translation_status: "reviewed", latest_review_decision: "rejected" });
  const { props, dialog, editor } = await renderDialog(rejected);
  expect(within(dialog).getByText("Only spelling, spacing or grammar. v3 stays Rejected in review; no translation review is started.")).toBeTruthy();
  // Issue 547, U2-06: the review is not "nobody worked on it"; it stays with the version it reviewed, and v3 needs its own.
  expect(within(dialog).getByText("Nobody has annotated v2 yet.")).toBeTruthy();
  expect(within(dialog).getByText("A submitted translation review stays with the version it reviewed. To have v3 reviewed, use Resolve… › Other ways… › Assign a new review… on this row after saving.")).toBeTruthy();
  fireEvent.change(editor, { target: { value: NEW } });
  fireEvent.click(within(dialog).getByRole("button", { name: "Grammar" }));
  fireEvent.click(within(dialog).getByRole("button", { name: "Save as v3 (stays Rejected in review)" }));
  await waitFor(() => expect(props.onCorrected).toHaveBeenCalledWith("Typos fixed: v3 of case-0101 de saved. It stays Rejected in review."));
});

it("names a submitted review by what happens to it (issue 547, U2-06)", () => {
  expect(reviewNote(null, 3)).toBeNull();
  expect(reviewNote("accepted", 3)).toBe("A submitted translation review stays with the version it reviewed.");
  expect(reviewNote("query", 3)).toBe("A submitted translation review stays with the version it reviewed. To have v3 reviewed, use Resolve… › Other ways… › Assign a new review… on this row after saving.");
  // Issue 613: a decided query or rejection has no Resolve… on its row, so the note does not point there.
  expect(reviewNote("query", 3, true)).toBe("A submitted translation review stays with the version it reviewed.");
  expect(reviewNote("rejected", 3, true)).toBe("A submitted translation review stays with the version it reviewed.");
});

it("says in words why a version cannot be corrected, without the editor", async () => {
  vi.mocked(api.previewEditorialCorrection).mockResolvedValue(preview({ available: false, reason: "review_open" }));
  render(<EditorialCorrectionDialog row={row} version={v2} projectKey="p" onCorrected={vi.fn()} onClose={vi.fn()} />);
  const dialog = screen.getByRole("dialog", { name: NAME });
  expect(await within(dialog).findByText(/^A translation review of this version is open\./)).toBeTruthy();
  expect(within(dialog).queryByRole("textbox")).toBeNull();
  expect(within(dialog).queryByRole("button", { name: "Save as v3 (stays Accepted)" })).toBeNull();
});

it("shows a refusal at saving in place", async () => {
  const { dialog, editor } = await renderDialog();
  fireEvent.change(editor, { target: { value: NEW } });
  fireEvent.click(within(dialog).getByRole("button", { name: "Typo" }));
  const save = within(dialog).getByRole("button", { name: "Save as v3 (stays Accepted)" });
  vi.mocked(api.editorialCorrection).mockRejectedValueOnce(new ApiError(409, "nope", "EDITORIAL_CORRECTION_NOT_AVAILABLE", { reason: "not_newest" }));
  fireEvent.click(save);
  expect(await within(dialog).findByText("A newer version of this translation exists. Reload the row to see it.")).toBeTruthy();
  vi.mocked(api.editorialCorrection).mockRejectedValueOnce(new ApiError(409, "nope", "VARIANT_REVIEW_STALE"));
  fireEvent.click(save);
  expect(await within(dialog).findByText("The text of this version changed. Reload the row to see the current text.")).toBeTruthy();
  // The text and the reason stay.
  expect(editor.value).toBe(NEW);
});

const moves = (text: string) => ({ kind: "moves", text });
const stays = (text: string) => ({ kind: "stays", text });
const note = (text: string) => ({ kind: "note", text });

it("consequences: names each task that stays and why, and with which step it moves later (issues 509, 556)", () => {
  const task = (username: string, display_name: string, reason: EditorialCorrectionPreview["tasks_staying"][number]["reason"], assignment_id = 1) =>
    ({ assignment_id, username, display_name, reason });
  // A task from proposals nobody opened, no proposal for a check: it continues.
  expect(editorialConsequences(checkedPreview(NEW, { annotations: { submitted: 0, open: 1 }, tasks_following: 1, proposals: { sets: 1, carried: 2, needs_check: 0 } })))
    .toEqual({ lines: [moves("1 waiting task continues on v3."), moves("Tool proposals move to v3.")], proposalsRule: false });
  // A proposal waits for a check, another task was opened, a third is paused: one line per person.
  expect(editorialConsequences(checkedPreview(NEW, {
    annotations: { submitted: 0, open: 3 }, tasks_following: 0, proposals: { sets: 1, carried: 1, needs_check: 1 },
    tasks_staying: [task("ana", "Ana Weber", "from_proposals_needs_check"), task("eva", "Eva Lang", "opened", 2), task("tom", "Tom Reis", "paused", 3)],
  }))).toEqual({ lines: [
    moves("Tool proposals move to v3; 1 marks words you changed and waits for a check."),
    stays("Ana Weber: task stays on v2 (from tool proposals, and a proposal waits for a check). Move it later with Handle text change…"),
    stays("Eva Lang: task stays on v2 (already opened). Move it later with Handle text change…"),
    stays("Tom Reis: task stays on v2 (the task is paused). Move it later with Handle text change…"),
  ], proposalsRule: true });
  // Before the text changes, a task from proposals is not decided yet: a note; the rule is in the help.
  expect(editorialConsequences(preview({ annotations: { submitted: 0, open: 1 }, tasks_staying: [task("ana", "Ana Weber", "from_proposals")] })))
    .toEqual({ lines: [note("Once you change the text, this says whether the task from tool proposals of Ana Weber continues on v3.")], proposalsRule: true });
  expect(PROPOSALS_RULE("v3")).toBe("A task from tool proposals continues on v3 only when nobody opened it and no proposal waits for a check.");
  expect(Object.keys(STAY_REASONS)).toEqual(["opened", "paused", "from_proposals_needs_check", "from_proposals_none_carried"]);
});

it("consequences: what moves, then what stays and with which step", async () => {
  expect(editorialConsequences(checkedPreview(NEW))).toEqual({ lines: [note("Nobody has annotated v2 yet.")], proposalsRule: false });
  expect(editorialConsequences(checkedPreview(NEW, { annotations: { submitted: 0, open: 2 }, tasks_following: 2 })).lines).toEqual([moves("2 waiting tasks continue on v3.")]);
  expect(editorialConsequences(checkedPreview(NEW, { annotations: { submitted: 0, open: 1 }, tasks_following: 1, proposals: { sets: 1, carried: 3, needs_check: 1 } })).lines)
    .toEqual([moves("1 waiting task continues on v3."), moves("Tool proposals move to v3; 1 marks words you changed and waits for a check.")]);
  // Started or submitted work without names: counts and the steps.
  expect(editorialConsequences(checkedPreview(NEW, {
    annotations: { submitted: 2, open: 3 }, tasks_following: 2, open_consolidations: 1, final_result: true,
    findings: { submitted: 7, needs_check: 1 }, proposals: { sets: 1, carried: 5, needs_check: 0 },
  })).lines).toEqual([
    moves("2 waiting tasks continue on v3."),
    moves("Tool proposals move to v3."),
    stays("3 annotations stay on v2. Move them later with Handle text change… and Carry to v3…"),
    stays("1 open consolidation and the final result stay on v2."),
    stays("1 of 7 findings marks words you changed and will need a check when moved."),
  ]);
  // With "annotate accepted translations only": an unaccepted correction waits for its acceptance.
  const waiting = { annotate_accepted_only: true, annotations: { submitted: 1, open: 0 } };
  expect(editorialConsequences(checkedPreview(NEW, waiting)).lines).toEqual([stays("1 annotation stays on v2. Move it later with Carry to v3…")]);
  expect(editorialConsequences(checkedPreview(NEW, { ...waiting, translation_status: "ready_for_review" })).lines)
    .toEqual([stays("1 annotation stays on v2. Move it with Carry to v3… once v3 is accepted.")]);
  expect(editorialConsequences(checkedPreview(NEW, { final_result: true })).lines).toEqual([stays("The final result stays on v2.")]);

  vi.mocked(api.previewEditorialCorrection).mockImplementation(async (_key, _id, text) => (text === undefined ? preview({ annotations: { submitted: 1, open: 2 }, tasks_following: 1 })
    : checkedPreview(text, { annotations: { submitted: 1, open: 2 }, tasks_following: 1 })));
  const { dialog } = await renderDialog();
  // "After saving", already when the dialog opens: one line each, what moves first.
  const after = within(dialog).getByRole("region", { name: "After saving" });
  expect(within(after).getAllByRole("listitem").map(item => item.textContent)).toEqual([
    "✓1 waiting task continues on v3.",
    "⚠1 annotation stays on v2. Move it later with Handle text change…",
    "Once you change the text, this says whether the submitted annotation moves to v3 by itself.",
  ]);
});

it("U4-04: before the text changes, a submitted annotation is not said to stay", () => {
  // The preview without a text has no per-person carry yet.
  expect(editorialConsequences(preview({ annotations: { submitted: 4, open: 0 } }))).toEqual({
    lines: [note("Once you change the text, this says which of the 4 submitted annotations move to v3 by themselves.")],
    proposalsRule: false,
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

it("consequences: one line per person whose submitted annotation moves by itself or stays, and why (issues 465, 556)", () => {
  expect(editorialConsequences(checkedPreview(NEW, {
    annotations: { submitted: 2, open: 0 }, annotation_carry: [person("Ana Weber", true), person("Tom Reis", true)],
  })).lines).toEqual([moves("Ana Weber: annotation moves to v3 by itself."), moves("Tom Reis: annotation moves to v3 by itself.")]);
  // One moves; two stay because a finding needs a check; a started task stays without a name.
  expect(editorialConsequences(checkedPreview(NEW, {
    annotations: { submitted: 3, open: 1 }, findings: { submitted: 3, needs_check: 2 },
    annotation_carry: [person("Ana Weber", true), person("Eva Roth", false, "not_submitted", "started"), person("Luc Bauer", false, "findings_need_check"), person("Tom Reis", false, "findings_need_check")],
  })).lines).toEqual([
    moves("Ana Weber: annotation moves to v3 by itself."),
    stays("Luc Bauer: annotation stays on v2 (1 finding marks words you changed). Move it later with Carry to v3…"),
    stays("Tom Reis: annotation stays on v2 (1 finding marks words you changed). Move it later with Carry to v3…"),
    stays("1 other annotation stays on v2. Move it later with Handle text change…"),
  ]);
  // A changed number keeps every annotation on the version.
  expect(editorialConsequences(checkedPreview(NEW, {
    annotations: { submitted: 1, open: 0 }, annotation_carry: [person("Tom Reis", false, "number_changed")],
  })).lines).toEqual([stays("Tom Reis: annotation stays on v2 (the fix changes a number). Move it later with Carry to v3…")]);
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
  expect(await within(dialog).findByText("Ana Weber: annotation moves to v3 by itself.")).toBeTruthy();
  expect(within(dialog).getByText("Tom Reis: annotation stays on v2 (the fix changes a number). Move it later with Carry to v3…")).toBeTruthy();
  fireEvent.click(within(dialog).getByRole("button", { name: "Spacing" }));
  fireEvent.click(within(dialog).getByRole("button", { name: "Save as v3 (stays Accepted)" }));
  await waitFor(() => expect(props.onCorrected).toHaveBeenCalled());
  expect(props.onCorrected.mock.calls[0][0]).toMatch(/1 annotation moved to v3\.$/);
});

// ---- Issue 591: rules 4 and 6 of docs/design.md › Panels and actions ----

it("opens with focus on Save; a greyed Save names its reason as description and tooltip (issue 591)", async () => {
  const { dialog, editor } = await renderDialog();
  const save = within(dialog).getByRole("button", { name: "Save as v3 (stays Accepted)" });
  expect(document.activeElement).toBe(save);
  expect(save.getAttribute("aria-disabled")).toBe("true");
  expect(describedBy(save)).toBe("Change the text first.");
  expect(save.getAttribute("title")).toBe("Change the text first.");
  // Before any press: the reason shows as the button's tooltip (focused here), not as a hint under the controls.
  const tip = () => within(dialog).getByText(describedBy(save)).closest(".ui-reason-tip");
  expect(tip()?.getAttribute("data-shown")).toBe("true");
  await type(editor, NEW);
  expect(describedBy(save)).toBe("Choose what you fixed first.");
  expect(save.getAttribute("title")).toBe("Choose what you fixed first.");
  fireEvent.click(within(dialog).getByRole("button", { name: "Spacing" }));
  expect(save.getAttribute("aria-disabled")).toBeNull();
  expect(save.getAttribute("title")).toBeNull();
  expect(save.getAttribute("aria-describedby")).toBeNull();
});

it("issue 584: After saving lists each reason on its own line; the rule for tasks from proposals is set apart behind (?)", async () => {
  const staying = {
    annotations: { submitted: 0, open: 2 }, tasks_following: 0, proposals: { sets: 1, carried: 1, needs_check: 1 },
    tasks_staying: [
      { assignment_id: 1, username: "ana", display_name: "Ana Weber", reason: "from_proposals_needs_check" as const },
      { assignment_id: 2, username: "eva", display_name: "Eva Lang", reason: "opened" as const },
    ],
  };
  vi.mocked(api.previewEditorialCorrection).mockImplementation(async (_key, _id, text) => (text === undefined ? preview(staying) : checkedPreview(text, staying)));
  const { dialog, editor } = await renderDialog();
  await type(editor, NEW);
  const block = await within(dialog).findByRole("region", { name: "After saving" });
  const list = within(block).getByRole("list");
  await waitFor(() => expect(within(list).getAllByRole("listitem").map(item => item.textContent)).toEqual([
    "✓Tool proposals move to v3; 1 marks words you changed and waits for a check.",
    "⚠Ana Weber: task stays on v2 (from tool proposals, and a proposal waits for a check). Move it later with Handle text change…",
    "⚠Eva Lang: task stays on v2 (already opened). Move it later with Handle text change…",
  ]));
  const rule = within(block).getByText(PROPOSALS_RULE("v3"));
  expect(rule.tagName).toBe("P");
  expect(list.contains(rule)).toBe(false);
});
