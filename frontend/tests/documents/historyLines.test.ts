import { describe, expect, it } from "vitest";
import { historyLines } from "../../src/documents/historyLines";
import { final, item, recordedVersion, row, stageCell, stages, submission, version, work } from "./fixtures";

// Local times (no zone suffix): the history shows the browser's time like every other time in the app.
const now = new Date("2026-10-21T23:00:00");
const ana = { pseudonym: "ann-0003", display_name: "Ana Weber", is_me: false };
const tom = { pseudonym: "ann-0004", display_name: "Tom Reis", is_me: false };
const luc = { pseudonym: "ann-0005", display_name: "Luc Martin", is_me: false };

/** case-201 de: Ana accepted v1 unchanged, Tom submitted Round 1, Luc annotates, the lead chose the final. */
function walkthroughRow() {
  return row({
    case_id: "case-201", language: "de",
    versions: [version({ document_id: "case-201-de", origin: "machine_translation", translation_status: "accepted", latest_review_decision: "accepted_unchanged" })],
    work: [
      work({ assignment_id: 1, document_id: "case-201-de", task: "translation_review", status: "submitted", author_label: "ann-0003", person: ana }),
      work({ assignment_id: 2, document_id: "case-201-de", status: "submitted", author_label: "ann-0004", person: tom, round_ordinal: 1 }),
      work({ assignment_id: 3, document_id: "case-201-de", status: "in_progress", author_label: "ann-0005", person: luc, round_ordinal: 1 }),
    ],
    stages: stages({ review: stageCell("accepted", "done", { people: [ana], at: "2026-10-20T22:09:00", note: "unchanged" }) }),
    final: final({ case_id: "case-201", language: "de", document_id: "case-201-de", submission_id: "s-tom", selected_by: "lead-0002", selected_at: "2026-10-20T22:20:00" }),
  });
}
const tomSubmission = submission({ submission_id: "s-tom", document_id: "case-201-de", author_label: "ann-0004", author: tom, round_ordinal: 1, finding_count: 1, recorded_at: "2026-10-21T22:15:00" });

