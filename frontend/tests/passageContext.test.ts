// @vitest-environment node
import { describe, expect, it } from "vitest";
import { sentenceAround } from "../src/editor/passageContext";

const TEXT = "The girl is 14 months old. Since summer she has seizures at night. Tone is low.\nNo fever today";
const seg = (word: string, text = TEXT) => ({ start: Array.from(text.slice(0, text.indexOf(word))).length, end: Array.from(text.slice(0, text.indexOf(word))).length + Array.from(word).length });
const plain = (parts: ReturnType<typeof sentenceAround>) => parts?.map(part => part.marked ? `[${part.text}]` : part.text).join("") ?? null;

describe("sentenceAround", () => {
  it("returns the sentence of the passage, the passage marked", () => {
    expect(plain(sentenceAround(TEXT, [seg("seizures")]))).toBe("Since summer she has [seizures] at night.");
    expect(plain(sentenceAround(TEXT, [seg("girl")]))).toBe("The [girl] is 14 months old.");
  });

  it("stops at a line break and at the end of the text", () => {
    expect(plain(sentenceAround(TEXT, [seg("low")]))).toBe("Tone is [low].");
    expect(plain(sentenceAround(TEXT, [seg("fever")]))).toBe("No [fever] today");
  });

  it("marks every segment and spans the sentences between them", () => {
    expect(plain(sentenceAround(TEXT, [seg("night"), seg("seizures")]))).toBe("Since summer she has [seizures] at [night].");
    expect(plain(sentenceAround(TEXT, [seg("months"), seg("summer")]))).toBe("The girl is 14 [months] old. Since [summer] she has seizures at night.");
  });

  it("counts code points, as the segments do", () => {
    const text = "😀 Fieber seit gestern. Kein Husten.";
    expect(plain(sentenceAround(text, [{ start: 2, end: 8 }]))).toBe("😀 [Fieber] seit gestern.");
  });

  it("cuts a long side at a word boundary", () => {
    const long = `${"word ".repeat(60)}seizure ${"more ".repeat(60)}end.`;
    const shown = plain(sentenceAround(long, [seg("seizure", long)]))!;
    expect(shown.startsWith("…word ")).toBe(true);
    expect(shown.endsWith(" more…")).toBe(true);
    expect(shown).toContain("word [seizure] more");
    expect(shown.length).toBeLessThan(300);
  });

  it("is null without a passage or when the sentence adds nothing", () => {
    expect(sentenceAround(TEXT, [])).toBeNull();
    expect(sentenceAround(TEXT, [{ start: 5, end: 5 }])).toBeNull();
    expect(sentenceAround("Seizures", [{ start: 0, end: 8 }])).toBeNull();
    expect(sentenceAround("One. Seizures\nThree", [{ start: 5, end: 13 }])).toBeNull();
  });
});
