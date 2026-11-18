/** One piece of a passage shown with its sentence: `marked` pieces are the passage itself. */
export interface ContextPart { text: string; marked: boolean }

type Seg = { start: number; end: number };

const SENTENCE_END = /[.!?…]/;
const SPACE = /\s/;
/** The most context shown on either side of the passage, in characters. */
const SIDE_LIMIT = 140;

/**
 * The sentence (or sentences) around the passage covered by codepoint `segments`, for reading a quoted passage where
 * the text itself is not on screen (issue 468: proposal details on a phone). A sentence ends at ". ", "! ", "? " or
 * a line break; a long side is cut at a word boundary and marked with "…". Null when there is no passage or the
 * sentence adds nothing to it.
 */
export function sentenceAround(text: string, segments: readonly Seg[] = []): ContextPart[] | null {
  const chars = Array.from(text);
  const spans = segments
    .map(s => ({ start: Math.max(0, s.start), end: Math.min(chars.length, s.end) }))
    .filter(s => s.end > s.start)
    .sort((a, b) => a.start - b.start);
  if (!spans.length) return null;
  const first = spans[0].start, last = Math.max(...spans.map(s => s.end));

  let from = first;
  while (from > 0 && chars[from - 1] !== "\n" && !(SPACE.test(chars[from - 1]) && from > 1 && SENTENCE_END.test(chars[from - 2]))) from--;
  let to = last;
  while (to < chars.length && chars[to] !== "\n" && !(SPACE.test(chars[to]) && SENTENCE_END.test(chars[to - 1]) && to > last)) to++;
  while (from < first && SPACE.test(chars[from])) from++;
  while (to > last && SPACE.test(chars[to - 1])) to--;
  if (from === first && to === last) return null;

  let before = chars.slice(from, first).join(""), after = chars.slice(last, to).join("");
  if (before.length > SIDE_LIMIT) before = `…${before.slice(-SIDE_LIMIT).replace(/^\S*\s+/, "")}`;
  if (after.length > SIDE_LIMIT) after = `${after.slice(0, SIDE_LIMIT).replace(/\s+\S*$/, "")}…`;

  const parts: ContextPart[] = [];
  const push = (value: string, marked: boolean) => { if (value) parts.push({ text: value, marked }); };
  push(before, false);
  let at = first;
  for (const span of spans) {
    if (span.end <= at && span.start < at) continue; // inside an earlier segment
    push(chars.slice(at, Math.max(at, span.start)).join(""), false);
    push(chars.slice(Math.max(at, span.start), span.end).join(""), true);
    at = Math.max(at, span.end);
  }
  push(after, false);
  return parts;
}
