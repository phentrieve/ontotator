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
/** "Start a round…": five submitted tasks, a text with a final result, one with an open consolidation, kept tasks. */
const roundPreview = (kind: "carry_forward" | "clean_restart" = "carry_forward", overrides: Partial<BulkTaskActionView> = {}): BulkTaskActionView => counted({
  ...reopenPreview(), action: "start_round", kind,
  kept: [
    { ...task("EN100027", 6, roe, "open"), reason: "not_submitted", message: "Not submitted yet." },
    { ...task("EN100027", 7, tom), reason: "paused", message: "Paused by a problem report; decide the report first." },
    { ...task("EN100029", 8, tom), reason: "not_current_version", message: "Not on the current version of the text; use the text card." },
    { ...task("EN100029", 9, roe), reason: "person_unavailable", message: "The person is no longer an active member with this role." },
    { ...task("EN100029", 10, roe), reason: "translation_not_accepted", message: "The translation is not accepted yet." },
    ...(kind === "clean_restart" ? [{ ...task("EN100026", 11, roe), reason: "no_round", message: "No work round to restart (older or imported work); use Reopen…." }] : []),
  ],
  skipped: [
    { case_id: "EN100028", language: "de", reason: "final_result", message: "Final result chosen: use Withdraw final… first." },
    { case_id: "EN100030", language: "de", reason: "consolidation_open", message: "A consolidation is open: finish or withdraw it first." },
  ],
  preview_token: `sha256:${kind}`, ...overrides,
});
/** The counts follow the lists, as the server sends them. */
function counted(view: BulkTaskActionView): BulkTaskActionView {
  return { ...view, change_count: view.changes.length, kept_count: view.kept.length, skipped_count: view.skipped.length };
}
const rows = ["EN100022", "EN100023", "EN100025", "EN100026", "EN100027", "EN100028", "EN100029"].map(case_id => ({ case_id, language: "de" }));

