/** Issue 556: the (?) help button and the greyed button that says its reason (ui/Help.tsx). */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { HelpButton, HelpText, ReasonButton, reasonTipPlacement, Textarea, useHelp } from "../../src/ui";

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

it("an opened explanation is scrolled into view, a closed one is not (issue 621)", () => {
  const scroll = vi.fn();
  const original = Element.prototype.scrollIntoView;
  Element.prototype.scrollIntoView = scroll;
  try {
    render(<Field />);
    expect(scroll).not.toHaveBeenCalled();
    const button = screen.getByRole("button", { name: "Help: Note" });
    fireEvent.click(button);
    expect(scroll).toHaveBeenCalledTimes(1);
    expect(scroll.mock.contexts[0]).toBe(document.getElementById(button.getAttribute("aria-controls")!));
    expect(scroll).toHaveBeenCalledWith({ block: "nearest" });
    fireEvent.click(button);
    expect(scroll).toHaveBeenCalledTimes(1);
  } finally { Element.prototype.scrollIntoView = original; }
});

it("a field's help is a (?) after its label, outside the label, so the field keeps its name", () => {
  render(<Textarea id="reason" label="Reason" help={{ topic: "Reason", content: <p>Kept with the change.</p> }} />);
  expect(screen.getByRole("textbox", { name: "Reason" })).toBeTruthy();
  const button = screen.getByRole("button", { name: "Help: Reason" });
  fireEvent.click(button);
  expect(document.getElementById(button.getAttribute("aria-controls")!)!.textContent).toBe("Kept with the change.");
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

it("issue 618: the reason floats above the button, but goes under it inside a box that clips its overflow", () => {
  const styles = new Map<Element, Partial<Record<"overflowX" | "overflowY" | "position", string>>>();
  const styleOf = (element: Element) => ({ overflowX: "visible", overflowY: "visible", position: "static", ...styles.get(element) });
  const page = document.body.appendChild(document.createElement("main"));
  const overlay = page.appendChild(document.createElement("div"));
  const body = overlay.appendChild(document.createElement("div"));
  const anchor = body.appendChild(document.createElement("span"));
  const footer = overlay.appendChild(document.createElement("div"));
  const footerAnchor = footer.appendChild(document.createElement("span"));
  try {
    expect(reasonTipPlacement(anchor, styleOf)).toBe("above");
    // A dialog's scrolling body clips; so does a box that scrolls one way only or hides its overflow.
    for (const style of [{ overflowY: "auto" }, { overflowX: "scroll" }, { overflowY: "hidden" }, { overflowX: "clip" }]) {
      styles.set(body, style);
      expect(reasonTipPlacement(anchor, styleOf)).toBe("below");
    }
    // A footer button is outside the body; the fixed overlay stops the walk before the scrolling page.
    styles.set(overlay, { position: "fixed" });
    styles.set(page, { overflowY: "auto" });
    expect(reasonTipPlacement(footerAnchor, styleOf)).toBe("above");
    styles.delete(overlay);
    expect(reasonTipPlacement(footerAnchor, styleOf)).toBe("below");
  } finally {
    page.remove();
  }
});

it("issue 618: the button marks where its reason shows, only while it has one", () => {
  const { rerender } = render(<div style={{ overflowY: "auto" }}><ReasonButton reason="Already planned.">Annotation only</ReasonButton></div>);
  const anchor = screen.getByRole("button", { name: "Annotation only" }).parentElement!;
  expect(anchor.dataset.tip).toBe("below");
  rerender(<div style={{ overflowY: "auto" }}><ReasonButton reason={null}>Annotation only</ReasonButton></div>);
  expect(anchor.dataset.tip).toBeUndefined();
  cleanup();
  render(<ReasonButton reason="Change the text first.">Save</ReasonButton>);
  expect(screen.getByRole("button", { name: "Save" }).parentElement!.dataset.tip).toBe("above");
});
