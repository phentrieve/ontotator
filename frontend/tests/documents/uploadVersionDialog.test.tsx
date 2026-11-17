/** Issue 341 a: "Upload a corrected text…" (paste or one .txt file, how the text was made, changes before saving). */
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { api, ApiError, type VersionUploadPreview, type VersionUploadResult } from "../../src/api/client";
import { changedPassages, readTextFile, UploadVersionDialog, uploadRefusal } from "../../src/documents/UploadVersionDialog";
import { diffText } from "../../src/translation/textDiff";
import { planRow, stepOf, version } from "./fixtures";

const v2 = version({ document_id: "case-0101-de-v2", version: 2, chain_name: "DeepL", origin: "correction", derived_from: "case-0101-de", translation_status: "accepted" });
const row = planRow("case-0101", "de", stepOf("assign_annotation"), {
  versions: [version({ document_id: "case-0101-de", version: 1, chain_name: "DeepL", origin: "machine_translation", translation_status: "accepted", is_newest_in_chain: false }), v2],
});
const OLD = "Bei Aufnahme: Puls regelmäßig, Temperatur 38,2 °C.";
const NEW = "Bei Aufnahme: regelmäßiger Puls, Körpertemperatur 38,2 °C.";

function preview(overrides: Partial<VersionUploadPreview> = {}): VersionUploadPreview {
  return {
    document_id: "case-0101-de-v2", case_id: "case-0101", language: "de", version: 2, next_version: 3, translation_status: "accepted", text_sha256: "sha-v2",
    available: true, reason: null, review_on: true, annotate_accepted_only: false, annotations: { submitted: 0, open: 0 }, open_consolidations: 0, final_result: false,
    text: null, previous_text: null, unchanged: null, ...overrides,
  };
}

