/**
 * What the colour of a mark means: the one place that maps a meaning to a palette slot.
 *
 * The palette is `--mark-0-fill` … `--mark-5-fill` in `styles/tokens.css`; the
 * `.run--color-N` block in `styles/screens/editor.css` binds slot N to `--mark-N-fill`. Neither knows
 * what a colour stands for. This module does: today a mark is coloured by its term, so
 * the same term looks the same wherever it appears. To give colours another meaning
 * (by layer, by kind, …) change `MARK_COLOUR_MEANING`, or add a meaning here; the
 * callers pass every attribute a meaning may need and do not change.
 *
 * The state of a mark (own, proposal, reference, negated, selected) is never a colour:
 * it is drawn as a line style or pattern, so it stays readable whatever the colours mean.
 *
 * A modifier segment (e.g. "schwere" for Severe of Seizure) takes its finding's slot, so colour
 * connects it to its finding; its state is the `run--modifier` double underline.
 *
 * Two steps (issue 524): `markColour` gives a mark its preferred slot and the key of its meaning
 * (its term); `assignMarkColours` then looks at all marks of one text and moves a key to another
 * slot where it would share a colour with a different key that overlaps it or stands next to it in
 * the same sentence. The same key keeps one slot across the text wherever the palette allows.
 */

/** Number of palette slots (`--mark-0-fill` … `--mark-5-fill`). */
export const MARK_PALETTE_SIZE = 6;

/** What a mark's colour can stand for. */
export type MarkColourMeaning = "term" | "layer" | "kind";

/** The meaning in use. */
export const MARK_COLOUR_MEANING: MarkColourMeaning = "term";

/** Everything a meaning may look at; callers fill in what they know. */
export interface MarkColourSubject {
  termId?: string | null;
  layerId?: string | null;
  kind?: "own" | "target" | "source";
}

/** A stable slot for a key: the same key always gets the same colour. */
export function hashSlot(key: string): number {
  if (!key) return 0;
  let hash = 0;
  for (let i = 0; i < key.length; i++) {
    hash = (hash << 5) - hash + key.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash) % MARK_PALETTE_SIZE;
}

/** Fixed slots where a meaning has few, known values. */
const KIND_SLOTS: Record<NonNullable<MarkColourSubject["kind"]>, number> = {
  own: 1,
  target: 0,
  source: 3,
};

const SLOT_BY_MEANING: Record<MarkColourMeaning, (subject: MarkColourSubject) => number> = {
  term: (s) => hashSlot(s.termId ?? ""),
  layer: (s) => hashSlot(s.layerId ?? ""),
  kind: (s) => (s.kind ? KIND_SLOTS[s.kind] : 0),
};

/** The key of what a mark's colour stands for: marks with one key are one colour. */
const KEY_BY_MEANING: Record<MarkColourMeaning, (subject: MarkColourSubject) => string> = {
  term: (s) => `term:${s.termId ?? ""}`,
  layer: (s) => `layer:${s.layerId ?? ""}`,
  kind: (s) => `kind:${s.kind ?? ""}`,
};

/** The palette slot (0 … MARK_PALETTE_SIZE - 1) of a mark. */
export function markColourSlot(
  subject: MarkColourSubject,
  meaning: MarkColourMeaning = MARK_COLOUR_MEANING,
): number {
  return SLOT_BY_MEANING[meaning](subject);
}

/**
 * A mark's preferred slot and the key of what its colour stands for (marks with one key are one colour).
 * Spread it into a mark display: `{ ...markColour(subject) }`; `assignMarkColours` may move the slot.
 */
export function markColour(
  subject: MarkColourSubject,
  meaning: MarkColourMeaning = MARK_COLOUR_MEANING,
): { colorIndex: number; colourKey: string } {
  return { colorIndex: SLOT_BY_MEANING[meaning](subject), colourKey: KEY_BY_MEANING[meaning](subject) };
}

/** A mark as `assignMarkColours` sees it: codepoint segments, a preferred slot and its colour key. */
export interface ColourableMark {
  segments: readonly { start: number; end: number }[];
  colorIndex?: number;
  colourKey?: string;
}

/**
 * Two marks "stand next to each other" when at most this many characters lie between them and no
 * sentence ends there ("periorbital and facial oedema": 5 characters between "periorbital" and "facial").
 */
export const NEIGHBOUR_GAP = 24;

/** Overlap weighs more than nearness when the palette runs out and a shared colour cannot be avoided. */
const OVERLAP_WEIGHT = 100;
const NEAR_WEIGHT = 1;

const SENTENCE_END = /[.!?…]/;
const SPACE = /\s/;

/**
 * `ends[i]`: the number of sentence ends before codepoint `i`. A sentence ends at a line break or at a
 * space after ".", "!", "?" or "…" (the rule of editor/passageContext.ts).
 */
function sentenceEnds(text: string): Int32Array {
  const chars = Array.from(text);
  const ends = new Int32Array(chars.length + 1);
  for (let i = 0; i < chars.length; i++) {
    const end = chars[i] === "\n" || (SPACE.test(chars[i]) && i > 0 && SENTENCE_END.test(chars[i - 1]));
    ends[i + 1] = ends[i] + (end ? 1 : 0);
  }
  return ends;
}

