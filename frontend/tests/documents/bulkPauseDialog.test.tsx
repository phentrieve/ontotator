import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { api, ApiError, type TextPauseActionView } from "../../src/api/client";
import { errorMessage } from "../../src/admin/errors";
import { pausedAssignText } from "../../src/admin/AssignWorkDialog";
import { consequenceLines, pausedTextsLine, previewGroups } from "../../src/documents/bulkActionModel";
import { BulkPauseDialog } from "../../src/documents/BulkPauseDialog";
import { pauseAppliedText, pauseApplyLabel, pauseConsequences, pauseGroups, pauseSummaryText, pauseUnavailableReason } from "../../src/documents/bulkPauseModel";
import { leadPauseLine, pausedWord } from "../../src/documents/labels";
import { stageText } from "../../src/documents/stageLabels";
import { pauseMarks, pauseNotice, REPORT_WAY_OUT } from "../../src/tasks/pauseLabels";

const tom = { pseudonym: "ann-1", display_name: "Tom Reis", is_me: false };
const roe = { pseudonym: "ann-2", display_name: "R. Roe", is_me: false };
const lead = { pseudonym: "ann-3", display_name: "Carla Diaz", is_me: true };
type Change = TextPauseActionView["changes"][number];
const WHY = "Source text is being clarified";
const task = (case_id: string, id: number, person = tom, paused_by_report = false): Change["tasks"][number] => ({
  assignment_id: id, document_id: `${case_id}-en`, version: 1, task: "annotate", status: "in_progress", person, paused_by_report,
});
const pause = { reason: WHY, paused_by: lead, paused_at: "2026-11-17T13:02:00Z" };
const change = (case_id: string, tasks: Change["tasks"], released = false): Change => ({ case_id, language: "en", pause: released ? pause : null, tasks });
const counted = (view: TextPauseActionView): TextPauseActionView => ({
  ...view, change_count: view.changes.length, skipped_count: view.skipped.length, task_count: view.changes.reduce((sum, item) => sum + item.tasks.length, 0),
  still_paused_count: view.action === "release" ? view.changes.reduce((sum, item) => sum + item.tasks.filter(entry => entry.paused_by_report).length, 0) : 0,
});
const pausePreview = (overrides: Partial<TextPauseActionView> = {}): TextPauseActionView => counted({
  action: "pause", applied: false, texts: 4, change_count: 0, skipped_count: 0, task_count: 0, still_paused_count: 0,
  changes: [change("EN100022", [task("EN100022", 1)]), change("EN100023", [task("EN100023", 2), task("EN100023", 3, roe)]), change("EN100025", [])],
  skipped: [{ case_id: "EN100027", language: "en", reason: "already_paused", message: "Already paused by a lead.", pause }],
  preview_token: "sha256:a", ...overrides,
});
const releasePreview = (overrides: Partial<TextPauseActionView> = {}): TextPauseActionView => counted({
  action: "release", applied: false, texts: 3, change_count: 0, skipped_count: 0, task_count: 0, still_paused_count: 0,
  changes: [change("EN100022", [task("EN100022", 1)], true), change("EN100026", [task("EN100026", 5, roe, true)], true)],
  skipped: [{ case_id: "EN100024", language: "en", reason: "not_paused", message: "Not paused by a lead.", pause: null }],
  preview_token: "sha256:r", ...overrides,
});
const rows = ["EN100022", "EN100023", "EN100025", "EN100027"].map(case_id => ({ case_id, language: "en" }));

beforeEach(() => { vi.spyOn(api, "pauseTexts").mockImplementation(async (_key, action) => action === "pause" ? pausePreview() : releasePreview()); });
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

