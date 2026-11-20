// @vitest-environment node
import { describe, expect, it } from "vitest";
import { firstUsableIndex, keepsPrefillSelected, matchLine, NO_PREFILL_HINT, passageText, prefillHint, prefillQuery } from "../src/editor/termSearch";

describe("prefillQuery", () => {
  it("joins segments with a space and collapses whitespace", () => {
    const text = "Der Patient hat\n  Krampfanfälle und Fieber.";
    expect(prefillQuery(text, [{ start: 0, end: 3 }, { start: 18, end: 31 }])).toBe("Der Krampfanfälle");
  });
  it("cuts at 80 codepoints on a word boundary", () => {
    const text = `${"wort ".repeat(30)}`;
    const value = prefillQuery(text, [{ start: 0, end: text.length }]);
    expect(Array.from(value).length).toBeLessThanOrEqual(80);
    expect(value.endsWith("wort")).toBe(true);
  });
  it("counts codepoints, not UTF-16 units", () => {
    expect(prefillQuery("😀 seizure", [{ start: 2, end: 9 }])).toBe("seizure");
  });
});
describe("passageText", () => {
  it("turns line breaks and runs of whitespace into one space and is never cut", () => {
    const text = `Der Patient hat\r\n  ${"wort ".repeat(30)}\nEnde`;
    const value = passageText(text, [{ start: 0, end: text.length }]);
    expect(value).toBe(`Der Patient hat ${"wort ".repeat(30)}Ende`);
    expect(Array.from(value).length).toBeGreaterThan(80);
  });
  it("joins segments with words between by a space and keeps adjacent ones together", () => {
    const text = "No\nfever, but cough";
    expect(passageText(text, [{ start: 0, end: 2 }, { start: 3, end: 8 }])).toBe("No fever");
    expect(passageText(text, [{ start: 0, end: 2 }, { start: 14, end: 19 }])).toBe("No cough");
    expect(passageText(text, [{ start: 3, end: 6 }, { start: 6, end: 8 }])).toBe("fever");
  });
  it("counts codepoints, not UTF-16 units", () => {
    expect(passageText("😀 seizure", [{ start: 2, end: 9 }])).toBe("seizure");
  });
});
describe("keepsPrefillSelected", () => {
  const key = (key: string, mods: Partial<Record<"ctrlKey" | "metaKey" | "altKey" | "shiftKey", boolean>> = {}) =>
    ({ key, ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, ...mods });
  it("keeps the mark for the modifier keys and the copy shortcuts", () => {
    for (const k of ["Control", "Meta", "Shift", "Alt"]) expect(keepsPrefillSelected(key(k))).toBe(true);
    expect(keepsPrefillSelected(key("c", { ctrlKey: true }))).toBe(true);
    expect(keepsPrefillSelected(key("C", { metaKey: true }))).toBe(true);
    expect(keepsPrefillSelected(key("Insert", { ctrlKey: true }))).toBe(true);
  });
  it("drops it for anything else: typing, Ctrl+A, arrows, Shift+arrows", () => {
    expect(keepsPrefillSelected(key("c"))).toBe(false);
    expect(keepsPrefillSelected(key("a", { ctrlKey: true }))).toBe(false);
    expect(keepsPrefillSelected(key("ArrowLeft"))).toBe(false);
    expect(keepsPrefillSelected(key("ArrowLeft", { shiftKey: true }))).toBe(false);
    expect(keepsPrefillSelected(key("C", { ctrlKey: true, shiftKey: true }))).toBe(false);
  });
});
describe("prefillHint", () => {
  it("says nothing for English and for active search languages", () => {
    expect(prefillHint("en", undefined)).toBeNull();
    expect(prefillHint("en-GB", [])).toBeNull();
    expect(prefillHint("de", ["de"])).toBeNull();
    expect(prefillHint("de-AT", ["de"])).toBeNull();
  });
  it("explains English-only search for languages that are not searched", () => {
    expect(NO_PREFILL_HINT).toBe("Names are searched in English. Type an English name or a code.");
    expect(prefillHint("de", undefined)).toBe(NO_PREFILL_HINT);
    expect(prefillHint("fr", ["de"])).toBe(NO_PREFILL_HINT);
  });
});
describe("matchLine (spec B.6)", () => {
  const hit = (match_kind: string, matched_term = "Absence seizure", match_language: string | null = null) =>
    ({ label: "Seizure", matched_term, match_kind, match_language });
  it.each([
    ["label", null],
    ["hasExactSynonym", "Matched synonym “Absence seizure”"],
    ["prefix:hasExactSynonym", "Matched the start of “Absence seizure”"],
    ["ngram", "Similar wording “Absence seizure”"],
    ["id", "Matched the code"],
    ["child", "Matched “Absence seizure”"],
  ])("%s", (kind, expected) => { expect(matchLine(hit(kind))).toBe(expected); });
  it("names the language for translated matches", () => {
    expect(matchLine(hit("ngram:de", "Krampfanfall", "de"))).toBe("Matched German name “Krampfanfall”");
    expect(matchLine(hit("translation", "Krampfanfall", "de"))).toBe("Matched German name “Krampfanfall”");
  });
  it("returns null when the match equals the label", () => { expect(matchLine(hit("hasExactSynonym", "Seizure"))).toBeNull(); });
});
it("firstUsableIndex skips obsolete hits", () => {
  expect(firstUsableIndex([{ obsolete: true }, { obsolete: false }] as never, true)).toBe(1);
  expect(firstUsableIndex([{ obsolete: false }] as never, false)).toBe(-1);
});
