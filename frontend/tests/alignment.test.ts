// @vitest-environment node
import { describe, expect, it } from "vitest";
import { alignTexts, splitSegments, type SegmentPair } from "../src/translation/alignment";
import { ALIGNMENT_HELD_OUT, ALIGNMENT_SAMPLE, sampleText, type GoldDocument } from "./fixtures/alignmentSample";

type Span = { start: number; end: number };
const THRESHOLD_EXACT = 0.9, THRESHOLD_CONSISTENT = 0.95;
/** Precision of predicted pairs against gold pairs: exact, and "consistent" (a union of whole gold pairs). */
function score(pairs: SegmentPair[], gold: { en: Span[]; de: Span[] }) {
  const exact = pairs.filter(pair => gold.en.some((span, i) => span.start === pair.source.start && span.end === pair.source.end
    && gold.de[i].start === pair.translation.start && gold.de[i].end === pair.translation.end)).length;
  // A union of whole consecutive gold pairs (gold pairs i to k) on both sides.
  const consistent = pairs.filter(pair => gold.en.some((first, i) => gold.en.some((last, k) => k >= i
    && first.start === pair.source.start && last.end === pair.source.end
    && gold.de[i].start === pair.translation.start && gold.de[k].end === pair.translation.end))).length;
  return { predicted: pairs.length, gold: gold.en.length, exact, consistent };
}

function evaluate(documents: GoldDocument[]) {
  const rows = documents.map(document => {
    const en = sampleText(document, "en"), de = sampleText(document, "de");
    const pairs = alignTexts(en.text, de.text, { sourceLang: "en", targetLang: "de" });
    const result = score(pairs, { en: en.spans, de: de.spans });
    if (process.env.ALIGNMENT_REPORT) {
      console.log(document.name, JSON.stringify(result));
      for (const pair of pairs) console.log("  ", JSON.stringify(en.text.slice(pair.source.start, pair.source.end)), "<->", JSON.stringify(de.text.slice(pair.translation.start, pair.translation.end)));
    }
    return result;
  });
  const total = rows.reduce((sum, row) => ({ predicted: sum.predicted + row.predicted, gold: sum.gold + row.gold, exact: sum.exact + row.exact, consistent: sum.consistent + row.consistent }));
  if (process.env.ALIGNMENT_REPORT) console.log("total", JSON.stringify(total));
  return total;
}

describe("segment aligner on the hand-labelled samples", () => {
  it("finds the gold pairs of the sample it was tuned on", () => {
    const total = evaluate(ALIGNMENT_SAMPLE);
    expect(total.gold).toBeGreaterThanOrEqual(50);
    expect(total.exact / total.predicted).toBeGreaterThanOrEqual(0.95);
  });
  it("keeps its precision on the held-out sample", () => {
    const total = evaluate(ALIGNMENT_HELD_OUT);
    expect(total.gold).toBeGreaterThanOrEqual(35);
    expect(total.exact / total.predicted).toBeGreaterThanOrEqual(THRESHOLD_EXACT);
    expect(total.consistent / total.predicted).toBeGreaterThanOrEqual(THRESHOLD_CONSISTENT);
  });
  it("splits clauses at semicolons and keeps abbreviations inside a sentence", () => {
    const text = "Recommendations: amoxicillin 90 mg/kg/day in two doses until 14 May; follow-up with Dr. Lee in two to three days.";
    expect(splitSegments(text, "en").map(s => text.slice(s.start, s.end))).toEqual([
      "Recommendations: amoxicillin 90 mg/kg/day in two doses until 14 May;", "follow-up with Dr. Lee in two to three days."]);
  });
});