it("groups the pause preview by consequence: work in progress, later tasks, skipped texts (issue 464)", () => {
  expect(pauseGroups(pausePreview()).map(group => `${group.tone}: ${group.title} · ${group.detail}`)).toEqual([
    "change: Pause 2 texts with 3 open tasks · Tom Reis 2, R. Roe 1",
    "change: Pause 1 text without open tasks · tasks assigned later are paused from the start",
    "skip: Skip 1 text · already paused by a lead",
  ]);
  expect(pauseSummaryText(pausePreview(), 3)).toBe("the work on 3 texts");
  expect(pauseSummaryText(pausePreview({ changes: [] }), 3)).toBe("The selected texts are already paused.");
  expect(pauseApplyLabel("pause", 3)).toBe("Pause 3 texts");
  expect(pauseAppliedText(pausePreview({ applied: true }))).toBe("Paused 3 texts.");
});

it("a release names the tasks a problem report still pauses", () => {
  expect(pauseGroups(releasePreview()).map(group => `${group.tone}: ${group.title} · ${group.detail}`)).toEqual([
    "change: Release 2 texts with 2 open tasks · R. Roe 1, Tom Reis 1",
    "keep: 1 task stays paused · paused by a problem report as well: decide the report under Problem reports",
    "skip: Skip 1 text · not paused by a lead",
  ]);
  expect(pauseConsequences(releasePreview())).toEqual([
    "1 task of 2 people can be worked on again, as they were left.",
    "1 task stays paused by a problem report until that report is decided.",
    "Pause texts… pauses them again.",
  ]);
  expect(pauseSummaryText(releasePreview({ changes: [] }), 3)).toBe("None of the selected texts is paused by a lead.");
  expect(pauseAppliedText(releasePreview({ applied: true }))).toBe("Released 2 texts.");
});

it("says what the people notice, what stays untouched and the way back", () => {
  const lines = pauseConsequences(pausePreview());
  expect(lines[0]).toMatch(/^2 people keep 3 tasks in My tasks, marked “Paused by lead” with your reason\. They can read the task but not save or submit it\./);
  expect(lines[1]).toBe("Tasks assigned, reopened or given a new round on these texts later are paused from the start, until you release the texts.");
  expect(lines[2]).toBe("Submitted work and final results are untouched and are exported as before.");
  expect(lines[3]).toMatch(/Release texts… ends it\.$/);
  expect(pauseConsequences(pausePreview({ changes: [change("EN100025", [])] }))[0]).toBe("Nobody has an open task on these texts now.");
});

it("with one text selected, the dialog summary speaks of one text (issue 585)", () => {
  expect(pauseSummaryText(pausePreview({ changes: [] }), 1)).toBe("The selected text is already paused.");
  expect(pauseSummaryText(releasePreview({ changes: [] }), 1)).toBe("The selected text is not paused by a lead.");
});

it("the menu entries name why they do nothing for the selection", () => {
  expect(pauseUnavailableReason("pause", pausePreview(), 2)).toBeNull();
  expect(pauseUnavailableReason("pause", null, 2)).toBeNull();
  expect(pauseUnavailableReason("pause", pausePreview({ changes: [] }), 2)).toBe("The selected texts are already paused.");
  expect(pauseUnavailableReason("release", releasePreview({ changes: [] }), 2)).toBe("None of the selected texts is paused by a lead.");
  // One text selected (issue 585).
  expect(pauseUnavailableReason("pause", pausePreview({ changes: [] }), 1)).toBe("The selected text is already paused.");
  expect(pauseUnavailableReason("release", releasePreview({ changes: [] }), 1)).toBe("The selected text is not paused by a lead.");
});

