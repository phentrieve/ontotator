/**
 * The offer to exclude a modifier's words from its finding's text span (issue: a modifier marked inside the finding's
 * span). Pure; offsets are Unicode code points, as everywhere in the editor.
 */
import type { Seg } from "./modifiers";

export interface SpanMention {
  evidenceId: string;
  segments: readonly Seg[];
  /** Cue segments (imported negation cues); a mention with cues is never offered, editing it would drop them. */
  cueSegments?: readonly Seg[];
}

export interface SpanExclusion {
  evidenceId: string;
  /** The mention's segments now. */
  before: Seg[];
  /** Its segments after the exclusion: the cut edges trimmed of spaces and punctuation. */
  after: Seg[];
  /** The parts of the mention the modifier covers (the words that go). */
  removed: Seg[];
}

const isGap = (char: string) => /[\s\p{P}]/u.test(char);
const isWord = (char: string | undefined) => char !== undefined && /[\p{L}\p{N}\p{M}]/u.test(char);

/** `segments` minus `cut`; each piece also says which of its edges are cut edges. */
function subtract(segments: readonly Seg[], cut: readonly Seg[]) {
  const pieces: { start: number; end: number; cutStart: boolean; cutEnd: boolean }[] = [];
  for (const segment of segments) {
    let parts = [{ start: segment.start, end: segment.end, cutStart: false, cutEnd: false }];
    for (const c of cut) {
      parts = parts.flatMap(part => {
        if (c.end <= part.start || c.start >= part.end) return [part];
        return [
          ...(c.start > part.start ? [{ ...part, end: c.start, cutEnd: true }] : []),
          ...(c.end < part.end ? [{ ...part, start: c.end, cutStart: true }] : []),
        ];
      });
    }
    pieces.push(...parts);
  }
  return pieces;
}

/**
 * The exclusion to offer once a modifier has the segments `modifier`, or null when there is none to offer:
 * the modifier lies outside every mention, covers a whole mention, or a cut would split a word.
 * The first mention the modifier overlaps is the one offered.
 */
export function exclusionOffer(text: string, mentions: readonly SpanMention[], modifier: readonly Seg[]): SpanExclusion | null {
  if (!modifier.length) return null;
  const chars = Array.from(text);
  const overlaps = (s: Seg) => modifier.some(m => m.start < s.end && m.end > s.start);
  const mention = mentions.find(item => item.segments.some(overlaps));
  if (!mention || mention.cueSegments?.length) return null;
  const after: Seg[] = [];
  for (const piece of subtract(mention.segments, modifier)) {
    let { start, end } = piece;
    // Only the edges the cut made are trimmed; the mention's own edges stay as the annotator set them.
    if (piece.cutStart) while (start < end && isGap(chars[start])) start += 1;
    if (piece.cutEnd) while (end > start && isGap(chars[end - 1])) end -= 1;
    if (!chars.slice(start, end).some(char => isWord(char))) continue;
    // A cut inside a word ("schwer|e") is no exclusion: the modifier was marked off its word edges.
    if (piece.cutStart && isWord(chars[start - 1]) && isWord(chars[start])) return null;
    if (piece.cutEnd && isWord(chars[end - 1]) && isWord(chars[end])) return null;
    after.push({ start, end });
  }
  // The modifier covers the whole mention: excluding it would leave the finding without text.
  if (!after.length) return null;
  const before = mention.segments.map(s => ({ start: s.start, end: s.end }));
  if (JSON.stringify(after) === JSON.stringify(before)) return null;
  const removed = mention.segments.flatMap(s => modifier
    .filter(m => m.start < s.end && m.end > s.start)
    .map(m => ({ start: Math.max(s.start, m.start), end: Math.min(s.end, m.end) })));
  return { evidenceId: mention.evidenceId, before, after, removed };
}

/** The mention's text with the parts that go marked: [{ text, removed }], in text order (the preview's first line). */
export function previewParts(text: string, offer: Pick<SpanExclusion, "before" | "removed">): { text: string; removed: boolean }[] {
  const chars = Array.from(text);
  const parts: { text: string; removed: boolean }[] = [];
  offer.before.forEach((segment, index) => {
    if (index > 0) parts.push({ text: chars.slice(offer.before[index - 1].end, segment.start).join("").trim() ? " … " : " ", removed: false });
    let at = segment.start;
    for (const r of offer.removed.filter(item => item.start >= segment.start && item.end <= segment.end).sort((a, b) => a.start - b.start)) {
      if (r.start > at) parts.push({ text: chars.slice(at, r.start).join(""), removed: false });
      parts.push({ text: chars.slice(r.start, r.end).join(""), removed: true });
      at = r.end;
    }
    if (at < segment.end) parts.push({ text: chars.slice(at, segment.end).join(""), removed: false });
  });
  return parts;
}
