import { diffWordsWithSpace } from "diff";

export interface TextDiffPart {
  op: "equal" | "insert" | "delete";
  text: string;
}

/**
 * Bounds of the word diff. Its cost grows with the number of differing words, not with the text length: similar
 * texts of any size are fast, two unrelated texts of 10,000 words would block the tab for many seconds.
 */
export interface DiffLimits {
  /** Give up beyond this many inserted plus deleted tokens (words, punctuation, whitespace runs). */
  maxEditLength: number;
  /** Give up after this many milliseconds. */
  timeoutMs: number;
}
export const DIFF_LIMITS: DiffLimits = { maxEditLength: 4000, timeoutMs: 400 };

/**
 * Word diff over exact raw text, bounded by `limits`: `null` when the texts differ too much to diff in time.
 * Every view that diffs whole texts on the main thread (Show changes) uses this, so one bound applies everywhere.
 */
export function diffTextBounded(before: string, after: string, limits: DiffLimits = DIFF_LIMITS): TextDiffPart[] | null {
  if (before === after) return [{ op: "equal", text: before }];
  const changes = diffWordsWithSpace(before, after, { maxEditLength: limits.maxEditLength, timeout: limits.timeoutMs });
  return changes ? partsOf(changes) : null;
}

/** Word diff over exact raw text; display rules and normalization live elsewhere. Unbounded: see `diffTextBounded`. */
export function diffText(before: string, after: string): TextDiffPart[] {
  if (before === after) return [{ op: "equal", text: before }];
  return partsOf(diffWordsWithSpace(before, after));
}

function partsOf(changes: readonly { value: string; added?: boolean; removed?: boolean }[]): TextDiffPart[] {
  const parts: TextDiffPart[] = [];
  for (const change of changes) {
    if (change.value.length === 0) continue;
    const op = change.added ? "insert" : change.removed ? "delete" : "equal";
    const previous = parts[parts.length - 1];
    if (previous?.op === op) previous.text += change.value;
    else parts.push({ op, text: change.value });
  }
  return parts;
}

/** A changed passage of one text, in UTF-16 code units of that text (as the DOM and the span editor count). */
export interface TextRange {
  start: number;
  end: number;
}

/**
 * Display-only change marks for one side of a comparison: the removed passages of the older text (`delete`) or the
 * added passages of the newer text (`insert`). Shared by every reading view that shows changes (TextPane `changes`).
 */
export interface TextChanges {
  op: "insert" | "delete";
  ranges: TextRange[];
}

/** Starts and ends of the graphemes of `text` that span several UTF-16 units (emoji sequences, combining marks). */
function longGraphemes(text: string): TextRange[] {
  // Plain ASCII has no such grapheme except CR LF, which a range may split.
  if (typeof Intl === "undefined" || typeof Intl.Segmenter !== "function" || !/[^\x00-\x7f]/.test(text)) return [];
  const found: TextRange[] = [];
  for (const { segment, index } of new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(text))
    if (segment.length > 1) found.push({ start: index, end: index + segment.length });
  return found;
}

/**
 * Display rules for marks: a range never splits a grapheme (it grows to the grapheme's edges, so a changed person in
 * a ZWJ emoji marks the whole emoji), overlapping ranges merge, and a whitespace-only change (CRLF to LF, a
 * no-break space to a space) is left out: its mark would be invisible, and it is no passage a reader can find.
 */
function displayRanges(text: string, ranges: readonly TextRange[]): TextRange[] {
  if (!ranges.length) return [];
  const graphemes = longGraphemes(text), result: TextRange[] = [];
  let cursor = 0;
  for (const range of ranges) {
    let { start, end } = range;
    while (cursor < graphemes.length && graphemes[cursor].end <= start) cursor++;
    for (let index = cursor; index < graphemes.length && graphemes[index].start < end; index++) {
      start = Math.min(start, graphemes[index].start); end = Math.max(end, graphemes[index].end);
    }
    const last = result[result.length - 1];
    if (last && start <= last.end) last.end = Math.max(last.end, end);
    else result.push({ start, end });
  }
  return result.filter(range => /\S/.test(text.slice(range.start, range.end)));
}

/**
 * Removed passages of `before` and added passages of `after`, from the same word diff as the review screen's
 * DiffView, ready to display (see `displayRanges`); the lengths of the two lists are the passage counts.
 * `null` when the texts differ too much (`diffTextBounded`): show no marks and say so.
 */
export function changeRanges(before: string, after: string, parts: readonly TextDiffPart[] | null = diffTextBounded(before, after)): { removed: TextRange[]; added: TextRange[] } | null {
  if (!parts) return null;
  const removed: TextRange[] = [], added: TextRange[] = [];
  let inBefore = 0, inAfter = 0;
  for (const part of parts) {
    const length = part.text.length;
    if (part.op === "delete") { removed.push({ start: inBefore, end: inBefore + length }); inBefore += length; }
    else if (part.op === "insert") { added.push({ start: inAfter, end: inAfter + length }); inAfter += length; }
    else { inBefore += length; inAfter += length; }
  }
  return { removed: displayRanges(before, removed), added: displayRanges(after, added) };
}
