import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TextPane } from "../src/editor/TextPane";
import { passageCountText, useChangesSince } from "../src/editor/ChangesSince";
import { changePassages as boundedPassages, DIFF_LIMITS } from "../src/translation/textDiff";

/** The passages of two texts within the diff bound. */
const changePassages = (before: string, after: string) => boundedPassages(before, after)!;
import { SpanEditor } from "../src/vendor/spans.js";

afterEach(cleanup);

// The vital-signs sentence of issue 421 (EN100022 de, v1 -> v2).
const V1 = "Bei Aufnahme: regelmäßiger Puls mit einer apikalen Frequenz von 120 Schlägen/min, Körpertemperatur 38,2 °C. Der Patient war wach.";
const V2 = "Bei Aufnahme: Puls regelmäßig, apikal auskultierte Herzfrequenz 120/min, Temperatur 38,2 °C. Der Patient war wach.";
const base = { mentions: [], selectedEvidenceId: null, selectionIntent: "new_mention" as const,
  onSelection: vi.fn(), onPick: vi.fn(), onChangeIntent: vi.fn() };

describe("changePassages", () => {
  it("reads a reworded sentence as one passage with its older wording", () => {
    const [passage, ...rest] = changePassages(V1, V2);
    expect(rest).toEqual([]);
    expect(V2.slice(passage.start, passage.end)).toBe("Puls regelmäßig, apikal auskultierte Herzfrequenz 120/min, Temperatur");
    expect(V1.slice(passage.beforeStart, passage.beforeEnd)).toBe("regelmäßiger Puls mit einer apikalen Frequenz von 120 Schlägen/min, Körpertemperatur");
    expect(passage.before.map(part => part.text).join("")).toBe(V1.slice(passage.beforeStart, passage.beforeEnd));
    expect(passage.before.filter(part => part.removed).map(part => part.text)).toContain("regelmäßiger ");
    expect(passage.hasRemoved).toBe(true);
  });

  it("keeps changes apart across a line or more than two unchanged words", () => {
    const before = "Fieber seit gestern.\nKein Husten, kein Auswurf, keine Atemnot.";
    const after = "Fieber seit vorgestern.\nKein Husten, kein Auswurf, keine Atemnot heute.";
    const passages = changePassages(before, after);
    expect(passages.map(p => after.slice(p.start, p.end))).toEqual(["vorgestern", " heute"]);
    expect(passages.map(p => p.hasRemoved)).toEqual([true, false]);
  });

  it("gives removed-only text an empty passage at its position", () => {
    const passages = changePassages("Mild fever and cough.", "Mild fever.");
    expect(passages).toHaveLength(1);
    expect(passages[0].start).toBe(passages[0].end);
    expect(passages[0].before).toEqual([{ text: " and cough", removed: true }]);
    expect(changePassages("same", "same")).toEqual([]);
  });
});

describe("changePassages display rules and bound", () => {
  it("leaves out whitespace-only changes and never splits a grapheme", () => {
    expect(changePassages("Fever.\r\nCough and\u00a0cold.", "Fever.\nCough and cold.")).toEqual([]);
    // A changed person inside a ZWJ emoji: the passage covers the whole emoji on both sides.
    const before = "Family \u{1f468}\u200d\u{1f469}\u200d\u{1f467} at home", after = "Family \u{1f468}\u200d\u{1f469}\u200d\u{1f466} at home";
    const [passage, ...rest] = changePassages(before, after);
    expect(rest).toEqual([]);
    expect(after.slice(passage.start, passage.end)).toBe("\u{1f468}\u200d\u{1f469}\u200d\u{1f466}");
    expect(passage.before.map(part => part.text).join("")).toBe("\u{1f468}\u200d\u{1f469}\u200d\u{1f467}");
  });

  it("counts a change of the number of spaces as a passage (issue 483)", () => {
    const [typed, ...rest] = changePassages("Fever and cough.", "Fever  and cough.");
    expect(rest).toEqual([]);
    expect({ start: typed.start, end: typed.end, hasRemoved: typed.hasRemoved }).toEqual({ start: 5, end: 7, hasRemoved: true });
    expect(typed.before).toEqual([{ text: " ", removed: true }]);
    // A space removed at the end of the text: nothing was added, the passage is a removal.
    const [removed] = changePassages("Fever. ", "Fever.");
    expect({ start: removed.start, end: removed.end, hasRemoved: removed.hasRemoved }).toEqual({ start: 6, end: 6, hasRemoved: true });
  });

  it("is null when the texts differ too much", () => {
    const words = (prefix: string) => Array.from({ length: 30 }, (_, index) => `${prefix}${index}`).join(" ");
    expect(boundedPassages(words("a"), words("b"), undefined)).not.toBeNull();
    const original = { ...DIFF_LIMITS };
    try {
      DIFF_LIMITS.maxEditLength = 5;
      expect(boundedPassages(words("a"), words("b"))).toBeNull();
    } finally { Object.assign(DIFF_LIMITS, original); }
  });
});

