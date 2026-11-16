import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { useState } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { api, ApiError, type BulkModeChangeView, type BulkTaskActionView, type SelectionSummary } from "../../src/api/client";
import { BulkModeDialog } from "../../src/documents/BulkModeDialog";
import { affectedLine, affectedPeople, modeAppliedText, modeConsequences, modeGroups, modeSummaryText, modeUnavailableReason, workText } from "../../src/documents/bulkModeModel";
import { SelectionBar } from "../../src/documents/SelectionBar";
import { Toast, useToast } from "../../src/ui";

const tom = { pseudonym: "ann-1", display_name: "Tom Reis", is_me: false };
const roe = { pseudonym: "ann-2", display_name: "R. Roe", is_me: false };
const lead = { pseudonym: "ann-3", display_name: "Carla Diaz", is_me: true };
type Change = BulkModeChangeView["changes"][number];
const submission = (case_id: string, author = tom, mode = "proposal_check"): Change["submissions"][number] => ({
  submission_id: `sub-${case_id}-${author.pseudonym}`, document_id: `${case_id}-en`, mode, recorded_at: "2026-11-10T10:00:00Z", author,
});
const assignment = (case_id: string, id: number, person = tom, status = "submitted", task: "annotate" | "review" = "annotate"): Change["assignments"][number] => ({
  assignment_id: id, document_id: `${case_id}-en`, task, status, person,
});
const change = (case_id: string, submissions: Change["submissions"], assignments: Change["assignments"]): Change => ({
  case_id, language: "en", from_mode: "proposals", to_mode: "scratch", revision: 1, submissions, assignments,
});
const skip = (case_id: string, reason: BulkModeChangeView["skipped"][number]["reason"]) => ({ case_id, language: "en", reason, message: `server: ${reason}` });
/** The counts follow the lists, as the server sends them. */
function counted(view: BulkModeChangeView): BulkModeChangeView {
  const reasons: Record<string, number> = {};
  for (const item of view.skipped) reasons[item.reason] = (reasons[item.reason] ?? 0) + 1;
  return {
    ...view, change_count: view.changes.length, skipped_count: view.skipped.length, skipped_by_reason: reasons,
    submission_count: view.changes.reduce((sum, item) => sum + item.submissions.length, 0), assignment_count: view.changes.reduce((sum, item) => sum + item.assignments.length, 0),
  };
}
const modePreview = (overrides: Partial<BulkModeChangeView> = {}): BulkModeChangeView => counted({
  mode: "scratch", applied: false, texts: 8, change_count: 0, skipped_count: 0, skipped_by_reason: {}, submission_count: 0, assignment_count: 0,
  changes: [
    change("EN100022", [submission("EN100022"), submission("EN100022", roe)], [assignment("EN100022", 1), assignment("EN100022", 2, roe)]),
    change("EN100023", [submission("EN100023")], [assignment("EN100023", 3), assignment("EN100023", 4, roe, "in_progress")]),
    change("EN100024", [submission("EN100024"), submission("EN100024", lead, "review")], [assignment("EN100024", 5), assignment("EN100024", 6, lead, "submitted", "review")]),
    change("EN100025", [], [assignment("EN100025", 7, roe, "open"), assignment("EN100025", 8, lead, "open", "review")]),
  ],
  skipped: [skip("EN100026", "final_result"), skip("EN100027", "unchanged"), skip("EN100028", "not_locked"), skip("EN100029", "no_proposals"), skip("EN100030", "no_current_version")],
  preview_token: "sha256:a", ...overrides,
});
const rows = ["EN100022", "EN100023", "EN100024", "EN100025", "EN100026", "EN100027", "EN100028", "EN100029"].map(case_id => ({ case_id, language: "en" }));
const nothing: BulkTaskActionView = { action: "reopen", applied: false, texts: 8, change_count: 0, kept_count: 0, skipped_count: 0, changes: [], kept: [], skipped: [], preview_token: "sha256:n", undo: null };

