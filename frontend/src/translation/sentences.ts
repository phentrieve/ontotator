/**
 * Sentences of a review text and the reviewer's checked-sentence marks (issue 256).
 * Marks are a working aid only: each side of the review is marked on its own, and a
 * mark names a sentence by its index and a short hash of its text, so an edited
 * sentence is "changed since checked" and a new text never shows wrong marks.
 */

export interface Sentence {
  index: number;
  /** UTF-16 offsets of the sentence without its surrounding white space. */
  start: number;
  end: number;
  text: string;
  hash: string;
}
export interface StoredMark { index: number; hash: string }
export interface StoredMarks { source: StoredMark[]; translation: StoredMark[] }
export type MarkState = { kind: "checked" } | { kind: "stale"; hash: string } | null;
export type Side = keyof StoredMarks;

/** A short, stable hash of a sentence (FNV-1a, 32 bit), ignoring runs of white space. */
export function sentenceHash(text: string): string {
  let hash = 0x811c9dc5;
  for (const char of text.trim().replace(/\s+/gu, " ")) {
    const point = char.codePointAt(0) ?? 0;
    for (const byte of [point & 0xff, (point >>> 8) & 0xff, (point >>> 16) & 0xff]) {
      hash ^= byte;
      hash = Math.imul(hash, 0x01000193) >>> 0;
    }
  }
  return hash.toString(16).padStart(8, "0");
}

type Segment = { index: number; segment: string };
type SegmentText = (line: string) => Iterable<Segment>;

