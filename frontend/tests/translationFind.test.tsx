import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { api } from "../src/api/client";
import type { RouteLeaveGuard } from "../src/app/router";
import { DiffView } from "../src/translation/DiffView";
import { findMatches } from "../src/translation/FindBar";
import { setHighlight } from "../src/translation/highlights";
import { indexText, rangeAt } from "../src/translation/textRanges";
import { TranslationReviewScreen } from "../src/translation/TranslationReviewScreen";
import { reviewWorkspace } from "./translationFixtures";

const SOURCE = "The dose is 5 mg. Give 5 mg at night.";
const TRANSLATION = "Die Dosis ist 5 mg. Abends 5 mg geben.";

afterEach(() => { cleanup(); window.localStorage.clear(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

function setup() {
  const base = reviewWorkspace();
  const workspace = reviewWorkspace({ text: TRANSLATION, draft: { ...base.draft, text: TRANSLATION }, source: { ...base.source, text: SOURCE } });
  vi.spyOn(api, "listSourceObligations").mockResolvedValue([]);
  vi.spyOn(api, "listMyTasks").mockResolvedValue([]);
  vi.stubGlobal("matchMedia", vi.fn((query: string) => ({ matches: /min-width/.test(query), media: query, onchange: null, addListener: vi.fn(), removeListener: vi.fn(), addEventListener: vi.fn(), removeEventListener: vi.fn(), dispatchEvent: () => true })));
  vi.spyOn(api, "openTranslationReview").mockResolvedValue(workspace);
  vi.spyOn(api, "saveTranslationReviewDraft").mockResolvedValue({ revision: 7 });
  const routeLeaveRef: { current: RouteLeaveGuard | null } = { current: null };
  const leaveGuardRef: { current: ((proceed: () => void) => void) | null } = { current: null };
  render(<TranslationReviewScreen assignmentId={17} username="alice" onNavigate={vi.fn()} routeLeaveRef={routeLeaveRef} leaveGuardRef={leaveGuardRef} />);
}
const frame = () => act(async () => { await new Promise(resolve => window.requestAnimationFrame(() => resolve(null))); });

describe("text ranges", () => {
  it("map text offsets to the pane's nodes and skip deleted words", () => {
    const { container } = render(<DiffView before="Dosis 5 mg" after="Dosis 10 mg" />);
    const index = indexText(container.firstElementChild!);
    expect(index.length).toBe("Dosis 10 mg".length);
    expect(rangeAt(index, 6, 11)!.toString()).toBe("10 mg");
    expect(rangeAt(index, 0, 99)).toBeNull();
  });

  it("find matches ignore case and give UTF-16 offsets", () => {
    expect(findMatches("Ärztin, ÄRZTIN 😀 ärztin", "ärztin")).toEqual([{ start: 0, end: 6 }, { start: 8, end: 14 }, { start: 18, end: 24 }]);
    expect(findMatches("a.b axb", ".")).toEqual([{ start: 1, end: 2 }]);
    expect(findMatches("text", "")).toEqual([]);
  });

  it("highlights do nothing where the browser has no highlight registry", () => {
    expect(() => setHighlight("review-find", "test", [document.createRange()])).not.toThrow();
  });
});

describe("Find in the texts", () => {
  it("is not there without Check by segment pairs: Ctrl+F stays the browser's own find, as before", async () => {
    setup();
    const textbox = await screen.findByRole("textbox", { name: "Translation (de)" });
    const press = new KeyboardEvent("keydown", { key: "f", ctrlKey: true, bubbles: true, cancelable: true });
    textbox.dispatchEvent(press);
    await frame();
    expect(press.defaultPrevented).toBe(false);
    expect(screen.queryByRole("search", { name: "Find in the texts" })).toBeNull();
    // The editor's layout mirror is as before: aria-hidden, not inert.
    const mirror = textbox.closest(".translation-editor")!.querySelector(".translation-editor-mirror")!;
    expect(mirror.getAttribute("aria-hidden")).toBe("true");
    expect(mirror.hasAttribute("inert")).toBe(false);
  });

  it("with segment pairs, Ctrl+F opens the bar, counts the hits of both columns, steps with Enter and closes with Escape", async () => {
    window.localStorage.setItem("ontotator.translationReview.segmentPairs.v1:alice", "1");
    vi.spyOn(api, "saveSegmentPairs").mockImplementation(async (_id, view) => view);
    setup();
    const check = await screen.findByRole("button", { name: "Pair 1: Not checked" });
    check.focus();
    fireEvent.keyDown(check, { key: "f", ctrlKey: true });
    await frame();
    const input = screen.getByRole("searchbox", { name: "Find in the texts" });
    expect(document.activeElement).toBe(input);
    fireEvent.change(input, { target: { value: "5 MG" } });
    const status = () => document.querySelector(".find-bar-status")!.textContent;
    expect(status()).toBe("1 of 4Source 2 · Translation 2");
    fireEvent.keyDown(input, { key: "Enter" });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(status()).toMatch(/^3 of 4/);
    fireEvent.keyDown(input, { key: "Escape" });
    expect(screen.queryByRole("search", { name: "Find in the texts" })).toBeNull();
    expect(document.activeElement).toBe(check);
  });

  it("with segment pairs, a second Ctrl+F is left to the browser", async () => {
    window.localStorage.setItem("ontotator.translationReview.segmentPairs.v1:alice", "1");
    vi.spyOn(api, "saveSegmentPairs").mockImplementation(async (_id, view) => view);
    setup();
    const check = await screen.findByRole("button", { name: "Pair 1: Not checked" });
    fireEvent.keyDown(check, { key: "f", metaKey: true });
    await frame();
    const input = screen.getByRole("searchbox", { name: "Find in the texts" }) as HTMLInputElement;
    const again = new KeyboardEvent("keydown", { key: "f", ctrlKey: true, bubbles: true, cancelable: true });
    input.dispatchEvent(again);
    expect(again.defaultPrevented).toBe(false);
    fireEvent.change(input, { target: { value: "nothing like this" } });
    expect(document.querySelector(".find-bar-status")!.textContent).toBe("No results");
  });
});
