// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
  MARK_COLOUR_MEANING,
  MARK_PALETTE_SIZE,
  NEIGHBOUR_GAP,
  assignMarkColours,
  hashSlot,
  markColour,
  markColourSlot,
  type ColourableMark,
} from "../src/editor/markColours";

describe("mark colour meanings", () => {
  it("colours_marks_by_term_by_default", () => {
    expect(MARK_COLOUR_MEANING).toBe("term");
    const a = markColourSlot({ termId: "HP:0001250", layerId: "phenotype", kind: "own" });
    const b = markColourSlot({ termId: "HP:0001250", layerId: "diseases", kind: "source" });
    expect(a).toBe(b);
    expect(a).toBe(hashSlot("HP:0001250"));
  });

  it("another_meaning_is_a_change_of_one_argument", () => {
    const byLayer = (termId: string) => markColourSlot({ termId, layerId: "phenotype" }, "layer");
    expect(byLayer("HP:0001250")).toBe(byLayer("HP:0001252"));
    expect(markColourSlot({ termId: "HP:0001250", kind: "own" }, "kind")).not.toBe(
      markColourSlot({ termId: "HP:0001250", kind: "target" }, "kind"),
    );
  });

  it("slots_stay_inside_the_palette", () => {
    for (const key of ["", "HP:0000001", "MONDO:0001250", "x".repeat(200), "Ünïcødé"]) {
      const slot = hashSlot(key);
      expect(slot).toBeGreaterThanOrEqual(0);
      expect(slot).toBeLessThan(MARK_PALETTE_SIZE);
    }
  });
});

type Mark = ColourableMark & { id: string };
const mark = (id: string, key: string, slot: number, ...segments: [number, number][]): Mark =>
  ({ id, colourKey: key, colorIndex: slot, segments: segments.map(([start, end]) => ({ start, end })) });
const slotsOf = (marks: Mark[], text: string) =>
  Object.fromEntries(assignMarkColours(marks, text).map((m) => [m.id, m.colorIndex]));

/** Every pair of marks with different keys that overlap or are neighbours in a sentence (the rule under test). */
function touchingPairs(marks: Mark[], text: string): Array<[Mark, Mark]> {
  const chars = Array.from(text);
  const endsIn = (from: number, to: number) => chars.slice(from, to).some((ch, i) =>
    ch === "\n" || (/\s/.test(ch) && /[.!?…]/.test(chars[from + i - 1] ?? "")));
  const pairs: Array<[Mark, Mark]> = [];
  marks.forEach((a, i) => marks.slice(i + 1).forEach((b) => {
    if (a.colourKey === b.colourKey) return;
    const touching = a.segments.some((x) => b.segments.some((y) => {
      if (x.start < y.end && y.start < x.end) return true;
      const [first, second] = x.start <= y.start ? [x, y] : [y, x];
      return second.start - first.end <= NEIGHBOUR_GAP && !endsIn(first.end, second.start);
    }));
    if (touching) pairs.push([a, b]);
  }));
  return pairs;
}

