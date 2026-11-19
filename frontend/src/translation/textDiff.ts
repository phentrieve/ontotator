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

/** A space, tab or no-break space: whitespace other than a line break. */
const HORIZONTAL_SPACE = /[^\S\r\n]/;
/** The spaces of a whitespace-only change as a reader sees them: no line breaks, every kind of space as a space. */
const spacing = (text: string): string => text.replace(/[\r\n]+/g, "").replace(/[^\S\r\n]/g, " ");

/**
 * Per part, whether a reader can see the change (the other display rule of marks, with `displayRanges`). A change
 * with a letter, digit or sign is seen. A change of spaces only is seen when the number of spaces changed: a double
 * space typed into the text, a removed space, a space at the end (issue 483). It is not seen, and neither marked nor
 * counted, when only the kind of whitespace changed (CRLF to LF, a no-break space to a space) or only line breaks did:
 * its mark would show nothing a reader can find.
 */
function visibleChanges(parts: readonly TextDiffPart[]): boolean[] {
  const visible = parts.map(part => part.op !== "equal" && /\S/.test(part.text));
  for (let start = 0; start < parts.length;) {
    if (parts[start].op === "equal") { start++; continue; }
    let end = start, removed = "", added = "";
    for (; end < parts.length && parts[end].op !== "equal"; end++) {
      if (parts[end].op === "delete") removed += parts[end].text; else added += parts[end].text;
    }
    if (/\S/.test(removed + added) || spacing(removed) !== spacing(added)) {
      for (let index = start; index < end; index++) if (HORIZONTAL_SPACE.test(parts[index].text)) visible[index] = true;
    }
    start = end;
  }
  return visible;
}

/**
 * Display rules for marks: a range never splits a grapheme (it grows to the grapheme's edges, so a changed person in
 * a ZWJ emoji marks the whole emoji) and overlapping ranges merge. Which changes get a range: `visibleChanges`.
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
  return result;
}

/**
 * Removed passages of `before` and added passages of `after`, from the same word diff as the review screen's
 * DiffView, ready to display (see `displayRanges`); the lengths of the two lists are the passage counts.
 * `null` when the texts differ too much (`diffTextBounded`): show no marks and say so.
 */
export function changeRanges(before: string, after: string, parts: readonly TextDiffPart[] | null = diffTextBounded(before, after)): { removed: TextRange[]; added: TextRange[] } | null {
  if (!parts) return null;
  const removed: TextRange[] = [], added: TextRange[] = [];
  const visible = visibleChanges(parts);
  let inBefore = 0, inAfter = 0;
  parts.forEach((part, index) => {
    const length = part.text.length;
    if (part.op === "delete") { if (visible[index]) removed.push({ start: inBefore, end: inBefore + length }); inBefore += length; }
    else if (part.op === "insert") { if (visible[index]) added.push({ start: inAfter, end: inAfter + length }); inAfter += length; }
    else { inBefore += length; inAfter += length; }
  });
  return { removed: displayRanges(before, removed), added: displayRanges(after, added) };
}

/** A part of the older wording of a changed passage: kept, or removed by the newer text. */
export interface PassagePart {
  text: string;
  removed: boolean;
}

/**
 * One changed passage of the newer text (Show changes since vN, issue 421): `[start, end)` in the newer text (empty
 * where text was only removed), `[beforeStart, beforeEnd)` in the older one, and the older wording of the passage.
 */
export interface ChangePassage {
  start: number;
  end: number;
  beforeStart: number;
  beforeEnd: number;
  /** The older wording: kept parts and removed parts, in order. */
  before: PassagePart[];
  /** Some text of the older version was removed here (the passage gets a "−" marker). */
  hasRemoved: boolean;
}

/** Grows `[start, end)` to the edges of the long graphemes it cuts (as `displayRanges` does for marks). */
function growToGraphemes(graphemes: readonly TextRange[], start: number, end: number): TextRange {
  if (end > start) for (const grapheme of graphemes) {
    if (grapheme.end <= start) continue;
    if (grapheme.start >= end) break;
    start = Math.min(start, grapheme.start); end = Math.max(end, grapheme.end);
  }
  return { start, end };
}

/** Words of an unchanged stretch that still joins two changes into one passage; never across a line break. */
const JOIN_WORDS = 2;
const joins = (equal: string): boolean => !/[\r\n]/.test(equal) && (equal.match(/[\p{L}\p{N}]+/gu)?.length ?? 0) <= JOIN_WORDS;

/**
 * Changed passages of `after` against `before`, from the same word diff as `changeRanges`: neighbouring changes with
 * at most two unchanged words between them on one line read as one passage ("Puls regelmäßig, apikal auskultierte
 * Herzfrequenz 120/min, Temperatur"), so the count and the Previous / Next steps follow sentences, not single words.
 * The display rules of `changeRanges` apply: a passage never splits a grapheme, and a passage whose changes a reader
 * cannot see (CRLF to LF, a no-break space to a space; `visibleChanges`) is left out. `null` when the texts differ too much
 * (`diffTextBounded`): show no marks and say so.
 */
export function changePassages(before: string, after: string, parts: readonly TextDiffPart[] | null = diffTextBounded(before, after)): ChangePassage[] | null {
  if (!parts) return null;
  const passages: Array<ChangePassage & { visible: boolean }> = [];
  let current: (ChangePassage & { visible: boolean }) | null = null;
  let gap: string | null = null;
  let inBefore = 0, inAfter = 0;
  const seen = visibleChanges(parts);
  for (const [index, part] of parts.entries()) {
    const length = part.text.length;
    if (part.op === "equal") {
      if (current) gap = part.text;
      inBefore += length; inAfter += length;
      continue;
    }
    if (current && gap !== null && !joins(gap)) { passages.push(current); current = null; }
    if (!current) current = { start: inAfter, end: inAfter, beforeStart: inBefore, beforeEnd: inBefore, before: [], hasRemoved: false, visible: false };
    else if (gap !== null) current.before.push({ text: gap, removed: false });
    gap = null;
    const visible = seen[index];
    if (visible) current.visible = true;
    if (part.op === "delete") {
      current.before.push({ text: part.text, removed: true });
      if (visible) current.hasRemoved = true;
      inBefore += length;
    } else {
      inAfter += length;
    }
    current.end = inAfter; current.beforeEnd = inBefore;
  }
  if (current) passages.push(current);
  const inAfterText = longGraphemes(after), inBeforeText = longGraphemes(before), result: ChangePassage[] = [];
  for (const { visible, ...passage } of passages) {
    if (!visible) continue;
    const shown = growToGraphemes(inAfterText, passage.start, passage.end);
    const earlier = growToGraphemes(inBeforeText, passage.beforeStart, passage.beforeEnd);
    // The earlier wording covers whole graphemes too: the unchanged rest of a cut grapheme joins it.
    const head = before.slice(earlier.start, passage.beforeStart), tail = before.slice(passage.beforeEnd, earlier.end);
    const grown: ChangePassage = { ...passage, ...shown, beforeStart: earlier.start, beforeEnd: earlier.end,
      before: [...(head ? [{ text: head, removed: false }] : []), ...passage.before, ...(tail ? [{ text: tail, removed: false }] : [])] };
    const last = result[result.length - 1];
    if (last && last.end > last.start && grown.start < last.end) {
      last.end = Math.max(last.end, grown.end); last.beforeEnd = Math.max(last.beforeEnd, grown.beforeEnd);
      last.before.push(...grown.before); last.hasRemoved ||= grown.hasRemoved;
    } else result.push(grown);
  }
  return result;
}
