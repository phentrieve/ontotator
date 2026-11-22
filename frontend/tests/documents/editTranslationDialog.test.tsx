/** Issue 555: "Edit the translation…" is one action; the lead chooses the consequence first (no hint under the buttons). */
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { EditTranslationDialog, editChoices } from "../../src/documents/VersionDialogs";
import { planRow, stepOf, version } from "./fixtures";

const v1 = version({ document_id: "case-0101-de", chain_name: "DeepL", origin: "machine_translation", translation_status: "accepted" });
const row = planRow("case-0101", "de", stepOf("done"), { versions: [v1] });

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

it("names each way by its consequence", () => {
  expect(editChoices(1)).toEqual([
    { kind: "typos", label: "Only spelling, spacing or grammar", consequence: "The meaning stays. No review; submitted annotations move to v2." },
    { kind: "meaning", label: "The meaning changes", consequence: "v2 is reviewed again. Annotations stay on v1; you handle the text change after." },
  ]);
});

it("asks what changes before anything opens; Continue without a choice says so in place", () => {
  const onChoose = vi.fn(), onClose = vi.fn();
  render(<EditTranslationDialog row={row} version={v1} onChoose={onChoose} onClose={onClose} />);
  const dialog = screen.getByRole("dialog", { name: "Edit the translation, case-0101 de v1" });
  const group = within(dialog).getByRole("group", { name: "What changes?" });
  const radios = within(group).getAllByRole("radio");
  expect(radios.map(radio => (radio as HTMLInputElement).checked)).toEqual([false, false]);
  // The consequence is the radio's accessible description, read with the choice.
  expect(within(group).getByRole("radio", { name: "The meaning changes" }).getAttribute("aria-describedby")).toBeTruthy();
  fireEvent.click(within(dialog).getByRole("button", { name: "Continue" }));
  expect(onChoose).not.toHaveBeenCalled();
  expect(within(dialog).getByText("Choose what changes.")).toBeTruthy();
  fireEvent.click(within(group).getByRole("radio", { name: "Only spelling, spacing or grammar" }));
  fireEvent.click(within(dialog).getByRole("button", { name: "Continue" }));
  expect(onChoose).toHaveBeenCalledWith("typos");
  fireEvent.click(within(group).getByRole("radio", { name: "The meaning changes" }));
  fireEvent.click(within(dialog).getByRole("button", { name: "Continue" }));
  expect(onChoose).toHaveBeenLastCalledWith("meaning");
  fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
  expect(onClose).toHaveBeenCalled();
});
