import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { api, type SegmentPairsView } from "../src/api/client";
import type { RouteLeaveGuard } from "../src/app/router";
import { alignTexts, carryChecks, mergedWithNext, pairHash, pairsFromSentenceMarks, pairState, rebasePairs, splitPair, STALE, textHash, toggledPair, type SegmentPair } from "../src/translation/alignment";
import { splitSentences } from "../src/translation/sentences";
import { indexCells, rangeAt } from "../src/translation/textRanges";
import { TranslationReviewScreen } from "../src/translation/TranslationReviewScreen";
import { reviewWorkspace } from "./translationFixtures";

const SOURCE = "The patient has a fever of 39 °C. We gave paracetamol 1 g. She is much better this morning; she can go home today.";
const TRANSLATION = "Die Patientin hat Fieber von 39 °C. Wir gaben Paracetamol 1 g. Heute Morgen geht es ihr deutlich besser. Sie kann heute nach Hause.";
const options = { sourceLang: "en", targetLang: "de" };
const slices = (pairs: SegmentPair[], source: string, target: string) => pairs.map(pair => [source.slice(pair.source.start, pair.source.end), target.slice(pair.translation.start, pair.translation.end)]);

afterEach(() => { cleanup(); window.localStorage.clear(); vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers(); });

describe("segment pairs", () => {
  const pairs = alignTexts(SOURCE, TRANSLATION, options);

  it("align sentences and clauses n:m", () => {
    expect(slices(pairs, SOURCE, TRANSLATION)).toEqual([
      ["The patient has a fever of 39 °C.", "Die Patientin hat Fieber von 39 °C."],
      ["We gave paracetamol 1 g.", "Wir gaben Paracetamol 1 g."],
      ["She is much better this morning;", "Heute Morgen geht es ihr deutlich besser."],
      ["she can go home today.", "Sie kann heute nach Hause."],
    ]);
  });

  it("are checked as one; an edit inside a checked pair reads as changed since checked, the others stay checked", () => {
    let checked = toggledPair(pairs, TRANSLATION, 0);
    checked = toggledPair(checked, TRANSLATION, 1);
    expect(checked.map(pair => pairState(TRANSLATION, pair))).toEqual(["checked", "checked", "open", "open"]);
    const edited = TRANSLATION.replace("Fieber von 39 °C", "Fieber bis 39,5 °C");
    const after = rebasePairs(checked, SOURCE, TRANSLATION, edited, options);
    expect(after.map(pair => pairState(edited, pair))).toEqual(["stale", "checked", "open", "open"]);
    expect(slices(after, SOURCE, edited)[1][1]).toBe("Wir gaben Paracetamol 1 g.");
    // Checking it again takes today's text; a whitespace-only change keeps the check.
    const again = toggledPair(after, edited, 0);
    expect(pairState(edited, again[0])).toBe("checked");
    const spaced = edited.replace("Fieber bis", "Fieber  bis");
    expect(pairState(spaced, rebasePairs(again, SOURCE, edited, spaced, options)[0])).toBe("checked");
    // Unchecking a checked pair.
    expect(pairState(edited, toggledPair(again, edited, 0)[0])).toBe("open");
  });

  it("align only the pairs an edit crosses, and keep a check there as changed since checked", () => {
    const checked = toggledPair(toggledPair(pairs, TRANSLATION, 1), TRANSLATION, 3);
    // Deleting across the end of pair 2 and the start of pair 3.
    const edited = TRANSLATION.replace("1 g. Heute Morgen", "1 g, heute Morgen");
    const after = rebasePairs(checked, SOURCE, TRANSLATION, edited, options);
    expect(after[0]).toEqual(checked[0]);
    expect(pairState(edited, after[after.length - 1])).toBe("checked");
    expect(after.slice(1, -1).some(pair => pairState(edited, pair) === "stale")).toBe(true);
  });

  it("merge and split by hand; a merge of a checked and an open pair needs another look", () => {
    const checked = toggledPair(pairs, TRANSLATION, 2);
    const merged = mergedWithNext(checked, TRANSLATION, 2);
    expect(merged).toHaveLength(3);
    expect(merged[2]).toMatchObject({ origin: "manual", checked: STALE });
    expect(pairState(TRANSLATION, merged[2])).toBe("stale");
    const split = splitPair(merged, SOURCE, TRANSLATION, 2, options)!;
    expect(slices(split, SOURCE, TRANSLATION).slice(2)).toEqual([["She is much better this morning;", "Heute Morgen geht es ihr deutlich besser."], ["she can go home today.", "Sie kann heute nach Hause."]]);
    expect(split.slice(2).every(pair => pair.origin === "manual")).toBe(true);
    // A pair of one short clause on each side has nothing to split.
    expect(splitPair(pairs, SOURCE, TRANSLATION, 1, options)).toBeNull();
    // Merging two checked pairs keeps the check.
    const both = mergedWithNext(toggledPair(toggledPair(pairs, TRANSLATION, 0), TRANSLATION, 1), TRANSLATION, 0);
    expect(pairState(TRANSLATION, both[0])).toBe("checked");
  });

  it("keep manual and checked pairs when the texts are aligned again", () => {
    const fixed = mergedWithNext(pairs, TRANSLATION, 0);
    const again = alignTexts(SOURCE, TRANSLATION, options, [fixed[0]]);
    expect(again[0]).toEqual(fixed[0]);
    expect(again).toHaveLength(3);
  });

  it("carry checks to a fresh alignment by source passage and translation", () => {
    const checked = toggledPair(toggledPair(pairs, TRANSLATION, 0), TRANSLATION, 1);
    const edited = TRANSLATION.replace("Paracetamol 1 g", "Paracetamol 500 mg");
    const carried = carryChecks(alignTexts(SOURCE, edited, options), checked);
    expect(carried.map(pair => pairState(edited, pair))).toEqual(["checked", "stale", "open", "open"]);
  });

  it("take checks from the checked-sentence marks once: a pair is checked when all its sentences are", () => {
    const source = splitSentences(SOURCE, "en"), target = splitSentences(TRANSLATION, "de");
    // The sentence marks of issue 256 read "1 g. She …" as one sentence: two in the source, three in the translation.
    expect([source.length, target.length]).toEqual([2, 3]);
    const marks = { source: [0, 1].map(index => ({ index, hash: source[index].hash })), translation: [0, 1].map(index => ({ index, hash: target[index].hash })) };
    const migrated = pairsFromSentenceMarks(pairs, SOURCE, TRANSLATION, marks, options);
    // Pairs 1 to 3 touch only checked sentences; pair 4 touches the unchecked last translation sentence.
    expect(migrated.map(pair => pairState(TRANSLATION, pair))).toEqual(["checked", "checked", "checked", "open"]);
    expect(pairsFromSentenceMarks(pairs, SOURCE, TRANSLATION, { source: [], translation: [] }, options)).toEqual(pairs);
    expect(migrated[0].checked).toBe(pairHash(TRANSLATION, pairs[0]));
  });
});

