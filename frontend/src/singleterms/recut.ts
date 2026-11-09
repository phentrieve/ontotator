/**
 * Re-cut of one occurrence (single-term review, spec section 3): the reviewer picks the first and last word
 * of the new span inside the occurrence's context window. The browser works in UTF-16; the server takes code
 * points of the whole text, so every offset goes through `toCodepoint` (spans/offsets.ts).
 */
import type { SingleTermContext } from "../api/client";
import { countCodepoints, toCodepoint } from "../spans/offsets";

export interface WordToken {
  index: number;
  text: string;
  /** UTF-16 offsets inside the context window. */
  start: number;
  end: number;
}

export interface RecutWindow {
  /** before + text + after, as the server sent them. */
  text: string;
  /** Code-point offset of the window's first character in the whole text. */
  base: number;
  /** The occurrence inside the window, UTF-16. */
  occurrenceStart: number;
  occurrenceEnd: number;
}

/** A word (letters, digits, marks, inner hyphens and apostrophes) or a single other non-space character. */
const TOKEN = /[\p{L}\p{N}\p{M}]+(?:['’-][\p{L}\p{N}\p{M}]+)*|[^\s\p{L}\p{N}\p{M}]/gu;

export function tokenize(text: string): WordToken[] {
  const tokens: WordToken[] = [];
  for (const match of text.matchAll(TOKEN)) {
    const start = match.index ?? 0;
    tokens.push({ index: tokens.length, text: match[0], start, end: start + match[0].length });
  }
  return tokens;
}

export function recutWindow(context: Pick<SingleTermContext, "before" | "text" | "after" | "start">): RecutWindow {
  return {
    text: context.before + context.text + context.after,
    base: context.start - countCodepoints(context.before),
    occurrenceStart: context.before.length,
    occurrenceEnd: context.before.length + context.text.length,
  };
}

/** The words that overlap the annotated occurrence: the starting selection. */
export function initialSelection(tokens: readonly WordToken[], window: RecutWindow): [number, number] | null {
  const inside = tokens.filter(token => token.start < window.occurrenceEnd && window.occurrenceStart < token.end);
  if (!inside.length) return null;
  return [inside[0].index, inside[inside.length - 1].index];
}

export interface RecutSpan {
  /** Code points in the whole text, as the decision request wants them. */
  start: number;
  end: number;
  /** The verbatim new phrase. */
  text: string;
  /** UTF-16 offsets in the window. */
  windowStart: number;
  windowEnd: number;
}

/** The span from word `first` to word `last` (either order). */
export function selectionSpan(window: RecutWindow, tokens: readonly WordToken[], first: number, last: number): RecutSpan {
  const [from, to] = first <= last ? [first, last] : [last, first];
  const windowStart = tokens[from].start, windowEnd = tokens[to].end;
  return {
    start: window.base + toCodepoint(window.text, windowStart),
    end: window.base + toCodepoint(window.text, windowEnd),
    text: window.text.slice(windowStart, windowEnd),
    windowStart,
    windowEnd,
  };
}

/** What the server checks first: the cut overlaps the occurrence and differs from it. */
export function recutProblem(window: RecutWindow, span: RecutSpan): string | null {
  const same = span.windowStart === window.occurrenceStart && span.windowEnd === window.occurrenceEnd;
  if (same) return "The new span is the annotated span. Pick other first or last words.";
  if (!(span.windowStart < window.occurrenceEnd && window.occurrenceStart < span.windowEnd)) {
    return "The new span must overlap the annotated span.";
  }
  return null;
}
