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

  it("is an icon without visible text, named 'Copy text', that copies", async () => {
    const writeText = clipboard();
    render(<CopyTextButton text="alpha" />);
    const button = screen.getByRole("button", { name: "Copy text" });
    expect(button.textContent).toBe("");
    expect(button.querySelector("svg")).not.toBeNull();
    fireEvent.click(button);
    expect(writeText).toHaveBeenCalledWith("alpha");
    expect((await screen.findByRole("button", { name: "Copied" })).textContent).toBe("");
  });

  it("says 'Copy failed' when the clipboard is unavailable", async () => {
    render(<CopyTextButton text="alpha" />);
    fireEvent.click(screen.getByRole("button", { name: "Copy text" }));
    await screen.findByRole("button", { name: "Copy failed" });
  });

  it("copies line breaks and runs of whitespace as one space", () => {
    const writeText = clipboard();
    render(<CopyTextButton text={" Mild weakness\r\nof both\n\n legs "} />);
    fireEvent.click(screen.getByRole("button", { name: "Copy text" }));
    expect(writeText).toHaveBeenCalledWith("Mild weakness of both legs");
  });
});
