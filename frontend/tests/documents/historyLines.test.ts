import { describe, expect, it } from "vitest";
import { historyLines } from "../../src/documents/historyLines";
import { final, item, recordedVersion, row, stageCell, stages, submission, version, work } from "./fixtures";

// Local times (no zone suffix): the history shows the browser's time like every other time in the app.
const now = new Date("2026-10-21T23:00:00");
const ana = { pseudonym: "ann-0003", display_name: "Ana Weber", is_me: false };
const tom = { pseudonym: "ann-0004", display_name: "Tom Reis", is_me: false };
const luc = { pseudonym: "ann-0005", display_name: "Luc Martin", is_me: false };
const lead = { pseudonym: "lead-0002", display_name: "Project Lead", is_me: false };

/** case-201 de: Ana accepted v1 unchanged, Tom submitted Round 1, Luc annotates, the lead chose the final. */
function walkthroughRow() {
  return row({
    case_id: "case-201", language: "de",
    versions: [version({ document_id: "case-201-de", origin: "machine_translation", translation_status: "accepted", latest_review_decision: "accepted_unchanged" })],
    work: [
      work({ assignment_id: 1, document_id: "case-201-de", task: "translation_review", status: "submitted", author_label: "ann-0003", person: ana }),
      work({ assignment_id: 2, document_id: "case-201-de", status: "submitted", author_label: "ann-0004", person: tom, round_ordinal: 1, assigned_at: "2026-10-20T21:00:00", assigned_by: lead }),
      work({ assignment_id: 3, document_id: "case-201-de", status: "in_progress", author_label: "ann-0005", person: luc, round_ordinal: 1, assigned_at: "2026-10-21T08:00:00", assigned_by: lead }),
    ],
    stages: stages({ review: stageCell("accepted", "done", { people: [ana], at: "2026-10-20T22:09:00", note: "unchanged" }) }),
    final: final({ case_id: "case-201", language: "de", document_id: "case-201-de", submission_id: "s-tom", selected_by: "lead-0002", selected_at: "2026-10-20T22:20:00" }),
  });
}
const tomSubmission = submission({ submission_id: "s-tom", document_id: "case-201-de", author_label: "ann-0004", author: tom, round_ordinal: 1, finding_count: 1, recorded_at: "2026-10-21T22:15:00" });

