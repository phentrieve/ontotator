import { diffWordsWithSpace } from "diff";

export interface TextDiffPart {
  op: "equal" | "insert" | "delete";
  text: string;
}

/** Word diff over exact raw text; display rules and normalization live elsewhere. */
export function diffText(before: string, after: string): TextDiffPart[] {
  if (before === after) return [{ op: "equal", text: before }];
  const parts: TextDiffPart[] = [];
  for (const change of diffWordsWithSpace(before, after)) {
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

/** Removed passages of `before` and added passages of `after`, from the same word diff as the review screen's DiffView. */
export function changeRanges(before: string, after: string, parts: readonly TextDiffPart[] = diffText(before, after)): { removed: TextRange[]; added: TextRange[] } {
  const removed: TextRange[] = [], added: TextRange[] = [];
  let inBefore = 0, inAfter = 0;
  for (const part of parts) {
    const length = part.text.length;
    if (part.op === "delete") { removed.push({ start: inBefore, end: inBefore + length }); inBefore += length; }
    else if (part.op === "insert") { added.push({ start: inAfter, end: inAfter + length }); inAfter += length; }
    else { inBefore += length; inAfter += length; }
  }
  return { removed, added };
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

/** Words of an unchanged stretch that still joins two changes into one passage; never across a line break. */
const JOIN_WORDS = 2;
const joins = (equal: string): boolean => !/[\r\n]/.test(equal) && (equal.match(/[\p{L}\p{N}]+/gu)?.length ?? 0) <= JOIN_WORDS;

/**
 * Changed passages of `after` against `before`, from the same word diff as `changeRanges`: neighbouring changes with
 * at most two unchanged words between them on one line read as one passage ("Puls regelmäßig, apikal auskultierte
 * Herzfrequenz 120/min, Temperatur"), so the count and the Previous / Next steps follow sentences, not single words.
 */
export function changePassages(before: string, after: string, parts: readonly TextDiffPart[] = diffText(before, after)): ChangePassage[] {
  const passages: ChangePassage[] = [];
  let current: ChangePassage | null = null;
  let gap: string | null = null;
  let inBefore = 0, inAfter = 0;
  for (const part of parts) {
    const length = part.text.length;
    if (part.op === "equal") {
      if (current) gap = part.text;
      inBefore += length; inAfter += length;
      continue;
    }
    if (current && gap !== null && !joins(gap)) { passages.push(current); current = null; }
    if (!current) current = { start: inAfter, end: inAfter, beforeStart: inBefore, beforeEnd: inBefore, before: [], hasRemoved: false };
    else if (gap !== null) current.before.push({ text: gap, removed: false });
    gap = null;
    if (part.op === "delete") {
      current.before.push({ text: part.text, removed: true });
      current.hasRemoved = true;
      inBefore += length;
    } else {
      inAfter += length;
    }
    current.end = inAfter; current.beforeEnd = inBefore;
  }
  if (current) passages.push(current);
  return passages;
}
