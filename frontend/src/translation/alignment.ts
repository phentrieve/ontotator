/**
 * Segment alignment of a source text and its translation (issue 560, prototype).
 *
 * Both texts are split into segments: sentences, and clauses where a sentence has a semicolon, or is long and has
 * commas. Segments are then grouped into pairs across the texts, n:m and in order, by a dynamic program in the style
 * of Gale and Church: a pair costs more the less its lengths fit the length ratio of the whole texts, the more its
 * numbers, terms and punctuation differ, and the rarer its shape (1:1 is cheapest; 1:0 and 0:1 cost about as much as 2:2). The
 * aligner is rule-based and runs in the browser: no model, no network.
 *
 * A pair keeps its own checked mark: the hash of its translation when the reviewer checked it. An edit inside a pair
 * resizes that pair only, so it reads "changed since checked"; pairs outside the edit keep their marks wherever they
 * move. An edit across pairs aligns only those pairs again. All offsets are UTF-16 units, as the DOM counts.
 */
import { resolveMarks, sentenceHash, splitSentences, type StoredMarks } from "./sentences";

export interface Span { start: number; end: number }
export interface Segment extends Span {
  /** Index of the segment's sentence in its text; clauses of one sentence share it. */
  sentence: number;
  /** How the segment starts: a sentence start, or a clause after a semicolon or a comma. */
  cut: "sentence" | "semicolon" | "comma";
}
export interface SegmentPair {
  source: Span;
  translation: Span;
  /** Made or changed by the reviewer (merge, split): kept as it is when the texts are aligned again. */
  manual?: boolean;
  /** The hash of the pair's translation when it was checked; another hash now reads "changed since checked". */
  checked?: string;
}
export type PairState = "open" | "checked" | "stale";
/** The checked mark of a pair that was partly checked: no translation hashes to it, so it reads "changed since checked". */
export const STALE = "stale";

const CLAUSE_MIN = 25, SEMICOLON_MIN = 12, LONG_SENTENCE = 140;

/** The clauses of one sentence: after "; " (no clause under 12 units), and after ", " in a long sentence (none under 25). */
function clauseCuts(text: string, from: number, to: number): { at: number; cut: Segment["cut"] }[] {
  const body = text.slice(from, to), cuts: { at: number; cut: Segment["cut"] }[] = [];
  let last = 0;
  for (const match of body.matchAll(/([;,])\s+/gu)) {
    const at = (match.index ?? 0) + match[0].length;
    const semicolon = match[1] === ";";
    if (!semicolon && body.length < LONG_SENTENCE) continue;
    const least = semicolon ? SEMICOLON_MIN : CLAUSE_MIN;
    if (at - last < least || body.length - at < least) continue;
    cuts.push({ at: from + at, cut: semicolon ? "semicolon" : "comma" }); last = at;
  }
  return cuts;
}

/** Words a German ordinal stands before ("am 3. Mai", "im 2. Zyklus"): there "3." does not end the sentence. */
const ORDINAL_NOUNS = new Set(("januar februar märz april mai juni juli august september oktober november dezember jan feb mär apr jun jul aug sep sept okt nov dez "
  + "tag tages woche monat quartal lebensjahr lebensjahres lebenstag lebenswoche schwangerschaftswoche ssw grad grades klasse stock etage obergeschoss "
  + "zyklus kurs rippe zeh finger halswirbel brustwirbel lendenwirbel mal hälfte jahrhundert linie generation ordnung").split(" "));

/**
 * Sentences as `splitSentences` finds them, with two more splits: a unit letter after a number ends the sentence
 * before a capitalised word ("1 g. She …"), and in German a number with a full stop does when the capitalised word
 * after it is none an ordinal stands before ("lag bei 6. In der CT …", but "am 3. Mai").
 */
