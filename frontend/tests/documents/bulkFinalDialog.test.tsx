import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { useState } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { api, ApiError, type AcceptAgreeingView, type BulkChangeFinalUndoView, type BulkChangeFinalView, type BulkTaskActionView, type SelectionSummary } from "../../src/api/client";
import { BulkFinalDialog } from "../../src/documents/BulkFinalDialog";
import { finalAppliedText, finalConsequences, finalGroups, finalSummaryText, finalUnavailableReason, finalUndoneText, finalUndoRefusal, taskUndoRefusal } from "../../src/documents/bulkFinalModel";
import { SelectionBar } from "../../src/documents/SelectionBar";
import { Toast, useToast } from "../../src/ui";

const tom = { pseudonym: "ann-1", display_name: "Tom Reis", is_me: false };
const roe = { pseudonym: "ann-2", display_name: "R. Roe", is_me: false };
const change = (case_id: string, kind: "annotation" | "consolidation" = "annotation", person: typeof tom | null = tom, eligible = 1): BulkChangeFinalView["changes"][number] => ({
  case_id, language: "en", expected_revision: 1, from_document_id: `${case_id}-en`, from_submission_id: `${case_id}-old`, from_version: 1,
  document_id: `${case_id}-en`, submission_id: `${case_id}-new`, version: 1, kind, person, eligible_submissions: eligible,
});
const skip = <R extends string>(case_id: string, reason: R, message = "Server words.") => ({ case_id, language: "en", reason, message });

function changePreview(overrides: Partial<BulkChangeFinalView> = {}): BulkChangeFinalView {
  const view: BulkChangeFinalView = {
    project: "p", rule: "newest_submission", applied: false, texts: 8, change_count: 0, skipped_count: 0, skipped_by_reason: {},
    changes: [change("EN100022", "consolidation", roe, 3), change("EN100023"), change("EN100024", "annotation", tom, 2), change("EN100025", "annotation", roe), change("EN100026")],
    skipped: [skip("EN100027", "already_newest"), skip("EN100028", "no_final"), skip("EN100029", "no_final"), skip("EN100030", "differ")],
    preview_token: "sha256:c", ...overrides,
  };
  const reasons: Record<string, number> = {};
  for (const item of view.skipped) reasons[item.reason] = (reasons[item.reason] ?? 0) + 1;
  return { ...view, change_count: view.changes.length, skipped_count: view.skipped.length, skipped_by_reason: reasons };
}
function acceptPreview(overrides: Partial<AcceptAgreeingView> = {}): AcceptAgreeingView {
  return {
    project: "p", applied: false,
    texts: [{ case_id: "EN100028", language: "en", document_id: "d28", submission_id: "s28", findings: 2 }, { case_id: "EN100029", language: "en", document_id: "d29", submission_id: "s29", findings: 0 }],
    skipped: [skip("EN100023", "differ"), skip("EN100024", "open_task")],
    already_final: 4, already_final_rows: ["EN100022", "EN100025", "EN100026", "EN100027"].map(case_id => ({ case_id, language: "en" })),
    unknown_case_ids: [], preview_token: "sha256:a", ...overrides,
  };
}
const rows = ["EN100022", "EN100023", "EN100024", "EN100025", "EN100026", "EN100027", "EN100028", "EN100029"].map(case_id => ({ case_id, language: "en" }));
const nothing: BulkTaskActionView = { action: "reopen", applied: false, texts: 8, change_count: 0, kept_count: 0, skipped_count: 0, changes: [], kept: [], skipped: [], preview_token: "sha256:n", undo: null };