/**
 * The slots of all marks of one text, so that marks with different colour keys that overlap or stand next
 * to each other in a sentence never share a slot (as long as the palette has a free one), and marks with
 * the same key share one slot across the text wherever possible.
 *
 * A greedy graph colouring: one node per colour key, in the order of the key's first mark in the text
 * (then by key); an edge where two marks of different keys overlap or are neighbours (`NEIGHBOUR_GAP`).
 * A key keeps its preferred slot (its term's hash) unless an earlier neighbour has it, then it takes the
 * next free slot after it. Only when no slot is free for all its marks does the key split: its marks keep
 * the slot that collides least where it is free for them, and each other mark takes the slot its own
 * neighbours use least (overlaps count most). The same marks and text always
 * give the same slots; an edit changes the slots of the keys around it only.
 *
 * Marks without a number `colorIndex` are left as they are; marks without a key are keyed by their slot.
 * Returns the marks in their order, a mark copied only where its slot changes.
 */
export function assignMarkColours<T extends ColourableMark>(marks: readonly T[], text: string): T[] {
  const units = marks
    .map((mark, index) => ({
      index,
      key: mark.colourKey ?? `slot:${mark.colorIndex}`,
      preferred: mark.colorIndex ?? 0,
      segments: mark.segments.filter((s) => s.end > s.start).map((s) => ({ start: s.start, end: s.end })),
    }))
    .filter((unit) => typeof marks[unit.index].colorIndex === "number" && unit.segments.length > 0);
  if (units.length < 2) return [...marks];

  const ends = sentenceEnds(text);
  const lastEnd = ends.length - 1;
  const endsBetween = (from: number, to: number) =>
    ends[Math.max(0, Math.min(to, lastEnd))] - ends[Math.max(0, Math.min(from, lastEnd))] > 0;

  // Edges between marks, by sweeping their segments in text order.
  const weights = units.map(() => new Map<number, number>());
  const segments = units
    .flatMap((unit, u) => unit.segments.map((s) => ({ u, start: s.start, end: s.end })))
    .sort((a, b) => a.start - b.start || a.end - b.end || a.u - b.u);
  for (let i = 0; i < segments.length; i++) {
    const a = segments[i];
    for (let j = i + 1; j < segments.length && segments[j].start <= a.end + NEIGHBOUR_GAP; j++) {
      const b = segments[j];
      if (b.u === a.u || units[b.u].key === units[a.u].key) continue;
      let weight = 0;
      if (b.start < a.end) weight = OVERLAP_WEIGHT;
      else if (!endsBetween(a.end, b.start)) weight = NEAR_WEIGHT;
      if (weight > (weights[a.u].get(b.u) ?? 0)) {
        weights[a.u].set(b.u, weight);
        weights[b.u].set(a.u, weight);
      }
    }
  }

  const groups = new Map<string, number[]>();
  for (let u = 0; u < units.length; u++) groups.set(units[u].key, [...(groups.get(units[u].key) ?? []), u]);
  const firstStart = (members: number[]) => Math.min(...members.flatMap((u) => units[u].segments.map((s) => s.start)));
  const order = [...groups.entries()]
    .map(([key, members]) => ({ key, members, start: firstStart(members) }))
    .sort((a, b) => a.start - b.start || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));

  const slots: Array<number | undefined> = units.map(() => undefined);
  /** The slots in the order a mark tries them: its preferred one, then the next ones round the palette. */
  const candidates = (preferred: number) =>
    Array.from({ length: MARK_PALETTE_SIZE }, (_, step) => (((preferred + step) % MARK_PALETTE_SIZE) + MARK_PALETTE_SIZE) % MARK_PALETTE_SIZE);
  const cost = (members: number[], slot: number) => {
    let total = 0;
    for (const u of members) for (const [v, weight] of weights[u]) if (slots[v] === slot) total += weight;
    return total;
  };

  for (const { members } of order) {
    const preferred = units[members[0]].preferred;
    const free = candidates(preferred).find((slot) => cost(members, slot) === 0);
    if (free !== undefined) {
      for (const u of members) slots[u] = free;
      continue;
    }
    // The palette is too small around this key: its marks keep the slot that collides least where that slot
    // is free for them; each other mark takes the slot its own neighbours use least.
    const leastFor = (members: number[]) => {
      let best = preferred;
      let bestCost = Infinity;
      for (const slot of candidates(preferred)) {
        const c = cost(members, slot);
        if (c < bestCost) [best, bestCost] = [slot, c];
      }
      return best;
    };
    const shared = leastFor(members);
    for (const u of members) slots[u] = cost([u], shared) === 0 ? shared : leastFor([u]);
  }

  const result = [...marks];
  units.forEach((unit, u) => {
    if (slots[u] !== marks[unit.index].colorIndex) result[unit.index] = { ...marks[unit.index], colorIndex: slots[u] };
  });
  return result;
}
