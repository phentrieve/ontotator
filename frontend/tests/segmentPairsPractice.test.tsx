/**
 * Check by segment pairs next to current practice (issue 560, the owner's condition): without the toggle nothing
 * changes; texts the aligner cannot pair fall back to the usual view with a note; the checked sentences of issue 256
 * are never lost or rewritten; a second tab's checks are kept.
 */
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { api, type CheckedSentences, type SegmentPairsView } from "../src/api/client";
import { alignTexts, textHash } from "../src/translation/alignment";
import { splitSentences } from "../src/translation/sentences";
import { TranslationReviewScreen } from "../src/translation/TranslationReviewScreen";
import { reviewWorkspace } from "./translationFixtures";

const SOURCE = "The patient has a fever of 39 °C. We gave paracetamol 1 g. She is much better this morning; she can go home today.";
const TRANSLATION = "Die Patientin hat Fieber von 39 °C. Wir gaben Paracetamol 1 g. Heute Morgen geht es ihr deutlich besser. Sie kann heute nach Hause.";
const PAIRS_KEY = "ontotator.translationReview.segmentPairs.v1:alice";
const MARKING_KEY = "ontotator.translationReview.markChecked.v1:alice";

afterEach(() => { cleanup(); window.localStorage.clear(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

function setup({ source = SOURCE, translation = TRANSLATION, marks, stored, touch = false }: { source?: string; translation?: string; marks?: CheckedSentences; stored?: SegmentPairsView; touch?: boolean } = {}) {
  const base = reviewWorkspace();
  const workspace = reviewWorkspace({ text: translation, draft: { ...base.draft, text: translation }, source: { ...base.source, text: source },
    ...(marks ? { checked_sentences: marks } : {}), segment_pairs: stored ?? null });
  vi.spyOn(api, "listSourceObligations").mockResolvedValue([]);
  vi.spyOn(api, "listMyTasks").mockResolvedValue([]);
  vi.stubGlobal("matchMedia", vi.fn((query: string) => ({ matches: /min-width/.test(query) || (touch && /pointer: coarse/.test(query)), media: query, onchange: null,
    addListener: vi.fn(), removeListener: vi.fn(), addEventListener: vi.fn(), removeEventListener: vi.fn(), dispatchEvent: () => true })));
  vi.spyOn(api, "openTranslationReview").mockResolvedValue(workspace);
  vi.spyOn(api, "saveTranslationReviewDraft").mockResolvedValue({ revision: 7 });
  const savePairs = vi.spyOn(api, "saveSegmentPairs").mockImplementation(async (_id, value) => value);
  const saveMarks = vi.spyOn(api, "saveCheckedSentences").mockImplementation(async (_id, value) => value);
  render(<TranslationReviewScreen assignmentId={17} username="alice" onNavigate={vi.fn()} routeLeaveRef={{ current: null }} leaveGuardRef={{ current: null }} />);
  return { savePairs, saveMarks };
}
const settle = () => act(async () => { await new Promise(resolve => setTimeout(resolve, 700)); });
const note = () => document.querySelector(".translation-pairs-fallback")?.textContent ?? null;
/** Marks for every sentence of both texts, as Mark checked sentences stores them. */
const allMarked = (source = SOURCE, translation = TRANSLATION): Required<CheckedSentences> => ({
  source: splitSentences(source, "en").map(sentence => ({ index: sentence.index, hash: sentence.hash })),
  translation: splitSentences(translation, "de").map(sentence => ({ index: sentence.index, hash: sentence.hash })),
});

describe("without Check by segment pairs", () => {
  it("is off by default and the review is as before: flowing texts, Mark checked sentences, browser find, nothing saved for pairs", async () => {
    const { savePairs } = setup();
    const toggle = await screen.findByRole("checkbox", { name: "Check by segment pairs" }) as HTMLInputElement;
    expect(toggle.checked).toBe(false);
    const textbox = screen.getByRole("textbox", { name: "Translation (de)" }) as HTMLTextAreaElement;
    expect(screen.getByRole("checkbox", { name: "Mark checked sentences" })).toBeTruthy();
    expect(screen.getByRole("checkbox", { name: "Couple scrolling" })).toBeTruthy();
    expect(screen.queryByRole("table", { name: "Segment pairs" })).toBeNull();
    fireEvent.change(textbox, { target: { value: TRANSLATION + " Gute Besserung." } });
    const press = new KeyboardEvent("keydown", { key: "f", ctrlKey: true, bubbles: true, cancelable: true });
    textbox.dispatchEvent(press);
    expect(press.defaultPrevented).toBe(false);
    await settle();
    expect(savePairs).not.toHaveBeenCalled();
    expect(note()).toBeNull();
  });
});

describe("texts the aligner cannot pair", () => {
  it.each([
    ["an empty translation", SOURCE, "", "one of the texts is empty."],
    ["a translation without sentence ends", SOURCE + " She has no pain. She eats well.", "Die Patientin hat Fieber und wir gaben Paracetamol und es geht ihr besser", "one text has no sentence ends"],
  ])("%s: the usual view with a note, nothing saved", async (_name, source, translation, reason) => {
    window.localStorage.setItem(PAIRS_KEY, "1");
    const { savePairs } = setup({ source, translation });
    const toggle = await screen.findByRole("checkbox", { name: "Check by segment pairs" }) as HTMLInputElement;
    expect(toggle.checked).toBe(true);
    await waitFor(() => expect(note()).toContain("These texts cannot be shown as pairs: "));
    expect(note()).toContain(reason);
    expect(note()).toContain("use Mark checked sentences");
    expect(screen.getByRole("textbox", { name: "Translation (de)" })).toBeTruthy();
    expect(screen.getByRole("checkbox", { name: "Mark checked sentences" })).toBeTruthy();
    expect(screen.queryByRole("table", { name: "Segment pairs" })).toBeNull();
    await settle();
    expect(savePairs).not.toHaveBeenCalled();
    // Turning the view off and on tries again, with the same answer; off removes the note.
    fireEvent.click(toggle);
    expect(note()).toBeNull();
    fireEvent.click(toggle);
    expect(note()).toContain(reason);
  });

  it("stored pairs of an earlier text are kept on the server when the new text cannot be paired", async () => {
    window.localStorage.setItem(PAIRS_KEY, "1");
    const stored: SegmentPairsView = { source_hash: textHash(SOURCE), text_hash: textHash(TRANSLATION), pairs: alignTexts(SOURCE, TRANSLATION, { sourceLang: "en", targetLang: "de" })
      .map(pair => ({ source: pair.source, translation: pair.translation, manual: false, checked: "0000abcd" })) };
    const { savePairs } = setup({ translation: "", stored });
    await screen.findByRole("checkbox", { name: "Check by segment pairs" });
    await waitFor(() => expect(note()).toContain("one of the texts is empty."));
    await settle();
    expect(savePairs).not.toHaveBeenCalled();
  });

  it("on a touch screen the note does not offer Mark checked sentences, which is not there", async () => {
    window.localStorage.setItem(PAIRS_KEY, "1");
    setup({ translation: "", touch: true });
    await screen.findByRole("checkbox", { name: "Check by segment pairs" });
    await waitFor(() => expect(note()).toBe("These texts cannot be shown as pairs: one of the texts is empty. They are shown as usual."));
    expect(screen.queryByRole("checkbox", { name: "Mark checked sentences" })).toBeNull();
  });
});

describe("checked sentences of issue 256", () => {
  it("are taken over into pairs once, never rewritten, and are there again when the view is turned off", async () => {
    window.localStorage.setItem(MARKING_KEY, "1");
    const marks = allMarked();
    const { saveMarks, savePairs } = setup({ marks });
    // Mark checked sentences is on: the sentences read as checked.
    await screen.findByRole("checkbox", { name: "Check by segment pairs" });
    const counts = () => [...document.querySelectorAll(".translation-column-head .sentence-count")].map(element => element.textContent);
    const all = [`Source: ${marks.source.length} of ${marks.source.length} checked`, `Translation: ${marks.translation.length} of ${marks.translation.length} checked`];
    expect(counts()).toEqual(all);
    fireEvent.click(screen.getByRole("checkbox", { name: "Check by segment pairs" }));
    // Every pair whose sentences were all checked starts checked.
    expect(document.querySelector(".translation-tools .sentence-count")!.textContent).toBe("4 of 4 pairs checked");
    // Show changes works in the pair view, also with Mark checked sentences on.
    expect((screen.getByRole("checkbox", { name: "Show changes" }) as HTMLInputElement).disabled).toBe(false);
    // Take one pair's check away: the sentence marks stay as they were.
    fireEvent.click(screen.getByRole("button", { name: "Pair 1: Checked" }));
    await settle();
    expect(savePairs).toHaveBeenCalled();
    expect(saveMarks).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("checkbox", { name: "Check by segment pairs" }));
    expect(screen.getByRole("checkbox", { name: "Mark checked sentences" })).toBeTruthy();
    expect(counts()).toEqual(all);
    // And back: the pairs keep their own checks (pair 1 is still open).
    fireEvent.click(screen.getByRole("checkbox", { name: "Check by segment pairs" }));
    expect(document.querySelector(".translation-tools .sentence-count")!.textContent).toBe("3 of 4 pairs checked");
    expect(screen.getByRole("button", { name: "Pair 1: Not checked" })).toBeTruthy();
    await settle();
    expect(saveMarks).not.toHaveBeenCalled();
  });

  it("an edit in a pair moves the sentence marks as an edit in the flowing editor does", async () => {
    window.localStorage.setItem(PAIRS_KEY, "1");
    const marks = allMarked();
    const { saveMarks } = setup({ marks });
    fireEvent.click(await screen.findByRole("button", { name: "Edit the translation of pair 1" }));
    // A new sentence in pair 1: the marks of the sentences after it move one place on; none is lost.
    fireEvent.change(screen.getByRole("textbox", { name: "Translation of pair 1" }), { target: { value: "Die Patientin hat Fieber von 39 °C. Sie friert." } });
    await settle();
    const sent = saveMarks.mock.calls.at(-1)![1];
    expect(sent.source).toEqual(marks.source);
    expect(sent.translation!.map(mark => mark.hash)).toEqual(marks.translation.map(mark => mark.hash));
    expect(sent.translation!.map(mark => mark.index)).toEqual(marks.translation.map(mark => mark.index === 0 ? 0 : mark.index + 1));
  });
});

describe("two tabs", () => {
  it("each save sends the pairs it was made from, and shows the checks the other tab saved", async () => {
    window.localStorage.setItem(PAIRS_KEY, "1");
    const { savePairs } = setup();
    await screen.findByRole("table", { name: "Segment pairs" });
    await settle();
    const first = savePairs.mock.calls.at(-1)!;
    expect(first[2]).toBeNull();
    // The other tab checked pair 4 meanwhile: the server's answer has it.
    savePairs.mockImplementation(async (_id, value) => ({ ...value, pairs: value.pairs!.map((pair, i) => i === 3 ? { ...pair, checked: "0000beef" } : pair) }));
    fireEvent.click(screen.getByRole("button", { name: "Pair 1: Not checked" }));
    await settle();
    const second = savePairs.mock.calls.at(-1)!;
    expect(second[2]).toEqual(first[1]);
    expect(screen.getByRole("button", { name: "Pair 1: Checked" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Pair 4: Changed since checked" })).toBeTruthy();
  });
});

describe("touch screens", () => {
  it("offer the pair view (a button per pair, no drag) while Mark checked sentences stays off there", async () => {
    setup({ touch: true });
    const toggle = await screen.findByRole("checkbox", { name: "Check by segment pairs" });
    expect(screen.queryByRole("checkbox", { name: "Mark checked sentences" })).toBeNull();
    fireEvent.click(toggle);
    fireEvent.click(screen.getByRole("button", { name: "Pair 2: Not checked" }));
    expect(screen.getByRole("button", { name: "Pair 2: Checked" })).toBeTruthy();
  });
});
