/** A guideline version by its upload number, with the project's own label ("3.1") where it has one. */
export interface GuidelineRef { version: number; label?: string | null }

/**
 * How a guideline version is named everywhere: "3.1 (v2)" with the project's own label, "v2" without.
 * The upload number stays the identifier; the label only comes first.
 */
export function guidelineVersionName(version: number | string, label?: string | null): string {
  const own = label?.trim();
  return own ? `${own} (v${version})` : `v${version}`;
}

/** Longest label a version can have. */
export const MAX_GUIDELINE_LABEL_CHARS = 40;

/** The version in force of a guideline listing, `null` when none is. */
export function currentGuidelineRef(listing: { current?: GuidelineRef | null }): GuidelineRef | null {
  return listing.current ? { version: listing.current.version, label: listing.current.label ?? null } : null;
}