function sentenceSpans(text: string, lang: string | undefined): Span[] {
  const spans = splitSentences(text, lang).map(({ start, end }) => ({ start, end }));
  const german = lang?.startsWith("de") === true;
  return spans.flatMap(span => {
    const parts: Span[] = [];
    let open = span.start;
    // A unit after a number ends the sentence too ("1 g. She is …"), which the sentence splitter reads as an abbreviation.
    for (const match of text.slice(span.start, span.end).matchAll(/(?<=[\s(])\d+(?:[.,]\d+)?(?:\s?[gmlhs]|(\.))(?:\.)?(\s+)(\p{Lu}\p{Ll}*)/gu)) {
      const ordinal = match[1] !== undefined;
      if (!match[0].includes(".") || (ordinal && (!german || ORDINAL_NOUNS.has(match[3].toLowerCase())))) continue;
      if (!ordinal && !/[gmlhs]\.\s/u.test(match[0])) continue;
      const cut = span.start + (match.index ?? 0) + match[0].length - match[3].length;
      parts.push({ start: open, end: cut - match[2].length }); open = cut;
    }
    parts.push({ start: open, end: span.end });
    return parts;
  });
}

/** The segments of a text between `from` and `to` (the whole text by default). */
export function splitSegments(text: string, lang?: string, from = 0, to = text.length): Segment[] {
  const part = text.slice(from, to), segments: Segment[] = [];
  sentenceSpans(part, lang).forEach((sentence, index) => {
    const start = from + sentence.start, end = from + sentence.end;
    let open = start, cut: Segment["cut"] = "sentence";
    for (const next of clauseCuts(text, start, end)) {
      const trimmed = text.slice(open, next.at).trimEnd();
      segments.push({ start: open, end: open + trimmed.length, sentence: index, cut });
      open = next.at; cut = next.cut;
    }
    segments.push({ start: open, end, sentence: index, cut });
  });
  return segments;
}

// ---- Anchors: numbers, short codes, shared terms and some punctuation, compared per pair. ----

/** "3,5" and "3.5" are one number; leading zeros and a trailing ".0" do not count. */
const numberKey = (raw: string) => {
  const value = /^\d{1,3}(?:[.,]\d{3})+$/u.test(raw) && !/^\d+[.,]\d{3}$/u.test(raw) ? raw.replace(/[.,]/gu, "") : raw.replace(",", ".");
  return `n:${value.replace(/^0+(?=\d)/u, "").replace(/\.0+$/u, "")}`;
};
/** A spelling key that lets cognates meet: Tachykardie / tachycardia, Zyanose / cyanosis, Ödem / oedema. */
export function termKey(word: string): string {
  return word.toLowerCase().normalize("NFD").replace(/\p{M}/gu, "").replace(/ß/gu, "ss").replace(/ph/gu, "f").replace(/th/gu, "t")
    .replace(/[cz]/gu, "k").replace(/y/gu, "i").replace(/ae|oe/gu, "e").slice(0, 5);
}
const PUNCTUATION: Record<string, string> = { "?": "p:?", "(": "p:(", ":": "p::", "%": "p:%", "/": "p:/" };

function rawAnchors(text: string): string[] {
  const keys: string[] = [];
  for (const match of text.matchAll(/\d+(?:[.,]\d+)*/gu)) keys.push(numberKey(match[0]));
  for (const match of text.matchAll(/\p{L}[\p{L}\p{N}]*/gu)) {
    const word = match[0];
    if (/^[\p{Lu}\p{N}]{2,6}$/u.test(word) && /\p{Lu}.*\p{Lu}|\p{N}/u.test(word)) keys.push(`c:${word}`);
    else if ([...word].length >= 6) keys.push(`t:${termKey(word)}`);
  }
  for (const char of text) if (PUNCTUATION[char]) keys.push(PUNCTUATION[char]);
  return keys;
}
const WEIGHT: Record<string, number> = { n: 1.4, c: 1, t: 0.7, p: 0.4 };

/** Anchors of each segment as [key id, weight] lists, keeping only keys both texts have (and terms neither repeats much). */
function anchorTable(source: string, target: string, sources: readonly Segment[], targets: readonly Segment[]) {
  const per = (text: string, segments: readonly Segment[]) => segments.map(segment => rawAnchors(text.slice(segment.start, segment.end)));
  const a = per(source, sources), b = per(target, targets);
  const count = (lists: string[][]) => { const map = new Map<string, number>(); for (const list of lists) for (const key of list) map.set(key, (map.get(key) ?? 0) + 1); return map; };
  const ca = count(a), cb = count(b), ids = new Map<string, number>();
  const usable = (key: string) => ca.has(key) && cb.has(key) && (key[0] !== "t" || Math.max(ca.get(key)!, cb.get(key)!) <= 6);
  const encode = (lists: string[][]) => lists.map(list => list.filter(usable).map(key => {
    if (!ids.has(key)) ids.set(key, ids.size);
    return [ids.get(key)!, WEIGHT[key[0]]] as const;
  }));
  return { source: encode(a), target: encode(b), size: ids.size };
}

// ---- The cost of one pair. ----

/** -log of a two-sided normal tail, the Gale–Church length cost. */
function lengthCost(ls: number, lt: number, ratio: number): number {
  if (ls === 0 || lt === 0) return 0;
  const delta = Math.abs(lt - ls * ratio) / Math.sqrt(ls * 6.8);
  // Abramowitz–Stegun erfc, enough for a cost.
  const t = 1 / (1 + 0.3275911 * delta / Math.SQRT2);
  const tail = t * (0.254829592 + t * (-0.284496736 + t * (1.421413741 + t * (-1.453152027 + t * 1.061405429)))) * Math.exp(-delta * delta / 2);
  return -Math.log(Math.max(tail, 1e-12));
}
/** The shape cost of a pair with one empty side (1:0, 0:1). */
export const ONE_SIDED_COST = 4;
/** The shape of a pair by the sentences it touches on each side. */
function shapeCost(a: number, b: number): number {
  // A part without a partner ("Not in the translation"): 4, so a left-out sentence gets a row of its own instead of
  // hiding in a 2:1 pair with a wrong cut next to it (measured on the samples, issue 560).
  if (a === 0 || b === 0) return ONE_SIDED_COST;
  const [low, high] = a < b ? [a, b] : [b, a];
  if (low === 1 && high === 1) return 0;
  if (low === 1 && high === 2) return 2.3;
  if (low === 2 && high === 2) return 4.5;
  if (low === 1 && high === 3) return 4.6;
  return 3 * (low + high) - 3;
}
const CUT_COST: Record<Segment["cut"], number> = { sentence: 0, semicolon: 1, comma: 3 };
/** The shapes a pair may take: source segments, translation segments. */
const SHAPES: readonly (readonly [number, number])[] = [[1, 1], [1, 0], [0, 1], [1, 2], [2, 1], [2, 2], [1, 3], [3, 1], [2, 3], [3, 2], [1, 4], [4, 1]];

export interface AlignOptions { sourceLang?: string; targetLang?: string; signal?: { budget: number } }

/**
 * Pairs for the segments of the source between `sourceSpan` and of the target between `targetSpan`, which must
 * cover both spans completely and in order. Empty sides make 1:0 and 0:1 pairs.
 */
function alignSegments(source: string, target: string, sources: Segment[], targets: Segment[], sourceSpan: Span, targetSpan: Span, ratio: number): SegmentPair[] {
  const n = sources.length, m = targets.length;
  if (n === 0 && m === 0) return [];
  if (n === 0 || m === 0) return [{ source: sourceSpan, translation: targetSpan }];
  const anchors = anchorTable(source, target, sources, targets);
  // Prefix sums: length, sentence-like units (a clause after a comma is not one) and paragraph breaks inside a group.
  const prefix = (text: string, list: Segment[]) => {
    const length = new Float64Array(list.length + 1), units = new Int32Array(list.length + 1), breaks = new Int32Array(list.length + 1);
    list.forEach((segment, k) => {
      length[k + 1] = length[k] + segment.end - segment.start;
      units[k + 1] = units[k] + (segment.cut === "comma" ? 0 : 1);
      breaks[k + 1] = breaks[k] + (k > 0 && text.slice(list[k - 1].end, segment.start).includes("\n") ? 1 : 0);
    });
    return { length, units, breaks };
  };
  const ps = prefix(source, sources), pt = prefix(target, targets);
  const sum = new Float64Array(Math.max(anchors.size, 1)), touched = new Int32Array(Math.max(anchors.size, 1));
  // Clauses after a semicolon count as sentences of their own, so "A; B." pairs with "A'. B'." clause by clause.
  const units = (list: Segment[], p: typeof ps, from: number, count: number) => count === 0 ? 0 : p.units[from + count] - p.units[from] + (list[from].cut === "comma" ? 1 : 0);
  /** The cheap part of a pair's cost: its shape, cuts and paragraph breaks. */
  const base = (i: number, a: number, j: number, b: number): number => {
    let cost = shapeCost(units(sources, ps, i, a), units(targets, pt, j, b));
    if (a > 1) cost += 2 * (ps.breaks[i + a] - ps.breaks[i + 1]);
    if (b > 1) cost += 2 * (pt.breaks[j + b] - pt.breaks[j + 1]);
    if (a > 0 && i > 0) cost += CUT_COST[sources[i].cut];
    if (b > 0 && j > 0) cost += CUT_COST[targets[j].cut];
    return cost;
  };
  /** The rest: length fit and anchors. */
  const rest = (i: number, a: number, j: number, b: number): number => {
    const cost = lengthCost(ps.length[i + a] - ps.length[i], pt.length[j + b] - pt.length[j], ratio);
    // Anchor mismatch: the weighted difference of key counts.
    let count = 0;
    for (let k = i; k < i + a; k++) for (const [id, w] of anchors.source[k]) { if (sum[id] === 0) touched[count++] = id; sum[id] += w; }
    for (let k = j; k < j + b; k++) for (const [id, w] of anchors.target[k]) { if (sum[id] === 0) touched[count++] = id; sum[id] -= w; }
    let mismatch = 0;
    for (let k = 0; k < count; k++) { mismatch += Math.abs(sum[touched[k]]); sum[touched[k]] = 0; }
    return cost + Math.min(mismatch, 8);
  };
  // Only cells near the diagonal; the band is wide enough for the texts' own drift.
  const band = Math.max(24, Math.ceil(0.06 * Math.max(n, m)));
  const width = m + 1, best = new Float64Array((n + 1) * width).fill(Infinity), step = new Uint8Array((n + 1) * width);
  best[0] = 0;
  for (let i = 0; i <= n; i++) {
    const centre = Math.round(i * m / n);
    for (let j = Math.max(0, centre - band); j <= Math.min(m, centre + band); j++) {
      if (i === 0 && j === 0) continue;
      let low = Infinity, choice = 0;
      for (let shape = 0; shape < SHAPES.length; shape++) {
        const [a, b] = SHAPES[shape];
        if (a > i || b > j) continue;
        const before = best[(i - a) * width + j - b];
        if (before === Infinity) continue;
        // The cheap part first: most shapes are out before the length and anchors are weighed.
        const floor = before + base(i - a, a, j - b, b);
        if (floor >= low) continue;
        const value = floor + rest(i - a, a, j - b, b);
        if (value < low) { low = value; choice = shape; }
      }
      best[i * width + j] = low; step[i * width + j] = choice;
    }
  }
  if (best[n * width + m] === Infinity) return [{ source: sourceSpan, translation: targetSpan }];
  const pairs: SegmentPair[] = [];
  for (let i = n, j = m; i > 0 || j > 0;) {
    const [a, b] = SHAPES[step[i * width + j]];
    const span = (list: Segment[], from: number, count: number, whole: Span): Span => count > 0
      ? { start: list[from].start, end: list[from + count - 1].end }
      // An empty side stands where the other side's pair would have begun.
      : { start: from < list.length ? list[from].start : whole.end, end: from < list.length ? list[from].start : whole.end };
    pairs.push({ source: span(sources, i - a, a, sourceSpan), translation: span(targets, j - b, b, targetSpan) });
    i -= a; j -= b;
  }
  return pairs.reverse();
}

const visibleLength = (text: string) => text.replace(/\s+/gu, "").length;

/**
 * The pairs of two whole texts. `fixed` pairs (manual ones and checked ones) stay as they are; the aligner only fills
 * the stretches between them. The pairs cover both texts in order; white space between pairs belongs to none.
 */
export function alignTexts(source: string, target: string, options: AlignOptions = {}, fixed: readonly SegmentPair[] = []): SegmentPair[] {
  const ratio = Math.max(0.3, Math.min(3, (visibleLength(target) || 1) / (visibleLength(source) || 1)));
  const result: SegmentPair[] = [];
  let s = 0, t = 0;
  const fill = (sourceEnd: number, targetEnd: number) => {
    const sources = splitSegments(source, options.sourceLang, s, sourceEnd), targets = splitSegments(target, options.targetLang, t, targetEnd);
    result.push(...alignSegments(source, target, sources, targets, { start: s, end: sourceEnd }, { start: t, end: targetEnd }, ratio));
  };
  for (const pair of [...fixed].sort((a, b) => a.source.start - b.source.start)) {
    if (pair.source.start < s || pair.translation.start < t) continue;
    fill(pair.source.start, pair.translation.start);
    result.push(pair); s = pair.source.end; t = pair.translation.end;
  }
  fill(source.length, target.length);
  return result;
}

// ---- State, edits and manual fixes. ----

const slice = (text: string, span: Span) => text.slice(span.start, span.end);
export const pairHash = (target: string, pair: SegmentPair) => sentenceHash(slice(target, pair.translation));

export function pairState(target: string, pair: SegmentPair): PairState {
  if (pair.checked === undefined) return "open";
  return pair.checked === pairHash(target, pair) ? "checked" : "stale";
}

/** Checks a pair (or checks it again after a change), or takes the check away from a checked one. */
export function toggledPair(pairs: readonly SegmentPair[], target: string, index: number): SegmentPair[] {
  return pairs.map((pair, i) => {
    if (i !== index) return pair;
    if (pairState(target, pair) === "checked") { const { checked: _, ...rest } = pair; return rest; }
    return { ...pair, checked: pairHash(target, pair) };
  });
}

/**
 * The pair that results from joining pairs: checked when every part was checked and is unchanged, "changed since
 * checked" when one part was checked (it needs another look), else open.
 */
function joined(parts: readonly SegmentPair[], target: string, manual: boolean): SegmentPair {
  const first = parts[0], last = parts[parts.length - 1];
  const pair: SegmentPair = { source: { start: first.source.start, end: last.source.end }, translation: { start: first.translation.start, end: last.translation.end }, ...(manual ? { manual } : {}) };
  const states = parts.map(part => pairState(target, part));
  if (states.every(state => state === "checked")) return { ...pair, checked: pairHash(target, pair) };
  // A hash no text has: the pair reads "changed since checked".
  if (states.some(state => state !== "open")) return { ...pair, checked: STALE };
  return pair;
}
export function mergedWithNext(pairs: readonly SegmentPair[], target: string, index: number): SegmentPair[] {
  if (index < 0 || index + 1 >= pairs.length) return [...pairs];
  return [...pairs.slice(0, index), joined(pairs.slice(index, index + 2), target, true), ...pairs.slice(index + 2)];
}

/**
 * Splits one pair in two: the aligner picks the best two-pair split of its segments (clauses of a single sentence
 * count). Null when the pair has nothing to split on either side. The halves keep the pair's checked state.
 */
export function splitPair(pairs: readonly SegmentPair[], source: string, target: string, index: number, options: AlignOptions = {}): SegmentPair[] | null {
  const pair = pairs[index];
  if (!pair) return null;
  const segmentsOf = (text: string, span: Span, lang?: string) => {
    const list = splitSegments(text, lang, span.start, span.end);
    // A single segment may still split at any comma.
    if (list.length > 1) return list;
    const body = text.slice(span.start, span.end), cuts = [...body.matchAll(/[,;:]\s+/gu)].map(match => (match.index ?? 0) + match[0].length);
    if (!cuts.length) return list;
    const at = cuts.reduce((best, cut) => Math.abs(cut - body.length / 2) < Math.abs(best - body.length / 2) ? cut : best);
    return [{ start: span.start, end: span.start + body.slice(0, at).trimEnd().length, sentence: 0, cut: "sentence" as const }, { start: span.start + at, end: span.end, sentence: 0, cut: "comma" as const }];
  };
  const sources = segmentsOf(source, pair.source, options.sourceLang), targets = segmentsOf(target, pair.translation, options.targetLang);
  if (sources.length < 2 && targets.length < 2) return null;
  const ratio = Math.max(0.3, Math.min(3, (visibleLength(slice(target, pair.translation)) || 1) / (visibleLength(slice(source, pair.source)) || 1)));
  let best: { cost: number; parts: SegmentPair[] } | null = null;
  // Every cut on each side (or none, for an empty half), scored by length fit only.
  for (let a = 0; a <= sources.length; a++) for (let b = 0; b <= targets.length; b++) {
    if ((a === 0 && b === 0) || (a === sources.length && b === targets.length)) continue;
    if ((a === 0 || a === sources.length) && (b === 0 || b === targets.length)) continue;
    const half = (list: Segment[], from: number, to: number, whole: Span, side: "start" | "end"): Span => from < to
      ? { start: list[from].start, end: list[to - 1].end } : side === "start" ? { start: whole.start, end: whole.start } : { start: whole.end, end: whole.end };
    const first: SegmentPair = { source: half(sources, 0, a, pair.source, "start"), translation: half(targets, 0, b, pair.translation, "start"), manual: true };
    const second: SegmentPair = { source: half(sources, a, sources.length, pair.source, "end"), translation: half(targets, b, targets.length, pair.translation, "end"), manual: true };
    const length = (p: SegmentPair) => lengthCost(visibleLength(slice(source, p.source)), visibleLength(slice(target, p.translation)), ratio);
    const cost = length(first) + length(second) + (a === 0 || b === 0 || a === sources.length || b === targets.length ? 6 : 0);
    if (!best || cost < best.cost) best = { cost, parts: [first, second] };
  }
  if (!best) return null;
  const state = pairState(target, pair);
  const parts = best.parts.map(part => state === "checked" ? { ...part, checked: pairHash(target, part) } : state === "stale" ? { ...part, checked: pair.checked } : part);
  return [...pairs.slice(0, index), ...parts, ...pairs.slice(index + 1)];
}

/** Length of the common start of two texts, and of their common end that does not reach into it. */
function commonEnds(a: string, b: string): [number, number] {
  const limit = Math.min(a.length, b.length);
  let prefix = 0;
  while (prefix < limit && a.charCodeAt(prefix) === b.charCodeAt(prefix)) prefix++;
  let suffix = 0;
  while (suffix < limit - prefix && a.charCodeAt(a.length - 1 - suffix) === b.charCodeAt(b.length - 1 - suffix)) suffix++;
  return [prefix, suffix];
}

const shifted = (span: Span, by: number): Span => ({ start: span.start + by, end: span.end + by });

/**
 * The pairs after an edit of the translation from `before` to `after`. With `inPair`, the edit was made inside that
 * pair (its cell): only that pair changes size. Otherwise the changed passage is found from the common start and end:
 * a passage inside one pair (its ends count) resizes that pair; a passage across pairs joins them and aligns that
 * stretch again, and the new pairs keep a check where they meet a checked one, as "changed since checked".
 */
export function rebasePairs(pairs: readonly SegmentPair[], source: string, before: string, after: string, options: AlignOptions = {}, inPair?: number): SegmentPair[] {
  if (before === after) return [...pairs];
  const delta = after.length - before.length;
  if (inPair !== undefined && pairs[inPair]) {
    return pairs.map((pair, i) => i < inPair ? pair : i === inPair ? { ...pair, translation: { start: pair.translation.start, end: pair.translation.end + delta } } : { ...pair, translation: shifted(pair.translation, delta) });
  }
  const [prefix, suffix] = commonEnds(before, after);
  const editEnd = before.length - suffix;
  const touched = pairs.map((pair, i) => [pair, i] as const).filter(([pair]) => pair.translation.start <= editEnd && pair.translation.end >= prefix).map(([, i]) => i);
  if (touched.length === 0) {
    // In white space between pairs: the pairs after it move.
    return pairs.map(pair => pair.translation.start >= editEnd ? { ...pair, translation: shifted(pair.translation, delta) } : pair);
  }
  const first = touched[0], last = touched[touched.length - 1];
  const head = pairs.slice(0, first), tail = pairs.slice(last + 1).map(pair => ({ ...pair, translation: shifted(pair.translation, delta) }));
  if (first === last) return [...head, { ...pairs[first], translation: { start: pairs[first].translation.start, end: pairs[first].translation.end + delta } }, ...tail];
  // Across pairs: align that stretch again.
  const sourceSpan = { start: pairs[first].source.start, end: pairs[last].source.end };
  const targetSpan = { start: pairs[first].translation.start, end: pairs[last].translation.end + delta };
  const ratio = Math.max(0.3, Math.min(3, (visibleLength(after) || 1) / (visibleLength(source) || 1)));
  const fresh = alignSegments(source, after, splitSegments(source, options.sourceLang, sourceSpan.start, sourceSpan.end),
    splitSegments(after, options.targetLang, targetSpan.start, targetSpan.end), sourceSpan, targetSpan, ratio);
  const old = pairs.slice(first, last + 1);
  const carried = fresh.map(pair => {
    const met = old.filter(o => o.checked !== undefined && o.source.start < pair.source.end && pair.source.start < o.source.end);
    const same = old.find(o => o.source.start === pair.source.start && o.source.end === pair.source.end);
    const checked = same?.checked ?? (met.length ? STALE : undefined);
    return checked === undefined ? pair : { ...pair, checked };
  });
  return [...head, ...carried, ...tail];
}

/** Whether stored pairs fit the texts: in order, inside the texts, without overlaps. */
export function pairsFit(pairs: readonly SegmentPair[], source: string, target: string): boolean {
  let s = 0, t = 0;
  for (const pair of pairs) {
    if (pair.source.start < s || pair.source.end < pair.source.start || pair.translation.start < t || pair.translation.end < pair.translation.start) return false;
    s = pair.source.end; t = pair.translation.end;
  }
  return s <= source.length && t <= target.length;
}

/**
 * Checked pairs from the checked-sentence marks of issue 256, once, when a review first shows pairs: a pair is checked
 * when every sentence it touches, on both sides, is checked (with today's text). Anything less stays open.
 */
export function pairsFromSentenceMarks(pairs: readonly SegmentPair[], source: string, target: string, marks: StoredMarks, options: AlignOptions = {}): SegmentPair[] {
  const checkedSpans = (text: string, lang: string | undefined, stored: StoredMarks["source"]) => {
    const sentences = splitSentences(text, lang), states = resolveMarks(sentences, stored);
    return sentences.map((sentence, i) => ({ start: sentence.start, end: sentence.end, checked: states[i]?.kind === "checked" }));
  };
  if (marks.source.length + marks.translation.length === 0) return [...pairs];
  const sides = { source: checkedSpans(source, options.sourceLang, marks.source), translation: checkedSpans(target, options.targetLang, marks.translation) };
  const all = (span: Span, list: typeof sides.source) => {
    const met = list.filter(sentence => sentence.start < span.end && span.start < sentence.end);
    return met.length > 0 && met.every(sentence => sentence.checked);
  };
  return pairs.map(pair => {
    const ok = (pair.source.start === pair.source.end || all(pair.source, sides.source))
      && (pair.translation.start === pair.translation.end || all(pair.translation, sides.translation));
    return ok && pair.checked === undefined ? { ...pair, checked: pairHash(target, pair) } : pair;
  });
}

/** Whether a pair has a place to split on one side: a sentence end or a clause cut inside it. Cheap, for menus. */
export function canSplitPair(source: string, target: string, pair: SegmentPair): boolean {
  const inside = /[.!?;:,]\s+\S/u;
  return inside.test(slice(source, pair.source)) || inside.test(slice(target, pair.translation));
}

/** A hash of a whole text, exact to the character (FNV-1a over UTF-16 units). */
export function textHash(text: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) { hash ^= text.charCodeAt(i); hash = Math.imul(hash, 0x01000193) >>> 0; }
  return hash.toString(16).padStart(8, "0");
}

