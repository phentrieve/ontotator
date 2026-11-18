import { guidelineVersionName, type GuidelineRef } from "./versionName";

/**
 * Guideline label of a submitted result (spec "Submitted results"): "Guidelines v2",
 * "Guidelines v2 (current: v3)" when a newer version is in force, "Guidelines v2 (withdrawn)",
 * or "Guidelines: not recorded" without a stamp (imported results, or no version in force at submit).
 * `current` is the version in force, `null` when none is or it is not known. A version with the
 * project's own label reads "Guidelines 3.1 (v2) (current: 3.2 (v3))".
 */
export function submissionGuidelineLabel(version: number | null | undefined, withdrawn: boolean, current: GuidelineRef | null, label?: string | null): string {
  if (version == null) return "Guidelines: not recorded";
  const name = guidelineVersionName(version, label);
  if (withdrawn) return `Guidelines ${name} (withdrawn)`;
  if (current !== null && current.version > version) return `Guidelines ${name} (current: ${guidelineVersionName(current.version, current.label)})`;
  return `Guidelines ${name}`;
}