beforeEach(() => {
  vi.spyOn(api, "bulkChangeMode").mockImplementation(async (_key, body) => body.mode === "scratch" ? modePreview() : modePreview({ mode: "proposals", changes: [], skipped: [skip("EN100029", "no_proposals")] }));
  // The other actions of the same menu are not asked here.
  vi.spyOn(api, "bulkReopen").mockResolvedValue(nothing);
  vi.spyOn(api, "bulkWithdraw").mockResolvedValue({ ...nothing, action: "withdraw" });
  vi.spyOn(api, "bulkStartRound").mockResolvedValue({ ...nothing, action: "start_round", kind: "carry_forward" });
  vi.spyOn(api, "acceptAgreeing").mockRejectedValue(new Error("not asked"));
  vi.spyOn(api, "bulkChangeFinal").mockRejectedValue(new Error("not asked"));
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

it("groups the preview by consequence, with every reason a text is skipped (issue 336 step 4)", () => {
  const groups = modeGroups(modePreview());
  expect(groups.map(group => `${group.title} · ${group.detail}`)).toEqual([
    "Annotate 4 texts from scratch · discards 5 submissions, removes 3 unsubmitted assignments",
    "Skip 1 text · final result chosen: use Withdraw final… first",
    "Skip 1 text · already annotated from scratch",
    "Skip 1 text · no annotation work yet: set the mode with Plan…",
    "Skip 1 text · no tool proposals for the text",
    "Skip 1 text · no version of the text is in use",
  ]);
  expect(groups[0].texts).toEqual(["EN100022 en", "EN100023 en", "EN100024 en", "EN100025 en"]);
  expect(workText({ changes: [change("a", [], [assignment("a", 1)])] })).toBe("no work to discard");
  expect(modeSummaryText(modePreview())).toBe("the annotation mode of 4 texts");
  expect(modeSummaryText(modePreview({ mode: "proposals", changes: [] }))).toBe("No selected text can change to annotation from proposals.");
  expect(modeAppliedText(modePreview({ applied: true }))).toBe("Changed the annotation mode of 4 texts.");
});

it("names every person affected with what happens to their work", () => {
  expect(affectedPeople(modePreview()).map(affectedLine)).toEqual([
    "Tom Reis: 3 submissions are discarded.",
    "Carla Diaz: 1 consolidation is discarded; 1 unsubmitted consolidation is removed.",
    "R. Roe: 1 submission is discarded; 2 unsubmitted assignments are removed.",
  ]);
});

it("says plainly what is discarded and that the bulk change cannot be undone here", () => {
  expect(modeConsequences(modePreview())).toEqual([
    "The annotation of 4 texts starts again from scratch: assign them anew.",
    "5 submissions are discarded and 3 unsubmitted assignments are removed (drafts are kept). Discarded work is kept, not deleted: it no longer counts for progress, consolidation, the final result or exports.",
    "This cannot be undone here. Restore… in a text card brings one text back while no new annotation has started on it.",
  ]);
  expect(modeConsequences(modePreview({ changes: [change("a", [], [assignment("a", 1)])] }))[1]).toBe("No submitted work is discarded.");
});

it("the menu entry names why it does nothing for the selection (decision 336-C)", () => {
  const none = (reasons: BulkModeChangeView["skipped"][number]["reason"][], mode: "scratch" | "proposals" = "scratch") => modePreview({ mode, changes: [], skipped: reasons.map((reason, index) => skip(`c${index}`, reason)) });
  expect(modeUnavailableReason([modePreview(), none(["unchanged"], "proposals")])).toBeNull();
  expect(modeUnavailableReason([null, none(["unchanged"])])).toBeNull();
  expect(modeUnavailableReason([none(["final_result", "final_result"]), none(["unchanged", "final_result"], "proposals")])).toBe("The selected texts have a final result: use Withdraw final… first.");
  expect(modeUnavailableReason([none(["not_locked"]), none(["not_locked"], "proposals")])).toBe("No annotation work on the selected texts yet: set the mode with Plan….");
  expect(modeUnavailableReason([none(["not_locked", "final_result"]), none(["no_proposals", "not_locked"], "proposals")])).toBe("No selected text can change its annotation mode.");
});

it("asks for the mode and a reason, lists the people, then applies with the preview's token after I understand", async () => {
  const onApplied = vi.fn();
  render(<BulkModeDialog projectKey="p" rows={rows} reach={{ scratch: 4, proposals: 0 }} onClose={vi.fn()} onApplied={onApplied} />);
  const dialog = await screen.findByRole("dialog", { name: "Change mode: 8 texts" });
  // No mode is preselected and nothing is asked before one is chosen; the only choices are the two modes.
  expect(within(dialog).getAllByRole("radio").map(radio => [(radio as HTMLInputElement).labels?.[0].textContent, (radio as HTMLInputElement).checked])).toEqual([["From scratch", false], ["From proposals", false]]);
  expect(within(dialog).queryAllByRole("checkbox")).toEqual([]);
  expect(within(dialog).getByText(/Changes 4 selected texts\./)).toBeTruthy();
  expect(within(dialog).getByText(/Changes none of the selected texts\./)).toBeTruthy();
  expect(api.bulkChangeMode).not.toHaveBeenCalled();
  const apply = within(dialog).getByRole("button", { name: "Change mode" });
  expect(apply.getAttribute("aria-disabled")).toBe("true");
  expect(within(dialog).getByText("Choose the new mode first.")).toBeTruthy();

  fireEvent.click(within(dialog).getByLabelText("From scratch"));
  expect(await within(dialog).findByText("Annotate 4 texts from scratch")).toBeTruthy();
  expect(api.bulkChangeMode).toHaveBeenCalledWith("p", { rows, mode: "scratch", preview: true }, expect.any(AbortSignal));
  expect(within(within(dialog).getByRole("list", { name: "Affected people" })).getAllByRole("listitem").map(item => item.textContent)).toEqual([
    "Tom Reis: 3 submissions are discarded.", "Carla Diaz: 1 consolidation is discarded; 1 unsubmitted consolidation is removed.", "R. Roe: 1 submission is discarded; 2 unsubmitted assignments are removed.",
  ]);
  expect(within(dialog).getByText("Will change:").parentElement?.textContent).toBe("Will change: the annotation mode of 4 texts");
  fireEvent.click(within(dialog).getByRole("button", { name: "Show all 4" }));

  const button = within(dialog).getByRole("button", { name: "Change mode of 4 texts" });
  expect(button.getAttribute("aria-disabled")).toBe("true");
  expect(within(dialog).getByText("Enter the reason first.")).toBeTruthy();
  fireEvent.change(within(dialog).getByLabelText("Reason (required)"), { target: { value: "Proposals were from the wrong model" } });
  fireEvent.click(button);
  // Step 2: the consequences with the people, then I understand.
  expect(within(dialog).getByText("What happens")).toBeTruthy();
  expect(within(dialog).getByText(/This cannot be undone here\. Restore… in a text card/)).toBeTruthy();
  expect(within(dialog).getByRole("list", { name: "Affected people" })).toBeTruthy();
  expect(within(dialog).queryByText(/^Skip 1 text/)).toBeNull();
  expect(button.getAttribute("aria-disabled")).toBe("true");
  fireEvent.click(within(dialog).getByLabelText("I understand — discard the work and change the mode"));
  vi.mocked(api.bulkChangeMode).mockResolvedValueOnce(modePreview({ applied: true }));
  fireEvent.click(button);
  await waitFor(() => expect(onApplied).toHaveBeenCalledOnce());
  expect(api.bulkChangeMode).toHaveBeenLastCalledWith("p", { rows, mode: "scratch", preview_token: "sha256:a", reason: "Proposals were from the wrong model" });
});

it("shows the fresh preview when the texts changed since (PREVIEW_STALE)", async () => {
  render(<BulkModeDialog projectKey="p" rows={rows} onClose={vi.fn()} onApplied={vi.fn()} />);
  const dialog = await screen.findByRole("dialog", { name: "Change mode: 8 texts" });
  fireEvent.click(within(dialog).getByLabelText("From scratch"));
  await within(dialog).findByText("Annotate 4 texts from scratch");
  fireEvent.change(within(dialog).getByLabelText("Reason (required)"), { target: { value: "Why" } });
  fireEvent.click(within(dialog).getByRole("button", { name: "Change mode of 4 texts" }));
  fireEvent.click(within(dialog).getByLabelText("I understand — discard the work and change the mode"));
  const fresh = modePreview({ changes: [change("EN100022", [submission("EN100022")], [assignment("EN100022", 1)])], preview_token: "sha256:b" });
  vi.mocked(api.bulkChangeMode).mockRejectedValueOnce(new ApiError(409, "stale", "PREVIEW_STALE", { preview: fresh } as never));
  fireEvent.click(within(dialog).getByRole("button", { name: "Change mode of 4 texts" }));
  expect(await within(dialog).findByText("The texts changed since the preview. Check the new preview.")).toBeTruthy();
  expect(within(dialog).getByText("Annotate 1 text from scratch")).toBeTruthy();
  expect(within(dialog).getByRole("button", { name: "Change mode of 1 text" })).toBeTruthy();
});

const summary: SelectionSummary = { cases: 8, steps: [], skipped: {}, common: null, not_shown: 0 };

function Harness() {
  const [keys] = useState<ReadonlySet<string>>(new Set(rows.map(row => `${row.case_id}:${row.language}`)));
  const { toast, show, dismiss } = useToast();
  return <div>
    <SelectionBar projectKey="p" keys={keys} filters={{}} onClear={vi.fn()} onAssign={vi.fn()} showToast={show} onAnnounce={vi.fn()} onChanged={vi.fn()} />
    <Toast toast={toast} onDismiss={dismiss} />
  </div>;
}

it("More actions lists Change mode… last, applies it and shows a message without Undo", async () => {
  vi.spyOn(api, "selectionSummary").mockResolvedValue(summary);
  render(<Harness />);
  await waitFor(() => expect(api.bulkChangeMode).toHaveBeenCalledWith("p", { rows, mode: "proposals", preview: true, summary_only: true }, expect.any(AbortSignal)));
  expect(api.bulkChangeMode).toHaveBeenCalledWith("p", { rows, mode: "scratch", preview: true, summary_only: true }, expect.any(AbortSignal));
  fireEvent.click(screen.getByRole("button", { name: "More actions" }));
  const items = within(screen.getByRole("menu", { name: "More actions" })).getAllByRole("menuitem");
  expect(items.at(-1)?.textContent).toBe("Change mode…");
  expect(items.at(-1)?.getAttribute("aria-disabled")).toBeNull();
  fireEvent.click(items.at(-1)!);
  const dialog = await screen.findByRole("dialog", { name: "Change mode: 8 texts" });
  fireEvent.click(within(dialog).getByLabelText("From scratch"));
  await within(dialog).findByText("Annotate 4 texts from scratch");
  fireEvent.change(within(dialog).getByLabelText("Reason (required)"), { target: { value: "Why" } });
  fireEvent.click(within(dialog).getByRole("button", { name: "Change mode of 4 texts" }));
  fireEvent.click(within(dialog).getByLabelText("I understand — discard the work and change the mode"));
  vi.mocked(api.bulkChangeMode).mockResolvedValueOnce(modePreview({ applied: true }));
  fireEvent.click(within(dialog).getByRole("button", { name: "Change mode of 4 texts" }));
  expect(await screen.findByText("Changed the annotation mode of 4 texts.")).toBeTruthy();
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(screen.queryByRole("button", { name: "Undo" })).toBeNull();
});
