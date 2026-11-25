import { diffText } from "./textDiff";

/**
 * Issue 610: the lead's "Take the proposed wording" writes into the reviewer's saved draft while the reviewer may
 * still be typing. The reviewer's screen merges that server change into the text on screen instead of discarding the
 * reviewer's edits: the merge is a three-way one between the text this screen last saved (`base`), the saved draft
 * (`server`) and the text on screen (`local`), and it only knows one kind of server change, a taken wording.
 */

/** A question whose proposed wording the lead took into the text (the fields of a question view it needs). */
export interface TakenWording {
  report_id: string;
  quote: string;
  proposed_text: string;
  answered_at?: string | null;
}

/** One replacement in a text, in UTF-16 code units of the text before it. */
export interface Replacement { start: number; end: number; text: string }

/** A taken wording the screen did not put in: the reviewer had changed its passage meanwhile. */
export interface KeptWording {
  wording: TakenWording;
  /** The reviewer's version of the passage the wording replaces; empty when it could not be told. */
  mine: string;
}

export type ServerMerge =
  /** The server change is explained by taken wordings: `text` is the reviewer's text with those put in. */
  | { kind: "merged"; text: string; applied: TakenWording[]; kept: KeptWording[]; replacements: Replacement[] }
  /** Another change, which is not merged: the reviewer chooses. */
  | { kind: "conflict" };

const occurrences = (text: string, part: string): number => part === "" ? 0 : text.split(part).length - 1;

/** `text` with the passage replaced by the wording; null unless the passage occurs exactly once (as on the server). */
export function takeWording(text: string, quote: string, wording: string): string | null {
  if (occurrences(text, quote) !== 1) return null;
  const start = text.indexOf(quote);
  return text.slice(0, start) + wording + text.slice(start + quote.length);
}

/** The wordings in the order the lead took them. */
function inAnswerOrder(taken: readonly TakenWording[]): TakenWording[] {
  const time = (value: TakenWording) => value.answered_at ? Date.parse(value.answered_at) : Number.POSITIVE_INFINITY;
  return taken.map((value, index) => ({ value, index }))
    .sort((a, b) => time(a.value) - time(b.value) || a.index - b.index).map(entry => entry.value);
}

/**
 * The run of taken wordings that turns `base` into `server`: empty when both are the same, null when no run does.
 * The lead's takes since this screen's last save follow each other in answer order, so only runs are tried.
 */
export function wordingsBetween(base: string, server: string, taken: readonly TakenWording[]): TakenWording[] | null {
  if (base === server) return [];
  const ordered = inAnswerOrder(taken);
  for (let first = 0; first < ordered.length; first += 1) {
    let current = base;
    for (let last = first; last < ordered.length; last += 1) {
      const next = takeWording(current, ordered[last].quote, ordered[last].proposed_text);
      if (next === null) break;
      current = next;
      if (current === server) return ordered.slice(first, last + 1);
    }
  }
  return null;
}

/**
 * Where the passage `[start, end)` of `before` stands in `after`, by a word diff of the two. A replaced passage
 * covers its replacement, also when the replacement is several words (issue 616: the word diff matches a space
 * between the new words as unchanged, so the replacement runs on through such spaces); text added right before or
 * after the passage stays outside it.
 */
export function passageAfterEdits(before: string, after: string, start: number, end: number): { start: number; end: number } | null {
  if (start < 0 || end > before.length || start >= end) return null;
  const parts = diffText(before, after);
  let b = 0, a = 0, from: number | null = null, to: number | null = null, extend = false, bridged = false;
  for (let index = 0; index < parts.length; index += 1) {
    const part = parts[index];
    const length = part.text.length;
    if (part.op === "insert") {
      if (extend && to !== null) to += length;
      a += length;
      continue;
    }
    // A space between two inserted words of the replacement belongs to it.
    if (extend && to !== null && part.op === "equal" && /^\s+$/.test(part.text) && parts[index + 1]?.op === "insert") {
      to += length;
      bridged = true;
      b += length;
      a += length;
      continue;
    }
    extend = false;
    if (from === null && start < b + length) from = part.op === "equal" ? a + (start - b) : a;
    if (to === null && end <= b + length) {
      to = part.op === "equal" ? a + (end - b) : a;
      // A deleted end that was replaced: the replacement belongs to the passage.
      extend = part.op === "delete" && end === b + length;
    }
    b += length;
    if (part.op === "equal") a += length;
  }
  // The space a bridged replacement ends with stood after the passage.
  if (bridged && from !== null && to !== null) while (to > from && /\s/.test(after[to - 1])) to -= 1;
  return from !== null && to !== null && from <= to ? { start: from, end: to } : null;
}

/**
 * Merges the saved draft into the reviewer's text. Each taken wording goes in where its passage is still in the
 * reviewer's text exactly once; where the reviewer changed that passage, the reviewer's text wins and the wording is
 * reported as kept out. A server change that is not a run of taken wordings is a conflict.
 */
export function mergeServerText(base: string, server: string, local: string, taken: readonly TakenWording[]): ServerMerge {
  const run = wordingsBetween(base, server, taken);
  if (run === null) return { kind: "conflict" };
  const applied: TakenWording[] = [], kept: KeptWording[] = [], replacements: Replacement[] = [];
  let before = base, text = local;
  for (const wording of run) {
    const start = occurrences(text, wording.quote) === 1 ? text.indexOf(wording.quote) : -1;
    if (start >= 0) {
      replacements.push({ start, end: start + wording.quote.length, text: wording.proposed_text });
      text = text.slice(0, start) + wording.proposed_text + text.slice(start + wording.quote.length);
      applied.push(wording);
    } else {
      const at = before.indexOf(wording.quote);
      const passage = passageAfterEdits(before, text, at, at + wording.quote.length);
      kept.push({ wording, mine: passage ? text.slice(passage.start, passage.end) : "" });
    }
    before = takeWording(before, wording.quote, wording.proposed_text) ?? before;
  }
  return { kind: "merged", text, applied, kept, replacements };
}

/** An offset of the text before `replacements` in the text after them; inside a replaced passage, its end. */
export function mapOffset(offset: number, replacements: readonly Replacement[]): number {
  let value = offset;
  for (const { start, end, text } of replacements) {
    if (value >= end) value += text.length - (end - start);
    else if (value > start) value = start + text.length;
  }
  return value;
}