/**
 * Checks of stored pairs carried to a fresh alignment of other texts (a draft saved after the pairs): a fresh pair
 * with the source passage of a stored checked pair is checked again when its translation reads as it did, else
 * "changed since checked".
 */
export function carryChecks(fresh: readonly SegmentPair[], stored: readonly SegmentPair[]): SegmentPair[] {
  const bySource = new Map(stored.filter(pair => pair.checked !== undefined).map(pair => [`${pair.source.start}:${pair.source.end}`, pair.checked!]));
  return fresh.map(pair => {
    const checked = bySource.get(`${pair.source.start}:${pair.source.end}`);
    if (checked === undefined) return pair;
    // An unchanged translation hashes to the stored mark (checked); any other reads "changed since checked".
    return { ...pair, checked };
  });
}

// ---- Confidence: when the pairs would mislead, the view is not offered (owner's condition on issue 560). ----

/** The longest text, in segments on either side, that the browser aligns; longer texts would freeze the page. */
export const MAX_ALIGN_SEGMENTS = 1500;
/** Why texts are not shown as pairs. */
export type LowConfidenceReason = "empty" | "too-long" | "one-block" | "counts-differ" | "unrelated" | "gap" | "weak";
/** How well pairs fit, as shares of the visible text of both sides. */
export interface AlignmentMetrics {
  /** In pairs of more than three segments on a side, with a length far from the texts' ratio, or numbers and codes the sides do not share. */
  weak: number;
  /** In pairs with one empty side. */
  unmatched: number;
  /** The longest run of segments in consecutive pairs with one empty side. */
  gap: number;
  /** Of the numbers and codes of the source, the share the translation has too (1 when the source has fewer than 6). */
  anchorRecall: number;
}
export type AlignmentAssessment = { usable: true; metrics?: AlignmentMetrics } | { usable: false; reason: LowConfidenceReason; metrics?: AlignmentMetrics };
/** Above this share of weak text, pairs mislead. */
export const WEAK_SHARE = 0.15;
/** Above this share of text without a partner, the texts do not belong together. */
export const UNMATCHED_SHARE = 0.15;
/** A run of this many segments without a partner is a missing section; the pairs around it are unsure. */
export const GAP_SEGMENTS = 3;
/** Below this share of the source's numbers and codes found in the translation, the texts are not a translation of each other. */
export const ANCHOR_RECALL = 0.5;
/** The length cost (Gale–Church, -log of the chance) above which a pair's lengths do not fit: about 1 in 400. */
export const MISFIT_COST = 6;
/** Sentence counts of the two texts further apart than this (and by at least 4) do not belong together. */
export const COUNT_RATIO = 1.6;

