// @vitest-environment node
import { describe, expect, it } from "vitest";
import { changeRanges, DIFF_LIMITS, diffText, diffTextBounded } from "../src/translation/textDiff";

const reconstructed = (parts: ReturnType<typeof diffText>, side: "before" | "after") =>
  parts.filter(part => part.op !== (side === "before" ? "insert" : "delete")).map(part => part.text).join("");

describe("review word diff", () => {
  it("marks inserted and deleted words without changing surrounding text", () => {
    expect(diffText("no fever present", "mild fever present")).toEqual([
      { op: "delete", text: "no" }, { op: "insert", text: "mild" },
      { op: "equal", text: " fever present" },
    ]);
  });

  it.each(["", "unchanged", "  😀e\u0301\r\n\ufeff "])("returns one equal part for identical input %j", text => {
    expect(diffText(text, text)).toEqual([{ op: "equal", text }]);
  });

  it.each([
    ["", "inserted\n"], ["removed\t", ""],
    ["one  two\tthree\n", "one two three\r\n"],
    ["\ufeffsame", "same"], ["e\u0301", "é"],
    ["line\r\nnext", "line\nnext"],
    ["😀 high", "😷 low"], ["👩‍⚕️ text", "👨‍⚕️  text"],
    ["alpha beta alpha", "beta alpha beta"],
    ["x\u0000y", "x\u0000 z"], ["word, punctuation!", "word; punctuation?"],
  ])("reconstructs exact raw input %j → %j", (before, after) => {
    const parts = diffText(before, after);
    expect(reconstructed(parts, "before")).toBe(before);
    expect(reconstructed(parts, "after")).toBe(after);
    expect(parts.some(part => part.op === "delete" || part.op === "insert")).toBe(true);
    expect(parts.every(part => part.text.length > 0)).toBe(true);
    for (let index = 1; index < parts.length; index++) {
      expect(parts[index].op).not.toBe(parts[index - 1].op);
    }
  });

  it("keeps changed astral symbols whole in every rendered part", () => {
    const parts = diffText("😀", "😃");
    expect(reconstructed(parts, "before")).toBe("😀");
    expect(reconstructed(parts, "after")).toBe("😃");
    for (const part of parts) {
      for (const point of part.text) {
        const codepoint = point.codePointAt(0)!;
        expect(codepoint < 0xd800 || codepoint > 0xdfff).toBe(true);
      }
    }
    expect(parts).toEqual([{ op: "delete", text: "😀" }, { op: "insert", text: "😃" }]);
  });

  it("keeps whitespace-only changes visible", () => {
    const parts = diffText(" \t\n", "  \r\n");
    expect(parts.filter(part => part.op === "delete").map(part => part.text).join("")).toContain("\t");
    expect(parts.filter(part => part.op === "insert").map(part => part.text).join("")).toContain("\r\n");
    expect(reconstructed(parts, "before")).toBe(" \t\n");
    expect(reconstructed(parts, "after")).toBe("  \r\n");
  });
});

describe("change ranges (Show changes in a reading text)", () => {
  const slices = (text: string, ranges: { start: number; end: number }[]) => ranges.map(range => text.slice(range.start, range.end));

  it("gives the removed passages of the older and the added passages of the newer text in their own offsets", () => {
    const before = "No fever 😀. Mild cough.", after = "😀 High fever 😀. Mild cough and rash.";
    const { removed, added } = changeRanges(before, after)!;
    expect(slices(before, removed).join("|")).toBe(diffText(before, after).filter(part => part.op === "delete").map(part => part.text).join("|"));
    expect(slices(after, added).join("|")).toBe(diffText(before, after).filter(part => part.op === "insert").map(part => part.text).join("|"));
    expect(slices(after, added).join("")).toContain("rash");
    expect(slices(before, removed).join("")).toContain("No");
  });

  it("is empty for equal texts", () => {
    expect(changeRanges("same 😀", "same 😀")).toEqual({ removed: [], added: [] });
  });

  it("leaves out whitespace-only changes: they are neither marked nor counted", () => {
    expect(changeRanges("line\r\nnext", "line\nnext")).toEqual({ removed: [], added: [] });
    expect(changeRanges("5\u00a0mg daily", "5 mg daily")).toEqual({ removed: [], added: [] });
    const before = "one  two\r\nthree", after = "one two\nfour";
    const { removed, added } = changeRanges(before, after)!;
    expect(slices(before, removed).map(part => part.trim())).toEqual(["three"]);
    expect(slices(after, added).map(part => part.trim())).toEqual(["four"]);
  });

  it("never splits a grapheme: a changed part of a ZWJ emoji or a combining mark marks the whole grapheme", () => {
    const before = "seen by 👩‍⚕️ today, cafe\u0301 visit", after = "seen by 👨‍⚕️ today, cafe\u0300 visit";
    const { removed, added } = changeRanges(before, after)!;
    const graphemes = (text: string) => new Set([...new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(text)].flatMap(part => [part.index, part.index + part.segment.length]));
    for (const [text, ranges] of [[before, removed], [after, added]] as const) {
      const edges = graphemes(text);
      for (const range of ranges) { expect(edges.has(range.start)).toBe(true); expect(edges.has(range.end)).toBe(true); }
    }
    expect(slices(before, removed).join("|")).toContain("👩‍⚕️");
    expect(slices(after, added).join("|")).toContain("👨‍⚕️");
    // Ranges stay sorted and disjoint after growing.
    for (const ranges of [removed, added]) for (let index = 1; index < ranges.length; index++) expect(ranges[index].start).toBeGreaterThan(ranges[index - 1].end - 1);
  });
});

describe("bounded diff", () => {
  const words = (count: number, seed: number) => Array.from({ length: count }, (_, index) => `w${(index * 7919 + seed) % 100003}x${seed}`).join(" ");

  it("gives up quickly on two large unrelated texts instead of blocking the tab", () => {
    const before = words(30_000, 1), after = words(30_000, 2);
    const started = performance.now();
    expect(diffTextBounded(before, after)).toBeNull();
    expect(changeRanges(before, after)).toBeNull();
    // Two attempts, each bounded by DIFF_LIMITS.timeoutMs; generous for a loaded CI machine.
    expect(performance.now() - started).toBeLessThan(2 * DIFF_LIMITS.timeoutMs + 3000);
  });

  it("the edit bound alone stops the diff, without relying on the clock", () => {
    expect(diffTextBounded(words(300, 1), words(300, 2), { maxEditLength: 50, timeoutMs: 60_000 })).toBeNull();
  });

  it("diffs a large text with few changes like the unbounded diff", () => {
    const before = words(30_000, 1), after = before.replace(" w7920x1 ", " changed ").replace(" w15839x1 ", " alsochanged ");
    expect(diffTextBounded(before, after)).toEqual(diffText(before, after));
    expect(changeRanges(before, after)!.added.map(range => after.slice(range.start, range.end))).toEqual(["changed", "alsochanged"]);
  });
});