function setup(stored?: SegmentPairsView) {
  const base = reviewWorkspace();
  const workspace = reviewWorkspace({ text: TRANSLATION, draft: { ...base.draft, text: TRANSLATION }, source: { ...base.source, text: SOURCE }, segment_pairs: stored ?? null });
  vi.spyOn(api, "listSourceObligations").mockResolvedValue([]);
  vi.spyOn(api, "listMyTasks").mockResolvedValue([]);
  vi.stubGlobal("matchMedia", vi.fn((query: string) => ({ matches: /min-width/.test(query), media: query, onchange: null, addListener: vi.fn(), removeListener: vi.fn(), addEventListener: vi.fn(), removeEventListener: vi.fn(), dispatchEvent: () => true })));
  vi.spyOn(api, "openTranslationReview").mockResolvedValue(workspace);
  vi.spyOn(api, "saveTranslationReviewDraft").mockResolvedValue({ revision: 7 });
  const save = vi.spyOn(api, "saveSegmentPairs").mockImplementation(async (_id, value) => value);
  const routeLeaveRef: { current: RouteLeaveGuard | null } = { current: null };
  const leaveGuardRef: { current: ((proceed: () => void) => void) | null } = { current: null };
  render(<TranslationReviewScreen assignmentId={17} username="alice" onNavigate={vi.fn()} routeLeaveRef={routeLeaveRef} leaveGuardRef={leaveGuardRef} />);
  return { save };
}
const rows = () => screen.getAllByRole("row").slice(1);
const settle = () => act(async () => { await new Promise(resolve => setTimeout(resolve, 700)); });