/**
 * Whether texts can be aligned at all, before the aligner runs: both have text, neither is too long, and both are
 * split into sentences of a similar count. Cheap: it only splits the texts.
 */
export function precheckAlignment(source: string, target: string, options: AlignOptions = {}): AlignmentAssessment {
  if (visibleLength(source) === 0 || visibleLength(target) === 0) return { usable: false, reason: "empty" };
  const n = splitSegments(source, options.sourceLang).length, m = splitSegments(target, options.targetLang).length;
  if (Math.max(n, m) > MAX_ALIGN_SEGMENTS) return { usable: false, reason: "too-long" };
  // A text without sentence ends (no punctuation, a script whose full stop the splitter does not know) is one block.
  const low = Math.min(n, m), high = Math.max(n, m);
  if (low <= 1 && high >= 4) return { usable: false, reason: "one-block" };
  if (high - low >= 4 && high / low > COUNT_RATIO) return { usable: false, reason: "counts-differ" };
  return { usable: true };
}

/** What a pair is judged by: the texts' length ratio and the strong anchors (numbers, codes). */
interface PairJudge { ratio: number; options: AlignOptions }
const strongAnchor = (key: string) => key[0] === "n" || key[0] === "c";
function judgeOf(source: string, target: string, options: AlignOptions): PairJudge {
  return { ratio: Math.max(0.3, Math.min(3, (visibleLength(target) || 1) / (visibleLength(source) || 1))), options };
}