describe("historyLines", () => {
  it("writes one line per review, submission, open task and the final, in time order (issue 545)", () => {
    const lines = historyLines(walkthroughRow(), [tomSubmission], { me: "lead-0002", now });
    expect(lines.map(line => line.text)).toEqual([
      "Review: Ana Weber (ann-0003), Accepted unchanged, 20 Oct, 22:09",
      "Final: chosen by you, 20 Oct, 22:20",
      "Annotation: Luc Martin (ann-0005), Round 1, In progress, assigned by Project Lead (lead-0002), 21 Oct, 08:00",
      "Annotation: Tom Reis (ann-0004), Round 1, 1 finding, 21 Oct, 22:15",
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
    expect(open.find(entry => entry.key === "unreviewed-7")).toEqual({ key: "unreviewed-7", stage: "annotation", at: null, text: line });
    const submitted = historyLines(flagged("submitted"), [submission({ submission_id: "s-7", document_id: "case-202-de", author_label: "ann-0004", author: tom, recorded_at: "2026-10-21T22:15:00" })], { now });
    expect(submitted.map(entry => entry.text)).toContain(line);
    expect(historyLines(flagged("in_progress", null), null, { now }).map(entry => entry.text))
      .toContain("Annotation assigned before the translation review was accepted (confirmed by the lead)");
  });

  it("tags every line with its stage for the row panel's Activity filter", () => {
    const lines = historyLines(walkthroughRow(), [tomSubmission], { me: "lead-0002", now });
    expect(lines.map(line => line.stage)).toEqual(["review", "final", "annotation", "annotation"]);
  });

  it("names another lead and falls back to the work items while submissions load", () => {
    const lines = historyLines(walkthroughRow(), null, { me: "lead-0009", now });
    expect(lines.map(line => line.text)).toEqual([
      "Annotation: Tom Reis (ann-0004), Round 1, Submitted, assigned by Project Lead (lead-0002), 20 Oct, 21:00",
      "Review: Ana Weber (ann-0003), Accepted unchanged, 20 Oct, 22:09",
      "Final: chosen by lead-0002, 20 Oct, 22:20",
      "Annotation: Luc Martin (ann-0005), Round 1, In progress, assigned by Project Lead (lead-0002), 21 Oct, 08:00",
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
    // Lines without a time stand first (oldest), in the order they are written.
    expect(lines.map(line => line.text)).toEqual([
      "Review: Ana Weber (ann-0003), Accepted with corrections, v1 → v2",
      "Review: Accepted: reviewed outside Ontotator, Checked",
      "Consolidation: Ana Weber (ann-0003), Open, Paused",
      "Annotation: Luc Martin (ann-0005), moved to v2",
      "Task paused: ann-0003",
      "Consolidation: Ana Weber (ann-0003), 3 findings, v2, 21 Oct, 09:00",
    ]);
    expect(lines.find(line => line.key === "hold-hold-3")?.reportId).toBe("rep-3");
    // A consolidation is Finalization work (review 2, F2): its lines are not filed under Annotation.
    expect(lines.map(line => line.stage)).toEqual(["review", "review", "final", "annotation", "annotation", "final"]);
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
  it("names an annotation that moved to a typo fix by itself (issue 465)", () => {
    const lines = historyLines(emptyRow, [], { now, changes: [
      { kind: "carried_by_typo_fix", at: "2026-10-30T09:00:00", task: "annotate", assignment_id: 9, by: null, to_person: ben, from_version: 1, to_version: 2 },
    ] });
    expect(lines.map(line => [line.stage, line.text])).toEqual([
      ["annotation", "Annotation: annotation of Ben Roth (ann-2) moved to v2 by itself after the typo fix, 30 Oct, 09:00"],
    ]);
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
  it("issue 483: the lead's decision on a query is one line with who, when and the answer", () => {
    const lead = { pseudonym: "ann-0001", display_name: "Project Lead", is_me: true };
    const ana = { pseudonym: "ann-0003", display_name: "Ana Weber", is_me: false };
    const decision = { decided_document_id: "c-de", reviewed_document_id: "c-de", reviewer_assignment_id: 1, decided_at: "2026-10-21T17:24:00", decided_by: lead };
    const review = work({ assignment_id: 1, document_id: "c-de", task: "translation_review", status: "submitted", author_label: "ann-0003", person: ana });
    const taken = row({
      case_id: "c", language: "de",
      versions: [
        version({ document_id: "c-de", origin: "machine_translation", translation_status: "reviewed", latest_review_decision: "query", is_newest_in_chain: false }),
        version({ document_id: "c-de-v2", version: 2, origin: "correction", derived_from: "c-de", translation_status: "accepted", query_decision: { ...decision, kind: "reviewer_text", answer: "Yes, as proposed.", edited: false } }),
      ],
      work: [review],
    });
    expect(historyLines(taken, [], { now }).map(line => [line.stage, line.text])).toEqual([
      ["review", "Review: Ana Weber (ann-0003), Query"],
      ["review", "Review: query decided by you, the reviewer’s text taken, v1 → v2, 21 Oct, 17:24: Yes, as proposed."],
    ]);
    const kept = row({
      case_id: "c", language: "de",
      versions: [version({ document_id: "c-de", origin: "machine_translation", translation_status: "accepted", latest_review_decision: "query",
        query_decision: { ...decision, kind: "unchanged", answer: "The short form is meant.", edited: false, decided_by: { ...lead, is_me: false } } })],
      work: [review],
    });
    expect(historyLines(kept, [], { now }).map(line => line.text)).toEqual([
      "Review: Ana Weber (ann-0003), Query",
      "Review: query decided by Project Lead (ann-0001), v1 accepted as it is, 21 Oct, 17:24: The short form is meant.",
    ]);
    const edited = { ...taken, versions: [taken.versions[0], { ...taken.versions[1], query_decision: { ...decision, kind: "reviewer_text" as const, answer: null, edited: true } }] };
    expect(historyLines(edited, [], { now }).at(-1)?.text).toBe("Review: query decided by you, the reviewer’s text taken with changes, v1 → v2, 21 Oct, 17:24");
  });

  it("issue 483: a correction request and each addition to its reason are lines of their own", () => {
    const lead = { pseudonym: "lead-1", display_name: "Carla Diaz", is_me: true };
    const lines = historyLines(emptyRow, [], { now, changes: [
      { kind: "correction_requested", at: "2026-10-30T09:00:00", task: "translation_review", assignment_id: 8, by: lead, to_person: anna, reason: "Check the dose." },
      { kind: "correction_reason_added", at: "2026-10-30T09:30:00", task: "translation_review", assignment_id: 8, by: { ...lead, is_me: false }, to_person: anna, reason: "Paragraph 3 as well." },
    ] });
    expect(lines.map(line => [line.stage, line.text])).toEqual([
      ["review", "Review: correction requested from Anna Early (ann-1) by you, 30 Oct, 09:00: Check the dose."],
      ["review", "Review: addition to the correction request for Anna Early (ann-1) by Carla Diaz (lead-1), 30 Oct, 09:30: Paragraph 3 as well."],
    ]);
  });
});

describe("time order, times and authors (issue 545)", () => {
  const now = new Date("2026-11-20T18:00:00");
  const me = { pseudonym: "lead-1", display_name: "Demo Lead", is_me: true };
  const reviewer = { pseudonym: "rev-1", display_name: "Rita Rev", is_me: false };

  it("U2-02: a query, its decision, a correction request and the corrected review stand in time order, each with its time", () => {
    const target = row({
      case_id: "synthetic-ready", language: "de",
      versions: [
        version({ document_id: "r-v1", origin: "machine_translation", translation_status: "reviewed", latest_review_decision: "query", is_newest_in_chain: false }),
        version({ document_id: "r-v2", version: 2, origin: "correction", derived_from: "r-v1", translation_status: "reviewed", latest_review_decision: "accepted_corrected", is_newest_in_chain: false,
          query_decision: { kind: "reviewer_text", decided_document_id: "r-v1", reviewed_document_id: "r-v1", reviewer_assignment_id: 1, answer: null, edited: false, decided_at: "2026-11-20T15:57:00", decided_by: me } }),
        version({ document_id: "r-v3", version: 3, origin: "correction", derived_from: "r-v2", translation_status: "accepted" }),
      ],
      work: [
        work({ assignment_id: 1, document_id: "r-v1", task: "translation_review", status: "submitted", author_label: "rev-1", person: reviewer, submitted_at: "2026-11-20T15:55:00" }),
        work({ assignment_id: 2, document_id: "r-v2", task: "translation_review", status: "submitted", author_label: "rev-1", person: reviewer, submitted_at: "2026-11-20T16:03:00" }),
      ],
    });
    const lines = historyLines(target, [], { now, changes: [
      { kind: "correction_requested", at: "2026-11-20T16:02:00", task: "translation_review", assignment_id: 2, by: me, to_person: reviewer, reason: "Check the dose." },
      { kind: "correction_reason_added", at: "2026-11-20T16:02:30", task: "translation_review", assignment_id: 2, by: me, to_person: reviewer, reason: "Paragraph 3 too." },
    ] });
    expect(lines.map(line => line.text)).toEqual([
      "Review: Rita Rev (rev-1), Query, 20 Nov, 15:55",
      "Review: query decided by you, the reviewer’s text taken, v1 → v2, 20 Nov, 15:57",
      "Review: correction requested from Rita Rev (rev-1) by you, 20 Nov, 16:02: Check the dose.",
      "Review: addition to the correction request for Rita Rev (rev-1) by you, 20 Nov, 16:02: Paragraph 3 too.",
      "Review: Rita Rev (rev-1), Accepted with corrections, v2 → v3, 20 Nov, 16:03",
    ]);
  });

  it("U3-05: an open consolidation names who started it and when; a reopening stands before later submissions", () => {
    const ben = { pseudonym: "ann-2", display_name: "Ben Clausen", is_me: false };
    const cara = { pseudonym: "ann-7", display_name: "Cara Dietz", is_me: false };
    const target = row({
      case_id: "u3-case-05", language: "de",
      versions: [version({ document_id: "u3-de", origin: "machine_translation", translation_status: "accepted" })],
      work: [
        work({ assignment_id: 4, document_id: "u3-de", status: "submitted", author_label: "ann-2", person: ben, round_ordinal: 2 }),
        work({ assignment_id: 5, document_id: "u3-de", task: "review", status: "open", author_label: "ann-7", person: cara, round_ordinal: 1, assigned_at: "2026-11-20T16:13:00", assigned_by: me }),
      ],
    });
    const submitted = submission({ submission_id: "s-ben-2", document_id: "u3-de", author_label: "ann-2", author: ben, round_ordinal: 2, finding_count: 2, recorded_at: "2026-11-20T16:12:00" });
    const lines = historyLines(target, [submitted], { now, changes: [
      { kind: "reopened", at: "2026-11-20T16:10:00", task: "annotate", assignment_id: 4, by: me, to_person: ben, reason: null },
      { kind: "text_paused", at: "2026-11-20T16:14:00", by: me, reason: "Source is checked" },
      { kind: "text_released", at: "2026-11-20T16:16:00", by: me, reason: null },
    ] });
    expect(lines.map(line => line.text)).toEqual([
      "Annotation: task of Ben Clausen (ann-2) reopened by you, 20 Nov, 16:10",
      "Annotation: Ben Clausen (ann-2), Round 2, 2 findings, 20 Nov, 16:12",
      "Consolidation: Cara Dietz (ann-7), Round 1, Open, started by you, 20 Nov, 16:13",
      "Text: paused by you, 20 Nov, 16:14: Source is checked",
      "Text: released by you, 20 Nov, 16:16",
    ]);
  });

  it("U4-09: the mode change, the typo fix and the annotations it moved stand in time order; the copies are no lines of their own", () => {
    const anna = { pseudonym: "ann-4", display_name: "Anna Kühn", is_me: false };
    const fix = { reason: "Typo", previous_document_id: "t-v1", inserted_characters: 1, deleted_characters: 0, corrected_at: "2026-11-20T15:58:00", corrected_by: me };
    const target = row({
      case_id: "synthetic-accepted", language: "de",
      versions: [
        version({ document_id: "t-v1", origin: "machine_translation", translation_status: "accepted", is_newest_in_chain: false }),
        version({ document_id: "t-v2", version: 2, origin: "correction", derived_from: "t-v1", translation_status: "accepted", editorial_correction: fix }),
      ],
      work: [work({ assignment_id: 9, document_id: "t-v2", version: 2, status: "submitted", author_label: "ann-4", person: anna, round_ordinal: 1 })],
    });
    const own = submission({ submission_id: "s-anna", document_id: "t-v1", author_label: "ann-4", author: anna, round_ordinal: 1, finding_count: 3, recorded_at: "2026-11-20T15:56:00" });
    const copy = submission({ submission_id: "s-anna-v2", document_id: "t-v2", version: 2, kind: "carry_forward", author_label: "ann-4", author: anna, round_ordinal: 1, finding_count: 3,
      recorded_at: "2026-11-20T15:58:00", moved_by_typo_fix: true });
    const lines = historyLines(target, [copy, own], { now, changes: [
      { kind: "mode_changed", at: "2026-11-20T15:55:00", from_mode: "proposals", to_mode: "scratch", reason: "No proposals", by: me },
      { kind: "carried_by_typo_fix", at: "2026-11-20T15:58:00", task: "annotate", assignment_id: 9, by: null, to_person: anna, from_version: 1, to_version: 2 },
    ] });
    expect(lines.map(line => line.text)).toEqual([
      "Annotation: mode changed by you, now annotated from scratch, 20 Nov, 15:55: No proposals",
      "Annotation: Anna Kühn (ann-4), Round 1, 3 findings, v1, 20 Nov, 15:56",
      "Review: typos fixed in v2 by you, 20 Nov, 15:58: Typo",
      "Annotation: annotation of Anna Kühn (ann-4) moved to v2 by itself after the typo fix, 20 Nov, 15:58",
    ]);
  });
});
