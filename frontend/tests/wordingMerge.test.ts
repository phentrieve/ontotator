// @vitest-environment node
import { describe, expect, it } from "vitest";
import { mapOffset, mergeServerText, passageAfterEdits, takeWording, wordingsBetween, type TakenWording } from "../src/translation/wordingMerge";

/** Issue 610: the reviewer's text and the lead's taken wording, from the acceptance steps. */
const SAVED = "Übungsbeispiel. EDITA Krampfanfälle seit dem Säugling. Text-Hash zu ändern. EDITB Familienmitglied. Hypotonie ist mild.";
const QUESTION: TakenWording = { report_id: "q1", quote: "Krampfanfälle", proposed_text: "Epileptische Anfälle", answered_at: "2026-11-22T10:00:00Z" };
const TAKEN = SAVED.replace("Krampfanfälle", "Epileptische Anfälle");

describe("taking a wording", () => {
  it("replaces a passage that occurs exactly once, as the server does", () => {
    expect(takeWording("a b c", "b", "B")).toBe("a B c");
    expect(takeWording("a b b", "b", "B")).toBeNull();
    expect(takeWording("a c", "b", "B")).toBeNull();
    expect(takeWording("a b", "", "B")).toBeNull();
  });

  it("finds the run of taken wordings between the saved text and the server's", () => {
    const second: TakenWording = { report_id: "q2", quote: "Hypotonie", proposed_text: "Muskelhypotonie", answered_at: "2026-11-22T10:05:00Z" };
    expect(wordingsBetween(SAVED, SAVED, [QUESTION])).toEqual([]);
    expect(wordingsBetween(SAVED, TAKEN, [QUESTION])).toEqual([QUESTION]);
    const both = TAKEN.replace("Hypotonie", "Muskelhypotonie");
    // Listed newest first, applied in answer order.
    expect(wordingsBetween(SAVED, both, [second, QUESTION])).toEqual([QUESTION, second]);
    // An earlier take already in the saved text is skipped.
    expect(wordingsBetween(TAKEN, both, [QUESTION, second])).toEqual([second]);
    expect(wordingsBetween(SAVED, `${SAVED} other`, [QUESTION])).toBeNull();
    expect(wordingsBetween(SAVED, TAKEN, [])).toBeNull();
  });
});

describe("merging the saved draft into the reviewer's text", () => {
  it("puts the wording into the text on screen and keeps an edit waiting at the answer and edits after it", () => {
    const local = SAVED.replace("Familienmitglied.", "Familienmitglied. EDITC").replace("Hypotonie ist", "Hypotonie ist EDITD");
    const merged = mergeServerText(SAVED, TAKEN, local, [QUESTION]);
    expect(merged).toMatchObject({ kind: "merged", applied: [QUESTION], kept: [] });
    if (merged.kind !== "merged") throw new Error("not merged");
    expect(merged.text).toBe(local.replace("Krampfanfälle", "Epileptische Anfälle"));
    for (const edit of ["EDITA", "EDITB", "EDITC", "EDITD", "Epileptische Anfälle"]) expect(merged.text).toContain(edit);
    expect(merged.replacements).toEqual([{ start: local.indexOf("Krampfanfälle"), end: local.indexOf("Krampfanfälle") + 13, text: "Epileptische Anfälle" }]);
  });

  it("keeps the reviewer's text where they changed the passage, and names their version of it", () => {
    const local = SAVED.replace("Krampfanfälle", "Krampfanfälle (fokal)").replace("Krampfanfälle", "Anfälle");
    const merged = mergeServerText(SAVED, TAKEN, local, [QUESTION]);
    expect(merged).toEqual({ kind: "merged", text: local, applied: [], kept: [{ wording: QUESTION, mine: "Anfälle" }], replacements: [] });
  });

  it("keeps the text when the passage occurs twice on screen", () => {
    const local = `${SAVED} Krampfanfälle.`;
    const merged = mergeServerText(SAVED, TAKEN, local, [QUESTION]);
    expect(merged).toMatchObject({ kind: "merged", text: local, applied: [], kept: [{ wording: QUESTION }] });
  });

  it("does not merge a change that no taken wording explains", () => {
    expect(mergeServerText(SAVED, `${SAVED} from another tab`, `${SAVED} mine`, [QUESTION])).toEqual({ kind: "conflict" });
  });

  it("applies two wordings taken one after the other", () => {
    const second: TakenWording = { report_id: "q2", quote: "Hypotonie", proposed_text: "Muskelhypotonie", answered_at: "2026-11-22T10:05:00Z" };
    const server = TAKEN.replace("Hypotonie", "Muskelhypotonie");
    const local = `${SAVED} EDITE`;
    const merged = mergeServerText(SAVED, server, local, [second, QUESTION]);
    expect(merged).toMatchObject({ kind: "merged", text: `${server} EDITE`, applied: [QUESTION, second], kept: [] });
  });
});

describe("positions", () => {
  it("maps a caret through the replacements", () => {
    const replacements = [{ start: 4, end: 7, text: "ABCDE" }];
    expect(mapOffset(2, replacements)).toBe(2);
    expect(mapOffset(4, replacements)).toBe(4);
    expect(mapOffset(5, replacements)).toBe(9);
    expect(mapOffset(7, replacements)).toBe(9);
    expect(mapOffset(10, replacements)).toBe(12);
  });

  it("finds a passage after edits around and inside it", () => {
    const before = "one two three four";
    expect(passageAfterEdits(before, "zero one two three four", 4, 7)).toEqual({ start: 9, end: 12 });
    const changed = "one deux three four";
    expect(changed.slice(...Object.values(passageAfterEdits(before, changed, 4, 7)!) as [number, number])).toBe("deux");
    // Text added right after the passage stays outside it.
    const appended = "one two more three four";
    expect(appended.slice(...Object.values(passageAfterEdits(before, appended, 4, 7)!) as [number, number])).toBe("two");
  });
});
