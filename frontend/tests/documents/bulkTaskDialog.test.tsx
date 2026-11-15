import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { useState } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { api, ApiError, type BulkTaskActionView, type SelectionSummary } from "../../src/api/client";
import { appliedText, consequenceLines, peopleCounts, previewGroups, unavailableReason, willChangeText } from "../../src/documents/bulkActionModel";
import { BulkTaskDialog } from "../../src/documents/BulkTaskDialog";
import { SelectionBar } from "../../src/documents/SelectionBar";
import { Toast, useToast } from "../../src/ui";

const tom = { pseudonym: "ann-1", display_name: "Tom Reis", is_me: false };
const roe = { pseudonym: "ann-2", display_name: "R. Roe", is_me: false };
const task = (case_id: string, assignment_id: number, person = tom, status: "open" | "in_progress" | "submitted" | "reopened" = "submitted") => ({
  case_id, language: "de", assignment_id, document_id: `${case_id}-de`, version: 1, task: "annotate" as const, status, person,
});
const reopenPreview = (overrides: Partial<BulkTaskActionView> = {}): BulkTaskActionView => counted({
  action: "reopen", applied: false, texts: 7, change_count: 0, kept_count: 0, skipped_count: 0,
  changes: [task("EN100022", 1), task("EN100023", 2), task("EN100023", 3, roe), task("EN100025", 4), task("EN100026", 5)],
  kept: [{ ...task("EN100027", 6, roe, "open"), reason: "not_submitted", message: "Not submitted yet." }],
  skipped: [{ case_id: "EN100028", language: "de", reason: "final_chosen", message: "Final result chosen: use Change final… first." }],
  preview_token: "sha256:a", undo: null, ...overrides,
});
/** The counts follow the lists, as the server sends them. */
function counted(view: BulkTaskActionView): BulkTaskActionView {
  return { ...view, change_count: view.changes.length, kept_count: view.kept.length, skipped_count: view.skipped.length };
}
const rows = ["EN100022", "EN100023", "EN100025", "EN100026", "EN100027", "EN100028", "EN100029"].map(case_id => ({ case_id, language: "de" }));

