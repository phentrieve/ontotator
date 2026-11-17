import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { api } from "../src/api/client";
import type { RouteLeaveGuard } from "../src/app/router";
import { TranslationReviewScreen } from "../src/translation/TranslationReviewScreen";
import { rebaseMarks, resolveMarks, sentenceHash, splitSentences, storedMarks, toggled, type StoredMark } from "../src/translation/sentences";
import { reviewWorkspace } from "./translationFixtures";

const SOURCE = "First source. Second source! Third source?";
const TRANSLATION = "Erster Satz. Zweiter Satz. Dritter Satz. Vierter Satz.";
const KEY = "ontotator.translationReview.markChecked.v1:alice";

// jsdom has no PointerEvent; without it button, shiftKey and pointerId would be dropped.
if (typeof window.PointerEvent === "undefined") {
  class TestPointerEvent extends MouseEvent {
    pointerId: number;
    constructor(type: string, init: PointerEventInit = {}) {
      super(type, init);
      this.pointerId = init.pointerId ?? 0;
    }
  }
  (window as unknown as { PointerEvent: unknown }).PointerEvent = TestPointerEvent;
}

afterEach(() => { cleanup(); window.localStorage.clear(); vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

function setup(changes: Parameters<typeof reviewWorkspace>[0] = {}, marking = true) {
  if (marking) window.localStorage.setItem(KEY, "1");
  const base = reviewWorkspace();
  const workspace = reviewWorkspace({ text: TRANSLATION, draft: { ...base.draft, text: TRANSLATION }, source: { ...base.source, text: SOURCE }, ...changes });
  vi.spyOn(api, "listSourceObligations").mockResolvedValue([]);
  vi.spyOn(api, "listMyTasks").mockResolvedValue([]);
  vi.stubGlobal("matchMedia", vi.fn((query: string) => ({ matches: /min-width/.test(query), media: query, onchange: null, addListener: vi.fn(), removeListener: vi.fn(), addEventListener: vi.fn(), removeEventListener: vi.fn(), dispatchEvent: () => true })));
  vi.spyOn(api, "openTranslationReview").mockResolvedValue(workspace);
  const saveDraft = vi.spyOn(api, "saveTranslationReviewDraft").mockResolvedValue({ revision: 7 });
  const saveMarks = vi.spyOn(api, "saveCheckedSentences").mockImplementation(async (_id, body) => body);
  const routeLeaveRef: { current: RouteLeaveGuard | null } = { current: null };
  const leaveGuardRef: { current: ((proceed: () => void) => void) | null } = { current: null };
  render(<TranslationReviewScreen assignmentId={17} username="alice" onNavigate={vi.fn()} routeLeaveRef={routeLeaveRef} leaveGuardRef={leaveGuardRef} />);
  return { saveDraft, saveMarks, routeLeaveRef, workspace };
}
const region = (name: string) => screen.getByRole("region", { name });
const sentences = (name: string) => [...region(name).querySelectorAll<HTMLElement>("[data-sentence]")];
const pressed = (name: string) => sentences(name).map(element => element.getAttribute("aria-pressed") === "true");
const counter = () => [...document.querySelectorAll(".sentence-count")].map(element => element.textContent).join(" / ");
function click(element: HTMLElement, init: PointerEventInit = {}) {
  fireEvent.pointerDown(element, { button: 0, pointerId: 1, ...init });
  fireEvent.pointerUp(element, { button: 0, pointerId: 1, ...init });
}
function drag(from: HTMLElement, over: HTMLElement[]) {
  fireEvent.pointerDown(from, { button: 0, pointerId: 2 });
  for (const element of over) fireEvent.pointerMove(element, { pointerId: 2 });
  fireEvent.pointerUp(over.at(-1) ?? from, { pointerId: 2 });
}

describe("sentence splitting", () => {
  it("splits one long paragraph into sentences with and without Intl.Segmenter", () => {
    for (const segmenter of [true, false]) {
      const parts = splitSentences("One sentence here. Another one follows! And a third? Yes.", "en", { segmenter });
      expect(parts.map(part => part.text)).toEqual(["One sentence here.", "Another one follows!", "And a third?", "Yes."]);
    }
  });
  it("does not end a sentence at an abbreviation", () => {
    const de = "Aufnahme durch Dr. Müller am 3. Mai. V. a. Pneumonie, z. B. mit Fieber bis ca. 39 °C. Keine Allergien.";
    for (const segmenter of [true, false]) {
      expect(splitSentences(de, "de", { segmenter }).map(part => part.text)).toEqual(["Aufnahme durch Dr. Müller am 3. Mai.", "V. a. Pneumonie, z. B. mit Fieber bis ca. 39 °C.", "Keine Allergien."]);
      expect(splitSentences("The dose was 5. Seen by Dr. Smith.", "en", { segmenter }).map(part => part.text)).toEqual(["The dose was 5.", "Seen by Dr. Smith."]);
    }
  });
  it("never lets a sentence span a line break and keeps offsets exact", () => {
    const text = "Kopf\n\nErster Satz. Zweiter Satz.\nLetzter";
    const parts = splitSentences(text, "de");
    expect(parts.map(part => part.text)).toEqual(["Kopf", "Erster Satz.", "Zweiter Satz.", "Letzter"]);
    for (const part of parts) expect(text.slice(part.start, part.end)).toBe(part.text);
  });
  it("reads a mark only at its own sentence: an edited one is stale, an equal sentence elsewhere is never checked", () => {
    const before = splitSentences("A one. B two. C three.", "en");
    const marks = storedMarks(before, toggled(toggled(before.map(() => null), 0), 2));
    const edited = splitSentences("A one. B two. C changed.", "en");
    expect(resolveMarks(edited, marks)).toEqual([{ kind: "checked" }, null, { kind: "stale", hash: sentenceHash("C three.") }]);
    // The mark of the first "Unauffällig." after that sentence was changed: not the unread second one.
    const repeated = splitSentences("Herz. Geändert. Lunge. Unauffällig.", "de");
    expect(resolveMarks(repeated, [{ index: 1, hash: sentenceHash("Unauffällig.") }])).toEqual([null, { kind: "stale", hash: sentenceHash("Unauffällig.") }, null, null]);
    // A mark beyond the text belongs to no sentence.
    expect(resolveMarks(repeated, [{ index: 9, hash: sentenceHash("Unauffällig.") }])).toEqual([null, null, null, null]);
  });
});

/** The states of `afterText` after the marks made on `beforeText` followed the edit. */
function afterEdit(beforeText: string, afterText: string, marks: StoredMark[], lang = "de") {
  const before = splitSentences(beforeText, lang), after = splitSentences(afterText, lang);
  const rebased = rebaseMarks(before, beforeText, after, afterText, marks);
  return { marks: rebased, states: resolveMarks(after, rebased).map(state => state?.kind ?? null) };
}
const marksAt = (text: string, indexes: number[], lang = "de"): StoredMark[] => {
  const parts = splitSentences(text, lang);
  return indexes.map(index => ({ index, hash: parts[index].hash }));
};

describe("marks follow an edit of the text", () => {
  const SHORT = "Herz. Unauffällig. Lunge. Unauffällig. Abdomen. Unauffällig.";

  it("splits the fixture into the repeated sentences the tests rely on", () => {
    expect(splitSentences(SHORT, "de").map(part => part.text)).toEqual(["Herz.", "Unauffällig.", "Lunge.", "Unauffällig.", "Abdomen.", "Unauffällig."]);
  });
  it("keeps the mark of a changed sentence at its position as changed and never moves it to an equal sentence", () => {
    // Only the first "Unauffällig." was read; the reviewer then changes it.
    const result = afterEdit(SHORT, "Herz. Unauffällig bis auf ein Systolikum. Lunge. Unauffällig. Abdomen. Unauffällig.", marksAt(SHORT, [1]));
    expect(result.states).toEqual([null, "stale", null, null, null, null]);
    expect(result.marks).toEqual([{ index: 1, hash: sentenceHash("Unauffällig.") }]);
  });
  it("keeps the other equal sentences checked when two of several identical ones are edited one after the other", () => {
    const all = marksAt(SHORT, [1, 3, 5]);
    const first = "Herz. Auffällig. Lunge. Unauffällig. Abdomen. Unauffällig.";
    const one = afterEdit(SHORT, first, all);
    expect(one.states).toEqual([null, "stale", null, "checked", null, "checked"]);
    const second = "Herz. Auffällig. Lunge. Unauffällig. Abdomen. Druckschmerz.";
    expect(afterEdit(first, second, one.marks).states).toEqual([null, "stale", null, "checked", null, "stale"]);
  });
  it("handles two of several identical sentences changed in one step", () => {
    // One change of the whole passage, as "Undo my edits" or a paste makes it.
    const result = afterEdit(SHORT, "Herz. Auffällig. Lunge. Unauffällig. Abdomen. Druckschmerz.", marksAt(SHORT, [1, 3, 5]));
    expect(result.states).toEqual([null, "stale", null, "checked", null, "stale"]);
    // Only the first and the last were read: the middle one stays unread.
    expect(afterEdit(SHORT, "Herz. Auffällig. Lunge. Unauffällig. Abdomen. Druckschmerz.", marksAt(SHORT, [1, 5])).states).toEqual([null, "stale", null, null, null, "stale"]);
  });
  it("moves the marks with their sentences when text is added or removed before them", () => {
    const marks = marksAt(SHORT, [1, 4]);
    expect(afterEdit(SHORT, `Neuer Satz. ${SHORT}`, marks).states).toEqual([null, null, "checked", null, null, "checked", null]);
    expect(afterEdit(SHORT, SHORT.replace("Herz. ", ""), marks).states).toEqual(["checked", null, null, "checked", null]);
    const english = "A one. B two. C three.";
    expect(afterEdit(english, "New first. A one. B two. C three.", marksAt(english, [0, 2], "en"), "en").states).toEqual([null, "checked", null, "checked"]);
  });
  it("drops the mark of a removed sentence instead of giving it to the equal one after it", () => {
    // The read first "Unauffällig." is deleted; the second one was never read.
    expect(afterEdit(SHORT, SHORT.replace("Herz. Unauffällig. ", "Herz. "), marksAt(SHORT, [1])).states).toEqual([null, null, null, null, null]);
    // Deleting either of two adjacent equal sentences gives the same text: the rest counts as unread.
    expect(afterEdit("Unauffällig. Unauffällig.", "Unauffällig.", [{ index: 1, hash: sentenceHash("Unauffällig.") }]).states).toEqual([null]);
  });
  it("checks a changed sentence again when the edit is taken back", () => {
    const edited = "Herz. Unauffällig, aber. Lunge. Unauffällig. Abdomen. Unauffällig.";
    const changed = afterEdit(SHORT, edited, marksAt(SHORT, [1, 3]));
    expect(changed.states).toEqual([null, "stale", null, "checked", null, null]);
    expect(afterEdit(edited, SHORT, changed.marks).states).toEqual([null, "checked", null, "checked", null, null]);
  });
  it("marks a merged or split sentence as changed, not as checked", () => {
    const text = "Erster Satz. Zweiter Satz. Dritter Satz.";
    // Merged: the first two become one sentence, which takes the first mark as changed.
    expect(afterEdit(text, "Erster Satz und zweiter Satz. Dritter Satz.", marksAt(text, [0, 1, 2])).states).toEqual(["stale", "checked"]);
    // Split: the second sentence becomes two; the new part is unread.
    expect(afterEdit(text, "Erster Satz. Zweiter. Satz. Dritter Satz.", marksAt(text, [1, 2])).states).toEqual([null, "stale", null, "checked"]);
  });
  it("does not check an equal sentence that takes the place of an edited one when the passage changed its length", () => {
    // "Lunge. Unauffällig." (read) is replaced by one "Unauffällig." in a passage of another length.
    const result = afterEdit("Herz. Lunge. Unauffällig. Ende.", "Herz. Unauffällig. Ende.", [{ index: 1, hash: sentenceHash("Unauffällig.") }]);
    expect(result.states).toEqual([null, null, null]);
  });
});

describe("Mark checked sentences", () => {
  it("is off by default: texts behave as today and the choice is remembered", async () => {
    const { saveMarks } = setup({}, false);
    const toggle = await screen.findByRole("checkbox", { name: "Mark checked sentences" }) as HTMLInputElement;
    expect(toggle.checked).toBe(false);
    expect(screen.getByRole("textbox", { name: "Translation (de)" })).toBeDefined();
    expect(region("Source (en)").querySelector("[data-sentence]")).toBeNull();
    expect(screen.queryByRole("button", { name: "Next unchecked" })).toBeNull();
    fireEvent.click(toggle);
    expect(window.localStorage.getItem(KEY)).toBe("1");
    expect(screen.queryByRole("textbox", { name: "Translation (de)" })).toBeNull();
    expect(sentences("Source (en)")).toHaveLength(3);
    expect(sentences("Translation (de)")).toHaveLength(4);
    expect((screen.getByRole("checkbox", { name: "Show changes" }) as HTMLInputElement).disabled).toBe(true);
    fireEvent.click(toggle);
    expect(window.localStorage.getItem(KEY)).toBe("0");
    expect(screen.getByRole("textbox", { name: "Translation (de)" })).toBeDefined();
    expect(saveMarks).not.toHaveBeenCalled();
  });

  it("click toggles one side only and saves the marks without a draft save", async () => {
    const { saveMarks, saveDraft } = setup();
    await screen.findByRole("button", { name: "Next unchecked" });
    vi.useFakeTimers();
    click(sentences("Translation (de)")[1]);
    expect(pressed("Translation (de)")).toEqual([false, true, false, false]);
    expect(pressed("Source (en)")).toEqual([false, false, false]);
    expect(sentences("Translation (de)")[1].className).toContain("is-checked");
    expect(counter()).toBe("Source: 0 of 3 checked / Translation: 1 of 4 checked");
    click(sentences("Translation (de)")[1]);
    expect(pressed("Translation (de)")).toEqual([false, false, false, false]);
    click(sentences("Source (en)")[2]);
    await act(async () => { await vi.advanceTimersByTimeAsync(700); });
    expect(saveMarks).toHaveBeenCalledTimes(1);
    // With the marks it was made from, so the server applies only this change (issue 284).
    expect(saveMarks).toHaveBeenLastCalledWith(17, { source: [{ index: 2, hash: sentenceHash("Third source?") }], translation: [] }, { source: [], translation: [] });
    expect(saveDraft).not.toHaveBeenCalled();
  });

  it("Shift+click and Shift+Enter mark the range from the last clicked sentence", async () => {
    setup();
    await screen.findByRole("button", { name: "Next unchecked" });
    click(sentences("Translation (de)")[0]);
    click(sentences("Translation (de)")[2], { shiftKey: true });
    expect(pressed("Translation (de)")).toEqual([true, true, true, false]);
    fireEvent.keyDown(sentences("Source (en)")[0], { key: "Enter" });
    expect(pressed("Source (en)")).toEqual([true, false, false]);
    fireEvent.keyDown(sentences("Source (en)")[2], { key: "Enter", shiftKey: true });
    expect(pressed("Source (en)")).toEqual([true, true, true]);
    fireEvent.keyDown(sentences("Source (en)")[1], { key: " " });
    expect(pressed("Source (en)")).toEqual([true, false, true]);
    // The submit shortcut leaves the marks alone.
    fireEvent.keyDown(sentences("Source (en)")[1], { key: "Enter", ctrlKey: true });
    expect(pressed("Source (en)")).toEqual([true, false, true]);
  });

  it("drag from an unchecked sentence marks the range and from a checked one unmarks it", async () => {
    setup();
    await screen.findByRole("button", { name: "Next unchecked" });
    const items = () => sentences("Translation (de)");
    fireEvent.pointerDown(items()[0], { button: 0, pointerId: 3 });
    fireEvent.pointerMove(items()[2], { pointerId: 3 });
    // The live range shows what the release will do.
    expect(items().slice(0, 3).every(element => element.className.includes("is-range-mark"))).toBe(true);
    expect(items()[3].className).not.toContain("is-range");
    fireEvent.pointerUp(items()[2], { pointerId: 3 });
    expect(pressed("Translation (de)")).toEqual([true, true, true, false]);
    drag(items()[3], [items()[2], items()[1]]);
    // Started on an unchecked sentence: everything passed is checked.
    expect(pressed("Translation (de)")).toEqual([true, true, true, true]);
    drag(items()[2], [items()[1]]);
    expect(pressed("Translation (de)")).toEqual([true, false, false, true]);
    expect(pressed("Source (en)")).toEqual([false, false, false]);
  });

  it("shows stored marks, an edited checked sentence as changed since checked, and Next unchecked", async () => {
    const translation = splitSentences(TRANSLATION, "de");
    const scroll = vi.fn();
    Element.prototype.scrollIntoView = scroll;
    setup({
      draft: { text: "Erster Satz. Zweiter Satz geändert. Dritter Satz. Vierter Satz.", form: {}, revision: 6 },
      checked_sentences: { source: [{ index: 0, hash: sentenceHash("First source.") }], translation: [0, 1, 3].map(index => ({ index, hash: translation[index].hash })) },
    });
    await screen.findByRole("button", { name: "Next unchecked" });
    const items = sentences("Translation (de)");
    expect(pressed("Translation (de)")).toEqual([true, false, false, true]);
    expect(items[1].className).toContain("is-stale");
    expect(items[1].textContent).toContain("changed since checked");
    expect(counter()).toBe("Source: 1 of 3 checked / Translation: 2 of 4 checked · 1 changed");
    fireEvent.click(screen.getByRole("button", { name: "Next unchecked" }));
    expect(document.activeElement).toBe(items[1]);
    expect(scroll).toHaveBeenCalled();
    click(items[1]);
    expect(sentences("Translation (de)")[1].className).toContain("is-checked");
    expect(counter()).toBe("Source: 1 of 3 checked / Translation: 3 of 4 checked");
    fireEvent.click(screen.getByRole("button", { name: "Next unchecked" }));
    expect(document.activeElement).toBe(sentences("Translation (de)")[2]);
  });

  it("an edit after checking makes the mark stale until it is ticked again", async () => {
    setup({}, false);
    const toggle = await screen.findByRole("checkbox", { name: "Mark checked sentences" });
    fireEvent.click(toggle);
    click(sentences("Translation (de)")[0]);
    click(sentences("Translation (de)")[3]);
    fireEvent.click(toggle);
    fireEvent.change(screen.getByRole("textbox", { name: "Translation (de)" }), { target: { value: "Erster Satz neu. Zweiter Satz. Dritter Satz. Vierter Satz." } });
    fireEvent.click(toggle);
    expect(sentences("Translation (de)")[0].className).toContain("is-stale");
    expect(sentences("Translation (de)")[3].className).toContain("is-checked");
    expect(counter()).toBe("Source: 0 of 3 checked / Translation: 1 of 4 checked · 1 changed");
  });

  it("an edited checked sentence stays changed at its place; the equal sentence further down is not checked", async () => {
    const text = "Herz. Unauffällig. Lunge. Unauffällig.";
    const base = reviewWorkspace();
    const { saveMarks } = setup({ text, draft: { ...base.draft, text } }, false);
    const toggle = await screen.findByRole("checkbox", { name: "Mark checked sentences" });
    fireEvent.click(toggle);
    click(sentences("Translation (de)")[1]);
    fireEvent.click(toggle);
    vi.useFakeTimers();
    fireEvent.change(screen.getByRole("textbox", { name: "Translation (de)" }), { target: { value: "Herz. Unauffällig bis auf ein Systolikum. Lunge. Unauffällig." } });
    fireEvent.click(toggle);
    const items = sentences("Translation (de)");
    expect(items.map(item => item.className.includes("is-stale"))).toEqual([false, true, false, false]);
    expect(pressed("Translation (de)")).toEqual([false, false, false, false]);
    expect(counter()).toBe("Source: 0 of 3 checked / Translation: 0 of 4 checked · 1 changed");
    // A new sentence before them: the changed mark moves with its sentence and is stored there.
    fireEvent.click(toggle);
    fireEvent.change(screen.getByRole("textbox", { name: "Translation (de)" }), { target: { value: "Neu. Herz. Unauffällig bis auf ein Systolikum. Lunge. Unauffällig." } });
    fireEvent.click(toggle);
    expect(sentences("Translation (de)").map(item => item.className.includes("is-stale"))).toEqual([false, false, true, false, false]);
    await act(async () => { await vi.advanceTimersByTimeAsync(700); });
    expect(saveMarks.mock.calls.at(-1)![1].translation).toEqual([{ index: 2, hash: sentenceHash("Unauffällig.") }]);
  });

  it("is not offered on a touch-only device", async () => {
    setup();
    vi.stubGlobal("matchMedia", vi.fn((query: string) => ({ matches: /min-width|pointer: coarse/.test(query), media: query, addEventListener: vi.fn(), removeEventListener: vi.fn() })));
    cleanup();
    render(<TranslationReviewScreen assignmentId={17} username="alice" onNavigate={vi.fn()} routeLeaveRef={{ current: null }} leaveGuardRef={{ current: null }} />);
    await screen.findByRole("checkbox", { name: "Show changes" });
    expect(screen.queryByRole("checkbox", { name: "Mark checked sentences" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Next unchecked" })).toBeNull();
  });

  it("is not offered on a read-only review", async () => {
    setup({ read_only: true, assignment: { ...reviewWorkspace().assignment, status: "submitted" } });
    await screen.findByRole("region", { name: "Source (en)" });
    expect(screen.queryByRole("checkbox", { name: "Mark checked sentences" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Next unchecked" })).toBeNull();
  });
});

describe("saving checked sentences (issue 284)", () => {
  const translation = splitSentences(TRANSLATION, "de");
  const mark = (index: number) => ({ index, hash: translation[index].hash });

  it("applies only this tab's change and shows the marks of another tab", async () => {
    const { saveMarks } = setup();
    await screen.findByRole("button", { name: "Next unchecked" });
    // Another tab checked the fourth sentence meanwhile: the answer carries it.
    saveMarks.mockImplementationOnce(async (_id, body) => ({ ...body, translation: [...(body.translation ?? []), mark(3)] }));
    vi.useFakeTimers();
    click(sentences("Translation (de)")[0]);
    await act(async () => { await vi.advanceTimersByTimeAsync(700); });
    expect(pressed("Translation (de)")).toEqual([true, false, false, true]);
    click(sentences("Translation (de)")[1]);
    await act(async () => { await vi.advanceTimersByTimeAsync(700); });
    expect(saveMarks).toHaveBeenCalledTimes(2);
    expect(saveMarks.mock.calls[1][2]).toEqual({ source: [], translation: [mark(0), mark(3)] });
    expect(saveMarks.mock.calls[1][1].translation).toEqual([mark(0), mark(1), mark(3)]);
  });

  it("sends waiting marks when the tab closes, in a request that outlives the page", async () => {
    const { saveMarks } = setup();
    await screen.findByRole("button", { name: "Next unchecked" });
    vi.useFakeTimers();
    click(sentences("Translation (de)")[2]);
    window.dispatchEvent(new Event("beforeunload"));
    expect(saveMarks).toHaveBeenCalledTimes(1);
    expect(saveMarks).toHaveBeenLastCalledWith(17, { source: [], translation: [mark(2)] }, { source: [], translation: [] }, { keepalive: true });
    await act(async () => { await vi.advanceTimersByTimeAsync(700); });
    expect(saveMarks).toHaveBeenCalledTimes(1);
  });

  it("Reload from server reads the marks only after the waiting ones are stored", async () => {
    const { saveMarks } = setup();
    await screen.findByRole("button", { name: "Next unchecked" });
    let store!: () => void;
    saveMarks.mockImplementationOnce((_id, body) => new Promise(resolve => { store = () => resolve(body); }));
    click(sentences("Translation (de)")[0]);
    fireEvent.click(screen.getByRole("button", { name: "Reload from server" }));
    await act(async () => { await Promise.resolve(); });
    expect(saveMarks).toHaveBeenCalledTimes(1);
    expect(api.openTranslationReview).toHaveBeenCalledTimes(1);
    await act(async () => { store(); await Promise.resolve(); });
    await vi.waitFor(() => expect(api.openTranslationReview).toHaveBeenCalledTimes(2));
  });

  it("leaving the review sends the waiting marks first", async () => {
    const { saveMarks, routeLeaveRef } = setup();
    await screen.findByRole("button", { name: "Next unchecked" });
    click(sentences("Source (en)")[1]);
    let allowed: boolean | undefined;
    await act(async () => { allowed = await routeLeaveRef.current!(); });
    expect(allowed).toBe(true);
    expect(saveMarks).toHaveBeenCalledTimes(1);
    expect(saveMarks.mock.calls[0][1].source).toEqual([{ index: 1, hash: sentenceHash("Second source!") }]);
  });
});