/**
 * Why a pair is unsure, or null: more than three segments on a side; lengths that do not fit the texts' ratio
 * (about 1 in 400); or numbers and codes on the sides that none of the other side's match, with three or more on one
 * side ("182/96 mmHg, 88/min" beside a sentence without a number), or three or more on one side that the other
 * side lacks. A pair with an empty side is not judged here.
 */
function pairDoubt(source: string, target: string, pair: SegmentPair, judge: PairJudge): "size" | "length" | "anchors" | null {
  const sourceText = slice(source, pair.source), targetText = slice(target, pair.translation);
  const a = visibleLength(sourceText), b = visibleLength(targetText);
  if (a === 0 || b === 0) return null;
  const size = Math.max(splitSegments(source, judge.options.sourceLang, pair.source.start, pair.source.end).length,
    splitSegments(target, judge.options.targetLang, pair.translation.start, pair.translation.end).length);
  if (size > 3) return "size";
  // Short pairs ("Unauffällig." / "Normal.") vary a lot in length; only longer ones count for the fit.
  if (a + b >= 40 && lengthCost(a, b, judge.ratio) > MISFIT_COST) return "length";
  const count = (text: string) => {
    const map = new Map<string, number>();
    for (const key of rawAnchors(text)) if (strongAnchor(key)) map.set(key, (map.get(key) ?? 0) + 1);
    return map;
  };
  const ka = count(sourceText), kb = count(targetText);
  let both = 0, na = 0, nb = 0;
  for (const [key, value] of ka) { na += value; both += Math.min(value, kb.get(key) ?? 0); }
  for (const value of kb.values()) nb += value;
  return (both === 0 && Math.max(na, nb) >= 3) || na - both >= 3 || nb - both >= 3 ? "anchors" : null;
}

