import { fireEvent, render, screen, within } from "@testing-library/react";
import { expect, it } from "vitest";
import { ChecksSummary } from "../src/translation/ReviewParts";

it("collapses one failed check into a one-line band with a Details disclosure", () => {
  render(<ChecksSummary failed={[{ code: "units_added", passed: false, detail: "mg added" }]} all={[
    { code: "units_added", passed: false, detail: "mg added" }, { code: "numbers_changed", passed: true }]} />);
  const band = screen.getByRole("region", { name: "Automatic translation checks" });
  expect(within(band).getByRole("heading", { level: 2, name: "Automatic translation checks" }).className).toContain("review-sr-only");
  expect(band.textContent).toContain("1 automatic check failed: Units added in translation");
  const details = within(band).getByRole("button", { name: "Details" });
  expect(details.getAttribute("aria-expanded")).toBe("false");
  expect(screen.queryByRole("heading", { level: 3 })).toBeNull();
  fireEvent.click(details);
  expect(details.getAttribute("aria-expanded")).toBe("true");
  expect(within(band).getByRole("button", { name: "Hide details" })).toBe(details);
  const region = document.getElementById(details.getAttribute("aria-controls")!)!;
  const block = within(region).getByRole("heading", { level: 3, name: "Units added in translation" }).closest("section")!;
  const text = block.textContent!;
  expect(text).toContain("It does not point to a text location; compare the texts yourself.");
  expect(within(block).getByText("“mg added”")).toBeTruthy();
  expect(text).toContain("Choose Accepted unchanged (or Accepted with corrections if you edited it). You can say in the rationale why the difference is correct. If it changes the clinical meaning, choose Query or Rejected with the category Number or unit.");
  const technical = within(block).getByText("Technical details").closest("details")!;
  expect(technical.open).toBe(false);
  expect(technical.textContent).toContain("units_added");
  expect(region.textContent).toContain("All checks: 1 passed, 1 failed");
  expect(within(region).getByText("Show all checks")).toBeTruthy();
});
it("lists two short labels and the rest as a count for several failures", () => {
  render(<ChecksSummary failed={[{ code: "units_added", passed: false }, { code: "numbers_changed", passed: false }, { code: "glossary_miss", passed: false }]} all={null} />);
  expect(screen.getByRole("region", { name: "Automatic translation checks" }).textContent)
    .toContain("3 automatic checks failed: Units added, Numbers changed and 1 more");
});
it("ends the guidance after Query or Rejected for codes other than units and numbers", () => {
  render(<ChecksSummary failed={[{ code: "glossary_miss", passed: false }]} all={null} />);
  fireEvent.click(screen.getByRole("button", { name: "Details" }));
  expect(screen.getByText(/choose Query or Rejected\.$/)).toBeTruthy();
  expect(screen.getByText(/Ontotator has no description for it; ask the project lead what it checks\./)).toBeTruthy();
});
it("shows the calm states without a fill", () => {
  const { rerender } = render(<ChecksSummary failed={[]} all={[{ code: "a", passed: true }, { code: "b", passed: true }]} />);
  expect(screen.getByText("All 2 automatic checks passed.")).toBeTruthy();
  rerender(<ChecksSummary failed={[]} all={[]} />);
  expect(screen.getByText("No automatic checks were recorded for this translation.")).toBeTruthy();
  expect(screen.queryByRole("button", { name: "Details" })).toBeNull();
});
it("is collapsed again on every mount", () => {
  const first = render(<ChecksSummary failed={[{ code: "units_added", passed: false }]} all={null} />);
  fireEvent.click(screen.getByRole("button", { name: "Details" })); first.unmount();
  render(<ChecksSummary failed={[{ code: "units_added", passed: false }]} all={null} />);
  expect(screen.getByRole("button", { name: "Details" }).getAttribute("aria-expanded")).toBe("false");
});
it("keeps the order heading, explanation, detail, guidance, technical details and unique ids", () => {
  render(<>
    <ChecksSummary failed={[{ code: "units_added", passed: false, detail: "mg added" }, { code: "numbers_changed", passed: false }]} all={null} />
    <ChecksSummary failed={[{ code: "units_added", passed: false }]} all={null} />
  </>);
  screen.getAllByRole("button", { name: "Details" }).forEach(button => fireEvent.click(button));
  const headings = screen.getAllByRole("heading", { level: 3 });
  expect(headings).toHaveLength(3);
  expect(new Set(headings.map((heading) => heading.id)).size).toBe(3);
  const block = headings[0].closest("section")!;
  expect(block.getAttribute("aria-labelledby")).toBe(headings[0].id);
  const text = block.textContent!;
  const order = ["Units added in translation", "unit of measurement", "It does not point", "From the translation run", "If the translation is right anyway", "Technical details"].map((part) => text.indexOf(part));
  expect(order.every((position, index) => position >= 0 && (index === 0 || position > order[index - 1]))).toBe(true);
  expect(within(headings[1].closest("section")!).queryByText("From the translation run")).toBeNull();
});
it("lists every check with its code on its own labelled line under Show all checks", () => {
  const { container } = render(<ChecksSummary failed={[]} all={[{ code: "numbers_changed", passed: true }]} />);
  fireEvent.click(screen.getByRole("button", { name: "Details" }));
  const item = container.querySelector(".translation-checks-all li")!;
  expect(item.textContent).toContain("Numbers changed in translation");
  expect(item.querySelector("dt")?.textContent).toBe("Technical code");
});
it("offers Details whenever the band reports a failure, with a failed count that never undercounts", () => {
  const { rerender } = render(<ChecksSummary failed={[{ code: "units_added", passed: false }]} all={[]} />);
  fireEvent.click(screen.getByRole("button", { name: "Details" }));
  expect(screen.getByRole("heading", { level: 3, name: "Units added in translation" })).toBeTruthy();
  expect(screen.getByText("All checks: 0 passed, 1 failed")).toBeTruthy();
  expect(screen.queryByText("Show all checks")).toBeNull();
  rerender(<ChecksSummary failed={[{ code: "units_added", passed: false }]} all={[{ code: "numbers_changed", passed: true }]} />);
  expect(screen.getByText("All checks: 1 passed, 1 failed")).toBeTruthy();
});
it("names the checks of a later version as checks of the first version and asks for nothing", () => {
  render(<ChecksSummary failed={[]} earlier={{ checked: 1, version: 2 }} all={[
    { code: "units_added", passed: false, detail: "mg added" }, { code: "numbers_changed", passed: true }]} />);
  const band = screen.getByRole("region", { name: "Automatic translation checks" });
  expect(band.textContent).toContain("The automatic checks ran on v1, not on this version (v2). 1 automatic check failed on v1: Units added in translation.");
  expect(band.className).not.toContain("translation-checks--failed");
  fireEvent.click(within(band).getByRole("button", { name: "Details" }));
  expect(band.textContent).toContain("Checks of v1: 1 passed, 1 failed");
  // No failure block with the "say why in the rationale" guidance: the check is not one of this version.
  expect(screen.queryByRole("heading", { level: 3 })).toBeNull();
});
it("says only where the checks ran when the first version passed them all", () => {
  render(<ChecksSummary failed={[]} earlier={{ checked: 1, version: 3 }} all={[{ code: "units_added", passed: true }]} />);
  expect(screen.getByRole("region", { name: "Automatic translation checks" }).textContent).toContain("The automatic checks ran on v1, not on this version (v3).Details");
});

