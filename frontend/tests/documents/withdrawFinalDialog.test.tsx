/** "Withdraw final…" (issue 343): the button next to "Change final…" and its confirmation dialog. */
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { api, ApiError } from "../../src/api/client";
import { StageActions } from "../../src/documents/StageActions";
import { WITHDRAW_CONSEQUENCES, WithdrawFinalDialog } from "../../src/documents/WithdrawFinalDialog";
import { row, version } from "./fixtures";

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

const final = { case_id: "case-7", language: "de", document_id: "case-7-de", submission_id: "s1", revision: 3 } as const;
const decided = row({ case_id: "case-7", language: "de", versions: [version({ document_id: "case-7-de" })], final: final as never });

const dialog = () => screen.getByRole("dialog", { name: "Withdraw final result: case-7 de" });
const confirmButton = () => within(dialog()).getByRole("button", { name: "Withdraw final result" });

it("Finalization offers Withdraw final… next to Change final… only with a final result", () => {
  const onWithdrawFinal = vi.fn();
  render(<StageActions row={decided} stage="final" onChangeFinal={vi.fn()} canChangeFinal={() => true} onWithdrawFinal={onWithdrawFinal} />);
  const buttons = screen.getAllByRole("button").map(button => button.textContent);
  expect(buttons).toEqual(["Change final…", "Withdraw final…"]);
  fireEvent.click(screen.getByRole("button", { name: "Withdraw final…" }));
  expect(onWithdrawFinal).toHaveBeenCalledWith(decided);
  cleanup();
  const open = { ...decided, final: null };
  const { container } = render(<StageActions row={open} stage="final" onWithdrawFinal={onWithdrawFinal} />);
  expect(container.textContent).toBe("");
});

it("lists the consequences and needs a reason and I understand before it sends the final's revision", async () => {
  const send = vi.spyOn(api, "withdrawFinalResult").mockResolvedValue({ ...final, revision: 4 });
  const onWithdrawn = vi.fn();
  render(<WithdrawFinalDialog projectKey="demo" row={decided} onCancel={vi.fn()} onWithdrawn={onWithdrawn} />);
  const lines = within(within(dialog()).getByRole("list", { name: "What happens" })).getAllByRole("listitem").map(item => item.textContent);
  expect(lines).toEqual([...WITHDRAW_CONSEQUENCES]);
  expect(confirmButton().getAttribute("aria-disabled")).toBe("true");
  fireEvent.click(confirmButton());
  expect(send).not.toHaveBeenCalled();
  expect(within(dialog()).getByText("Give a reason for withdrawing the final result.")).toBeTruthy();
  fireEvent.change(within(dialog()).getByLabelText(/Reason/), { target: { value: "  Re-annotation with guideline 2.3 " } });
  fireEvent.click(confirmButton());
  expect(send).not.toHaveBeenCalled();
  fireEvent.click(within(dialog()).getByLabelText("I understand"));
  expect(confirmButton().getAttribute("aria-disabled")).toBeNull();
  fireEvent.click(confirmButton());
  await waitFor(() => expect(onWithdrawn).toHaveBeenCalled());
  expect(send).toHaveBeenCalledWith("demo", { case_id: "case-7", language: "de", expected_revision: 3, reason: "Re-annotation with guideline 2.3" });
});

it("shows a refusal and stays open", async () => {
  vi.spyOn(api, "withdrawFinalResult").mockRejectedValue(new ApiError(409, "Conflict", "REVISION_CONFLICT", { current_revision: 4 }));
  const onWithdrawn = vi.fn();
  render(<WithdrawFinalDialog projectKey="demo" row={decided} onCancel={vi.fn()} onWithdrawn={onWithdrawn} />);
  fireEvent.change(within(dialog()).getByLabelText(/Reason/), { target: { value: "Redo" } });
  fireEvent.click(within(dialog()).getByLabelText("I understand"));
  fireEvent.click(confirmButton());
  await waitFor(() => expect(within(dialog()).getByRole("alert")).toBeTruthy());
  expect(onWithdrawn).not.toHaveBeenCalled();
});
