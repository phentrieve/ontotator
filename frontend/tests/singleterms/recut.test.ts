// Invented example text; the astral character (U+1D465) takes two UTF-16 code units but one code point.
import { describe, expect, it } from "vitest";
import { initialSelection, recutProblem, recutWindow, selectionSpan, tokenize } from "../../src/singleterms/recut";

const context = { before: "Fieber 𝑥 und ", text: "Husten", after: " seit gestern.", start: 113 };

describe("single-term re-cut", () => {
  it("splits words and punctuation and keeps UTF-16 offsets", () => {
    expect(tokenize("Kopf-Schmerz, stark.").map(token => [token.text, token.start, token.end])).toEqual([
      ["Kopf-Schmerz", 0, 12], [",", 12, 13], ["stark", 14, 19], [".", 19, 20],
    ]);
  });

  it("finds the window's code-point base and the annotated words", () => {
    const window = recutWindow(context);
    expect(window.base).toBe(100);
    expect(window.occurrenceStart).toBe("Fieber 𝑥 und ".length);
    const tokens = tokenize(window.text);
    expect(tokens.map(token => token.text)).toEqual(["Fieber", "𝑥", "und", "Husten", "seit", "gestern", "."]);
    expect(initialSelection(tokens, window)).toEqual([3, 3]);
  });

  it("converts a selection across an astral character to code points of the whole text", () => {
    const window = recutWindow(context);
    const tokens = tokenize(window.text);
    const span = selectionSpan(window, tokens, 3, 1);
    expect(span.text).toBe("𝑥 und Husten");
    // UTF-16 7..20 in the window; code points 7..19; plus the base 100.
    expect([span.windowStart, span.windowEnd]).toEqual([7, 20]);
    expect([span.start, span.end]).toEqual([107, 119]);
    expect(recutProblem(window, span)).toBeNull();
    const after = selectionSpan(window, tokens, 4, 5);
    expect([after.start, after.end]).toEqual([120, 132]);
    expect(recutProblem(window, after)).toMatch(/overlap/);
    expect(recutProblem(window, selectionSpan(window, tokens, 3, 3))).toMatch(/annotated span/);
  });
});
