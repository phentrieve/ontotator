import { describe, expect, it } from "vitest";
import { submissionGuidelineLabel } from "../src/guidelines/submissionLabel";
import { currentGuidelineRef, guidelineVersionName } from "../src/guidelines/versionName";

describe("submissionGuidelineLabel", () => {
  it("names the version when it is the current one or none is in force", () => {
    expect(submissionGuidelineLabel(2, false, { version: 2 })).toBe("Guidelines v2");
    expect(submissionGuidelineLabel(2, false, null)).toBe("Guidelines v2");
  });
  it("adds the current version when the result was made under an older one", () => {
    expect(submissionGuidelineLabel(2, false, { version: 3 })).toBe("Guidelines v2 (current: v3)");
  });
  it("marks a withdrawn version, also when a newer one is in force", () => {
    expect(submissionGuidelineLabel(2, true, { version: 3 })).toBe("Guidelines v2 (withdrawn)");
    expect(submissionGuidelineLabel(2, true, null)).toBe("Guidelines v2 (withdrawn)");
  });
  it("says not recorded without a stamp", () => {
    expect(submissionGuidelineLabel(null, false, { version: 3 })).toBe("Guidelines: not recorded");
    expect(submissionGuidelineLabel(undefined, false, null)).toBe("Guidelines: not recorded");
  });
  it("puts the project's own label before the upload number (#487)", () => {
    expect(submissionGuidelineLabel(2, false, { version: 2, label: "3.1" }, "3.1")).toBe("Guidelines 3.1 (v2)");
    expect(submissionGuidelineLabel(2, false, { version: 3, label: "3.2" }, "3.1")).toBe("Guidelines 3.1 (v2) (current: 3.2 (v3))");
    expect(submissionGuidelineLabel(2, false, { version: 3 }, "3.1")).toBe("Guidelines 3.1 (v2) (current: v3)");
    expect(submissionGuidelineLabel(2, false, { version: 3, label: "3.2" })).toBe("Guidelines v2 (current: 3.2 (v3))");
    expect(submissionGuidelineLabel(2, true, { version: 3, label: "3.2" }, "3.1")).toBe("Guidelines 3.1 (v2) (withdrawn)");
  });
});

describe("guidelineVersionName", () => {
  it("names a version by its label and number, or by the number alone", () => {
    expect(guidelineVersionName(2, "3.1")).toBe("3.1 (v2)");
    expect(guidelineVersionName(2)).toBe("v2");
    expect(guidelineVersionName(2, null)).toBe("v2");
    expect(guidelineVersionName(2, "  ")).toBe("v2");
  });
  it("reads the version in force from a listing", () => {
    expect(currentGuidelineRef({ current: { version: 3, label: "3.2" } })).toEqual({ version: 3, label: "3.2" });
    expect(currentGuidelineRef({ current: { version: 3 } })).toEqual({ version: 3, label: null });
    expect(currentGuidelineRef({ current: null })).toBeNull();
  });
});