beforeEach(() => {
  vi.spyOn(api, "acceptAgreeing").mockResolvedValue(acceptPreview());
  vi.spyOn(api, "bulkChangeFinal").mockResolvedValue(changePreview());
  vi.spyOn(api, "bulkReopen").mockResolvedValue(nothing);
  vi.spyOn(api, "bulkWithdraw").mockResolvedValue({ ...nothing, action: "withdraw" });
  vi.spyOn(api, "bulkStartRound").mockResolvedValue({ ...nothing, action: "start_round", kind: "carry_forward" });
  vi.spyOn(api, "bulkChangeMode").mockResolvedValue({ mode: "scratch", applied: false, texts: 0, change_count: 0, skipped_count: 0, skipped_by_reason: {}, submission_count: 0, assignment_count: 0, changes: [], skipped: [], preview_token: "sha256:m" });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

it("groups Change final… by the kind of the new result, with people, and the skipped texts by reason (decision 336-B)", () => {
  const groups = finalGroups({ action: "change", data: changePreview() });
  expect(groups.map(group => `${group.tone}: ${group.title} · ${group.detail}`)).toEqual([
    "change: Use the newest consolidation for 1 text · R. Roe 1",
    "change: Use the newest annotation for 4 texts · Tom Reis 3, R. Roe 1",
    "skip: Skip 1 text · the final result already is the newest submission",
    "skip: Skip 2 texts · no final result yet: use Accept agreeing results… or the text card",
    "skip: Skip 1 text · submissions differ: compare or consolidate first",
  ]);
  expect(groups[1].texts).toEqual(["EN100023 en", "EN100024 en", "EN100025 en", "EN100026 en"]);
  expect(finalSummaryText({ action: "change", data: changePreview() }, 5)).toBe("the final result of 5 texts");
  expect(finalAppliedText({ action: "change", data: changePreview({ changes: [change("a")] }) })).toBe("Changed the final result of 1 text.");
  // An unknown reason shows the server's words; a submission of someone who left is named so.
  const odd = finalGroups({ action: "change", data: changePreview({ changes: [change("a", "annotation", null)], skipped: [skip("b", "later_reason" as "no_final", "Server words.")] }) });
  expect(odd.map(group => group.detail)).toEqual(["someone no longer in the project 1", "Server words."]);
});

it("groups Accept agreeing results…: accepted, skipped by reason, already final (decision 354-C)", () => {
  const groups = finalGroups({ action: "accept", data: acceptPreview() });
  expect(groups.map(group => `${group.tone}: ${group.title} · ${group.detail}`)).toEqual([
    "change: Accept the result of 2 texts · all annotations agree in full",
    "skip: Skip 1 text · the results differ: consolidate or choose in the text card",
    "skip: Skip 1 text · other work on the text is still open",
    "keep: Keep 4 final results · already final: use Change final… for them",
  ]);
  expect(groups[3].texts).toHaveLength(4);
  expect(finalSummaryText({ action: "accept", data: acceptPreview() }, 2)).toBe("2 texts");
  expect(finalAppliedText({ action: "accept", data: acceptPreview() })).toBe("Accepted the results of 2 texts.");
});

it("the consequences say how to go back: Undo in the message for Change final…, none for Accept agreeing results…", () => {
  const lines = finalConsequences({ action: "change", data: changePreview() });
  expect(lines[0]).toBe("5 texts get the newest submission as final result. The earlier final result stays in each text's history.");
  expect(lines).toHaveLength(3);
  expect(lines.some(line => line.includes("without comparing"))).toBe(false);
  expect(lines.at(-1)).toBe("Undo in the message brings the earlier final results back while nothing else changed on the texts.");
  expect(finalConsequences({ action: "accept", data: acceptPreview() }).at(-1)).toBe("This cannot be undone here; use Withdraw final… or Change final… in a text card.");
});

const undoView = (overrides: Partial<BulkChangeFinalUndoView> = {}): BulkChangeFinalUndoView => ({
  project: "p", undo_id: 41, applied: true, expires_at: "2026-11-17T12:00:00Z", texts: 5, restore_count: 5, blocked_count: 0, restores: [], blocked: [], exports_since: 0, ...overrides,
});

it("words the Undo: what came back, exports made meanwhile, and the texts in the way of a refused one", () => {
  expect(finalUndoneText(undoView())).toBe("The earlier final results of 5 texts are back.");
  expect(finalUndoneText(undoView({ restore_count: 1 }))).toBe("The earlier final result of 1 text is back.");
  expect(finalUndoneText(undoView({ exports_since: 1 }))).toBe("The earlier final results of 5 texts are back. 1 final export made meanwhile stays as it is, with the changed results.");
  expect(finalUndoneText(undoView({ exports_since: 2 }))).toBe("The earlier final results of 5 texts are back. 2 final exports made meanwhile stay as they are, with the changed results.");
  const blocked = [
    { case_id: "EN100023", language: "en", reason: "tasks" as const, message: "Server words." },
    { case_id: "EN100024", language: "en", reason: "final" as const, message: "Server words." },
  ];
  const refused = new ApiError(409, "stale", "BULK_UNDO_STALE", { reason: "changed", preview: undoView({ applied: false, restore_count: 3, blocked_count: 2, blocked }) });
  expect(finalUndoRefusal(refused)).toBe(
    "Undo is not possible: 2 of 5 texts changed since (EN100023 en: a task was assigned, reopened, withdrawn or paused, or got a new round; and 1 more text). Nothing was undone.",
  );
  // Expired, used or another lead's: the general message.
  expect(finalUndoRefusal(new ApiError(409, "stale", "BULK_UNDO_STALE", { reason: "expired" }))).toBeNull();
  // Issue 469: the Undo of a bulk Reopen or Withdraw names the text in the same pattern.
  const task = (case_id: string, reason: string) => ({ case_id, language: "en", reason, message: "Server words." });
  const taskRefusal = (blocked_texts: unknown[], texts = 7) => new ApiError(409, "stale", "BULK_UNDO_STALE", { reason: "changed", preview: { undone: 0, applied: false, texts, blocked_texts } });
  expect(taskUndoRefusal(taskRefusal([task("EN100022", "tasks")]))).toBe(
    "Undo is not possible: 1 of 7 texts changed since (EN100022 en: a task was assigned, reopened, withdrawn or paused, or got a new round). Nothing was undone.");
  expect(taskUndoRefusal(taskRefusal([task("EN100022", "drafts"), task("EN100023", "plan"), task("EN100024", "final")]))).toBe(
    "Undo is not possible: 3 of 7 texts changed since (EN100022 en: work on a task was saved; and 2 more texts). Nothing was undone.");
  // A reason this client does not know: the server's words.
  expect(taskUndoRefusal(taskRefusal([task("EN100022", "later")], 1))).toBe("Undo is not possible: 1 of 1 text changed since (EN100022 en: Server words.). Nothing was undone.");
  // No text named (an expired or used Undo, or an older record): the general message stays.
  expect(taskUndoRefusal(taskRefusal([]))).toBeNull();
  expect(taskUndoRefusal(new ApiError(409, "stale", "BULK_UNDO_STALE", { reason: "expired" }))).toBeNull();
  expect(finalUndoRefusal(new Error("offline"))).toBeNull();
});

it("a menu entry that does nothing names the reason (decision 336-C)", () => {
  expect(finalUnavailableReason(null, 2)).toBeNull();
  expect(finalUnavailableReason({ action: "change", data: changePreview() }, 2)).toBeNull();
  expect(finalUnavailableReason({ action: "change", data: changePreview({ changes: [], skipped: [skip("a", "no_final"), skip("b", "no_final")] }) }, 2)).toBe("The selected texts have no final result yet.");
  expect(finalUnavailableReason({ action: "change", data: changePreview({ changes: [], skipped: [skip("a", "no_final"), skip("b", "already_newest")] }) }, 2))
    .toBe("No selected text has a newer submission than its final result.");
  expect(finalUnavailableReason({ action: "accept", data: acceptPreview() }, 2)).toBeNull();
  expect(finalUnavailableReason({ action: "accept", data: acceptPreview({ texts: [], skipped: [] }) }, 2)).toBe("The selected texts already have a final result: use Change final….");
  expect(finalUnavailableReason({ action: "accept", data: acceptPreview({ texts: [] }) }, 2)).toBe("No selected text has annotations that agree in full.");
});

it("the dialog summary when nothing changes speaks of one text or several (issue 585)", () => {
  expect(finalSummaryText({ action: "accept", data: acceptPreview({ texts: [] }) }, 2)).toBe("No selected text has annotations that agree in full.");
  expect(finalSummaryText({ action: "accept", data: acceptPreview({ texts: [] }) }, 1)).toBe("The selected text has no annotations that agree in full.");
  expect(finalSummaryText({ action: "change", data: changePreview({ changes: [] }) }, 2)).toBe("No selected text has a newer submission than its final result.");
  expect(finalSummaryText({ action: "change", data: changePreview({ changes: [] }) }, 1)).toBe("The selected text has no newer submission than its final result.");
});

it("with one text selected, the reasons speak of one text (issue 585)", () => {
  expect(finalUnavailableReason({ action: "change", data: changePreview({ changes: [], skipped: [skip("a", "no_final")] }) }, 1)).toBe("The selected text has no final result yet.");
  expect(finalUnavailableReason({ action: "change", data: changePreview({ changes: [], skipped: [skip("a", "already_newest")] }) }, 1))
    .toBe("The selected text has no newer submission than its final result.");
  expect(finalUnavailableReason({ action: "accept", data: acceptPreview({ texts: [], skipped: [] }) }, 1)).toBe("The selected text already has a final result: use Change final….");
  expect(finalUnavailableReason({ action: "accept", data: acceptPreview({ texts: [] }) }, 1)).toBe("The selected text has no annotations that agree in full.");
});

it("Change final… previews, needs I understand, then applies with the preview's token", async () => {
  const onApplied = vi.fn();
  render(<BulkFinalDialog projectKey="p" action="change" rows={rows} onClose={vi.fn()} onApplied={onApplied} />);
  const dialog = await screen.findByRole("dialog", { name: "Change final: 8 texts" });
  expect(await within(dialog).findByText("Use the newest annotation for 4 texts")).toBeTruthy();
  expect(api.bulkChangeFinal).toHaveBeenCalledWith("p", { rows, preview: true, rule: "newest_submission" }, expect.any(AbortSignal));
  expect(within(dialog).getByText("Rule:").parentElement?.textContent).toContain("newest submission");
  fireEvent.click(within(dialog).getByRole("button", { name: "Show all 4" }));
  expect(within(dialog).getByText("EN100023 en, EN100024 en, EN100025 en, EN100026 en", { exact: false })).toBeTruthy();
  expect(within(dialog).getByText("Will change:").parentElement?.textContent).toBe("Will change: the final result of 5 texts");

  const apply = within(dialog).getByRole("button", { name: "Change 5 final results" });
  expect(apply.getAttribute("aria-disabled")).toBeNull();
  fireEvent.click(apply);
  expect(within(dialog).getByText("What happens")).toBeTruthy();
  expect(within(dialog).queryByText("Skip 2 texts")).toBeNull();
  expect(apply.getAttribute("aria-disabled")).toBe("true");
  fireEvent.click(apply);
  expect(api.bulkChangeFinal).toHaveBeenCalledTimes(1);
  fireEvent.click(within(dialog).getByLabelText("I understand"));
  vi.mocked(api.bulkChangeFinal).mockResolvedValueOnce(changePreview({ applied: true }));
  fireEvent.click(apply);
  await waitFor(() => expect(onApplied).toHaveBeenCalledOnce());
  expect(api.bulkChangeFinal).toHaveBeenLastCalledWith("p", { rows, preview_token: "sha256:c", rule: "newest_submission" }, undefined);
  expect(onApplied.mock.calls[0][0].action).toBe("change");
});

it("shows the fresh preview when the texts changed since (PREVIEW_STALE)", async () => {
  render(<BulkFinalDialog projectKey="p" action="change" rows={rows} onClose={vi.fn()} onApplied={vi.fn()} />);
  const dialog = await screen.findByRole("dialog", { name: "Change final: 8 texts" });
  await within(dialog).findByText("Use the newest annotation for 4 texts");
  fireEvent.click(within(dialog).getByRole("button", { name: "Change 5 final results" }));
  fireEvent.click(within(dialog).getByLabelText("I understand"));
  const fresh = changePreview({ changes: [change("EN100023")], preview_token: "sha256:d" });
  vi.mocked(api.bulkChangeFinal).mockRejectedValueOnce(new ApiError(409, "stale", "PREVIEW_STALE", { preview: fresh } as never));
  fireEvent.click(within(dialog).getByRole("button", { name: "Change 5 final results" }));
  expect(await within(dialog).findByText("The texts changed since the preview. Check the new preview.")).toBeTruthy();
  expect(within(dialog).getByText("Use the newest annotation for 1 text")).toBeTruthy();
  expect(within(dialog).getByRole("button", { name: "Change 1 final result" })).toBeTruthy();
  expect(within(dialog).queryByText("What happens")).toBeNull();
});

it("Accept agreeing results… sends the selection and names why nothing can be accepted", async () => {
  vi.mocked(api.acceptAgreeing).mockResolvedValue(acceptPreview({ texts: [] }));
  render(<BulkFinalDialog projectKey="p" action="accept" rows={rows} onClose={vi.fn()} onApplied={vi.fn()} />);
  const dialog = await screen.findByRole("dialog", { name: "Accept agreeing results: 8 texts" });
  expect(await within(dialog).findByText("Keep 4 final results")).toBeTruthy();
  expect(api.acceptAgreeing).toHaveBeenCalledWith("p", { rows, preview: true }, expect.any(AbortSignal));
  expect(within(dialog).getByText("Will become final:").parentElement?.textContent).toBe("Will become final: No selected text has annotations that agree in full.");
  const apply = within(dialog).getByRole("button", { name: "Accept 0 results" });
  expect(apply.getAttribute("aria-disabled")).toBe("true");
  fireEvent.click(apply);
  expect(within(dialog).queryByText("What happens")).toBeNull();
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

it("More actions lists the final actions, applies Accept agreeing results… and shows a message without Undo", async () => {
  vi.spyOn(api, "selectionSummary").mockResolvedValue(summary);
  vi.mocked(api.bulkChangeFinal).mockResolvedValue(changePreview({ changes: [], skipped: [skip("EN100028", "no_final")] }));
  render(<Harness />);
  await waitFor(() => expect(api.bulkChangeFinal).toHaveBeenCalledWith("p", { rows, preview: true, summary_only: true }, expect.any(AbortSignal)));
  await waitFor(() => expect(api.acceptAgreeing).toHaveBeenCalledWith("p", { rows, preview: true }, expect.any(AbortSignal)));
  fireEvent.click(screen.getByRole("button", { name: "More actions" }));
  const items = within(screen.getByRole("menu", { name: "More actions" })).getAllByRole("menuitem");
  expect(items.slice(2, 4).map(item => item.textContent)).toEqual(["Accept agreeing results…", "Change final…The selected texts have no final result yet."]);
  expect(items[3].getAttribute("aria-disabled")).toBe("true");
  fireEvent.click(items[2]);
  const dialog = await screen.findByRole("dialog", { name: "Accept agreeing results: 8 texts" });
  await within(dialog).findByText("Accept the result of 2 texts");
  fireEvent.click(within(dialog).getByRole("button", { name: "Accept 2 results" }));
  fireEvent.click(within(dialog).getByLabelText("I understand"));
  vi.mocked(api.acceptAgreeing).mockResolvedValueOnce(acceptPreview({ applied: true }));
  fireEvent.click(within(dialog).getByRole("button", { name: "Accept 2 results" }));
  expect(await screen.findByText("Accepted the results of 2 texts.")).toBeTruthy();
  expect(api.acceptAgreeing).toHaveBeenLastCalledWith("p", { rows, preview_token: "sha256:a" }, undefined);
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(screen.queryByRole("button", { name: "Undo" })).toBeNull();
});

async function applyChangeFinal(): Promise<void> {
  vi.spyOn(api, "selectionSummary").mockResolvedValue(summary);
  render(<Harness />);
  await waitFor(() => expect(api.bulkChangeFinal).toHaveBeenCalled());
  fireEvent.click(screen.getByRole("button", { name: "More actions" }));
  fireEvent.click(within(screen.getByRole("menu", { name: "More actions" })).getByRole("menuitem", { name: /^Change final…/ }));
  const dialog = await screen.findByRole("dialog", { name: "Change final: 8 texts" });
  fireEvent.click(await within(dialog).findByRole("button", { name: "Change 5 final results" }));
  fireEvent.click(within(dialog).getByLabelText("I understand"));
  vi.mocked(api.bulkChangeFinal).mockResolvedValueOnce(changePreview({ applied: true, undo: { id: 41, expires_at: "2026-11-17T12:00:00Z" } }));
  fireEvent.click(within(dialog).getByRole("button", { name: "Change 5 final results" }));
  expect(await screen.findByText("Changed the final result of 5 texts.")).toBeTruthy();
}

it("after Change final… the message offers Undo, which restores the earlier final results by the record's id", async () => {
  const undo = vi.spyOn(api, "bulkChangeFinalUndo").mockResolvedValue(undoView({ exports_since: 1 }));
  await applyChangeFinal();
  fireEvent.click(screen.getByRole("button", { name: "Undo" }));
  expect(await screen.findByText("The earlier final results of 5 texts are back. 1 final export made meanwhile stays as it is, with the changed results.")).toBeTruthy();
  expect(undo).toHaveBeenCalledWith("p", 41);
  expect(screen.queryByRole("button", { name: "Undo" })).toBeNull();
});

it("a refused Undo of Change final… names the texts that changed since and undoes nothing", async () => {
  const blocked = [{ case_id: "EN100023", language: "en", reason: "final" as const, message: "Server words." }];
  vi.spyOn(api, "bulkChangeFinalUndo").mockRejectedValue(new ApiError(409, "stale", "BULK_UNDO_STALE", { reason: "changed", preview: undoView({ applied: false, restore_count: 4, blocked_count: 1, blocked }) }));
  await applyChangeFinal();
  fireEvent.click(screen.getByRole("button", { name: "Undo" }));
  expect(await screen.findByText("Undo is not possible: 1 of 5 texts changed since (EN100023 en: its final result was changed, confirmed again or withdrawn). Nothing was undone.")).toBeTruthy();
  expect(screen.queryByText(/are back/)).toBeNull();
});

it("an expired Undo of Change final… says so in the general words", async () => {
  vi.spyOn(api, "bulkChangeFinalUndo").mockRejectedValue(new ApiError(409, "stale", "BULK_UNDO_STALE", { reason: "expired" }));
  await applyChangeFinal();
  fireEvent.click(screen.getByRole("button", { name: "Undo" }));
  expect(await screen.findByText("Undo is no longer possible: the texts changed since.")).toBeTruthy();
});