/**
 * The indexes of the pairs that are unsure, for the view to mark: each pair with a doubt (see `pairDoubt`), and the
 * pairs next to it that the aligner made, because a wrong cut lies on one of its two borders. A pair the reviewer
 * merged, split or checked is taken as it is.
 */
export function unsurePairs(source: string, target: string, pairs: readonly SegmentPair[], options: AlignOptions = {}): Set<number> {
  const judge = judgeOf(source, target, options), result = new Set<number>();
  const free = (pair: SegmentPair | undefined) => pair !== undefined && !pair.manual && pair.checked === undefined;
  pairs.forEach((pair, index) => {
    if (!free(pair) || !pairDoubt(source, target, pair, judge)) return;
    result.add(index);
    for (const next of [index - 1, index + 1]) if (free(pairs[next]) && visibleLength(slice(target, pairs[next].translation)) > 0) result.add(next);
  });
  return result;
}

/**
 * Fresh pairs made safe: an unsure pair is joined with the pair before or after it (or both) when that joined pair
 * is sure. A cut in the wrong place, typically next to a sentence the translation left out, then disappears into
 * one larger pair that is right, instead of two pairs that are both wrong. Manual and checked pairs stay as they are.
 */
export function securePairs(source: string, target: string, pairs: readonly SegmentPair[], options: AlignOptions = {}): SegmentPair[] {
  const judge = judgeOf(source, target, options);
  const free = (pair: SegmentPair | undefined) => pair !== undefined && !pair.manual && pair.checked === undefined;
  const join = (parts: readonly SegmentPair[]): SegmentPair => ({ source: { start: parts[0].source.start, end: parts[parts.length - 1].source.end },
    translation: { start: parts[0].translation.start, end: parts[parts.length - 1].translation.end } });
  const result = [...pairs];
  const unsure = (pair: SegmentPair) => pairDoubt(source, target, pair, judge) !== null;
  for (let i = 0; i < result.length; i++) {
    if (!free(result[i]) || !unsure(result[i])) continue;
    const candidates = ([[i, i + 1], [i - 1, i], [i - 1, i + 1]] as const).filter(([from, to]) => from >= 0 && to < result.length && result.slice(from, to + 1).every(free));
    // A join that is sure is best; else one that leaves one unsure pair where there were several (the cut was wrong).
    const choice = candidates.find(([from, to]) => !unsure(join(result.slice(from, to + 1))))
      ?? candidates.find(([from, to]) => result.slice(from, to + 1).filter(unsure).length >= 2);
    if (!choice) continue;
    const [from, to] = choice;
    result.splice(from, to - from + 1, join(result.slice(from, to + 1)));
    i = from - 1;
  }
  return result;
}

