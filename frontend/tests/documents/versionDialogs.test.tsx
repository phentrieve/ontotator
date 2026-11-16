/** Issue 341 d: "Accept this version…" (reason required, recorded like the work plan's acceptance). */
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { api, ApiError, type AcceptVersionResult, type VariantSummary } from "../../src/api/client";
import { AcceptVersionDialog } from "../../src/documents/VersionDialogs";
import { planRow, stepOf, version } from "./fixtures";

const v2 = version({ document_id: "case-0101-de-v2", version: 2, chain_name: "DeepL", origin: "correction", derived_from: "case-0101-de", translation_status: "ready_for_review" });
const row = planRow("case-0101", "de", stepOf("assign_translation_review"), {
  versions: [version({ document_id: "case-0101-de", version: 1, chain_name: "DeepL", origin: "machine_translation", translation_status: "accepted", is_newest_in_chain: false }), v2],
});

beforeEach(() => {
  vi.spyOn(api, "getVariantMetadata").mockResolvedValue({ document_id: "case-0101-de-v2", text_sha256: "sha-v2" } as VariantSummary);
  vi.spyOn(api, "acceptVersion");
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

function renderDialog() {
  const props = { row, version: v2, projectKey: "p", onAccepted: vi.fn(), onClose: vi.fn() };
  render(<AcceptVersionDialog {...props} />);
  return { props, dialog: screen.getByRole("dialog", { name: "Accept de v2" }) };
}

it("requires a reason and accepts exactly this version", async () => {
  vi.mocked(api.acceptVersion).mockResolvedValue({ document_id: "case-0101-de-v2", translation_status: "accepted" } as AcceptVersionResult);
  const { props, dialog } = renderDialog();
  expect(within(dialog).getByText("The acceptance is recorded with your name, the reason and the time.")).toBeTruthy();
  const accept = within(dialog).getByRole("button", { name: "Accept v2" });
  expect(accept.getAttribute("aria-disabled")).toBe("true");
  fireEvent.click(accept);
  expect(within(dialog).getByText("Enter a reason.")).toBeTruthy();
  expect(api.acceptVersion).not.toHaveBeenCalled();
  fireEvent.change(within(dialog).getByRole("textbox", { name: /Reason/ }), { target: { value: " Checked against the DeepL output " } });
  fireEvent.click(accept);
  await waitFor(() => expect(api.acceptVersion).toHaveBeenCalledWith("p", "case-0101-de-v2", { reason: "Checked against the DeepL output", expected_text_sha256: "sha-v2" }));
  await waitFor(() => expect(props.onAccepted).toHaveBeenCalledWith("case-0101 de v2 accepted as reviewed outside Ontotator."));
  fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
  expect(props.onClose).toHaveBeenCalled();
});

it("explains VERSION_NOT_ACCEPTABLE in words", async () => {
  vi.mocked(api.acceptVersion).mockRejectedValueOnce(new ApiError(409, "nope", "VERSION_NOT_ACCEPTABLE", { reason: "review_open" }));
  const { props, dialog } = renderDialog();
  fireEvent.change(within(dialog).getByRole("textbox", { name: /Reason/ }), { target: { value: "Checked" } });
  fireEvent.click(within(dialog).getByRole("button", { name: "Accept v2" }));
  expect(await within(dialog).findByText(/A translation review of this version is open/)).toBeTruthy();
  expect(props.onAccepted).not.toHaveBeenCalled();
});
