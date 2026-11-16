import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { useState } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { api, ApiError, type AcceptAgreeingView, type BulkChangeFinalView, type BulkTaskActionView, type SelectionSummary } from "../../src/api/client";
import { BulkFinalDialog } from "../../src/documents/BulkFinalDialog";
import { finalAppliedText, finalConsequences, finalGroups, finalSummaryText, finalUnavailableReason } from "../../src/documents/bulkFinalModel";
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
    skipped: [skip("EN100027", "already_newest"), skip("EN100028", "no_final"), skip("EN100029", "no_final")],
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
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

it("groups Change final… by the kind of the new result, with people, and the skipped texts by reason (decision 336-B)", () => {
  const groups = finalGroups({ action: "change", data: changePreview() });
  expect(groups.map(group => `${group.tone}: ${group.title} · ${group.detail}`)).toEqual([
    "change: Use the newest consolidation for 1 text · R. Roe 1",
    "change: Use the newest annotation for 4 texts · Tom Reis 3, R. Roe 1",
    "skip: Skip 1 text · the final result already is the newest submission",
    "skip: Skip 2 texts · no final result yet: use Accept agreeing results… or the text card",
  ]);
  expect(groups[1].texts).toEqual(["EN100023 en", "EN100024 en", "EN100025 en", "EN100026 en"]);
  expect(finalSummaryText({ action: "change", data: changePreview() })).toBe("the final result of 5 texts");
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
  expect(finalSummaryText({ action: "accept", data: acceptPreview() })).toBe("2 texts");
  expect(finalAppliedText({ action: "accept", data: acceptPreview() })).toBe("Accepted the results of 2 texts.");
});

it("the consequences say that there is no Undo and name uncompared annotations", () => {
  const lines = finalConsequences({ action: "change", data: changePreview() });
  expect(lines[0]).toBe("5 texts get the newest submission as final result. The earlier final result stays in each text's history.");
  expect(lines[1]).toBe("In 1 text the newest submission is one of several annotations; it becomes final without comparing them.");
  expect(lines.at(-1)).toBe("This cannot be undone here; Change final… in a text card sets one text back.");
  expect(finalConsequences({ action: "change", data: changePreview({ changes: [change("a", "consolidation", roe, 3)] }) })).toHaveLength(3);
  expect(finalConsequences({ action: "accept", data: acceptPreview() }).at(-1)).toBe("This cannot be undone here; use Withdraw final… or Change final… in a text card.");
});

it("a menu entry that does nothing names the reason (decision 336-C)", () => {
  expect(finalUnavailableReason(null)).toBeNull();
  expect(finalUnavailableReason({ action: "change", data: changePreview() })).toBeNull();
  expect(finalUnavailableReason({ action: "change", data: changePreview({ changes: [], skipped: [skip("a", "no_final")] }) })).toBe("The selected texts have no final result yet.");
  expect(finalUnavailableReason({ action: "change", data: changePreview({ changes: [], skipped: [skip("a", "no_final"), skip("b", "already_newest")] }) }))
    .toBe("No selected text has a newer submission than its final result.");
  expect(finalUnavailableReason({ action: "accept", data: acceptPreview() })).toBeNull();
  expect(finalUnavailableReason({ action: "accept", data: acceptPreview({ texts: [], skipped: [] }) })).toBe("The selected texts already have a final result: use Change final….");
  expect(finalUnavailableReason({ action: "accept", data: acceptPreview({ texts: [] }) })).toBe("No selected text has annotations that agree in full.");
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
  expect(items.slice(2).map(item => item.textContent)).toEqual(["Accept agreeing results…", "Change final…The selected texts have no final result yet."]);
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