/**
 * Whether pairs of two texts can be trusted (see `AlignmentMetrics`). Low confidence when the texts share too few
 * numbers and codes to be a translation of each other, when a whole section has no partner (the pairs around such a
 * gap are often wrong), or when much of the text has no partner or is in unsure pairs. Shown pairs would then
 * mislead, so the review falls back to the flowing texts.
 */
export function assessAlignment(source: string, target: string, pairs: readonly SegmentPair[], options: AlignOptions = {}): AlignmentAssessment {
  const pre = precheckAlignment(source, target, options);
  if (!pre.usable) return pre;
  const judge = judgeOf(source, target, options);
  const sourceKeys = rawAnchors(source).filter(strongAnchor), targetKeys = new Set(rawAnchors(target).filter(strongAnchor));
  const anchorRecall = sourceKeys.length < 6 ? 1 : sourceKeys.filter(key => targetKeys.has(key)).length / sourceKeys.length;
  let total = 0, weak = 0, unmatched = 0, gap = 0, run = 0;
  for (const pair of pairs) {
    const a = visibleLength(slice(source, pair.source)), b = visibleLength(slice(target, pair.translation));
    total += a + b;
    if (a === 0 || b === 0) {
      unmatched += a + b;
      run += a === 0 ? splitSegments(target, options.targetLang, pair.translation.start, pair.translation.end).length
        : splitSegments(source, options.sourceLang, pair.source.start, pair.source.end).length;
      gap = Math.max(gap, run);
      continue;
    }
    run = 0;
    if (pairDoubt(source, target, pair, judge)) weak += a + b;
  }
  const metrics: AlignmentMetrics = { weak: total ? weak / total : 1, unmatched: total ? unmatched / total : 1, gap, anchorRecall };
  if (total === 0) return { usable: false, reason: "empty", metrics };
  if (anchorRecall < ANCHOR_RECALL) return { usable: false, reason: "unrelated", metrics };
  if (gap >= GAP_SEGMENTS) return { usable: false, reason: "gap", metrics };
  if (metrics.unmatched > UNMATCHED_SHARE || metrics.weak > WEAK_SHARE) return { usable: false, reason: "weak", metrics };
  return { usable: true, metrics };
}
