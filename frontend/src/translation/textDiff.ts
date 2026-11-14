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