describe("colours of one text (issue 524)", () => {
  // "periorbital and facial oedema": Periorbital oedema = "periorbital" + "oedema", Facial oedema = "facial oedema".
  const OEDEMA = "periorbital and facial oedema";
  const periorbital = (slot: number) => mark("periorbital", "term:HP:0000001", slot, [0, 11], [23, 29]);
  const facial = (slot: number) => mark("facial", "term:HP:0000002", slot, [16, 29]);

  it("overlapping_findings_with_different_terms_never_share_a_slot", () => {
    for (let slot = 0; slot < MARK_PALETTE_SIZE; slot++) {
      const slots = slotsOf([periorbital(slot), facial(slot)], OEDEMA);
      expect(slots.periorbital).not.toBe(slots.facial);
      // The first finding in the text keeps its own slot; the other one moves to the next free slot.
      expect(slots.periorbital).toBe(slot);
      expect(slots.facial).toBe((slot + 1) % MARK_PALETTE_SIZE);
    }
  });

  it("neighbours_in_a_sentence_never_share_a_slot", () => {
    const text = "Hypotonia and seizures since birth.";
    const slots = slotsOf([mark("a", "term:A", 3, [0, 9]), mark("b", "term:B", 3, [14, 22])], text);
    expect(slots.a).toBe(3);
    expect(slots.b).not.toBe(3);
  });

  it("marks_in_different_sentences_or_far_apart_keep_their_slot", () => {
    const twoSentences = "Hypotonia. Seizures since birth.";
    expect(slotsOf([mark("a", "term:A", 3, [0, 9]), mark("b", "term:B", 3, [11, 19])], twoSentences)).toEqual({ a: 3, b: 3 });
    const twoLines = "Hypotonia\nSeizures";
    expect(slotsOf([mark("a", "term:A", 3, [0, 9]), mark("b", "term:B", 3, [10, 18])], twoLines)).toEqual({ a: 3, b: 3 });
    const far = `Hypotonia ${"x".repeat(NEIGHBOUR_GAP)} seizures`;
    const start = far.indexOf("seizures");
    expect(slotsOf([mark("a", "term:A", 3, [0, 9]), mark("b", "term:B", 3, [start, start + 8])], far)).toEqual({ a: 3, b: 3 });
  });

  it("the_same_term_keeps_one_slot_across_the_text", () => {
    const text = "Seizures and hypotonia. Later seizures again, and seizures with fever.";
    const at = (word: string, from = 0) => { const s = text.indexOf(word, from); return [s, s + word.length] as [number, number]; };
    const marks = [
      mark("s1", "term:S", 2, at("Seizures")),
      mark("h", "term:H", 2, at("hypotonia")),
      mark("s2", "term:S", 2, at("seizures", 30)),
      mark("s3", "term:S", 2, at("seizures", 45)),
      mark("f", "term:F", 2, at("fever")),
    ];
    const slots = slotsOf(marks, text);
    expect(new Set([slots.s1, slots.s2, slots.s3])).toEqual(new Set([2]));
    expect(slots.h).not.toBe(2);
    expect(slots.f).not.toBe(2);
    // A term the same as its neighbour does not split a colour: one key, no edge.
    expect(slotsOf([mark("x", "term:S", 4, [0, 8]), mark("y", "term:S", 4, [4, 12])], text)).toEqual({ x: 4, y: 4 });
  });

  it("is_deterministic_and_does_not_depend_on_the_order_of_the_marks", () => {
    const marks = [periorbital(2), facial(2), mark("c", "term:C", 2, [0, 29])];
    const first = slotsOf(marks, OEDEMA);
    expect(slotsOf([...marks].reverse(), OEDEMA)).toEqual(first);
    expect(slotsOf([marks[1], marks[2], marks[0]], OEDEMA)).toEqual(first);
    expect(new Set(Object.values(first)).size).toBe(3);
  });

  it("an_edit_far_away_does_not_change_the_colours_here", () => {
    const text = `periorbital and facial oedema. ${"Nothing else. ".repeat(4)}Fever.`;
    const fever = text.indexOf("Fever");
    const before = slotsOf([periorbital(1), facial(1)], text);
    const after = slotsOf([periorbital(1), facial(1), mark("fever", "term:F", 1, [fever, fever + 5])], text);
    expect({ periorbital: after.periorbital, facial: after.facial }).toEqual(before);
    expect(after.fever).toBe(1);
  });

  it("random_texts_with_up_to_six_terms_never_collide", () => {
    // With at most six terms there is always a free slot: no pair that touches may share one.
    let seed = 524;
    const random = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
    for (let round = 0; round < 300; round++) {
      const words = Array.from({ length: 12 }, () => (random() < 0.15 ? "end." : "word"));
      const text = words.join(" ");
      const marks: Mark[] = Array.from({ length: 2 + Math.floor(random() * 8) }, (_, i) => {
        const start = Math.floor(random() * (text.length - 4));
        const end = Math.min(text.length, start + 1 + Math.floor(random() * 15));
        const segments: [number, number][] = [[start, end]];
        if (random() < 0.3) { const s2 = Math.min(text.length - 1, end + 3 + Math.floor(random() * 10)); segments.push([s2, Math.min(text.length, s2 + 4)]); }
        return mark(`m${i}`, `term:${Math.floor(random() * 6)}`, Math.floor(random() * MARK_PALETTE_SIZE), ...segments);
      });
      const coloured = assignMarkColours(marks, text) as Mark[];
      const collisions = touchingPairs(coloured, text).filter(([a, b]) => a.colorIndex === b.colorIndex);
      expect(collisions.map(([a, b]) => `${a.id}/${b.id} in "${text}"`)).toEqual([]);
      const byKey = new Map<string, Set<number | undefined>>();
      for (const m of coloured) byKey.set(m.colourKey!, new Set([...(byKey.get(m.colourKey!) ?? []), m.colorIndex]));
      expect([...byKey.values()].every((slots) => slots.size === 1)).toBe(true);
    }
  });

  it("more_overlapping_terms_than_slots_share_as_little_as_possible", () => {
    const text = "a long passage of text";
    const marks = Array.from({ length: MARK_PALETTE_SIZE + 1 }, (_, i) => mark(`m${i}`, `term:${i}`, 0, [0, 22]));
    const slots = Object.values(slotsOf(marks, text));
    expect(new Set(slots).size).toBe(MARK_PALETTE_SIZE);
  });

  it("leaves_marks_without_a_slot_and_unchanged_marks_as_they_are", () => {
    const pending = { id: "pending", segments: [{ start: 0, end: 29 }] } as Mark;
    const marks = [periorbital(2), facial(5), pending];
    const result = assignMarkColours(marks, OEDEMA);
    expect(result[0]).toBe(marks[0]);
    expect(result[1]).toBe(marks[1]);
    expect(result[2]).toBe(pending);
    expect(assignMarkColours([], OEDEMA)).toEqual([]);
  });

  it("markColour_gives_the_slot_of_markColourSlot_and_the_key_of_the_meaning", () => {
    const subject = { termId: "HP:0001250", layerId: "phenotype", kind: "own" as const };
    expect(markColour(subject)).toEqual({ colorIndex: markColourSlot(subject), colourKey: "term:HP:0001250" });
    expect(markColour({ ...subject, kind: "source" }).colourKey).toBe(markColour(subject).colourKey);
    expect(markColour(subject, "layer").colourKey).toBe("layer:phenotype");
  });
});
