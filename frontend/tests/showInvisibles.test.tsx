import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { api } from "../src/api/client";
import type { RouteLeaveGuard } from "../src/app/router";
import { TranslationReviewScreen } from "../src/translation/TranslationReviewScreen";
import { invisibleNodes } from "../src/translation/invisibles";
import { reviewWorkspace } from "./translationFixtures";

// Written as code points so the test file holds no invisible character.
const NBSP = String.fromCodePoint(0xa0), NARROW = String.fromCodePoint(0x202f), ZWSP = String.fromCodePoint(0x200b);
const BOM = String.fromCodePoint(0xfeff), SHY = String.fromCodePoint(0xad), FACE = String.fromCodePoint(0x1f600);
const SOURCE = `First  line.\t10${NBSP}mg \nSecond${ZWSP} li${SHY}ne ${FACE}.\r\nThird${NARROW}${BOM}.`;
const TRANSLATION = `Erste Zeile.\t10${NBSP}mg\n\nZweite${ZWSP} Zeile.`;
const KEY = "ontotator.translationReview.showInvisibles.v1:alice";
const MARKING = "ontotator.translationReview.markChecked.v1:alice";

afterEach(() => { cleanup(); window.localStorage.clear(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

function setup(username = "alice") {
  const base = reviewWorkspace();
  const workspace = reviewWorkspace({ text: TRANSLATION, draft: { ...base.draft, text: TRANSLATION }, source: { ...base.source, text: SOURCE } });
  vi.spyOn(api, "listSourceObligations").mockResolvedValue([]);
  vi.spyOn(api, "listMyTasks").mockResolvedValue([]);
  vi.stubGlobal("matchMedia", vi.fn((query: string) => ({ matches: /min-width/.test(query), media: query, onchange: null, addListener: vi.fn(), removeListener: vi.fn(), addEventListener: vi.fn(), removeEventListener: vi.fn(), dispatchEvent: () => true })));
  vi.spyOn(api, "openTranslationReview").mockResolvedValue(workspace);
  const saveDraft = vi.spyOn(api, "saveTranslationReviewDraft").mockResolvedValue({ revision: 7 });
  vi.spyOn(api, "saveCheckedSentences").mockImplementation(async (_id, body) => body);
  const routeLeaveRef: { current: RouteLeaveGuard | null } = { current: null };
  const leaveGuardRef: { current: ((proceed: () => void) => void) | null } = { current: null };
  render(<TranslationReviewScreen assignmentId={17} username={username} onNavigate={vi.fn()} routeLeaveRef={routeLeaveRef} leaveGuardRef={leaveGuardRef} />);
  return { saveDraft };
}
const toggle = () => screen.findByRole("checkbox", { name: "Show invisible characters" });
const kinds = (root: Element) => [...root.querySelectorAll<HTMLElement>(".invisible-char")].map(element => element.dataset.invisible);
const count = (root: Element, kind: string) => kinds(root).filter(value => value === kind).length;

describe("invisibleNodes", () => {
  it("wraps every invisible character and keeps the characters of the text", () => {
    const { container } = render(<p>{invisibleNodes(SOURCE, "k")}</p>);
    expect(container.textContent).toBe(SOURCE);
    expect(kinds(container)).toEqual([
      "space", "space", "tab", "nbsp", "space", "line-end",
      "zero-width", "space", "soft-hyphen", "space", "line-end",
      "nbsp", "zero-width",
    ]);
    // A Windows line end is one mark and keeps both of its characters.
    expect([...container.querySelectorAll("[data-invisible='line-end']")].map(element => element.textContent)).toEqual(["\n", "\r\n"]);
    // Each span holds exactly its character: nothing is added to the text.
    for (const element of container.querySelectorAll(".invisible-char")) expect(element.childNodes).toHaveLength(1);
  });
  it("returns the text itself when it has nothing to mark", () => {
    expect(invisibleNodes("Fieber", "k")).toEqual(["Fieber"]);
    expect(invisibleNodes("", "k")).toEqual([]);
  });
});

describe("Show invisible characters", () => {
  it("is a checkbox of the Text view group, off at first, and only changes the rendering", async () => {
    const { saveDraft } = setup();
    const box = await toggle() as HTMLInputElement;
    expect(within(screen.getByRole("group", { name: "Text view" })).getByRole("checkbox", { name: "Show invisible characters" })).toBe(box);
    expect(box.checked).toBe(false);
    const source = screen.getByRole("region", { name: "Source (en)" });
    const editor = screen.getByRole("textbox", { name: "Translation (de)" }) as HTMLTextAreaElement;
    const mirror = document.querySelector(".translation-editor-mirror")!;
    expect(document.querySelectorAll(".invisible-char")).toHaveLength(0);
    const sourceBefore = source.textContent, mirrorBefore = mirror.textContent;
    // Issue 472: the key of the marks is on the screen while they are shown, and only then.
    expect(document.querySelector(".invisibles-key")).toBeNull();

    fireEvent.click(box);
    expect(box.checked).toBe(true);
    expect(within(screen.getByRole("group", { name: "Text view" })).getByText(/^Marks:/).textContent)
      .toBe("Marks: \u00B7 space, \u00B0 non-breaking space, \u2192 tab, \u00B6 line end, \u00AC soft hyphen, | zero-width character");
    expect(window.localStorage.getItem(KEY)).toBe("1");
    // Source: every kind is marked, and the characters are those of the text.
    expect(source.classList.contains("show-invisibles")).toBe(true);
    expect(source.textContent).toBe(sourceBefore);
    expect(source.textContent).toBe(SOURCE);
    for (const kind of ["space", "tab", "nbsp", "zero-width", "soft-hyphen", "line-end"]) expect(count(source, kind), kind).toBeGreaterThan(0);
    // Translation: the marks are in the mirror behind the textarea; the textarea keeps its value.
    expect(editor.value).toBe(TRANSLATION);
    expect(editor.querySelector(".invisible-char")).toBeNull();
    expect(mirror.textContent).toBe(mirrorBefore);
    expect(count(mirror, "tab")).toBe(1);
    expect(count(mirror, "line-end")).toBe(2);
    expect(mirror.closest(".translation-editor")!.classList.contains("show-invisibles")).toBe(true);
    // Paragraph markers of coupled scrolling stay where they were.
    expect(mirror.querySelectorAll("[data-paragraph]")).toHaveLength(2);
    // Nothing was edited, so nothing is saved.
    expect(saveDraft).not.toHaveBeenCalled();

    // Typing with the marks on saves exactly the typed text.
    const next = `${TRANSLATION} Neu`;
    fireEvent.change(editor, { target: { value: next } });
    expect(editor.value).toBe(next);
    expect(mirror.textContent!.replace(ZWSP, "")).toContain("Neu");

    fireEvent.click(box);
    expect(window.localStorage.getItem(KEY)).toBe("0");
    expect(document.querySelectorAll(".invisible-char")).toHaveLength(0);
    expect(source.classList.contains("show-invisibles")).toBe(false);
  });

  it("is remembered per user", async () => {
    window.localStorage.setItem(KEY, "1");
    setup();
    expect((await toggle() as HTMLInputElement).checked).toBe(true);
    expect(count(screen.getByRole("region", { name: "Source (en)" }), "tab")).toBe(1);
    cleanup();
    setup("bob");
    expect((await toggle() as HTMLInputElement).checked).toBe(false);
    expect(document.querySelectorAll(".invisible-char")).toHaveLength(0);
  });

  it("marks the change view and the text beside the sentence markers too", async () => {
    window.localStorage.setItem(KEY, "1");
    setup();
    await toggle();
    fireEvent.click(screen.getByRole("checkbox", { name: "Show changes" }));
    const changes = screen.getByRole("region", { name: "Text changes" });
    expect(changes.textContent).toBe(TRANSLATION);
    expect(count(changes, "tab")).toBe(1);
    fireEvent.click(screen.getByRole("checkbox", { name: "Show changes" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Mark checked sentences" }));
    expect(window.localStorage.getItem(MARKING)).toBe("1");
    // Marking keeps the editor: its mirror carries the marks, the markers stand beside it.
    const mirror = document.querySelector<HTMLElement>(".translation-editor-mirror")!;
    expect(count(mirror, "tab")).toBe(1);
    expect(count(mirror, "line-end")).toBe(2);
    expect(screen.getByRole("group", { name: "Checked sentences: Translation" }).querySelector(".invisible-char")).toBeNull();
    expect((screen.getByRole("textbox", { name: "Translation (de)" }) as HTMLTextAreaElement).value).toBe(TRANSLATION);
  });
});
