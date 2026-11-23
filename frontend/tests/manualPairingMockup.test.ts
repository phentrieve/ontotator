// Mockup model of #595 (manual sentence pairing): selection rules, pairing, unpairing and the check state.
import { describe, expect, it } from "vitest";
import { splitSentences } from "../src/translation/sentences";
import { crossing, extend, nextSelection, pair, pairedIndexes, pairLabel, pairReason, pairState, rowOrder, setChecked, toggle, unpair, type ManualPair } from "../src/mockups/manualPairing";

const t = splitSentences("Eins ist hier. Zwei ist hier. Drei ist hier. Vier ist hier.", "de");
const mk = (id: number, source: [number, number], translation: [number, number]): ManualPair => ({ id, source, translation, checkedHash: null, origin: "manual" });

describe("manual pairing (mockup)", () => {
  it("proposes the first unpaired sentence of each text", () => {
    expect(nextSelection([mk(1, [0, 1], [0, 2])], { source: 3, translation: 4 })).toEqual({ source: [1], translation: [2] });
    expect(nextSelection([mk(1, [0, 3], [0, 4])], { source: 3, translation: 4 })).toEqual({ source: [], translation: [] });
  });

  it("keeps a selection contiguous: extend at an edge, shrink at an edge, restart elsewhere", () => {
    const taken = new Set([0]);
    expect(toggle([2], 3, taken)).toEqual([2, 3]);
    expect(toggle([2, 3], 1, taken)).toEqual([1, 2, 3]);
    expect(toggle([1, 2, 3], 3, taken)).toEqual([1, 2]);
    expect(toggle([1, 2, 3], 2, taken)).toEqual([2]);
    expect(toggle([2], 5, taken)).toEqual([5]);
    expect(toggle([2], 2, taken)).toEqual([]);
    expect(toggle([2], 0, taken)).toEqual([2]); // a paired sentence cannot be selected
    expect(extend([2], new Set([0, 4]), 5)).toEqual([2, 3]);
    expect(extend([3], new Set([0, 4]), 5)).toEqual([3]);
    expect(extend([], new Set([0]), 5)).toEqual([1]);
  });

  it("pairs n:m, 1:0 and 0:1, and names what Pair does", () => {
    expect(pairReason({ source: [], translation: [] })).not.toBeNull();
    expect(pairLabel({ source: [1], translation: [1, 2] })).toBe("Pair 1:2");
    expect(pairLabel({ source: [1], translation: [] })).toBe("Not in the translation");
    expect(pairLabel({ source: [], translation: [3] })).toBe("Not in the source");
    const pairs = pair([], { source: [1], translation: [1, 2] }, 7);
    expect(pairs).toEqual([mk(7, [1, 2], [1, 3])]);
    expect([...pairedIndexes(pairs, "translation")]).toEqual([1, 2]);
  });

  it("orders rows by the source and puts a translation-only pair after the pair before it", () => {
    const rows = rowOrder([mk(3, [2, 3], [3, 4]), mk(1, [0, 1], [0, 1]), mk(2, [0, 0], [1, 3]), mk(4, [1, 2], [0, 0])]);
    expect(rows.map(r => r.id)).toEqual([1, 2, 4, 3]);
  });

  it("shows pairs in another order than the source", () => {
    expect([...crossing([mk(1, [0, 1], [1, 2]), mk(2, [1, 2], [0, 1]), mk(3, [2, 3], [2, 3])])].sort()).toEqual([1, 2]);
  });

  it("binds a check to the pair's translation: an edit makes it changed since checked, white space does not", () => {
    const checked = setChecked(mk(1, [0, 1], [1, 3]), t, true);
    expect(pairState(checked, t)).toBe("checked");
    const spaced = splitSentences("Eins ist hier. Zwei  ist hier. Drei ist  hier. Vier ist hier.", "de");
    expect(pairState(checked, spaced)).toBe("checked");
    const edited = splitSentences("Eins ist hier. Zwei ist dort. Drei ist hier. Vier ist hier.", "de");
    expect(pairState(checked, edited)).toBe("stale");
    expect(pairState(setChecked(checked, t, false), t)).toBe("open");
    expect(unpair([checked], 1)).toEqual([]);
  });
});