/** Sentence ends for texts where Intl.Segmenter is missing: . ! ? … with closing quotes or brackets. */
function regexSegments(line: string): Segment[] {
  const segments: Segment[] = [];
  let start = 0;
  for (const match of line.matchAll(/[.!?…。！？]+["'”’»)\]]*\s+/gu)) {
    const end = (match.index ?? 0) + match[0].length;
    segments.push({ index: start, segment: line.slice(start, end) });
    start = end;
  }
  if (start < line.length) segments.push({ index: start, segment: line.slice(start) });
  return segments;
}

/** Abbreviations whose full stop does not end a sentence. */
const ABBREVIATIONS = new Set(["approx", "bzw", "ca", "dr", "evtl", "ggf", "inkl", "mind", "mr", "mrs", "ms", "nr", "prof", "sog", "st", "tgl", "vgl", "vs"]);

/**
 * Whether the text ends in an abbreviation, so the sentence goes on ("Dr. Müller", "z. B.", in German "am 3. Mai").
 * shortcut: a sentence ending in a lone letter ("Vitamin D.") joins the next one, two sentences get one mark; add an exception list if reviewers trip over it.
 */
function endsInAbbreviation(text: string, lang: string | undefined): boolean {
  // A word of its own: the "C" of "39 °C." does end a sentence.
  const word = /(?:^|[\s(])([\p{L}\p{N}]+)\.$/u.exec(text)?.[1].toLowerCase();
  if (!word) return false;
  return ([...word].length === 1 && /\p{L}/u.test(word)) || ABBREVIATIONS.has(word) || (lang?.startsWith("de") === true && /^\d+$/.test(word));
}

function segmenterFor(lang: string | undefined, useSegmenter: boolean): SegmentText {
  const Segmenter = useSegmenter ? (Intl as { Segmenter?: typeof Intl.Segmenter }).Segmenter : undefined;
  if (!Segmenter) return regexSegments;
  let segmenter: Intl.Segmenter;
  try { segmenter = new Segmenter(lang || undefined, { granularity: "sentence" }); }
  catch { try { segmenter = new Segmenter(undefined, { granularity: "sentence" }); } catch { return regexSegments; } }
  return line => segmenter.segment(line);
}

/**
 * The sentences of a text in its language. Every line break ends a sentence, so a
 * sentence never spans paragraphs; a text of one long paragraph still splits into its
 * sentences. White space between sentences belongs to none of them. A split after an
 * abbreviation is undone: clinical texts are full of them.
 */
export function splitSentences(text: string, lang?: string, { segmenter: useSegmenter = true } = {}): Sentence[] {
  const segment = segmenterFor(lang, useSegmenter);
  const spans: { start: number; end: number }[] = [];
  let lineStart = 0;
  for (const line of text.split("\n")) {
    let open: { start: number; end: number } | null = null;
    for (const part of segment(line)) {
      const lead = part.segment.length - part.segment.trimStart().length;
      const body = part.segment.trim();
      if (!body) continue;
      const start = lineStart + part.index + lead, end = start + body.length;
      if (open && endsInAbbreviation(text.slice(open.start, open.end), lang)) open.end = end;
      else spans.push(open = { start, end });
    }
    lineStart += line.length + 1;
  }
  return spans.map(({ start, end }, index) => {
    const body = text.slice(start, end);
    return { index, start, end, text: body, hash: sentenceHash(body) };
  });
}

/**
 * The state of every sentence from the stored marks. A mark belongs to the sentence at its index and to no other:
 * with that sentence's hash it is checked, with another hash the sentence is "changed since checked". A mark is
 * never moved to a sentence with the same text elsewhere (clinical texts repeat short sentences such as
 * "Unauffällig."); marks follow an edit through `rebaseMarks` instead.
 */
export function resolveMarks(sentences: readonly Sentence[], marks: readonly StoredMark[]): MarkState[] {
  const states: MarkState[] = sentences.map(() => null);
  for (const mark of marks) {
    const sentence = sentences[mark.index];
    if (!sentence) continue;
    if (sentence.hash === mark.hash) states[mark.index] = { kind: "checked" };
    else if (!states[mark.index]) states[mark.index] = { kind: "stale", hash: mark.hash };
  }
  return states;
}

/** Length of the common start of two texts, in UTF-16 units. */
function commonPrefix(a: string, b: string): number {
  const limit = Math.min(a.length, b.length);
  let length = 0;
  while (length < limit && a.charCodeAt(length) === b.charCodeAt(length)) length++;
  return length;
}

/** Length of the common end of two texts that does not reach into their first `skip` units. */
function commonSuffix(a: string, b: string, skip: number): number {
  const limit = Math.min(a.length, b.length) - skip;
  let length = 0;
  while (length < limit && a.charCodeAt(a.length - 1 - length) === b.charCodeAt(b.length - 1 - length)) length++;
  return length;
}

/**
 * The marks after an edit of the text they were made on (`beforeText` to `afterText`, with their sentences).
 *
 * A sentence outside the edited passage is the same sentence afterwards, wherever it now stands: its mark moves
 * with it. A sentence the edit touched keeps its mark at its position, where it now reads "changed since checked"
 * (its hash differs); the first touched sentence goes with the first sentence of the edited passage, the second
 * with the second. A mark is dropped when its sentence was removed, and when the edited passage has another
 * number of sentences and the sentence now at its position reads the same: that may be another sentence.
 * A mark never goes to an equal sentence elsewhere in the text.
 */
export function rebaseMarks(before: readonly Sentence[], beforeText: string, after: readonly Sentence[], afterText: string, marks: readonly StoredMark[]): StoredMark[] {
  if (beforeText === afterText) return [...marks];
  const prefix = commonPrefix(beforeText, afterText), suffix = commonSuffix(beforeText, afterText, prefix);
  const shift = afterText.length - beforeText.length;
  const byStart = new Map(after.map(sentence => [sentence.start, sentence]));
  /** Where each untouched sentence stands now; undefined for a sentence the edit touched. */
  const kept = before.map(sentence => {
    const offset = sentence.end <= prefix ? 0 : sentence.start >= beforeText.length - suffix ? shift : null;
    if (offset === null) return undefined;
    const now = byStart.get(sentence.start + offset);
    return now && now.end === sentence.end + offset && now.hash === sentence.hash ? now.index : undefined;
  });
  const taken = new Set(kept.filter((index): index is number => index !== undefined));
  const touched = before.filter(sentence => kept[sentence.index] === undefined).map(sentence => sentence.index);
  const edited = after.filter(sentence => !taken.has(sentence.index)).map(sentence => sentence.index);
  const position = new Map(touched.map((index, order) => [index, order]));
  const moved = new Map<number, string>();
  for (const mark of marks) {
    if (mark.index >= before.length) continue;
    let index = kept[mark.index];
    if (index === undefined) {
      index = edited[position.get(mark.index) ?? -1];
      if (index === undefined) continue;
      if (touched.length !== edited.length && after[index].hash === mark.hash) continue;
    }
    moved.set(index, mark.hash);
  }
  return [...moved].sort(([a], [b]) => a - b).map(([index, hash]) => ({ index, hash }));
}

/** The marks to store for these states: checked ones with today's hash, stale ones with the old one. */
export function storedMarks(sentences: readonly Sentence[], states: readonly MarkState[]): StoredMark[] {
  const marks: StoredMark[] = [];
  states.forEach((state, index) => {
    if (state?.kind === "checked" && sentences[index]) marks.push({ index, hash: sentences[index].hash });
    else if (state?.kind === "stale") marks.push({ index, hash: state.hash });
  });
  return marks;
}

export const isChecked = (state: MarkState | undefined): boolean => state?.kind === "checked";

/** Toggles one sentence: a checked one is unmarked, an unchecked or changed one is checked. */
export function toggled(states: readonly MarkState[], index: number): MarkState[] {
  return states.map((state, i) => i === index ? (isChecked(state) ? null : { kind: "checked" }) : state);
}

/** Sets every sentence from `from` to `to` (either order) to checked or unchecked. */
export function withRange(states: readonly MarkState[], from: number, to: number, checked: boolean): MarkState[] {
  const low = Math.min(from, to), high = Math.max(from, to);
  return states.map((state, i) => i < low || i > high ? state : checked ? { kind: "checked" } : null);
}
