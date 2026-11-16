import { describe, expect, it } from "vitest";
import type { DraftHistoryView, HistoryStepView } from "../../src/api/client";
import { historyControls, stepText } from "../../src/editor/history";

const step = (action: string, outcome: string | null = null, term = true): HistoryStepView => ({
  before_revision: 1, after_revision: 2, action, outcome, commands: 1,
  annotation_id: "a1", layer_id: term ? "hpo" : null, term_id: term ? "HP:0001250" : null,
});
const name = (s: HistoryStepView) => stepText(s, () => "Seizure");

describe("stepText (issue 320)", () => {
  it("names a finding by its term", () => {
    expect(name(step("delete_draft_annotation"))).toBe("delete finding Seizure");
    expect(name(step("create_annotation"))).toBe("add finding Seizure");
  });

  it("an Edit & Replace copy is not an added finding", () => {
    expect(name(step("create_annotation", "copy"))).toBe("edit and replace proposal Seizure");
  });

  it("a layer step says whether the layer was checked or unchecked", () => {
    expect(name(step("check_layer", "checked", false))).toBe("mark a layer as checked");
    expect(name(step("check_layer", "unchecked", false))).toBe("mark a layer as not checked");
  });

  it("a step is named after its button", () => {
    expect(name(step("decision", "confirmed"))).toBe("confirm proposal Seizure");
    expect(name(step("decision", "uncertain"))).toBe("mark proposal Seizure as unresolved");
    expect(name(step("clear_round_input_resolution"))).toBe("undo the dismissal of carried finding Seizure");
  });

  it("a carried finding is checked, linked or dismissed", () => {
    expect(name(step("resolve_round_input", "checked"))).toBe("mark carried finding Seizure as checked");
    expect(name(step("resolve_round_input", "completed"))).toBe("mark carried finding Seizure as checked");
    expect(name(step("resolve_round_input", "linked"))).toBe("link carried finding Seizure");
    expect(name(step("resolve_round_input", "dismissed"))).toBe("dismiss carried finding Seizure");
  });
});

describe("historyControls: an undo right after a change is not lost", () => {
  const view = (revision: number, undo: HistoryStepView | null, redo: HistoryStepView | null = null): DraftHistoryView => ({
    available: true, revision, undo, redo, undo_count: undo ? 1 : 0, redo_count: redo ? 1 : 0, changed: !!undo,
  });
  const values = { ...step("set_axes"), before_revision: 2, after_revision: 3 };

  it("the history of the shown revision names the steps", () => {
    expect(historyControls(view(3, values), 3)).toEqual({ undo: values, redo: null, canUndo: true, canRedo: false });
    expect(historyControls(view(3, null), 3)).toEqual({ undo: null, redo: null, canUndo: false, canRedo: false });
    expect(historyControls(null, 3)).toEqual({ undo: null, redo: null, canUndo: false, canRedo: false });
  });

  it("a change was saved but its history is not read yet: Undo is available, Redo is not, no step is named", () => {
    // The first change of the round: the last history had nothing to undo.
    expect(historyControls(view(3, null), 4)).toEqual({ undo: null, redo: null, canUndo: true, canRedo: false });
    // A later change (review F1: Ctrl+Z right after a value change); it ended the redo of the last history.
    expect(historyControls(view(3, values, values), 4)).toEqual({ undo: null, redo: null, canUndo: true, canRedo: false });
    // An undo of an older revision says nothing about this one.
    expect(historyControls(view(3, values, values), 5, { revision: 4, command: "undo_step" }).canRedo).toBe(false);
  });

  it("right after an undo, Redo is available; Undo only if more steps were there", () => {
    const last = { revision: 4, command: "undo_step" } as const;
    expect(historyControls(view(3, values), 4, last)).toEqual({ undo: null, redo: null, canUndo: false, canRedo: true });
    expect(historyControls({ ...view(3, values), undo_count: 2 }, 4, last)).toMatchObject({ canUndo: true, canRedo: true });
    // The last history is older than the revision before: its counts cannot say, so Undo stays available.
    expect(historyControls(view(2, null), 4, last)).toMatchObject({ canUndo: true, canRedo: true });
  });

  it("right after a redo, Undo is available; Redo only if more undone steps were there", () => {
    const last = { revision: 4, command: "redo_step" } as const;
    expect(historyControls(view(3, null, values), 4, last)).toEqual({ undo: null, redo: null, canUndo: true, canRedo: false });
    expect(historyControls({ ...view(3, null, values), redo_count: 2 }, 4, last)).toMatchObject({ canUndo: true, canRedo: true });
  });

  it("right after a reset, Undo is available and there is nothing to redo", () => {
    expect(historyControls(view(3, values, values), 4, { revision: 4, command: "reset_changes" }))
      .toEqual({ undo: null, redo: null, canUndo: true, canRedo: false });
  });
});
