// @vitest-environment node
/**
 * Low confidence of the segment aligner (issue 560, the owner's condition): texts the aligner cannot pair sensibly
 * are not shown as pairs. Realistic samples (the invented German/English letters) must stay usable; degenerate
 * texts must be refused with the right reason; a dropped sentence must not leave a wrong pair unmarked.
 */
import { describe, expect, it } from "vitest";
import { alignTexts, assessAlignment, MAX_ALIGN_SEGMENTS, precheckAlignment, securePairs, splitSegments, unsurePairs, type AlignmentAssessment, type SegmentPair } from "../src/translation/alignment";
import { ALIGNMENT_HELD_OUT, ALIGNMENT_SAMPLE, sampleText, type GoldDocument } from "./fixtures/alignmentSample";

const options = { sourceLang: "en", targetLang: "de" };
const DOCUMENTS = [...ALIGNMENT_SAMPLE, ...ALIGNMENT_HELD_OUT];
const EN = DOCUMENTS.map(document => sampleText(document, "en").text).join("\n\n");
const DE = DOCUMENTS.map(document => sampleText(document, "de").text).join("\n\n");

/** What the review does: the precheck, then the aligner, the secured pairs and their assessment. */
function judge(source: string, target: string, opts: { sourceLang?: string; targetLang?: string } = options): AlignmentAssessment & { pairs?: SegmentPair[] } {
  const pre = precheckAlignment(source, target, opts);
  if (!pre.usable) return pre;
  const pairs = securePairs(source, target, alignTexts(source, target, opts), opts);
  return { ...assessAlignment(source, target, pairs, opts), pairs };
}
const reason = (result: AlignmentAssessment) => result.usable ? "usable" : result.reason;

describe("alignment confidence on realistic texts", () => {
  it.each(DOCUMENTS.map(document => [document.name, document] as const))("%s is shown as pairs", (_name, document) => {
    expect(reason(judge(sampleText(document, "en").text, sampleText(document, "de").text))).toBe("usable");
  });

  it("all letters together, and with the translation as one block of text", () => {
    expect(reason(judge(EN, DE))).toBe("usable");
    expect(reason(judge(EN, DE.replace(/\s*\n+\s*/gu, " ")))).toBe("usable");
  });

  it("non-Latin scripts with their own sentence ends", () => {
    const english = "The patient was admitted on 4 May 2026. The blood pressure was 182/96 mmHg. CT showed no bleeding. We started thrombolysis with alteplase 0.9 mg/kg. The symptoms improved within 24 hours.";
    const russian = "Пациент поступил 4 мая 2026 года. Артериальное давление составляло 182/96 мм рт. ст. КТ не выявила кровотечения. Начат тромболизис алтеплазой 0,9 мг/кг. Симптомы улучшились в течение 24 часов.";
    const japanese = "患者は2026年5月4日に入院した。血圧は182/96 mmHgであった。CTでは出血を認めなかった。アルテプラーゼ0.9 mg/kgで血栓溶解療法を開始した。24時間以内に症状は改善した。";
    expect(reason(judge(english, russian, { sourceLang: "en", targetLang: "ru" }))).toBe("usable");
    expect(reason(judge(english, japanese, { sourceLang: "en", targetLang: "ja" }))).toBe("usable");
    // Without its full stops, the Japanese text is one block: refused.
    expect(reason(judge(english, japanese.replace(/。/gu, ""), { sourceLang: "en", targetLang: "ja" }))).toBe("one-block");
  });
});

describe("alignment confidence on degenerate texts", () => {
  it("an empty or blank translation", () => {
    expect(reason(judge(EN, ""))).toBe("empty");
    expect(reason(judge(EN, "  \n\n "))).toBe("empty");
    expect(reason(judge("", DE))).toBe("empty");
  });

  it("a translation without punctuation, as one block", () => {
    const block = DE.replace(/[.;!?:]/gu, "").replace(/\s*\n+\s*/gu, " ");
    expect(reason(judge(EN, block))).toBe("counts-differ");
    expect(reason(judge(sampleText(ALIGNMENT_SAMPLE[0], "en").text, "Der Patient wurde aufgenommen und behandelt und entlassen ohne Satzzeichen"))).toBe("one-block");
  });

  it("very different sentence counts: only half of the text translated", () => {
    expect(reason(judge(EN, DE.slice(0, DE.length / 2)))).toBe("counts-differ");
  });

  it("a translation missing whole sections", () => {
    const paragraphs = DE.split("\n\n");
    expect(reason(judge(EN, [...paragraphs.slice(0, 4), ...paragraphs.slice(5)].join("\n\n")))).toBe("gap");
    expect(reason(judge(EN, [...paragraphs.slice(0, 2), ...paragraphs.slice(5)].join("\n\n")))).toBe("gap");
  });

  it("a translation of another text", () => {
    expect(reason(judge(sampleText(ALIGNMENT_SAMPLE[1], "en").text, sampleText(ALIGNMENT_SAMPLE[0], "de").text))).toBe("unrelated");
    expect(reason(judge(EN, sampleText(ALIGNMENT_SAMPLE[0], "de").text))).toBe("counts-differ");
  });

  it("the sentences in another order", () => {
    expect(reason(judge(EN, DE.split(". ").reverse().join(". ")))).toBe("weak");
    const paragraphs = DE.split("\n\n");
    expect(reason(judge(EN, [...paragraphs.slice(3), ...paragraphs.slice(0, 3)].join("\n\n")))).toBe("weak");
  });

  it("a very long text is not aligned in the browser, and the check says so quickly", () => {
    const longSource = Array(16).fill(EN).join("\n\n"), longTarget = Array(16).fill(DE).join(" ");
    expect(splitSegments(longTarget, "de").length).toBeGreaterThan(MAX_ALIGN_SEGMENTS);
    const started = performance.now();
    expect(reason(precheckAlignment(longSource, longTarget, options))).toBe("too-long");
    expect(performance.now() - started).toBeLessThan(2000);
    // Eight times all letters (about 900 segments) is still aligned.
    expect(reason(judge(Array(8).fill(EN).join("\n\n"), Array(8).fill(DE).join(" ")))).toBe("usable");
  });
});

