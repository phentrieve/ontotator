// @vitest-environment node
import { describe, expect, it } from "vitest";
import { clinicalChangeFacts, decisionDescriptions, decisionKeyHint, rationaleHint, allChecksLine, calmCheckText, checkBandText, checkDeviationGuidance, checkExplanation, checkLabel, checkNoLocation, failedChecksTitle, shortCheckLabel, unknownCheckExplanation, languageName, translationStatusLabel, translationNote, decisionConsequence, versionOriginRows, earlierChecksText } from "../src/translation/labels";
import { formatTime } from "../src/app/submissionLabels";

describe("translation review labels", () => {
  it("names known check codes and turns unknown codes into words", () => {
    expect(checkLabel("units_added")).toBe("Units added in translation");
    expect(checkLabel("numbers_changed")).toBe("Numbers changed in translation");
    expect(checkLabel("negation-flip_detected")).toBe("Negation flip detected");
    expect(checkLabel("")).toBe("Unnamed check");
    expect(checkLabel(undefined)).toBe("Unnamed check");
    expect(checkLabel("toString")).toBe("ToString");
  });
  it("explains known check codes and falls back for unknown ones", () => {
    expect(checkExplanation("units_added")).toContain("unit of measurement");
    expect(checkExplanation("numbers_changed")).toContain("numbers in the translation that differ");
    expect(checkExplanation("glossary_miss")).toBe(unknownCheckExplanation);
    expect(checkExplanation("toString")).toBe(unknownCheckExplanation);
  });
  it("counts failed checks in words", () => {
    expect(failedChecksTitle(1)).toBe("1 automatic check failed");
    expect(failedChecksTitle(3)).toBe("3 automatic checks failed");
  });
  it("shortens check labels and builds the band text", () => {
    expect(shortCheckLabel("units_added")).toBe("Units added");
    expect(shortCheckLabel("numbers_changed")).toBe("Numbers changed");
    expect(shortCheckLabel("glossary_miss")).toBe(checkLabel("glossary_miss"));
    expect(checkBandText(["units_added"])).toBe("1 automatic check failed: Units added in translation");
    expect(checkBandText(["units_added", "numbers_changed"])).toBe("2 automatic checks failed: Units added and Numbers changed");
    expect(checkBandText(["units_added", "numbers_changed", "glossary_miss"])).toBe("3 automatic checks failed: Units added, Numbers changed and 1 more");
    expect(checkBandText(["units_added", "numbers_changed", "a", "b"])).toBe("4 automatic checks failed: Units added, Numbers changed and 2 more");
  });
  it("builds the calm text and the all-checks line", () => {
    expect(calmCheckText(1)).toBe("1 automatic check passed.");
    expect(calmCheckText(5)).toBe("All 5 automatic checks passed.");
    expect(allChecksLine(4, 1)).toBe("All checks: 4 passed, 1 failed");
  });
  it("ends the guidance by code", () => {
    const start = "Choose Accepted unchanged (or Accepted with corrections if you edited it). You can say in the rationale why the difference is correct. If it changes the clinical meaning, choose Query or Rejected";
    expect(checkDeviationGuidance("units_added")).toBe(`${start} with the category Number or unit.`);
    expect(checkDeviationGuidance("numbers_changed")).toBe(`${start} with the category Number or unit.`);
    expect(checkDeviationGuidance("glossary_miss")).toBe(`${start}.`);
    expect(checkNoLocation).toBe("It does not point to a text location; compare the texts yourself.");
  });
  it("describes translation statuses without raw values", () => {
    expect(translationStatusLabel("reviewed")).toBe("Reviewed");
    expect(translationStatusLabel("accepted")).toBe("Accepted");
    expect(translationStatusLabel("ready_for_review")).toBe("Ready for review");
    expect(translationStatusLabel("needs_another_look")).toBe("Needs another look");
  });
  it("names languages in English and keeps unknown codes", () => {
    expect(languageName("de")).toBe("German");
    expect(languageName("en")).toBe("English");
    expect(languageName("not a code")).toBe("not a code");
  });
  it("has short decision hints and fact lines", () => {
    expect(decisionDescriptions).toEqual({
      accepted_unchanged: "Correct as it stands. No edits.",
      accepted_corrected: "Your corrected version is accepted.",
      query: "Meaning may differ clinically. Not accepted.",
      rejected: "Changes clinical meaning. Not accepted.",
    });
    expect(clinicalChangeFacts).toEqual({
      query: "Clinically relevant change: yes, always for a query.",
      rejected: "Clinically relevant change: yes, always for a rejection.",
    });
    expect(decisionKeyHint).toBe("Ctrl + Enter submits, 1–4 choose a decision outside the text");
  });
  it("selects the rationale hint", () => {
    expect(rationaleHint("accepted_unchanged", false, 0)).toBe("Optional.");
    expect(rationaleHint("accepted_unchanged", false, 2)).toBe("Required: an automatic check failed. Say why the flagged difference is correct.");
    expect(rationaleHint("accepted_corrected", false, 2)).toBe("Optional.");
    expect(rationaleHint(undefined, false, 1)).toBe("Optional.");
    expect(rationaleHint("query", true, 0)).toBe("Required for a clinically relevant change.");
    expect(rationaleHint("accepted_unchanged", true, 1)).toBe("Required for a clinically relevant change.");
  });
});

