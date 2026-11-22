/** Issue 556: the (?) help button and the greyed button that says its reason (ui/Help.tsx). */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { HelpButton, HelpText, ReasonButton, useHelp } from "../../src/ui";

afterEach(cleanup);

function Field() {
  const help = useHelp();
  return <div>
    <span>Note</span><HelpButton help={help} topic="Note" />
    <HelpText help={help}><p>Kept with the version.</p></HelpText>
  </div>;
}

it("the (?) is a disclosure: named by its topic, toggled by click, closed by Escape with the focus on it", () => {
  const outer = vi.fn();
  render(<div onKeyDown={outer}><Field /></div>);
  const button = screen.getByRole("button", { name: "Help: Note" });
  const text = document.getElementById(button.getAttribute("aria-controls")!)!;
  expect(button.getAttribute("aria-expanded")).toBe("false");
  expect(text.hidden).toBe(true);
  fireEvent.click(button);
  expect(button.getAttribute("aria-expanded")).toBe("true");
  expect(text.hidden).toBe(false);
  // Escape in the explanation closes it and gives the focus back; it does not reach the dialog around it.
  fireEvent.keyDown(text, { key: "Escape" });
  expect(button.getAttribute("aria-expanded")).toBe("false");
  expect(document.activeElement).toBe(button);
  expect(outer).not.toHaveBeenCalled();
  // A closed explanation lets Escape through.
  fireEvent.keyDown(button, { key: "Escape" });
  expect(outer).toHaveBeenCalledTimes(1);
});

it("a greyed button says its reason: as its description, and visibly when focused or pressed", () => {
  const onClick = vi.fn();
  const { rerender } = render(<ReasonButton reason="Choose what you fixed first." onClick={onClick}>Save</ReasonButton>);
  const button = screen.getByRole("button", { name: "Save" });
  expect(button.getAttribute("aria-disabled")).toBe("true");
  const tip = document.getElementById(button.getAttribute("aria-describedby")!)!;
  expect(tip.textContent).toBe("Choose what you fixed first.");
  // The tooltip a greyed control has everywhere (issue 591).
  expect(button.getAttribute("title")).toBe("Choose what you fixed first.");
  expect(tip.dataset.shown).toBeUndefined();
  fireEvent.focus(button);
  expect(tip.dataset.shown).toBe("true");
  fireEvent.blur(button);
  expect(tip.dataset.shown).toBeUndefined();
  // A press (touch) shows it too, and still reaches the dialog so it can mark the missing field.
  fireEvent.click(button);
  expect(tip.dataset.shown).toBe("true");
  expect(onClick).toHaveBeenCalledTimes(1);
  rerender(<ReasonButton reason={null} onClick={onClick}>Save</ReasonButton>);
  expect(button.getAttribute("aria-disabled")).toBeNull();
  expect(button.getAttribute("aria-describedby")).toBeNull();
  expect(button.getAttribute("title")).toBeNull();
});
