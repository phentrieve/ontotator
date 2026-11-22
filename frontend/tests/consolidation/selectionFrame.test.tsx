/**
 * The frame of the selected group in the consolidation text (issue 548, U4-06): one frame around the group's adjacent
 * pieces, even where other findings overlap it and split it into pieces; never a box of its own around a space.
 */
import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TextPane } from "../../src/consolidation/TextPane";
import { group, LUC, member, TOM } from "./fixtures";

const TEXT = "Im Verlauf: Krampfanfälle werden als positiver Befund vermerkt. Muskuläre Hypotonie ist nicht beschrieben.";
const at = (words: string): [number, number] => {
  const start = TEXT.indexOf(words);
  if (start < 0) throw new Error(`"${words}" not in the text`);
  return [start, start + words.length];
};

// "Krampfanfälle" (Luc) and "Krampfanfälle werden" (Tom) overlap; "werden als positiver Befund" (Luc) starts inside the
// second, so "Krampfanfälle werden" falls into three pieces: "Krampfanfälle", " " and "werden".
const GROUPS = [
  group("g-seizure", ["partial"], [member("s", LUC, "HP:0001250", "Seizure", [at("Krampfanfälle")])]),
  group("g-dialeptic", ["partial"], [member("d", TOM, "HP:0011146", "Dialeptic seizure", [at("Krampfanfälle werden")])]),
  group("g-werden", ["partial"], [member("w", LUC, "HP:0000001", "Positive finding", [at("werden als positiver Befund")])]),
  group("g-hypotonia", ["span_differs"], [
    member("h-l", LUC, "HP:0001252", "Hypotonia", [at("Hypotonie")]),
    member("h-t", TOM, "HP:0001252", "Hypotonia", [at("Hypotonie ist")]),
  ]),
];

function renderPane(selectedGroupId: string | null, onSelectGroup = vi.fn()) {
  render(<TextPane text={TEXT} groups={GROUPS} people={[LUC, TOM]} selectedGroupId={selectedGroupId} onSelectGroup={onSelectGroup} />);
  const body = document.querySelector<HTMLElement>(".cons-text-body")!;
  return { body, frames: [...body.querySelectorAll<HTMLElement>(".cons-selected")], onSelectGroup };
}

describe("the selection frame of the consolidation text", () => {
  afterEach(cleanup);

  it("is one frame around overlapping findings, the space between them inside it", () => {
    const { frames } = renderPane("g-dialeptic");
    expect(frames).toHaveLength(1);
    expect(frames[0].textContent).toBe("Krampfanfälle werden");
    // The pieces keep their own lanes and offsets inside the frame; none of them is framed alone.
    const pieces = [...frames[0].querySelectorAll<HTMLElement>(".cons-mark")];
    expect(pieces.map(piece => piece.textContent)).toEqual(["Krampfanfälle", " ", "werden"]);
    expect(pieces.map(piece => Number(piece.dataset.start))).toEqual([at("Krampfanfälle")[0], at(" werden")[0], at("werden")[0]]);
    expect(pieces.every(piece => !piece.classList.contains("cons-selected"))).toBe(true);
  });

  it("frames a finding that another one overlaps at its end as one piece row", () => {
    const { frames } = renderPane("g-hypotonia");
    expect(frames.map(frame => frame.textContent)).toEqual(["Hypotonie ist"]);
  });

  it("leaves the text and its offsets as they are, with or without a selection", () => {
    const none = renderPane(null);
    expect(none.frames).toHaveLength(0);
    expect(none.body.textContent).toBe(TEXT);
    cleanup();
    const selected = renderPane("g-werden");
    expect(selected.body.textContent).toBe(TEXT);
    expect(selected.frames.map(frame => frame.textContent)).toEqual(["werden als positiver Befund"]);
  });

  it("a click on a piece inside the frame keeps the selected group", () => {
    const { frames, onSelectGroup } = renderPane("g-dialeptic");
    fireEvent.click(frames[0].querySelector(".cons-mark")!);
    expect(onSelectGroup).toHaveBeenCalledWith("g-dialeptic");
  });
});
