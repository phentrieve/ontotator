// @vitest-environment node
import { describe, expect, it } from "vitest";
import { holdersLine, memberReason, onePersonSummary, partlyAssignedLines, resultMessage, skippedLines, stepLabel, validPerText } from "../src/admin/assignSummary";

const ana = { pseudonym: "ann-0004", display_name: "Ana Weber" };
const ben = { pseudonym: "ann-0007", display_name: "Ben Roth" };

describe("assign summary", () => {
  it("names up to five holders, then the first five and how many more (issue 447)", () => {
    const names = Array.from({ length: 20 }, (_, index) => `Person ${index + 1}`);
    expect(holdersLine(names.slice(0, 5))).toBe("Person 1; Person 2; Person 3; Person 4; Person 5");
    expect(holdersLine(names.slice(0, 6))).toBe("Person 1; Person 2; Person 3; Person 4; Person 5; and 1 more (marked “Already assigned” below)");
    expect(holdersLine(names)).toBe("Person 1; Person 2; Person 3; Person 4; Person 5; and 15 more (marked “Already assigned” below)");
  });

  it("annotators per text: a whole number from 1, up to the server's maximum when it has one (issue 457)", () => {
    expect([1, 20, 21, 30, 5000].map(value => validPerText(value))).toEqual([true, true, true, true, true]);
    expect([0, -1, 2.5, Number.NaN, Number.POSITIVE_INFINITY].map(value => validPerText(value))).toEqual([false, false, false, false, false]);
    expect([1, 8, 9].map(value => validPerText(value, 8))).toEqual([true, true, false]);
    expect(validPerText(9, null)).toBe(true);
  });

  it("summarises one person", () => {
    expect(onePersonSummary({ person: ana, gets: 20, task: "translation_review", language: "de", openBefore: 3, openAfter: 23 }))
      .toBe("Ana Weber gets 20 translation reviews (de). Open tasks: 3 → 23.");
    expect(onePersonSummary({ person: { pseudonym: "ann-0004" }, gets: 1, task: "annotate", language: "fr", openBefore: 0, openAfter: 1 }))
      .toBe("ann-0004 gets 1 annotation (fr). Open tasks: 0 → 1.");
  });

  it("states skipped cases", () => {
    const skipped = [
      ...Array.from({ length: 6 }, (_, index) => ({ case_id: `w${index}`, language: "de", reason: "waiting_for_review" as const })),
      ...Array.from({ length: 4 }, (_, index) => ({ case_id: `n${index}`, language: "de", reason: "not_in_plan" as const })),
      { case_id: "a", language: "de", reason: "already_assigned" as const },
    ];
    expect(skippedLines(skipped, "de")).toEqual([
      "6 texts without a translation review under way: assign the review first",
      "4 texts without annotation of de in the plan (other languages are separate tasks)",
      "1 text already assigned",
    ]);
  });

  it("labels steps, reasons, partial targets and results", () => {
    // Issue 546: the dialog counts texts, as the selection bar does; versions only where they differ.
    expect(stepLabel("translation_review", "de", 20)).toBe("Translation review, de, 20 texts");
    expect(stepLabel("annotate", "fr", 1)).toBe("Annotation, fr, 1 text");
    expect(stepLabel("annotate", "fr", 2, 3)).toBe("Annotation, fr, 2 texts (3 versions)");
    expect(memberReason({ unavailable: "does_not_read", already_assigned: 0, reads: ["en"] }, "annotate", "de")).toBe("does not read de");
    expect(memberReason({ unavailable: "does_not_read", already_assigned: 0, reads: ["de"] }, "translation_review", "de")).toBe("does not read the source language");
    expect(memberReason({ unavailable: "role_missing", already_assigned: 0, reads: ["de"] }, "annotate", "de")).toBe("Cannot annotate in this project");
    expect(memberReason({ unavailable: "role_missing", already_assigned: 0, reads: ["de"] }, "translation_review", "de")).toBe("Cannot review translations in this project");
    expect(memberReason({ unavailable: null, already_assigned: 3, reads: ["de"] }, "annotate", "de")).toBe("Already annotating 3 of these texts");
    expect(memberReason({ unavailable: null, already_assigned: 0, reads: ["de"] }, "annotate", "de")).toBeNull();
    expect(partlyAssignedLines([{ case_id: "case-0101", language: "de", remaining: 1 }, { case_id: "case-0102", language: "de", remaining: 2 }], 2)).toEqual(["case-0101 de: 1 assigned (limit 2)"]);
    // Issue 422: a text's own limit replaces the project value.
    expect(partlyAssignedLines([{ case_id: "case-0101", language: "de", remaining: 3, per_text: 4 }, { case_id: "case-0102", language: "de", remaining: 1, per_text: 1 }], 1)).toEqual(["case-0101 de: 1 assigned (limit 4)"]);
    expect(resultMessage("translation_review", 20, [{ person: ana, count: 20 }])).toBe("20 translation reviews assigned to Ana Weber");
    expect(resultMessage("annotate", 2, [{ person: ana, count: 1 }, { person: ben, count: 1 }])).toBe("2 annotations assigned to Ana Weber and Ben Roth");
  });
});