it("names the count and the step", () => {
  expect(passageCountText(1, -1, 1)).toBe("1 passage changed");
  expect(passageCountText(3, 1, 1)).toBe("3 passages changed · 2 of 3");
  expect(passageCountText(0, -1, 2)).toBe("No text changes since v2");
});

describe("TextPane passages", () => {
  const passages = changePassages(V1, V2);

  it("frames each passage and adds a removed-text marker without changing the text or its offsets", () => {
    const mounted = render(<TextPane {...base} text={V2} passages={passages} passagesSince="v1"
      mentions={[{ evidence_id: "ev", segments: [{ start: V2.indexOf("Herzfrequenz"), end: V2.indexOf("Herzfrequenz") + 12 }], kind: "own" }]} />);
    const text = mounted.container.querySelector<HTMLElement>(".text-container")!;
    expect(text.textContent).toBe(V2);
    const frame = text.querySelector<HTMLElement>(".change-passage")!;
    expect(frame.textContent).toBe("Puls regelmäßig, apikal auskultierte Herzfrequenz 120/min, Temperatur");
    // The finding mark inside the passage keeps its run and offset.
    const marked = text.querySelector<HTMLElement>(".run--marked")!;
    expect(marked.textContent).toBe("Herzfrequenz");
    expect(Number(marked.dataset.start)).toBe(V2.indexOf("Herzfrequenz"));
    const marker = screen.getByRole("button", { name: /^Changed text\. In v1: regelmäßiger Puls/ });
    expect(marker.textContent).toBe("");
    expect(marker.dataset.offset).toBe(String(V2.indexOf("Puls")));
    mounted.rerender(<TextPane {...base} text={V2} passages={null} />);
    expect(text.querySelector(".change-passage, .change-removed")).toBeNull();
    expect(text.textContent).toBe(V2);
  });

  it("shows the older wording in a tooltip on keyboard focus; Esc closes it", () => {
    render(<TextPane {...base} text={V2} passages={passages} passagesSince="v1" />);
    const marker = screen.getByRole("button", { name: /^Changed text/ });
    act(() => marker.focus());
    const tip = screen.getByRole("tooltip");
    expect(tip.textContent).toContain("In v1:");
    expect([...tip.querySelectorAll("del")].map(node => node.textContent)).toContain("regelmäßiger ");
    fireEvent.keyDown(marker, { key: "Escape" });
    expect(screen.queryByRole("tooltip")).toBeNull();
    fireEvent.mouseOver(marker);
    expect(screen.getByRole("tooltip")).toBeTruthy();
  });

  it("keeps the tooltip after a tap or click on the marker until it is dismissed (issue 468)", () => {
    vi.useFakeTimers();
    try {
      render(<><TextPane {...base} text={V2} passages={passages} passagesSince="v1" /><button type="button">Elsewhere</button></>);
      const marker = screen.getByRole("button", { name: /^Changed text/ });
      // A touch tap: the pointer arrives, the click follows, and the pointer "leaves" at once.
      const tap = () => { fireEvent.mouseOver(marker); fireEvent.click(marker); fireEvent.mouseOut(marker); };
      tap();
      act(() => { vi.advanceTimersByTime(2000); });
      expect(screen.getByRole("tooltip").textContent).toContain("In v1:");
      // Inside the tooltip: it stays, also when the pointer leaves it.
      fireEvent.click(screen.getByRole("tooltip"));
      fireEvent.mouseLeave(screen.getByRole("tooltip"));
      expect(screen.getByRole("tooltip")).toBeTruthy();
      // The marker again closes it; a tap elsewhere and Esc do too.
      fireEvent.click(marker);
      expect(screen.queryByRole("tooltip")).toBeNull();
      tap();
      expect(screen.getByRole("tooltip")).toBeTruthy();
      fireEvent.click(screen.getByRole("button", { name: "Elsewhere" }));
      expect(screen.queryByRole("tooltip")).toBeNull();
      tap();
      fireEvent.keyDown(document.body, { key: "Escape" });
      expect(screen.queryByRole("tooltip")).toBeNull();
      // Without a click, hover still closes when the pointer leaves.
      fireEvent.mouseOver(marker);
      fireEvent.mouseOut(marker);
      act(() => { vi.advanceTimersByTime(300); });
      expect(screen.queryByRole("tooltip")).toBeNull();
    } finally { vi.useRealTimers(); }
  });

  it("keeps the marker focused when the marks are redrawn", () => {
    const mounted = render(<TextPane {...base} text={V2} passages={passages} passagesSince="v1" />);
    act(() => screen.getByRole("button", { name: /^Changed text/ }).focus());
    mounted.rerender(<TextPane {...base} text={V2} passages={passages} passagesSince="v1" mentions={[{ evidence_id: "ev", segments: [{ start: 0, end: 3 }] }]} />);
    expect(document.activeElement?.classList.contains("change-removed")).toBe(true);
  });
});