describe("a version after the first (user review 2026-11)", () => {
  it("names the baseline: the machine translation only for a machine translation's first version", () => {
    expect(translationNote({ origin: "machine_translation", version: 1 }, "same")).toBe("Same as the machine translation.");
    expect(translationNote({ origin: "machine_translation", version: 1 }, "edited")).toBe("Underlined text differs from the machine translation.");
    expect(translationNote({ origin: "machine_translation", version: 1 }, "changes")).toBe("Showing changes against the machine translation. Turn off Show changes to edit.");
    expect(translationNote({ origin: "correction", version: 2 }, "same", 1)).toBe("Same as the version you were given (v2). Compare shows what changed since v1.");
    expect(translationNote({ origin: "correction", version: 2 }, "edited", 1)).toBe("Underlined text differs from the version you were given (v2). Compare shows what changed since v1.");
    expect(translationNote({ origin: "correction", version: 2 }, "changes", 1)).toBe("Showing your changes against the version you were given (v2). Turn off Show changes to edit. Compare shows what changed since v1.");
    expect(translationNote({ origin: "human_translation", version: 1 }, "same")).toBe("Same as the version you were given (v1).");
    expect(decisionConsequence("accepted_corrected", { origin: "correction" })).toContain("The version you were given stays as it was.");
    expect(decisionConsequence("accepted_corrected", { origin: "machine_translation" })).toContain("The machine translation stays as it was.");
  });
  it("describes how the version was made, not the run of the first version", () => {
    expect(versionOriginRows({ kind: "upload", previous_version: 1, at: "2026-11-17T09:30:00Z", method: "machine_translation", provider: "DeepL", model: "deepl-2026-10", made_on: "2026-11-12", made_by: "Dr. Roe", note: "Checked" }))
      .toEqual([["This version", "Machine translation, DeepL, deepl-2026-10"], ["Uploaded", `by the project lead on ${formatTime("2026-11-17T09:30:00Z")}`],
        ["Made", "on 12 November 2026 by Dr. Roe"], ["Note", "Checked"], ["Version before", "v1"]]);
    expect(versionOriginRows({ kind: "upload", previous_version: 2, method: "human_translation" })).toEqual([["This version", "Human translation"], ["Uploaded", "by the project lead"], ["Version before", "v2"]]);
    expect(versionOriginRows({ kind: "lead_correction", previous_version: 1, at: "2026-11-17T09:30:00Z" }))
      .toEqual([["This version", "Corrected by the project lead"], ["Corrected", `on ${formatTime("2026-11-17T09:30:00Z")}`], ["Version before", "v1"]]);
    expect(versionOriginRows({ kind: "review_correction", previous_version: 1 })[0]).toEqual(["This version", "Corrected in a translation review"]);
    // "Fix typos…" (issue 453): named as what it is, with the recorded reason.
    expect(versionOriginRows({ kind: "editorial_correction", previous_version: 2, at: "2026-11-17T09:30:00Z", note: "Spacing; Typo" }))
      .toEqual([["This version", `Typos fixed by the project lead on ${formatTime("2026-11-17T09:30:00Z")}`], ["What was fixed", "Spacing; Typo"], ["Version before", "v2"]]);
    expect(versionOriginRows({ kind: "correction", previous_version: 1 })).toEqual([["This version", "Correction"], ["Version before", "v1"]]);
    expect(earlierChecksText(1, 2, [])).toBe("The automatic checks ran on v1, not on this version (v2).");
    expect(earlierChecksText(1, 2, ["units_added", "numbers_changed"])).toBe("The automatic checks ran on v1, not on this version (v2). 2 automatic checks failed on v1: Units added and Numbers changed.");
  });
});
