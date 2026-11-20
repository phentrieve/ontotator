// @vitest-environment node
import { describe, expect, it } from "vitest";
import { takeEffect, treeContextOf, treeFollow, treeModeNote, walkMode } from "../src/editor/treeMode";

describe("what the tree may do for a selection (issue 523)", () => {
  it("assigns directly only on an own finding that can be edited", () => {
    const own = { kind: "annotation" as const, annotationId: "a1", layerId: "l", termId: "HP:1" };
    expect(treeContextOf({ ...own, editable: true })).toEqual({ key: "annotation:a1", layerId: "l", termId: "HP:1", mode: "assign", annotationId: "a1" });
    expect(treeContextOf({ ...own, editable: false })?.mode).toBe("look");
  });

  it("takes a term with a confirmation for an undecided proposal and a new finding", () => {
    const proposal = { kind: "proposal" as const, key: "p:v1", layerId: "l", termId: "HP:2", copyId: null };
    expect(treeContextOf({ ...proposal, open: true })).toEqual({ key: "target:p:v1", layerId: "l", termId: "HP:2", mode: "proposal" });
    // An existing copy of the proposal is where the term goes.
    expect(treeContextOf({ ...proposal, open: true, copyId: "c1" })?.annotationId).toBe("c1");
    expect(treeContextOf({ ...proposal, open: false, copyId: "c1" })).toEqual({ key: "target:p:v1", layerId: "l", termId: "HP:2", mode: "look" });
    expect(treeContextOf({ ...proposal, open: true, layerId: null })).toBeNull();

    // A new finding has the key of the finding it becomes, and no start term of its own.
    expect(treeContextOf({ kind: "pending", annotationId: "ann-9", layerId: "l", editable: true }))
      .toEqual({ key: "annotation:ann-9", layerId: "l", termId: null, mode: "new", annotationId: "ann-9" });
  });

  it("only looks at a reference, under no id of the reference", () => {
    const context = treeContextOf({ kind: "reference", key: "r:v1", layerId: "l", termId: "HP:3" });
    expect(context).toEqual({ key: "source:r:v1", layerId: "l", termId: "HP:3", mode: "look" });
    expect(context?.annotationId).toBeUndefined();
    expect(treeContextOf(null)).toBeNull();
  });

  it("follows the selection: same key keeps, another one with a term restarts, none closes", () => {
    const at = (key: string, termId: string | null = "HP:1") => ({ key, layerId: "l", termId, mode: "look" as const });
    expect(treeFollow(null, at("a"), false)).toBe("keep");
    expect(treeFollow("a", at("a"), false)).toBe("keep");
    expect(treeFollow("a", at("a", null), false)).toBe("keep");
    expect(treeFollow("a", at("b"), false)).toBe("restart");
    expect(treeFollow("a", at("b", null), false)).toBe("close");
    expect(treeFollow("a", null, false)).toBe("close");
    // A new finding's search: another walk steps aside, and is kept when the search is given up.
    expect(treeFollow("a", at("b", null), true)).toBe("keep");
    expect(treeFollow("a", null, false, true)).toBe("keep");
    expect(treeFollow("a", at("b"), false, true)).toBe("restart");
  });

  it("takes the mode of the selection only while the walk still shows it", () => {
    const context = { key: "a", layerId: "l", termId: "HP:1", mode: "proposal" as const };
    expect(walkMode("a", context)).toBe("proposal");
    expect(walkMode("b", context)).toBe("look");
    expect(walkMode("a", null)).toBe("look");
  });

  it("says what looking means and what a confirmation does", () => {
    expect(treeModeNote("assign")).toBeNull();
    expect(treeModeNote("look")).toBe("Only looking: nothing can be changed from here.");
    expect(treeModeNote("proposal")).toBe("Only looking: nothing changes until you choose a term and confirm.");
    expect(treeModeNote("new")).toBe(treeModeNote("proposal"));
    expect(takeEffect("proposal", "Seizure", "HP:0001250")).toBe("Proposal: decide as Replaced with Seizure (HP:0001250)");
    expect(takeEffect("new", "Seizure", "HP:0001250")).toBe("New finding: choose Seizure (HP:0001250)");
  });
});