describe("historyLines", () => {
  it("writes one line per stage as the spec examples", () => {
    const lines = historyLines(walkthroughRow(), [tomSubmission], { me: "lead-0002", now });
    expect(lines.map(line => line.text)).toEqual([
      "Review: Ana Weber (ann-0003), Accepted unchanged, 20 Oct, 22:09",
      "Annotation: Tom Reis (ann-0004), Round 1, 1 finding, 21 Oct, 22:15",
      "Annotation: Luc Martin (ann-0005), Round 1, In progress",
      "Final: chosen by you, 20 Oct, 22:20",
    ]);
  });

  it("an acknowledged annotation adds its line", () => {
    const line = "Annotation assigned before the translation review was accepted (confirmed by Ana Weber (ann-0003))";
    const flagged = (status: "in_progress" | "submitted", assigned_by: typeof ana | null = ana) => row({
      case_id: "case-202", language: "de",
      versions: [version({ document_id: "case-202-de", origin: "machine_translation" })],
      work: [work({ assignment_id: 7, document_id: "case-202-de", status, author_label: "ann-0004", person: tom, assigned_by, unreviewed_translation: true })],
    });
    const open = historyLines(flagged("in_progress"), null, { now });
    expect(open.find(entry => entry.key === "unreviewed-7")).toEqual({ key: "unreviewed-7", stage: "annotation", text: line });
    const submitted = historyLines(flagged("submitted"), [submission({ submission_id: "s-7", document_id: "case-202-de", author_label: "ann-0004", author: tom, recorded_at: "2026-10-21T22:15:00" })], { now });
    expect(submitted.map(entry => entry.text)).toContain(line);
    expect(historyLines(flagged("in_progress", null), null, { now }).map(entry => entry.text))
      .toContain("Annotation assigned before the translation review was accepted (confirmed by the lead)");
  });

  it("tags every line with its stage for the row panel's Activity filter", () => {
    const lines = historyLines(walkthroughRow(), [tomSubmission], { me: "lead-0002", now });
    expect(lines.map(line => line.stage)).toEqual(["review", "annotation", "annotation", "final"]);
  });

  it("names another lead and falls back to the work items while submissions load", () => {
    const lines = historyLines(walkthroughRow(), null, { me: "lead-0009", now });
    expect(lines.map(line => line.text)).toEqual([
      "Review: Ana Weber (ann-0003), Accepted unchanged, 20 Oct, 22:09",
      "Annotation: Tom Reis (ann-0004), Round 1, Submitted",
      "Annotation: Luc Martin (ann-0005), Round 1, In progress",
      "Final: chosen by lead-0002, 20 Oct, 22:20",
    ]);
  });

  it("words corrections, moved work, consolidations, pauses and acceptances", () => {
    const v1 = version({ document_id: "c-de", origin: "machine_translation", translation_status: "reviewed", latest_review_decision: "accepted_corrected", is_newest_in_chain: false });
    const v2 = recordedVersion({
      document_id: "c-de-v2", chain_id: "c-de", version: 2, origin: "correction", derived_from: "c-de", translation_status: "accepted",
      acceptance: { source: "lead", reason: "Checked", accepted_at: null, accepted_by: null },
    });
    const target = row({
      case_id: "c", language: "de", versions: [v1, v2],
      work: [
        work({ assignment_id: 1, document_id: "c-de", task: "translation_review", status: "submitted", author_label: "ann-0003", person: ana }),
        work({ assignment_id: 3, document_id: "c-de-v2", task: "review", status: "open", author_label: "ann-0003", person: ana, held: true }),
      ],
      moved_work: [work({ assignment_id: 2, document_id: "c-de", status: "in_progress", author_label: "ann-0005", person: luc, moved_to_version: 2 })],
      notes: [item({ code: "TASK_ON_HOLD", cause_id: "hold-3", author_label: "ann-0003", report_id: "rep-3" })],
    });
    const consolidation = submission({ submission_id: "s-c", document_id: "c-de-v2", version: 2, kind: "consolidation", author_label: "ann-0003", author: ana, round_ordinal: null, finding_count: 3, recorded_at: "2026-10-21T09:00:00" });
    const lines = historyLines(target, [consolidation], { now });
    expect(lines.map(line => line.text)).toEqual([
      "Review: Ana Weber (ann-0003), Accepted with corrections, v1 → v2",
      "Review: Accepted: reviewed outside Ontotator, Checked",
      "Consolidation: Ana Weber (ann-0003), 3 findings, v2, 21 Oct, 09:00",
      "Consolidation: Ana Weber (ann-0003), Open, Paused",
      "Annotation: Luc Martin (ann-0005), moved to v2",
      "Task paused: ann-0003",
    ]);
    expect(lines.at(-1)?.reportId).toBe("rep-3");
    // A consolidation is Finalization work (review 2, F2): its lines are not filed under Annotation.
    expect(lines.map(line => line.stage)).toEqual(["review", "review", "final", "final", "annotation", "annotation"]);
  });

  it("is empty for a row without work, records or final", () => {
    expect(historyLines(row({ case_id: "c", language: "de" }), [], { now })).toEqual([]);
  });

  it("says how many findings a consolidation kept automatically (all matched)", () => {
    const consolidation = (kept: number) => submission({ submission_id: `c-${kept}`, document_id: "case-201-de", author_label: "rev-0005", author: luc,
      kind: "consolidation", round_ordinal: null, finding_count: 6, recorded_at: "2026-10-21T22:30:00", kept_automatically: kept });
    const four = historyLines(walkthroughRow(), [consolidation(4)], { now }).find(line => line.key === "submission-c-4")!;
    expect(four.text).toBe("Consolidation: Luc Martin (ann-0005), 6 findings, 4 kept automatically (all matched), 21 Oct, 22:30");
    const none = historyLines(walkthroughRow(), [consolidation(0)], { now }).find(line => line.key === "submission-c-0")!;
    expect(none.text).not.toContain("kept automatically");
  });
});