describe("Check by segment pairs", () => {
  it("shows the pairs in rows, checks a pair, marks an edited pair as changed and saves the pairs", async () => {
    const { save } = setup();
    fireEvent.click(await screen.findByRole("checkbox", { name: "Check by segment pairs" }));
    expect(screen.queryByRole("textbox", { name: "Translation (de)" })).toBeNull();
    expect(screen.queryByRole("checkbox", { name: "Mark checked sentences" })).toBeNull();
    expect(rows()).toHaveLength(4);
    expect(within(rows()[2]).getByText("She is much better this morning;")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Pair 1: Not checked" }));
    expect(screen.getByRole("button", { name: "Pair 1: Checked" }).getAttribute("aria-pressed")).toBe("true");
    expect(document.querySelector(".translation-tools .sentence-count")!.textContent).toBe("1 of 4 pairs checked");
    // Edit the translation of pair 1 in its cell.
    fireEvent.click(screen.getByRole("button", { name: "Edit the translation of pair 1" }));
    const cell = screen.getByRole("textbox", { name: "Translation of pair 1" }) as HTMLTextAreaElement;
    fireEvent.change(cell, { target: { value: "Die Patientin hat Fieber bis 39 °C." } });
    expect(screen.getByRole("button", { name: "Pair 1: Changed since checked" })).toBeTruthy();
    expect(document.querySelector(".translation-tools .sentence-count")!.textContent).toBe("0 of 4 pairs checked · 1 changed");
    fireEvent.blur(cell);
    expect(screen.getByText("Die Patientin hat Fieber bis 39 °C.")).toBeTruthy();
    await settle();
    const sent = save.mock.calls.at(-1)![1];
    const text = TRANSLATION.replace("von 39", "bis 39");
    expect(sent.text_hash).toBe(textHash(text));
    expect(sent.source_hash).toBe(textHash(SOURCE));
    expect(sent.pairs![0].checked).not.toBe(pairHash(text, { source: sent.pairs![0].source, translation: sent.pairs![0].translation }));
    expect(sent.pairs![1].translation.start).toBe(text.indexOf("Wir gaben"));
  });

  it("merges and splits pairs from the row menu", async () => {
    setup();
    fireEvent.click(await screen.findByRole("checkbox", { name: "Check by segment pairs" }));
    fireEvent.click(screen.getByRole("button", { name: "Pair 3: change the pairing" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Merge with the pair below" }));
    expect(rows()).toHaveLength(3);
    expect(rows()[2].textContent).toContain("She is much better this morning; she can go home today.");
    fireEvent.click(screen.getByRole("button", { name: "Pair 3: change the pairing" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Split this pair" }));
    expect(rows()).toHaveLength(4);
  });

  it("uses stored pairs made on these texts, and finds in the cells of each side", async () => {
    const pairs = toggledPair(mergedWithNext(alignTexts(SOURCE, TRANSLATION, options), TRANSLATION, 0), TRANSLATION, 0);
    setup({ source_hash: textHash(SOURCE), text_hash: textHash(TRANSLATION),
      pairs: pairs.map(pair => ({ source: pair.source, translation: pair.translation, origin: pair.origin ?? "aligner", checked: pair.checked ?? null })) });
    fireEvent.click(await screen.findByRole("checkbox", { name: "Check by segment pairs" }));
    expect(rows()).toHaveLength(3);
    expect(screen.getByRole("button", { name: "Pair 1: Checked" })).toBeTruthy();
    const table = screen.getByRole("table", { name: "Segment pairs" });
    const index = indexCells(table, "translation"), at = TRANSLATION.indexOf("Paracetamol");
    expect(rangeAt(index, at, at + 11)!.toString()).toBe("Paracetamol");
    const sourceIndex = indexCells(table, "source"), from = SOURCE.indexOf("go home");
    expect(rangeAt(sourceIndex, from, from + 7)!.toString()).toBe("go home");
    // The find bar counts the hits of both sides.
    fireEvent.keyDown(table, { key: "f", ctrlKey: true });
    await act(async () => { await new Promise(resolve => window.requestAnimationFrame(() => resolve(null))); });
    fireEvent.change(screen.getByRole("searchbox", { name: "Find in the texts" }), { target: { value: "39" } });
    expect(document.querySelector(".find-bar-status")!.textContent).toBe("1 of 2Source 1 · Translation 1");
  });

  it("shows the changes inside the translation cells with Show changes, and then does not edit", async () => {
    const base = reviewWorkspace();
    const machine = TRANSLATION.replace("Paracetamol 1 g", "Paracetamol 2 g");
    vi.spyOn(api, "listSourceObligations").mockResolvedValue([]);
    vi.spyOn(api, "listMyTasks").mockResolvedValue([]);
    vi.stubGlobal("matchMedia", vi.fn((query: string) => ({ matches: /min-width/.test(query), media: query, onchange: null, addListener: vi.fn(), removeListener: vi.fn(), addEventListener: vi.fn(), removeEventListener: vi.fn(), dispatchEvent: () => true })));
    vi.spyOn(api, "openTranslationReview").mockResolvedValue(reviewWorkspace({ text: machine, draft: { ...base.draft, text: TRANSLATION }, source: { ...base.source, text: SOURCE } }));
    vi.spyOn(api, "saveSegmentPairs").mockImplementation(async (_id, value) => value);
    render(<TranslationReviewScreen assignmentId={17} username="alice" onNavigate={vi.fn()} routeLeaveRef={{ current: null }} leaveGuardRef={{ current: null }} />);
    fireEvent.click(await screen.findByRole("checkbox", { name: "Check by segment pairs" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Show changes" }));
    const second = rows()[1];
    expect(second.querySelector("del")!.textContent).toBe("2");
    expect(second.querySelector("ins")!.textContent).toBe("1");
    expect(screen.queryByRole("button", { name: "Edit the translation of pair 2" })).toBeNull();
  });
});