it("a selection that ends on a removed-text marker reads its offset", () => {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const editor = new SpanEditor(container);
  editor.setBlock(V2);
  editor.setPassages(changePassages(V1, V2).map(p => ({ start: p.start, end: p.end, removedLabel: "Changed text" })));
  const marker = container.querySelector<HTMLElement>(".change-removed")!;
  expect(editor._offsetOf(marker, 0)).toBe(V2.indexOf("Puls"));
  expect(container.textContent).toBe(V2);
  container.remove();
});

function Harness({ source }: { source: { version: number; text: string } | null }): JSX.Element {
  const [element, setElement] = useState<HTMLDivElement | null>(null);
  const changes = useChangesSince(source, V2, element);
  return <TextPane {...base} header={changes?.bar} text={V2} onTextElement={setElement}
    changes={changes?.changes} passages={changes?.passages} passagesSince={changes?.since} currentPassage={changes?.current} />;
}

describe("Show changes since vN", () => {
  it("is offered only with an earlier version", () => {
    render(<Harness source={null} />);
    expect(screen.queryByRole("checkbox", { name: /Show changes since/ })).toBeNull();
  });

  it("says so instead of marking when the texts differ too much", () => {
    const original = { ...DIFF_LIMITS };
    try {
      DIFF_LIMITS.maxEditLength = 1;
      const mounted = render(<Harness source={{ version: 1, text: V1 }} />);
      fireEvent.click(screen.getByRole("checkbox", { name: "Show changes since v1" }));
      expect(screen.getByRole("status").textContent).toBe("The texts differ too much to show the changes.");
      const text = mounted.container.querySelector<HTMLElement>(".text-container")!;
      expect(text.querySelector(".change-passage, .change-removed, .run--marker")).toBeNull();
      expect(text.hasAttribute("data-changes")).toBe(false);
      expect(screen.queryByRole("button", { name: "Next ›" })).toBeNull();
      expect(text.textContent).toBe(V2);
    } finally { Object.assign(DIFF_LIMITS, original); }
  });

  it("is off by default; on, it marks added text and steps through the passages", () => {
    const mounted = render(<Harness source={{ version: 1, text: V1 }} />);
    const toggle = screen.getByRole<HTMLInputElement>("checkbox", { name: "Show changes since v1" });
    const text = mounted.container.querySelector<HTMLElement>(".text-container")!;
    expect(toggle.checked).toBe(false);
    expect(text.querySelector(".change-passage, .run--marker")).toBeNull();
    fireEvent.click(toggle);
    expect(screen.getByRole("status").textContent).toBe("1 passage changed");
    expect(text.getAttribute("data-changes")).toBe("insert");
    expect([...text.querySelectorAll(".run--marker")].map(run => run.textContent)).toContain("auskultierte");
    expect(text.textContent).toBe(V2);
    fireEvent.click(screen.getByRole("button", { name: "Next ›" }));
    expect(screen.getByRole("status").textContent).toBe("1 passage changed · 1 of 1");
    expect(text.querySelector(".change-passage")?.hasAttribute("data-current")).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "‹ Previous" }));
    expect(screen.getByRole("status").textContent).toBe("1 passage changed · 1 of 1");
    fireEvent.click(toggle);
    expect(text.querySelector(".change-passage, .run--marker")).toBeNull();
    expect(screen.queryByRole("status")).toBeNull();
  });
});