describe("reassignments and mode changes", () => {
  const anna = { pseudonym: "ann-1", display_name: "Anna Early", is_me: false };
  const ben = { pseudonym: "ann-2", display_name: "Ben Roth", is_me: false };
  const now = new Date("2026-10-31T12:00:00");
  const emptyRow = { versions: [], work: [], moved_work: [], issues: [], notes: [], final: null, stages: null } as unknown as Parameters<typeof historyLines>[0];
  it("lists a reassignment on its stage and a mode change with its reason", () => {
    const lines = historyLines(emptyRow, [], { now, changes: [
      { kind: "reassigned", at: "2026-10-31T10:00:00", task: "annotate", from_person: anna, to_person: ben },
      { kind: "reassigned", at: "2026-10-31T10:05:00", task: "translation_review", from_person: ben, to_person: anna },
      { kind: "mode_changed", at: "2026-10-31T10:10:00", from_mode: "proposals", to_mode: "scratch", reason: "The tool proposals were wrong", by: { ...anna, is_me: true } },
    ] });
    expect(lines.map(line => [line.stage, line.text])).toEqual([
      ["annotation", "Annotation: reassigned from Anna Early (ann-1) to Ben Roth (ann-2), 31 Oct, 10:00"],
      ["review", "Review: reassigned from Ben Roth (ann-2) to Anna Early (ann-1), 31 Oct, 10:05"],
      ["annotation", "Annotation: mode changed by you, now annotated from scratch, 31 Oct, 10:10: The tool proposals were wrong"],
    ]);
  });
  it("lists a withdrawn final result with the lead and the reason (issue 343)", () => {
    const lines = historyLines(emptyRow, [], { now, changes: [
      { kind: "final_withdrawn", at: "2026-10-31T10:20:00", from_person: { ...anna, is_me: true }, reason: "Re-annotation" },
    ] });
    expect(lines.map(line => [line.stage, line.text])).toEqual([["final", "Final: withdrawn by you, 31 Oct, 10:20: Re-annotation"]]);
  });
  it("keeps a line for a pause of the text and one for its release (review 2, F6)", () => {
    const lead = { pseudonym: "lead-1", display_name: "Carla Diaz", is_me: true };
    const changes = [
      { kind: "text_paused", at: "2026-10-30T09:00:00", by: lead, reason: "Source is checked" },
      { kind: "text_released", at: "2026-10-30T11:30:00", by: { ...lead, is_me: false }, reason: null },
    ] as const;
    // After the release: both lines stay.
    expect(historyLines(emptyRow, [], { now, changes }).map(line => [line.stage, line.text])).toEqual([
      ["text", "Text: paused by you, 30 Oct, 09:00: Source is checked"],
      ["text", "Text: released by Carla Diaz (lead-1), 30 Oct, 11:30"],
    ]);
    // While paused: the event line, not a second line from the row; without the events, the row's pause.
    const paused = { ...emptyRow, lead_pause: { reason: "Source is checked", paused_by: lead, paused_at: "2026-10-30T09:00:00" } };
    expect(historyLines(paused, [], { now, changes: changes.slice(0, 1) }).map(line => line.text)).toEqual(["Text: paused by you, 30 Oct, 09:00: Source is checked"]);
    expect(historyLines(paused, null, { now }).map(line => [line.stage, line.text])).toEqual([["text", "Text: paused by you, 30 Oct, 09:00: Source is checked"]]);
  });
  it("names who reopened a task or started a round, when and why", () => {
    const lead = { pseudonym: "lead-1", display_name: "Carla Diaz", is_me: true };
    const lines = historyLines(emptyRow, [], { now, changes: [
      { kind: "reopened", at: "2026-10-30T09:00:00", task: "annotate", assignment_id: 7, by: lead, to_person: ben, reason: "Guideline changed" },
      { kind: "reopen_undone", at: "2026-10-30T09:02:00", task: "annotate", assignment_id: 7, by: lead, to_person: ben },
      { kind: "reopened", at: "2026-10-30T09:05:00", task: "translation_review", assignment_id: 8, by: { ...lead, is_me: false }, to_person: anna, reason: null },
      { kind: "round_started", at: "2026-10-30T09:10:00", task: "annotate", assignment_id: 7, round_ordinal: 2, by: lead, to_person: ben, reason: "Second pass" },
      { kind: "round_started", at: "2026-10-30T09:20:00", task: "annotate", assignment_id: 7, round_ordinal: 3, by: ben, to_person: ben, reason: null },
    ] });
    expect(lines.map(line => [line.stage, line.text])).toEqual([
      ["annotation", "Annotation: task of Ben Roth (ann-2) reopened by you, 30 Oct, 09:00: Guideline changed"],
      ["annotation", "Annotation: reopening of the task of Ben Roth (ann-2) undone by you, 30 Oct, 09:02"],
      ["review", "Review: task of Anna Early (ann-1) reopened by Carla Diaz (lead-1), 30 Oct, 09:05"],
      ["annotation", "Annotation: Round 2 for Ben Roth (ann-2) started by you, 30 Oct, 09:10: Second pass"],
      ["annotation", "Annotation: Round 3 started by Ben Roth (ann-2), 30 Oct, 09:20"],
    ]);
  });
  it("names the final result when it is chosen, replaced and when a change is undone; the summary line goes", () => {
    const lead = { pseudonym: "lead-1", display_name: "Carla Diaz", is_me: true };
    const a = { author: anna, consolidation: false };
    const b = { author: ben, consolidation: true };
    const row = { ...emptyRow, final: { selected_by: "lead-1", selected_at: "2026-10-29T08:00:00" } } as unknown as Parameters<typeof historyLines>[0];
    const lines = historyLines(row, [], { now, me: "lead-1", changes: [
      { kind: "final_chosen", at: "2026-10-29T08:00:00", by: { ...lead, is_me: false }, to_result: a },
      { kind: "final_changed", at: "2026-10-30T13:35:00", by: lead, from_result: a, to_result: b },
      { kind: "final_restored", at: "2026-10-30T13:36:00", by: lead, from_result: b, to_result: a },
      { kind: "final_changed", at: "2026-10-30T13:40:00", by: lead, from_result: a, to_result: null },
    ] });
    expect(lines.map(line => [line.stage, line.text])).toEqual([
      ["final", "Final: the result of Anna Early (ann-1) chosen by Carla Diaz (lead-1), 29 Oct, 08:00"],
      ["final", "Final: changed from the result of Anna Early (ann-1) to the consolidation by Ben Roth (ann-2) by you, 30 Oct, 13:35"],
      ["final", "Final: change undone by you, the result of Anna Early (ann-1) is final again, 30 Oct, 13:36"],
      ["final", "Final: changed from the result of Anna Early (ann-1) to another result by you, 30 Oct, 13:40"],
    ]);
    // Without the events (not loaded yet) the one line of the row stays.
    expect(historyLines(row, null, { now, me: "lead-1" }).map(line => line.text)).toEqual(["Final: chosen by you, 29 Oct, 08:00"]);
  });
  it("review 2, F6: a typo fix is one line with who, when and the reason", () => {
    const lead = { pseudonym: "ann-0001", display_name: "Project Lead", is_me: true };
    const fix = (by: typeof lead | null, reason: string) => ({ reason, previous_document_id: "c-de", inserted_characters: 1, deleted_characters: 1, corrected_at: "2026-10-21T17:24:00", corrected_by: by });
    const target = row({
      case_id: "c", language: "de",
      versions: [
        version({ document_id: "c-de", origin: "machine_translation", translation_status: "reviewed", latest_review_decision: "query", is_newest_in_chain: false }),
        version({ document_id: "c-de-v2", version: 2, origin: "correction", derived_from: "c-de", translation_status: "reviewed", latest_review_decision: "query", is_newest_in_chain: false, editorial_correction: fix(lead, "Typo; Grammar") }),
        version({ document_id: "c-de-v3", version: 3, origin: "correction", derived_from: "c-de-v2", translation_status: "reviewed", latest_review_decision: "query", editorial_correction: { ...fix(luc, " Spacing "), previous_document_id: "c-de-v2" } }),
      ],
      work: [work({ assignment_id: 1, document_id: "c-de", task: "translation_review", status: "submitted", author_label: "ann-0003", person: ana })],
    });
    const lines = historyLines(target, [], { now });
    expect(lines.map(line => [line.stage, line.text])).toEqual([
      ["review", "Review: Ana Weber (ann-0003), Query"],
      ["review", "Review: typos fixed in v2 by you, 21 Oct, 17:24: Typo; Grammar"],
      ["review", "Review: typos fixed in v3 by Luc Martin (ann-0005), 21 Oct, 17:24: Spacing"],
    ]);
  });
});