beforeEach(() => {
  vi.spyOn(api, "bulkReopen").mockResolvedValue(reopenPreview());
  vi.spyOn(api, "bulkWithdraw").mockResolvedValue(reopenPreview({ action: "withdraw", changes: [], kept: [], skipped: [] }));
  vi.spyOn(api, "bulkStartRound").mockImplementation(async (_key, body) => roundPreview(body.kind));
  vi.spyOn(api, "bulkChangeMode").mockResolvedValue({ mode: "scratch", applied: false, texts: 0, change_count: 0, skipped_count: 0, skipped_by_reason: {}, submission_count: 0, assignment_count: 0, changes: [], skipped: [], preview_token: "sha256:m" });
  // The final actions of the same menu (bulkFinalDialog.test.tsx) are not asked here.
  vi.spyOn(api, "acceptAgreeing").mockRejectedValue(new Error("not asked"));
  vi.spyOn(api, "bulkChangeFinal").mockRejectedValue(new Error("not asked"));
  // Issue 464: no selected text is paused by a lead.
  vi.spyOn(api, "pauseTexts").mockImplementation(async (_key, action) => ({ action, applied: false, texts: 7, change_count: action === "pause" ? 7 : 0, skipped_count: action === "pause" ? 0 : 7,
    task_count: 0, still_paused_count: 0, changes: [], skipped: [], preview_token: "sha256:p" }));
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
  expect(willChangeText(reopenPreview())).toBe("5 tasks in 4 texts");
  expect(appliedText(reopenPreview({ applied: true }))).toBe("Reopened 5 tasks in 4 texts.");
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
  expect(within(dialog).getByText("Will change:").parentElement?.textContent).toBe("Will change: 5 tasks in 4 texts");

  const apply = within(dialog).getByRole("button", { name: "Reopen 5 tasks" });
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
  fireEvent.click(within(dialog).getByRole("button", { name: "Reopen 5 tasks" }));
  fireEvent.click(within(dialog).getByLabelText("I understand"));
  const fresh = reopenPreview({ changes: [task("EN100022", 1)], preview_token: "sha256:b" });
  vi.mocked(api.bulkReopen).mockRejectedValueOnce(new ApiError(409, "stale", "PREVIEW_STALE", { preview: fresh } as never));
  fireEvent.click(within(dialog).getByRole("button", { name: "Reopen 5 tasks" }));
  expect(await within(dialog).findByText("The texts changed since the preview. Check the new preview.")).toBeTruthy();
  expect(within(dialog).getByText("Reopen 1 submitted task")).toBeTruthy();
  expect(within(dialog).getByRole("button", { name: "Reopen 1 task" })).toBeTruthy();
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
  expect(items.map(item => item.textContent)).toEqual(["Reopen…", "Withdraw open tasks…No open tasks in the selected texts.", "Accept agreeing results…", "Change final…", "Start a round…", "Change mode…No selected text can change its annotation mode.",
    // Issue 464: nothing is paused, so only pausing can act.
    "Pause texts…", "Release texts…None of the selected texts is paused by a lead."]);
  expect(items[1].getAttribute("aria-disabled")).toBe("true");
  expect(items[0].getAttribute("aria-disabled")).toBeNull();
  fireEvent.click(items[0]);
  const dialog = await screen.findByRole("dialog", { name: "Reopen: 7 texts" });
  await within(dialog).findByText("Reopen 5 submitted tasks");
  fireEvent.change(within(dialog).getByLabelText("Reason (required)"), { target: { value: "Why" } });
  fireEvent.click(within(dialog).getByRole("button", { name: "Reopen 5 tasks" }));
  fireEvent.click(within(dialog).getByLabelText("I understand"));
  const undo = { id: 41, expires_at: "2026-11-15T12:00:00Z" };
  vi.mocked(api.bulkReopen).mockResolvedValueOnce(reopenPreview({ applied: true, undo }));
  fireEvent.click(within(dialog).getByRole("button", { name: "Reopen 5 tasks" }));
  expect(await screen.findByText("Reopened 5 tasks in 4 texts.")).toBeTruthy();
  expect(screen.queryByRole("dialog")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Undo" }));
  await waitFor(() => expect(api.bulkUndo).toHaveBeenCalledWith("p", 41));
  expect(await screen.findByText("The reopened tasks are submitted again.")).toBeTruthy();
});

it("Start a round… groups the preview with every reason a task is kept or a text is skipped (issue 336 step 3)", () => {
  const lines = (kind: "carry_forward" | "clean_restart") => previewGroups(roundPreview(kind)).map(group => `${group.title} · ${group.detail}`);
  expect(lines("carry_forward")).toEqual([
    "Continue 5 submitted tasks in a new round · Tom Reis 4, R. Roe 1",
    "Skip 1 text · final result chosen: use Withdraw final… first",
    "Skip 1 text · a consolidation is open: finish or withdraw it first",
    "Keep 1 open task · not submitted yet",
    "Keep 1 paused task · paused by a problem report: decide the report first",
    "Keep 1 task · not on the current version of the text: use the text card",
    "Keep 1 task · the person can no longer take it",
    "Keep 1 task · the translation is not accepted yet",
  ]);
  expect(lines("clean_restart")[0]).toBe("Restart 5 submitted tasks in a new round · Tom Reis 4, R. Roe 1");
  expect(lines("clean_restart").at(-1)).toBe("Keep 1 submitted task · no work round to restart (older or imported work): use Reopen…");
  expect(willChangeText(roundPreview())).toBe("5 tasks in 4 texts");
  expect(willChangeText(roundPreview("carry_forward", { changes: [] }))).toBe("No submitted annotation in the selected texts can start a round.");
  expect(appliedText(roundPreview("carry_forward", { applied: true }))).toBe("Started 5 rounds in 4 texts.");
  expect(unavailableReason("start_round", roundPreview())).toBeNull();
  expect(unavailableReason("start_round", roundPreview("carry_forward", { changes: [], texts: 2 }))).toBe("The selected texts have a final result or an open consolidation.");
  expect(unavailableReason("start_round", roundPreview("carry_forward", { changes: [], skipped: [] }))).toBe("No submitted annotations in the selected texts.");
});

it("Start a round… says plainly what is set aside and that it cannot be undone here", () => {
  expect(consequenceLines(roundPreview("carry_forward"))).toEqual([
    "2 people get 5 tasks back in My tasks, in a new round that starts with what they submitted.",
    "The earlier submissions no longer count as submitted: each task must be submitted again. Each person still reads their earlier rounds in the task, under More › Work rounds.",
    "This cannot be undone here. There is no way back for a single text either: the person submits the new round.",
  ]);
  expect(consequenceLines(roundPreview("clean_restart"))).toEqual([
    "2 people get 5 tasks back in My tasks, in a new round without any of the earlier findings. Tasks from tool proposals start again from the newest proposals, all open.",
    "The submitted work of these 5 tasks is set aside: it no longer counts as submitted and is not carried into the new round. Each person still reads their earlier rounds in the task, under More › Work rounds.",
    "This cannot be undone here, and no action on a single text brings the set-aside work back into the task.",
  ]);
});

it("Start a round… offers the two rounds, needs a reason only to restart, and applies with the preview's token", async () => {
  const onApplied = vi.fn();
  render(<BulkTaskDialog projectKey="p" action="start_round" rows={rows} onClose={vi.fn()} onApplied={onApplied} />);
  const dialog = await screen.findByRole("dialog", { name: "Start a round: 7 texts" });
  expect(await within(dialog).findByText("Continue 5 submitted tasks in a new round")).toBeTruthy();
  expect(api.bulkStartRound).toHaveBeenCalledWith("p", { rows, kind: "carry_forward", preview: true }, expect.any(AbortSignal));
  // Only the choices of the single action: no task kinds, no further options.
  expect(within(dialog).getAllByRole("radio").map(radio => radio.getAttribute("aria-describedby") && (radio as HTMLInputElement).labels?.[0].textContent)).toEqual(["Continue from the submission", "Restart"]);
  expect(within(dialog).queryAllByRole("checkbox")).toEqual([]);
  expect(within(dialog).getByLabelText("Reason (optional)")).toBeTruthy();

  fireEvent.click(within(dialog).getByLabelText("Restart"));
  expect(await within(dialog).findByText("Restart 5 submitted tasks in a new round")).toBeTruthy();
  const apply = within(dialog).getByRole("button", { name: "Start 5 rounds" });
  expect(apply.getAttribute("aria-disabled")).toBe("true");
  expect(within(dialog).getByText("Enter the reason first.")).toBeTruthy();
  fireEvent.change(within(dialog).getByLabelText("Reason (required)"), { target: { value: "Tool set of 10 Nov" } });
  fireEvent.click(apply);
  expect(within(dialog).getByText("What happens")).toBeTruthy();
  expect(within(dialog).getByText(/This cannot be undone here/)).toBeTruthy();
  expect(within(dialog).queryByText(/^Skip 1 text/)).toBeNull();
  expect(apply.getAttribute("aria-disabled")).toBe("true");
  fireEvent.click(within(dialog).getByLabelText("I understand — restart without the earlier findings"));
  vi.mocked(api.bulkStartRound).mockResolvedValueOnce(roundPreview("clean_restart", { applied: true }));
  fireEvent.click(apply);
  await waitFor(() => expect(onApplied).toHaveBeenCalledOnce());
  expect(api.bulkStartRound).toHaveBeenLastCalledWith("p", { rows, kind: "clean_restart", preview_token: "sha256:clean_restart", reason: "Tool set of 10 Nov" }, undefined);
});

it("Start a round… shows the fresh preview when the texts changed since (PREVIEW_STALE)", async () => {
  render(<BulkTaskDialog projectKey="p" action="start_round" rows={rows} onClose={vi.fn()} onApplied={vi.fn()} />);
  const dialog = await screen.findByRole("dialog", { name: "Start a round: 7 texts" });
  await within(dialog).findByText("Continue 5 submitted tasks in a new round");
  fireEvent.click(within(dialog).getByRole("button", { name: "Start 5 rounds" }));
  fireEvent.click(within(dialog).getByLabelText("I understand"));
  const fresh = roundPreview("carry_forward", { changes: [task("EN100022", 1)], preview_token: "sha256:b" });
  vi.mocked(api.bulkStartRound).mockRejectedValueOnce(new ApiError(409, "stale", "PREVIEW_STALE", { preview: fresh } as never));
  fireEvent.click(within(dialog).getByRole("button", { name: "Start 5 rounds" }));
  expect(await within(dialog).findByText("The texts changed since the preview. Check the new preview.")).toBeTruthy();
  expect(within(dialog).getByText("Continue 1 submitted task in a new round")).toBeTruthy();
  expect(within(dialog).getByRole("button", { name: "Start 1 round" })).toBeTruthy();
});

it("More actions starts rounds and shows a message without Undo", async () => {
  vi.spyOn(api, "selectionSummary").mockResolvedValue(summary);
  render(<Harness />);
  await waitFor(() => expect(api.bulkStartRound).toHaveBeenCalledWith("p", { rows, kind: "carry_forward", preview: true, summary_only: true }, expect.any(AbortSignal)));
  fireEvent.click(screen.getByRole("button", { name: "More actions" }));
  fireEvent.click(within(screen.getByRole("menu", { name: "More actions" })).getByRole("menuitem", { name: "Start a round…" }));
  const dialog = await screen.findByRole("dialog", { name: "Start a round: 7 texts" });
  await within(dialog).findByText("Continue 5 submitted tasks in a new round");
  fireEvent.click(within(dialog).getByRole("button", { name: "Start 5 rounds" }));
  fireEvent.click(within(dialog).getByLabelText("I understand"));
  vi.mocked(api.bulkStartRound).mockResolvedValueOnce(roundPreview("carry_forward", { applied: true }));
  fireEvent.click(within(dialog).getByRole("button", { name: "Start 5 rounds" }));
  expect(await screen.findByText("Started 5 rounds in 4 texts.")).toBeTruthy();
  expect(screen.queryByRole("button", { name: "Undo" })).toBeNull();
});