const added = { source_count: 1, translation_count: 3, truncated: false, passages: [{ start: 10, end: 19, text: "(Ikterus)" }, { start: 30, end: 38, text: "(Pyrexie)" }] };
it("shows more passages in brackets than in the source in the band, with the passages under Details (issue 484)", () => {
  render(<ChecksSummary failed={[]} all={[{ code: "numbers_changed", passed: true }]} brackets={added} />);
  const band = screen.getByRole("region", { name: "Automatic translation checks" });
  expect(band.className).toContain("translation-checks--failed");
  // The run's checks keep their line; the check of Ontotator has its own.
  expect(band.querySelector(".translation-checks-line")!.textContent).toBe("1 automatic check passed.");
  expect(band.querySelector(".translation-checks-brackets")!.textContent).toBe("More passages in brackets than in the source: 3 in the translation, 1 in the source");
  expect(screen.queryByRole("heading", { level: 3 })).toBeNull();
  fireEvent.click(within(band).getByRole("button", { name: "Details" }));
  const block = within(band).getByRole("heading", { level: 3, name: "Passages in brackets added in translation" }).closest("section")!;
  expect(within(block).getAllByRole("listitem").map(item => item.textContent)).toEqual(["“(Ikterus)”", "“(Pyrexie)”"]);
  expect(block.textContent).toContain("Remove it and choose Accepted with corrections. If you are not sure, choose Query with the category Addition.");
  expect(block.textContent).toContain("This check asks for no rationale.");
  // It is not counted with the checks of the translation run.
  expect(band.textContent).toContain("All checks: 1 passed, 0 failed");
});
it("shows the passages also without any check of the run, and says when the list is cut", () => {
  render(<ChecksSummary failed={[]} all={[]} brackets={{ ...added, truncated: true }} />);
  const band = screen.getByRole("region", { name: "Automatic translation checks" });
  expect(band.textContent).toContain("No automatic checks were recorded for this translation.");
  fireEvent.click(within(band).getByRole("button", { name: "Details" }));
  expect(band.textContent).toContain("There are more; only the first ones are listed.");
  expect(band.textContent).not.toContain("All checks:");
});
it("says nothing about brackets when the translation has no more passages than the source", () => {
  render(<ChecksSummary failed={[]} all={[]} brackets={{ source_count: 2, translation_count: 2, truncated: false, passages: [] }} />);
  const band = screen.getByRole("region", { name: "Automatic translation checks" });
  expect(band.className).not.toContain("translation-checks--failed");
  expect(band.querySelector(".translation-checks-brackets")).toBeNull();
  expect(within(band).queryByRole("button", { name: "Details" })).toBeNull();
});