it("asks for the reason, shows the consequences, then pauses with the preview's token after I understand", async () => {
  const onApplied = vi.fn();
  render(<BulkPauseDialog projectKey="p" action="pause" rows={rows} onClose={vi.fn()} onApplied={onApplied} />);
  const dialog = await screen.findByRole("dialog", { name: "Pause texts: 4 texts" });
  expect(await within(dialog).findByText("Pause 2 texts with 3 open tasks")).toBeTruthy();
  expect(api.pauseTexts).toHaveBeenCalledWith("p", "pause", { rows, preview: true }, expect.any(AbortSignal));
  expect(within(dialog).getByText("Will change:").parentElement?.textContent).toBe("Will change: the work on 3 texts");
  const button = within(dialog).getByRole("button", { name: "Pause 3 texts" });
  expect(button.getAttribute("aria-disabled")).toBe("true");
  expect(within(dialog).getByText("Enter the reason first.")).toBeTruthy();
  fireEvent.change(within(dialog).getByLabelText("Reason (required)"), { target: { value: WHY } });
  fireEvent.click(button);
  expect(within(dialog).getByText("What happens")).toBeTruthy();
  expect(within(dialog).getByText(`Reason: ${WHY}`)).toBeTruthy();
  expect(within(dialog).queryByText(/^Skip 1 text/)).toBeNull();
  expect(button.getAttribute("aria-disabled")).toBe("true");
  fireEvent.click(within(dialog).getByLabelText("I understand — pause the work on these texts"));
  vi.mocked(api.pauseTexts).mockResolvedValueOnce(pausePreview({ applied: true }));
  fireEvent.click(button);
  await waitFor(() => expect(onApplied).toHaveBeenCalledOnce());
  expect(api.pauseTexts).toHaveBeenLastCalledWith("p", "pause", { rows, preview_token: "sha256:a", reason: WHY });
});

it("a release needs no reason; a stale token shows the new preview and asks again", async () => {
  const onApplied = vi.fn();
  render(<BulkPauseDialog projectKey="p" action="release" rows={rows} onClose={vi.fn()} onApplied={onApplied} />);
  const dialog = await screen.findByRole("dialog", { name: "Release texts: 4 texts" });
  const button = await within(dialog).findByRole("button", { name: "Release 2 texts" });
  expect(within(dialog).getByLabelText("Reason (optional)")).toBeTruthy();
  fireEvent.click(button);
  // The tasks a report still pauses stay in view on the consequences step.
  expect(within(dialog).getByText("1 task stays paused")).toBeTruthy();
  fireEvent.click(within(dialog).getByLabelText("I understand"));
  const fresh = releasePreview({ changes: [change("EN100022", [task("EN100022", 1)], true)], preview_token: "sha256:s" });
  vi.mocked(api.pauseTexts).mockRejectedValueOnce(new ApiError(409, "stale", "PREVIEW_STALE", { preview: fresh }));
  fireEvent.click(button);
  expect(await within(dialog).findByText("The texts changed since the preview. Check the new preview.")).toBeTruthy();
  expect(onApplied).not.toHaveBeenCalled();
  expect(within(dialog).queryByText("What happens")).toBeNull();
  expect(within(dialog).getByRole("button", { name: "Release 1 text" })).toBeTruthy();
});

it("names the cause of a paused task: the lead, a problem report, or both", () => {
  const byLead = { held: true, hold_reason: WHY, pause_causes: ["lead"] as const, lead_pause_reason: WHY };
  const both = { held: true, hold_reason: "Text is cut off", pause_causes: ["report", "lead"] as const, lead_pause_reason: WHY };
  expect(pauseMarks(byLead)).toEqual([{ cause: "lead", badge: "Paused by lead", reason: WHY }]);
  expect(pauseMarks(both).map(mark => `${mark.badge}: ${mark.reason}`)).toEqual(["Paused: Text is cut off", `Paused by lead: ${WHY}`]);
  // Responses of an older server carry no causes: a held task reads as before.
  expect(pauseMarks({ held: true, hold_reason: "Text is cut off" })).toEqual([{ cause: "report", badge: "Paused", reason: "Text is cut off" }]);
  expect(pauseNotice(byLead)).toMatchObject({ title: "Paused by lead", reason: WHY });
  expect(pauseNotice(both)).toMatchObject({ title: "Paused by a problem report and by lead", reason: `Text is cut off · Lead: ${WHY}` });
  expect(pauseNotice({ held: true, hold_reason: "Text is cut off", pause_causes: ["report"] })).toEqual({ title: "Task paused", reason: "Text is cut off", kept: REPORT_WAY_OUT });
  expect(pausedWord({ held: true, pause_causes: ["lead"] })).toBe("Paused by lead");
  expect(pausedWord({ held: true, pause_causes: ["report", "lead"] })).toBe("Paused by a problem report and by lead");
  expect(pausedWord({ held: true, pause_causes: ["report"] })).toBe("Paused");
  expect(pausedWord({ held: false })).toBeNull();
});

