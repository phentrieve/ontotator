import { fireEvent, render, screen, within } from "@testing-library/react";
import { expect, it } from "vitest";
import { hintExcerpts, HINTS_SHOWN, TypographyHintsNote, typographyHintsSummary, typographyRuleLabel } from "../src/translation/typographyHints";

it("names the hints of the text to be saved in one line", () => {
  expect(typographyHintsSummary(2, { DOUBLE_SPACE: 2 }, true)).toBe("2 typography hints in your text: double space (2).");
  expect(typographyHintsSummary(1, { DOUBLE_FULL_STOP: 1 }, false)).toBe("1 typography hint in this text: doubled full stop.");
  expect(typographyHintsSummary(3, { DOUBLE_SPACE: 2, TRAILING_WHITESPACE_TEXT: 1 }, true))
    .toBe("3 typography hints in your text: double space (2), space or empty lines at the end of the text.");
  // A rule this page does not know yet is still named.
  expect(typographyRuleLabel("SOME_NEW_RULE")).toBe("some new rule");
});

it("cuts the place of a hint out of the text by code points, never across a line break", () => {
  const text = "\u{1f600} First line\nKein Fieber  und kein Husten.. Danach folgt noch ein langer Satz ohne Ende";
  const [space, stop] = hintExcerpts(text, [{ rule: "DOUBLE_SPACE", start: 24, end: 26 }, { rule: "DOUBLE_FULL_STOP", start: 41, end: 43 }]);
  expect(space).toEqual({ rule: "DOUBLE_SPACE", before: "Kein Fieber", marked: "  ", after: "und kein Husten.. Danach", cutBefore: false, cutAfter: true });
  expect(stop.marked).toBe("..");
  expect(stop.cutBefore).toBe(true);
  // A position outside the text (a stale answer) gives no excerpt.
  expect(hintExcerpts("short", [{ rule: "TAB", start: 9, end: 10 }])).toEqual([]);
});

it("shows one line, and the places behind Show them", () => {
  const text = "Kein Fieber  und Husten.. ";
  render(<TypographyHintsNote text={text} own found={{ total: 3, counts: { DOUBLE_SPACE: 1, TRAILING_WHITESPACE_TEXT: 1, DOUBLE_FULL_STOP: 1 },
    hints: [{ rule: "DOUBLE_SPACE", start: 11, end: 13 }, { rule: "DOUBLE_FULL_STOP", start: 23, end: 25 }, { rule: "TRAILING_WHITESPACE_TEXT", start: 25, end: 26 }] }} />);
  expect(screen.getByText("3 typography hints in your text: double space, space or empty lines at the end of the text, doubled full stop.")).toBeTruthy();
  const show = screen.getByRole("button", { name: "Show them" });
  expect(show.getAttribute("aria-expanded")).toBe("false");
  expect(screen.queryByRole("list", { name: "Typography hints" })).toBeNull();
  fireEvent.click(show);
  expect(screen.getByRole("button", { name: "Hide them" }).getAttribute("aria-expanded")).toBe("true");
  const items = within(screen.getByRole("list", { name: "Typography hints" })).getAllByRole("listitem");
  expect(items.map(item => item.querySelector(".review-confirm-hint-rule")!.textContent)).toEqual(["double space", "doubled full stop", "space or empty lines at the end of the text"]);
  expect(items.map(item => item.querySelector("mark")!.textContent)).toEqual(["  ", "..", " "]);
  // The excerpt holds exactly the characters of the text; the marks of spaces are drawn by CSS.
  expect(items[0].querySelector(".review-confirm-hint-excerpt")!.textContent).toBe(text);
  expect(items[0].querySelectorAll('mark [data-invisible="space"]')).toHaveLength(2);
});

it("renders nothing without hints and counts the hints it does not list", () => {
  const { container, rerender } = render(<TypographyHintsNote text="clean" own found={{ total: 0, counts: {}, hints: [] }} />);
  expect(container.textContent).toBe("");
  const text = "a  b".repeat(30);
  const hints = Array.from({ length: 30 }, (_, index) => ({ rule: "DOUBLE_SPACE" as const, start: index * 4 + 1, end: index * 4 + 3 }));
  rerender(<TypographyHintsNote text={text} own={false} found={{ total: 30, counts: { DOUBLE_SPACE: 30 }, hints }} />);
  fireEvent.click(screen.getByRole("button", { name: "Show them" }));
  expect(screen.getAllByRole("listitem")).toHaveLength(HINTS_SHOWN);
  expect(screen.getByText(`and ${30 - HINTS_SHOWN} more`)).toBeTruthy();
});