describe("unsure pairs", () => {
  type Span = { start: number; end: number };
  /** A pair is right when it is a union of whole gold pairs on both sides (gold pairs with an empty side count). */
  const right = (pair: SegmentPair, en: Span[], de: Span[]) => en.some((first, i) => en.some((last, k) => {
    if (k < i || first.start !== pair.source.start || last.end !== pair.source.end) return false;
    const parts = de.slice(i, k + 1).filter(span => span.end > span.start);
    return parts.length === 0 ? pair.translation.start === pair.translation.end
      : parts[0].start === pair.translation.start && parts[parts.length - 1].end === pair.translation.end;
  }));
  const dropped = (document: GoldDocument, at: number): GoldDocument => ({ ...document, pairs: document.pairs.map((pair, i) => i === at ? { ...pair, de: "" } : pair) });

  it("a left-out sentence whose numbers are missing marks the wrong pairs around it as unsure", () => {
    // The first sentence of the neurology letter (date of birth, dates) is not translated.
    const document = dropped(ALIGNMENT_SAMPLE[0], 0);
    const en = sampleText(document, "en"), de = sampleText(document, "de");
    const result = judge(en.text, de.text);
    expect(result.usable).toBe(true);
    const pairs = result.pairs!, unsure = unsurePairs(en.text, de.text, pairs, options);
    const wrong = pairs.map((pair, i) => [pair, i] as const).filter(([pair]) => !right(pair, en.spans, de.spans)).map(([, i]) => i);
    expect(wrong.length).toBeGreaterThan(0);
    for (const index of wrong) expect(unsure.has(index)).toBe(true);
  });

  it("each sentence of the letters left out in turn: most alignments stay right, few show an unmarked wrong pair", () => {
    // Measured with "Not in the translation" at cost 4 (at cost 6: 64 right, 32 with an unmarked wrong pair).
    let rightCount = 0, unmarked = 0, total = 0;
    for (const document of DOCUMENTS) for (let at = 0; at < document.pairs.length; at++) {
      const cut = { ...document, pairs: document.pairs.map((pair, i) => i === at ? { ...pair, de: pair.de.startsWith("¶ ") ? "¶ " : "" } : pair) };
      const en = sampleText(cut, "en"), de = sampleText(cut, "de"), result = judge(en.text, de.text);
      total++;
      if (!result.usable) continue;
      const unsure = unsurePairs(en.text, de.text, result.pairs!, options);
      const wrong = result.pairs!.map((pair, i) => [pair, i] as const).filter(([pair]) => !right(pair, en.spans, de.spans));
      if (wrong.length === 0) rightCount++;
      else if (wrong.some(([, i]) => !unsure.has(i))) unmarked++;
    }
    expect(total).toBe(101);
    expect(rightCount).toBeGreaterThanOrEqual(75);
    expect(unmarked).toBeLessThanOrEqual(22);
  });

  it("no pair of the realistic samples is unsure", () => {
    const pairs = securePairs(EN, DE, alignTexts(EN, DE, options), options);
    expect(unsurePairs(EN, DE, pairs, options).size).toBe(0);
  });

  it("securing never changes pairs the reviewer merged, split or checked", () => {
    const document = dropped(ALIGNMENT_SAMPLE[0], 0);
    const en = sampleText(document, "en").text, de = sampleText(document, "de").text;
    const fresh = alignTexts(en, de, options);
    const fixed = fresh.map(pair => ({ ...pair, manual: true }));
    expect(securePairs(en, de, fixed, options)).toEqual(fixed);
    expect(unsurePairs(en, de, fixed, options).size).toBe(0);
  });
});