it("a refused save names the lead and the reason, and that the input is kept", () => {
  const refused = new ApiError(409, "API request failed with status 409", "TASK_HELD", { causes: ["lead"], reason: WHY, lead_reason: WHY, assignment_id: 7 });
  expect(errorMessage(refused)).toBe(`The project lead paused the work on this text: ${WHY}. This change was not saved; your local input is kept. You can continue when the lead releases the text.`);
  const byReport = new ApiError(409, "API request failed with status 409", "TASK_HELD", { causes: ["report"], reason: "Text is cut off", assignment_id: 7 });
  expect(errorMessage(byReport)).toBe("This task is paused. Your local input is kept; review the pause reason before continuing.");
});

it("Documents words: the stage cell, the text card line, bulk previews and the assign note", () => {
  const cell = { state: "paused", tone: "waiting", detail: { people: [lead], excerpt: WHY, note: "lead_pause", causes: [] } } as unknown as Parameters<typeof stageText>[1];
  expect(stageText("annotation", cell, { case_id: "EN100022", language: "en" })).toMatchObject({ word: "Paused by lead" });
  expect(stageText("annotation", cell, { case_id: "EN100022", language: "en" }).detail).toContain(WHY);
  expect(leadPauseLine(pause)).toMatch(new RegExp(`^you, .*: ${WHY}$`));
  expect(leadPauseLine({ ...pause, paused_by: null })).toMatch(new RegExp(`: ${WHY}$`));

  const bulkTask = { case_id: "EN100022", language: "en", assignment_id: 1, document_id: "EN100022-en", version: 1, task: "annotate" as const, person: tom };
  const reopen = { action: "reopen" as const, applied: false, texts: 2, change_count: 2, kept_count: 0, skipped_count: 0, preview_token: "t", undo: null, skipped: [],
    changes: [{ ...bulkTask, status: "submitted" as const, text_paused: true }, { ...bulkTask, case_id: "EN100023", assignment_id: 2, status: "submitted" as const, text_paused: false }], kept: [] };
  expect(pausedTextsLine(reopen)).toBe("1 task is on 1 text paused by a lead: it stays paused, marked “Paused by lead” in My tasks, until you release the text.");
  expect(consequenceLines(reopen).at(-1)).toBe(pausedTextsLine(reopen));
  expect(pausedTextsLine({ ...reopen, changes: [reopen.changes[1]] })).toBeNull();
  const withdraw = { ...reopen, action: "withdraw" as const, changes: [], change_count: 0, kept_count: 1,
    kept: [{ ...bulkTask, status: "in_progress" as const, reason: "paused_by_lead", message: "Paused by a lead; release the text first." }] };
  expect(previewGroups(withdraw).map(group => `${group.title} · ${group.detail}`)).toEqual(["Keep 1 paused task · paused by a lead: release the text first"]);

  expect(pausedAssignText(1, true)).toBe("This text is paused by a lead. A task assigned now is paused from the start (“Paused by lead” in My tasks) until you release the text.");
  expect(pausedAssignText(2, false)).toBe("2 of the selected texts are paused by a lead. Tasks assigned there are paused from the start (“Paused by lead” in My tasks) until you release the texts.");
});
