/**
 * MOCKUP model for the owner's sign-off (#595, docs/design/manual-sentence-pairing.md): the reviewer pairs source and
 * translation sentences by hand. A pair is the same thing as a segment pair of #579 (source range, translation range,
 * check bound to the translation's hash); only its origin is "manual". Pure functions, no storage.
 */
import { sentenceHash, type Sentence } from "../translation/sentences";

export type Side = "source" | "translation";
/** Sentence indexes [start, end); an empty range is a sentence with no counterpart (1:0 or 0:1). */
export type Range = readonly [number, number];
export interface ManualPair {
  id: number;
  source: Range;
  translation: Range;
  /** The hash of the pair's translation when it was checked; null = not checked. */
  checkedHash: string | null;
  origin: "manual" | "alignment";
}
/** Contiguous, ascending sentence indexes per side. */
export interface Selection { source: number[]; translation: number[] }
export type PairState = "open" | "checked" | "stale";

const indexes = ([start, end]: Range) => Array.from({ length: end - start }, (_, i) => start + i);
const rangeOf = (selected: readonly number[]): Range => selected.length ? [selected[0], selected[selected.length - 1] + 1] : [0, 0];

export function pairedIndexes(pairs: readonly ManualPair[], side: Side): Set<number> {
  return new Set(pairs.flatMap(pair => indexes(pair[side])));
}

function firstFree(pairs: readonly ManualPair[], side: Side, total: number): number | null {
  const taken = pairedIndexes(pairs, side);
  for (let i = 0; i < total; i += 1) if (!taken.has(i)) return i;
  return null;
}

/** The proposal the composer starts with: the first unpaired sentence of each text (1:1, in reading order). */
export function nextSelection(pairs: readonly ManualPair[], counts: Record<Side, number>): Selection {
  const s = firstFree(pairs, "source", counts.source);
  const t = firstFree(pairs, "translation", counts.translation);
  return { source: s == null ? [] : [s], translation: t == null ? [] : [t] };
}

/**
 * A click or tap on an unpaired sentence: next to the selection it extends it, at its edge it shrinks it, inside it
 * the selection starts again from that sentence, anywhere else it starts there. The selection stays contiguous.
 */
export function toggle(selected: readonly number[], index: number, taken: ReadonlySet<number>): number[] {
  if (taken.has(index)) return [...selected];
  if (selected.length === 0) return [index];
  const first = selected[0], last = selected[selected.length - 1];
  if (index === first - 1) return [index, ...selected];
  if (index === last + 1) return [...selected, index];
  if (index === first && selected.length > 1) return selected.slice(1);
  if (index === last && selected.length > 1) return selected.slice(0, -1);
  if (index === first && index === last) return [];
  return [index];
}

/** "+ next sentence" of one text: the unpaired sentence after the selection (or the first unpaired one). */
export function extend(selected: readonly number[], taken: ReadonlySet<number>, total: number): number[] {
  if (selected.length === 0) {
    for (let i = 0; i < total; i += 1) if (!taken.has(i)) return [i];
    return [];
  }
  const next = selected[selected.length - 1] + 1;
  return next < total && !taken.has(next) ? [...selected, next] : [...selected];
}

/** Why the selection cannot be paired; null when it can. */
export function pairReason(selection: Selection): string | null {
  return selection.source.length === 0 && selection.translation.length === 0 ? "Select a sentence of either text first." : null;
}

/** What Pair does with this selection, for its label. */
export function pairLabel(selection: Selection): string {
  if (selection.source.length && !selection.translation.length) return "Not in the translation";
  if (!selection.source.length && selection.translation.length) return "Not in the source";
  return `Pair ${selection.source.length}:${selection.translation.length}`;
}

export function pair(pairs: readonly ManualPair[], selection: Selection, id: number): ManualPair[] {
  return [...pairs, { id, source: rangeOf(selection.source), translation: rangeOf(selection.translation), checkedHash: null, origin: "manual" }];
}

/** Unpair: the sentences go back to the unpaired ones and the pair's check is dropped (Undo restores both). */
export function unpair(pairs: readonly ManualPair[], id: number): ManualPair[] {
  return pairs.filter(pair => pair.id !== id);
}

export function translationText(pair: ManualPair, sentences: readonly Sentence[]): string {
  return indexes(pair.translation).map(i => sentences[i]?.text ?? "").join(" ");
}

export function setChecked(pair: ManualPair, sentences: readonly Sentence[], checked: boolean): ManualPair {
  return { ...pair, checkedHash: checked ? sentenceHash(translationText(pair, sentences)) : null };
}

/** As #579 (B4-3): checked while the translation reads the same, ignoring white space; else changed since checked. */
export function pairState(pair: ManualPair, sentences: readonly Sentence[]): PairState {
  if (pair.checkedHash == null) return "open";
  return pair.checkedHash === sentenceHash(translationText(pair, sentences)) ? "checked" : "stale";
}

/** Rows in reading order of the source; a pair without source sentences goes after the pair before its translation. */
export function rowOrder(pairs: readonly ManualPair[]): ManualPair[] {
  const key = (pair: ManualPair): number => {
    if (pair.source[1] > pair.source[0]) return pair.source[0];
    const before = pairs.filter(other => other.source[1] > other.source[0] && other.translation[1] > other.translation[0] && other.translation[1] <= pair.translation[0]);
    return before.length ? Math.max(...before.map(other => other.source[1])) - 0.5 : -0.5;
  };
  return [...pairs].sort((a, b) => key(a) - key(b) || a.translation[0] - b.translation[0]);
}

/** Pairs whose order in the translation differs from the source (allowed, but shown, since it is rare and often a slip). */
export function crossing(pairs: readonly ManualPair[]): Set<number> {
  const out = new Set<number>();
  const full = pairs.filter(p => p.source[1] > p.source[0] && p.translation[1] > p.translation[0]);
  for (const a of full) for (const b of full) {
    if (a.source[0] < b.source[0] && a.translation[0] > b.translation[0]) { out.add(a.id); out.add(b.id); }
  }
  return out;
}