beforeEach(() => {
  vi.spyOn(api, "previewVersionUpload").mockImplementation(async (_key, _id, text) => (text === undefined ? preview() : preview({ text, previous_text: OLD, unchanged: false })));
  vi.spyOn(api, "uploadVersion").mockResolvedValue({ document_id: "case-0101-de~de~v3", version: 3 } as VersionUploadResult);
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

async function renderDialog() {
  const props = { row, version: v2, projectKey: "p", onUploaded: vi.fn(), onClose: vi.fn() };
  render(<UploadVersionDialog {...props} />);
  const dialog = screen.getByRole("dialog", { name: "Upload a corrected text, case-0101 de v2" });
  await waitFor(() => expect(api.previewVersionUpload).toHaveBeenCalledWith("p", "case-0101-de-v2"));
  return { props, dialog };
}

it("pastes a text, names how it was made, shows the changes and saves it as a correction", async () => {
  const { props, dialog } = await renderDialog();
  expect(within(dialog).getByText("The text becomes v3, a correction of v2.")).toBeTruthy();
  expect(await within(dialog).findByText("v3 starts as a correction with review On.")).toBeTruthy();
  // Nothing on v2: no consequence block (as the lead correction).
  expect(within(dialog).queryByText(/has work/)).toBeNull();
  const check = within(dialog).getByRole("button", { name: "Check changes" });
  fireEvent.click(check);
  expect(within(dialog).getByText("Paste the text.")).toBeTruthy();
  expect(within(dialog).getByText("Choose how the text was made.")).toBeTruthy();
  fireEvent.change(within(dialog).getByRole("textbox", { name: /New text/ }), { target: { value: NEW } });
  fireEvent.click(within(dialog).getByRole("radio", { name: "Machine translation" }));
  fireEvent.click(check);
  // The provider is required for a machine translation only.
  expect(within(dialog).getByText("Enter the provider, for example DeepL.")).toBeTruthy();
  expect(api.previewVersionUpload).toHaveBeenCalledTimes(1);
  fireEvent.change(within(dialog).getByRole("textbox", { name: /Provider/ }), { target: { value: " DeepL " } });
  fireEvent.change(within(dialog).getByRole("textbox", { name: "Model or tool" }), { target: { value: "deepl-2026-10" } });
  fireEvent.change(within(dialog).getByLabelText("Made on"), { target: { value: "2026-11-12" } });
  fireEvent.change(within(dialog).getByRole("textbox", { name: "Made by" }), { target: { value: "Dr. Roe" } });
  fireEvent.change(within(dialog).getByRole("textbox", { name: "Note" }), { target: { value: "Checked against the source" } });
  fireEvent.click(check);
  await waitFor(() => expect(api.previewVersionUpload).toHaveBeenLastCalledWith("p", "case-0101-de-v2", NEW));
  expect(await within(dialog).findByText("Changes to v2")).toBeTruthy();
  expect(within(dialog).getByText(/2 passages changed/)).toBeTruthy();
  const changes = within(dialog).getByRole("region", { name: "Text changes" });
  expect(changes.querySelector("ins")?.textContent).toContain("regelmäßiger");
  expect(changes.querySelector("del")).toBeTruthy();
  expect(api.uploadVersion).not.toHaveBeenCalled();
  // Back keeps what was entered.
  fireEvent.click(within(dialog).getByRole("button", { name: "Back" }));
  expect((within(dialog).getByRole("textbox", { name: /New text/ }) as HTMLTextAreaElement).value).toBe(NEW);
  fireEvent.click(within(dialog).getByRole("button", { name: "Check changes" }));
  fireEvent.click(await within(dialog).findByRole("button", { name: "Save as v3" }));
  await waitFor(() => expect(api.uploadVersion).toHaveBeenCalledWith("p", "case-0101-de-v2", {
    text: NEW, expected_text_sha256: "sha-v2", method: "machine_translation", provider: "DeepL", model: "deepl-2026-10", made_on: "2026-11-12", made_by: "Dr. Roe", note: "Checked against the source",
  }));
  await waitFor(() => expect(props.onUploaded).toHaveBeenCalledWith("case-0101 de v3 saved as a correction of v2. It is ready for review."));
});

it("a correction by hand needs no provider and sends none", async () => {
  const { dialog } = await renderDialog();
  fireEvent.change(within(dialog).getByRole("textbox", { name: /New text/ }), { target: { value: NEW } });
  fireEvent.click(within(dialog).getByRole("radio", { name: "Correction of v2 by hand" }));
  expect(within(dialog).queryByRole("textbox", { name: /Provider/ })).toBeNull();
  fireEvent.click(within(dialog).getByRole("button", { name: "Check changes" }));
  fireEvent.click(await within(dialog).findByRole("button", { name: "Save as v3" }));
  await waitFor(() => expect(api.uploadVersion).toHaveBeenCalledWith("p", "case-0101-de-v2", { text: NEW, expected_text_sha256: "sha-v2", method: "manual_correction" }));
});

it("reads one UTF-8 .txt file into the text and refuses other files", async () => {
  const { dialog } = await renderDialog();
  fireEvent.click(within(dialog).getByRole("radio", { name: "Choose file" }));
  expect(within(dialog).getByText("One UTF-8 text file (.txt). The file name does not matter here.")).toBeTruthy();
  const input = () => within(dialog).getByLabelText(/Text file/) as HTMLInputElement;
  fireEvent.change(input(), { target: { files: [new File([new Uint8Array([0xff, 0xfe, 0x41])], "latin.txt")] } });
  expect(await within(dialog).findByText("This file is not UTF-8 text. Save it as UTF-8 and choose it again.")).toBeTruthy();
  fireEvent.change(input(), { target: { files: [new File(["x"], "bundle.json")] } });
  expect(await within(dialog).findByText("Choose a text file (.txt).")).toBeTruthy();
  fireEvent.change(input(), { target: { files: [new File([NEW], "EN100022_de_deepl.txt")] } });
  expect(await within(dialog).findByText(/^EN100022_de_deepl\.txt · \d+ B$/)).toBeTruthy();
  fireEvent.click(within(dialog).getByRole("radio", { name: "Human translation" }));
  fireEvent.click(within(dialog).getByRole("button", { name: "Check changes" }));
  await waitFor(() => expect(api.previewVersionUpload).toHaveBeenLastCalledWith("p", "case-0101-de-v2", NEW));
  expect(await within(dialog).findByRole("button", { name: "Save as v3" })).toBeTruthy();
});

it("lists the work that stays on the version before and after the check, only when there is work", async () => {
  const work = { annotations: { submitted: 2, open: 1 }, final_result: true };
  vi.mocked(api.previewVersionUpload).mockImplementation(async (_key, _id, text) => preview(text === undefined ? work : { ...work, text, previous_text: OLD, unchanged: false }));
  const { dialog } = await renderDialog();
  expect(await within(dialog).findByText("Annotation has work on v2.")).toBeTruthy();
  expect(within(dialog).getByText(/3 annotations \(2 submitted, 1 open\) stay on v2\. After saving, the row offers Handle text change…\./)).toBeTruthy();
  expect(within(dialog).getByText(/The final result stays on v2\./)).toBeTruthy();
  fireEvent.change(within(dialog).getByRole("textbox", { name: /New text/ }), { target: { value: NEW } });
  fireEvent.click(within(dialog).getByRole("radio", { name: "Human translation" }));
  fireEvent.click(within(dialog).getByRole("button", { name: "Check changes" }));
  await within(dialog).findByRole("button", { name: "Save as v3" });
  expect(within(dialog).getByText("Annotation has work on v2.")).toBeTruthy();
});

it("an open translation review refuses the upload with only Close", async () => {
  vi.mocked(api.previewVersionUpload).mockResolvedValue(preview({ available: false, reason: "review_open" }));
  const { props, dialog } = await renderDialog();
  expect(await within(dialog).findByText("A translation review of this version is open. Withdraw it with Remove… in the reviewer’s row of the Translation part before you upload a new version.")).toBeTruthy();
  expect(within(dialog).queryByRole("button", { name: "Check changes" })).toBeNull();
  expect(within(dialog).queryByRole("textbox")).toBeNull();
  // The footer's Close (the dialog's own close button has the same name).
  fireEvent.click(within(dialog).getAllByRole("button", { name: "Close" }).at(-1)!);
  expect(props.onClose).toHaveBeenCalled();
});

it("a text equal to the version saves nothing", async () => {
  vi.mocked(api.previewVersionUpload).mockImplementation(async (_key, _id, text) => (text === undefined ? preview() : preview({ available: false, reason: "unchanged", text, previous_text: OLD, unchanged: true })));
  const { dialog } = await renderDialog();
  fireEvent.change(within(dialog).getByRole("textbox", { name: /New text/ }), { target: { value: OLD } });
  fireEvent.click(within(dialog).getByRole("radio", { name: "Human translation" }));
  fireEvent.click(within(dialog).getByRole("button", { name: "Check changes" }));
  expect(await within(dialog).findByText("No changes to v2. Nothing is saved.")).toBeTruthy();
  expect(within(dialog).queryByRole("button", { name: "Save as v3" })).toBeNull();
  // The message goes when the text changes.
  fireEvent.change(within(dialog).getByRole("textbox", { name: /New text/ }), { target: { value: NEW } });
  expect(within(dialog).queryByText("No changes to v2. Nothing is saved.")).toBeNull();
});

it("explains a refusal at saving in words", async () => {
  vi.mocked(api.uploadVersion).mockRejectedValueOnce(new ApiError(409, "nope", "VERSION_UPLOAD_NOT_AVAILABLE", { reason: "not_newest" }));
  const { props, dialog } = await renderDialog();
  fireEvent.change(within(dialog).getByRole("textbox", { name: /New text/ }), { target: { value: NEW } });
  fireEvent.click(within(dialog).getByRole("radio", { name: "Human translation" }));
  fireEvent.click(within(dialog).getByRole("button", { name: "Check changes" }));
  fireEvent.click(await within(dialog).findByRole("button", { name: "Save as v3" }));
  expect(await within(dialog).findByText("A newer version of this translation exists. Reload the row to see it.")).toBeTruthy();
  expect(props.onUploaded).not.toHaveBeenCalled();
});

it("counts changed passages and names every refusal", async () => {
  expect(changedPassages(diffText(OLD, NEW))).toBe(2);
  expect(changedPassages(diffText(OLD, OLD))).toBe(0);
  expect(changedPassages(diffText("a b c", "x y c"))).toBe(1);
  for (const reason of ["review_open", "not_newest", "discarded", "unchanged"]) expect(uploadRefusal(reason, "v2")).toBeTruthy();
  expect(uploadRefusal("other", "v2")).toBeNull();
  expect(await readTextFile(new File(["  \n"], "empty.txt"))).toEqual({ error: "This file is empty." });
  expect(await readTextFile(new File(["Text"], "NAME.TXT"))).toEqual({ text: "Text" });
});
