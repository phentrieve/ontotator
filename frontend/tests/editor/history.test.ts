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

  it("a change was saved but its history is not read yet: Undo stays available, no step is named", () => {
    // The first change of the round: the last history had nothing to undo.
    expect(historyControls(view(3, null), 4)).toEqual({ undo: null, redo: null, canUndo: true, canRedo: false });
    // A later change (review F1: Ctrl+Z right after a value change).
    expect(historyControls(view(3, values, values), 4)).toEqual({ undo: null, redo: null, canUndo: true, canRedo: true });
  });
});
