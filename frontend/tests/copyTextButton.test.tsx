import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CopyTextButton } from "../src/editor/CopyTextButton";

afterEach(() => { cleanup(); delete (navigator as any).clipboard; });
const clipboard = () => {
  const writeText = vi.fn(async () => undefined);
  Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
  return writeText;
};

describe("CopyTextButton", () => {
  it("says 'Copied' only for the passage it copied", async () => {
    clipboard();
    const { rerender } = render(<CopyTextButton text="alpha" />);
    fireEvent.click(screen.getByRole("button", { name: "Copy text" }));
    await screen.findByRole("button", { name: "Copied" });
    rerender(<CopyTextButton text="beta" />);
    expect(screen.getByRole("button", { name: "Copy text" })).toBeDefined();
  });

  it("compact is an icon named 'Copy text' that copies the same", async () => {
    const writeText = clipboard();
    render(<CopyTextButton text="alpha" compact />);
    const button = screen.getByRole("button", { name: "Copy text" });
    expect(button.textContent).toBe("");
    fireEvent.click(button);
    expect(writeText).toHaveBeenCalledWith("alpha");
  });
});
