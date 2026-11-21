// @vitest-environment node
import { describe, expect, it } from "vitest";
import { exclusionOffer, previewParts } from "../src/editor/spanExclusion";
import { quoteOf } from "../src/editor/modifiers";

/** Code-point offsets of `word` in `text` (its `nth` occurrence). */
const at = (text: string, word: string, nth = 0) => {
  let start = -1;
  for (let i = 0; i <= nth; i += 1) start = text.indexOf(word, start + 1);
  const cp = Array.from(text.slice(0, start)).length;
  return { start: cp, end: cp + Array.from(word).length };
};
const mention = (text: string, ...words: string[]) => ({ evidenceId: "ev-1", segments: words.map(word => at(text, word)) });
const after = (text: string, offer: ReturnType<typeof exclusionOffer>) => offer && quoteOf(text, offer.after);

describe("exclusionOffer", () => {
  it("splits a mention when the modifier sits in the middle", () => {
    const text = "Severe periorbital and severe facial oedema.";
    const offer = exclusionOffer(text, [mention(text, "periorbital and severe facial oedema")], [at(text, "Severe")]);
    expect(offer).toBeNull(); // "Severe" at the start is outside the span
    const inner = exclusionOffer(text, [mention(text, "periorbital and severe facial oedema")], [at(text, "severe")]);
    expect(inner?.after).toEqual([at(text, "periorbital and"), at(text, "facial oedema")]);
    expect(after(text, inner)).toBe("periorbital and … facial oedema");
    expect(quoteOf(text, inner!.removed)).toBe("severe");
  });

  it("trims a mention when the modifier sits at its edge, without leaving the space", () => {
    const text = "Seit 2 Wochen wiederholt schwere Krampfanfälle und eine Muskelhypotonie.";
    const offer = exclusionOffer(text, [mention(text, "schwere Krampfanfälle")], [at(text, "schwere")]);
    expect(offer?.after).toEqual([at(text, "Krampfanfälle")]);
    expect(offer?.before).toEqual([at(text, "schwere Krampfanfälle")]);
  });

  it("trims the punctuation the cut leaves, but keeps the mention's own edges", () => {
    const text = "Note: (severe, periorbital oedema).";
    const offer = exclusionOffer(text, [mention(text, "(severe, periorbital oedema).")], [at(text, "severe")]);
    expect(after(text, offer)).toBe("periorbital oedema)."); // the lone "(" has no word: dropped
    const text2 = "periorbital oedema (severe)";
    const tail = exclusionOffer(text2, [mention(text2, "periorbital oedema (severe)")], [at(text2, "severe")]);
    expect(tail?.after).toEqual([at(text2, "periorbital oedema")]);
  });

  it("offers nothing when the modifier covers the whole mention or lies outside it", () => {
    const text = "severe oedema";
    expect(exclusionOffer(text, [mention(text, "severe")], [at(text, "severe")])).toBeNull();
    expect(exclusionOffer(text, [mention(text, "oedema")], [at(text, "severe")])).toBeNull();
    expect(exclusionOffer(text, [mention(text, "oedema")], [])).toBeNull();
  });

  it("removes only the overlap when the modifier is partly inside the span", () => {
    const text = "very severe periorbital oedema";
    const offer = exclusionOffer(text, [mention(text, "severe periorbital oedema")], [at(text, "very severe")]);
    expect(after(text, offer)).toBe("periorbital oedema");
    expect(quoteOf(text, offer!.removed)).toBe("severe");
  });

  it("offers nothing when a cut would split a word", () => {
    const text = "schwere Krampfanfälle";
    expect(exclusionOffer(text, [mention(text, "schwere Krampfanfälle")], [at(text, "schwer")])).toBeNull();
  });

  it("works on multi-segment mentions and leaves mentions with cue segments alone", () => {
    const text = "severe periorbital and facial oedema";
    const multi = { evidenceId: "ev-1", segments: [at(text, "severe periorbital"), at(text, "oedema")] };
    const offer = exclusionOffer(text, [multi], [at(text, "severe")]);
    expect(offer?.after).toEqual([at(text, "periorbital"), at(text, "oedema")]);
    expect(exclusionOffer(text, [{ ...multi, cueSegments: [at(text, "and")] }], [at(text, "severe")])).toBeNull();
  });

  it("picks the mention the modifier overlaps and counts code points", () => {
    const text = "😀 schwere Ödeme und Krampfanfälle";
    const first = { evidenceId: "ev-a", segments: [at(text, "Krampfanfälle")] };
    const second = { evidenceId: "ev-b", segments: [at(text, "schwere Ödeme")] };
    const offer = exclusionOffer(text, [first, second], [at(text, "schwere")]);
    expect(offer?.evidenceId).toBe("ev-b");
    expect(after(text, offer)).toBe("Ödeme");
  });
});

describe("previewParts", () => {
  it("marks the words that go and joins segments with …", () => {
    const text = "wiederholt schwere Krampfanfälle, dann Fieber";
    const offer = exclusionOffer(text, [{ evidenceId: "e", segments: [at(text, "wiederholt schwere Krampfanfälle"), at(text, "Fieber")] }], [at(text, "schwere")])!;
    expect(previewParts(text, offer)).toEqual([
      { text: "wiederholt ", removed: false },
      { text: "schwere", removed: true },
      { text: " Krampfanfälle", removed: false },
      { text: " … ", removed: false },
      { text: "Fieber", removed: false },
    ]);
  });
});
