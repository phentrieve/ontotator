import { vi } from "vitest";
import * as wordDiff from "../src/translation/textDiff";
import { cleanup, render } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { DiffView } from "../src/translation/DiffView";
import { shownText } from "./support/shownText";
import { paragraphStarts } from "../src/variants/paragraphs";
afterEach(cleanup);

it("renders raw React word parts losslessly without interpreting HTML", () => {
  const before = "<b>old</b> 😀\r\n", after = "<b>new</b> 😀\n ";
  const { container } = render(<DiffView before={before} after={after} />);
  const pieces = Array.from(container.querySelectorAll<HTMLElement>("[data-diff-op]"));
  expect(pieces.filter(n => n.dataset.diffOp !== "insert").map(shownText).join("")).toBe(before);
  expect(pieces.filter(n => n.dataset.diffOp !== "delete").map(n => n.textContent).join("")).toBe(after);
  expect(container.querySelector("b")).toBeNull();
  expect(container.querySelector("ins")).not.toBeNull();
  expect(container.querySelector("del")).not.toBeNull();
});
it("places codepoint paragraph markers in proposed coordinates without counting deletions", () => {
  const after = "😀first\n\nsecond\n\nthird";
  const { container } = render(<DiffView before={"deleted old paragraph\n\n" + after} after={after} />);
  const markers = Array.from(container.querySelectorAll<HTMLElement>("[data-paragraph]"));
  expect(markers.map(n => Number(n.dataset.paragraphOffset))).toEqual(paragraphStarts(after));
  expect(markers.map(n => n.dataset.paragraph)).toEqual(["0", "1", "2"]);
  expect(markers.every(n => n.textContent === "")).toBe(true);
});
it("keeps a real zero marker for an empty proposed text", () => {
  const { container } = render(<DiffView before="Deleted" after="" />);
  expect(container.querySelectorAll("[data-paragraph]")).toHaveLength(1);
  expect(container.querySelector<HTMLElement>("[data-paragraph]")?.dataset.paragraphOffset).toBe("0");
});

it("renders supplied server parts without invoking word diff and keeps proposed paragraph coordinates", () => {
  const diff = vi.spyOn(wordDiff, 'diffText');
  const { container } = render(<DiffView before="old" after={"😀\n\nnext"} parts={[{ op:'delete', text:'old' }, { op:'insert', text:'😀\n\nnext' }]} />);
  expect(diff).not.toHaveBeenCalled();
  expect(shownText(container.querySelector("del")!)).toBe('old');
  expect([...container.querySelectorAll<HTMLElement>('[data-paragraph]')].map(node => Number(node.dataset.paragraphOffset))).toEqual([0,3]);
  diff.mockRestore();
});

it("keeps deleted words out of the text, so the browser's find and copy see the proposed text (issue 533)", () => {
  const { container } = render(<DiffView before="Dosis 5 mg" after="Dosis 10 mg" />);
  const region = container.querySelector<HTMLElement>(".translation-diff")!;
  expect(region.textContent).toBe("Dosis 10 mg");
  expect(shownText(region)).toBe("Dosis 510 mg");
  const deleted = region.querySelector("del")!;
  expect(deleted.textContent).toBe("");
  expect(deleted.querySelector(".generated-text")?.getAttribute("data-text")).toBe("5");
});
it("keeps deleted invisible characters as generated text with their marks (issue 533)", () => {
  const { container } = render(<DiffView before={"a b\tc"} after="a" showInvisibles />);
  const region = container.querySelector<HTMLElement>(".translation-diff")!;
  expect(region.textContent).toBe("a");
  expect(shownText(region.querySelector("del")!)).toBe(" b\tc");
  expect([...region.querySelectorAll<HTMLElement>("del .invisible-char")].map(node => [node.dataset.invisible, node.dataset.text])).toEqual([["space", " "], ["tab", "\t"]]);
});