beforeEach(() => {
  vi.spyOn(api, "bulkReopen").mockResolvedValue(reopenPreview());
  vi.spyOn(api, "bulkWithdraw").mockResolvedValue(reopenPreview({ action: "withdraw", changes: [], kept: [], skipped: [] }));
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

it("groups the preview by consequence and names people with their counts (decision 336-B)", () => {
  const groups = previewGroups(reopenPreview());
  expect(groups.map(group => `${group.title} · ${group.detail}`)).toEqual([
    "Reopen 5 submitted tasks · Tom Reis 4, R. Roe 1",
    "Skip 1 text · final result chosen: use Change final… first",
    "Keep 1 open task · not submitted yet",
  ]);
  expect(groups[0].texts).toEqual(["EN100022 de", "EN100023 de", "EN100025 de", "EN100026 de"]);
  expect(peopleCounts([task("a", 1, roe), task("b", 2, tom), task("c", 3, roe)])).toBe("R. Roe 2, Tom Reis 1");
  expect(willChangeText(reopenPreview())).toBe("5 assignments in 4 texts");
  expect(appliedText(reopenPreview({ applied: true }))).toBe("Reopened 5 assignments in 4 texts.");
  const withdraw = previewGroups(reopenPreview({ action: "withdraw", changes: [task("a", 1, tom, "open"), task("b", 2, roe, "in_progress")], kept: [], skipped: [] }));
  expect(withdraw.map(group => group.title)).toEqual(["Withdraw 1 open task", "Withdraw 1 started task, drafts kept"]);
});

it("a menu entry that does nothing names the reason (decision 336-C)", () => {
  expect(unavailableReason("reopen", reopenPreview())).toBeNull();
  expect(unavailableReason("reopen", reopenPreview({ changes: [], texts: 1, skipped: [{ case_id: "x", language: "de", reason: "final_chosen", message: "" }] })))
    .toBe("The selected texts have a final result: use Change final… first.");
  expect(unavailableReason("reopen", reopenPreview({ changes: [], skipped: [] }))).toBe("No submitted tasks in the selected texts.");
  expect(unavailableReason("withdraw", reopenPreview({ action: "withdraw", changes: [] }))).toBe("No open tasks in the selected texts.");
  expect(unavailableReason("withdraw", null)).toBeNull();
});

it("says that reopened translation reviews cannot be undone", () => {
  const review = { ...task("EN100022", 1), task: "translation_review" as const };
  expect(consequenceLines(reopenPreview({ changes: [review] })).at(-1)).toBe("Translation reviews start again from the current text of their version. This cannot be undone.");
  expect(consequenceLines(reopenPreview()).at(-1)).toBe("Undo in the message submits the tasks again while nobody has changed them.");
});

it("previews, needs a reason and I understand, then applies with the preview's token", async () => {
  const onApplied = vi.fn();
  render(<BulkTaskDialog projectKey="p" action="reopen" rows={rows} onClose={vi.fn()} onApplied={onApplied} />);
  const dialog = await screen.findByRole("dialog", { name: "Reopen: 7 texts" });
  expect(await within(dialog).findByText("Reopen 5 submitted tasks")).toBeTruthy();
  expect(api.bulkReopen).toHaveBeenCalledWith("p", { rows, tasks: ["annotate"], preview: true }, expect.any(AbortSignal));
  expect(within(dialog).getByText("EN100022 de, EN100023 de, EN100025 de, …", { exact: false })).toBeTruthy();
  fireEvent.click(within(dialog).getByRole("button", { name: "Show all 4" }));
  expect(within(dialog).getByText("EN100022 de, EN100023 de, EN100025 de, EN100026 de", { exact: false })).toBeTruthy();
  expect(within(dialog).getByText("Will change:").parentElement?.textContent).toBe("Will change: 5 assignments in 4 texts");

  const apply = within(dialog).getByRole("button", { name: "Reopen 5 assignments" });
  expect(apply.getAttribute("aria-disabled")).toBe("true");
  expect(within(dialog).getByText("Enter the reason first.")).toBeTruthy();
  fireEvent.change(within(dialog).getByLabelText("Reason (required)"), { target: { value: "Guideline 2.3 changed" } });
  fireEvent.click(apply);
  // Step 2: the consequences, then I understand.
  expect(within(dialog).getByText("What happens")).toBeTruthy();
  expect(within(dialog).queryByText("Keep 1 open task")).toBeNull();
  expect(apply.getAttribute("aria-disabled")).toBe("true");
  fireEvent.click(within(dialog).getByLabelText("I understand"));
  vi.mocked(api.bulkReopen).mockResolvedValueOnce(reopenPreview({ applied: true, undo: { id: 41, expires_at: "2026-11-15T12:00:00Z" } }));
  fireEvent.click(apply);
  await waitFor(() => expect(onApplied).toHaveBeenCalledOnce());
  expect(api.bulkReopen).toHaveBeenLastCalledWith("p", { rows, tasks: ["annotate"], preview_token: "sha256:a", reason: "Guideline 2.3 changed" }, undefined);
});

it("shows the fresh preview when the texts changed since (PREVIEW_STALE)", async () => {
  render(<BulkTaskDialog projectKey="p" action="reopen" rows={rows} onClose={vi.fn()} onApplied={vi.fn()} />);
  const dialog = await screen.findByRole("dialog", { name: "Reopen: 7 texts" });
  await within(dialog).findByText("Reopen 5 submitted tasks");
  fireEvent.change(within(dialog).getByLabelText("Reason (required)"), { target: { value: "Why" } });
  fireEvent.click(within(dialog).getByRole("button", { name: "Reopen 5 assignments" }));
  fireEvent.click(within(dialog).getByLabelText("I understand"));
  const fresh = reopenPreview({ changes: [task("EN100022", 1)], preview_token: "sha256:b" });
  vi.mocked(api.bulkReopen).mockRejectedValueOnce(new ApiError(409, "stale", "PREVIEW_STALE", { preview: fresh } as never));
  fireEvent.click(within(dialog).getByRole("button", { name: "Reopen 5 assignments" }));
  expect(await within(dialog).findByText("The texts changed since the preview. Check the new preview.")).toBeTruthy();
  expect(within(dialog).getByText("Reopen 1 submitted task")).toBeTruthy();
  expect(within(dialog).getByRole("button", { name: "Reopen 1 assignment" })).toBeTruthy();
});

it("withdraw offers started tasks and the limit as options", async () => {
  render(<BulkTaskDialog projectKey="p" action="withdraw" rows={rows} onClose={vi.fn()} onApplied={vi.fn()} />);
  const dialog = await screen.findByRole("dialog", { name: "Withdraw open tasks: 7 texts" });
  await waitFor(() => expect(api.bulkWithdraw).toHaveBeenCalledWith("p", { rows, tasks: ["annotate"], include_started: false, over_limit_only: false, preview: true }, expect.any(AbortSignal)));
  const first = vi.mocked(api.bulkWithdraw).mock.calls[0][2]!;
  fireEvent.click(within(dialog).getByLabelText("Only annotations above the limit of annotators per text"));
  await waitFor(() => expect(api.bulkWithdraw).toHaveBeenLastCalledWith("p", expect.objectContaining({ over_limit_only: true, preview: true }), expect.any(AbortSignal)));
  // The changed option aborted the earlier preview request.
  expect(first.aborted).toBe(true);
  expect(await within(dialog).findByText("No open tasks to withdraw in the selected texts.", { selector: ".dialog-footer-reason" })).toBeTruthy();
  expect(within(dialog).getByLabelText("Reason (optional)")).toBeTruthy();
});

const summary: SelectionSummary = { cases: 7, steps: [], skipped: {}, common: null, not_shown: 0 };

function Harness() {
  const [keys] = useState<ReadonlySet<string>>(new Set(rows.map(row => `${row.case_id}:${row.language}`)));
  const { toast, show, dismiss } = useToast();
  return <div>
    <SelectionBar projectKey="p" keys={keys} filters={{}} onClear={vi.fn()} onAssign={vi.fn()} showToast={show} onAnnounce={vi.fn()} onChanged={vi.fn()} />
    <Toast toast={toast} onDismiss={dismiss} />
  </div>;
}

it("More actions lists Reopen… and Withdraw open tasks…, applies and offers Undo (issue 336)", async () => {
  vi.spyOn(api, "selectionSummary").mockResolvedValue(summary);
  vi.spyOn(api, "bulkUndo").mockResolvedValue({ undone: 5 });
  render(<Harness />);
  await waitFor(() => expect(api.bulkWithdraw).toHaveBeenCalledWith("p", expect.objectContaining({ include_started: true, preview: true, summary_only: true, tasks: ["annotate", "translation_review", "review"] }), expect.any(AbortSignal)));
  fireEvent.click(screen.getByRole("button", { name: "More actions" }));
  const menu = screen.getByRole("menu", { name: "More actions" });
  const items = within(menu).getAllByRole("menuitem");
  expect(items.map(item => item.textContent)).toEqual(["Reopen…", "Withdraw open tasks…No open tasks in the selected texts."]);
  expect(items[1].getAttribute("aria-disabled")).toBe("true");
  expect(items[0].getAttribute("aria-disabled")).toBeNull();
  fireEvent.click(items[0]);
  const dialog = await screen.findByRole("dialog", { name: "Reopen: 7 texts" });
  await within(dialog).findByText("Reopen 5 submitted tasks");
  fireEvent.change(within(dialog).getByLabelText("Reason (required)"), { target: { value: "Why" } });
  fireEvent.click(within(dialog).getByRole("button", { name: "Reopen 5 assignments" }));
  fireEvent.click(within(dialog).getByLabelText("I understand"));
  const undo = { id: 41, expires_at: "2026-11-15T12:00:00Z" };
  vi.mocked(api.bulkReopen).mockResolvedValueOnce(reopenPreview({ applied: true, undo }));
  fireEvent.click(within(dialog).getByRole("button", { name: "Reopen 5 assignments" }));
  expect(await screen.findByText("Reopened 5 assignments in 4 texts.")).toBeTruthy();
  expect(screen.queryByRole("dialog")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Undo" }));
  await waitFor(() => expect(api.bulkUndo).toHaveBeenCalledWith("p", 41));
  expect(await screen.findByText("The reopened tasks are submitted again.")).toBeTruthy();
});
