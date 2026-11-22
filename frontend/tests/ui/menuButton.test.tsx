import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import { MenuButton, menuPosition } from "../../src/ui/MenuButton";
import { useShortcut } from "../../src/ui/shortcuts";

afterEach(cleanup);
const setup = () => {
  const resolve = vi.fn(); const carry = vi.fn(); const review = vi.fn(); const escapeShortcut = vi.fn();
  function Host() {
    useShortcut("Escape", () => { escapeShortcut(); });
    return <><MenuButton label="2 more actions for case-107 de" buttonLabel="+2"
      items={[{ id: "resolve", label: "Resolve…", onSelect: resolve }, { id: "carry", label: "Carry to v2…", onSelect: carry }, { id: "review", label: "Review changes…", onSelect: review }]} />
      <button>Outside</button></>;
  }
  render(<Host />);
  return { resolve, carry, review, escapeShortcut, button: screen.getByRole("button", { name: "2 more actions for case-107 de" }) };
};
const item = (name: string) => screen.getByRole("menuitem", { name });

it("aria-haspopup, arrow keys, Escape", async () => {
  const user = userEvent.setup();
  const { button, carry, escapeShortcut } = setup();
  expect(button.getAttribute("aria-haspopup")).toBe("menu");
  expect(button.getAttribute("aria-expanded")).toBe("false");
  expect(button.textContent).toBe("+2");
  expect(screen.queryByRole("menu")).toBeNull();

  await user.click(button);
  const menu = screen.getByRole("menu", { name: "2 more actions for case-107 de" });
  expect(button.getAttribute("aria-expanded")).toBe("true");
  expect(button.getAttribute("aria-controls")).toBe(menu.id);
  expect(document.activeElement).toBe(item("Resolve…"));
  await user.keyboard("{ArrowDown}");
  expect(document.activeElement).toBe(item("Carry to v2…"));
  await user.keyboard("{End}");
  expect(document.activeElement).toBe(item("Review changes…"));
  await user.keyboard("{ArrowDown}");
  expect(document.activeElement).toBe(item("Resolve…"));
  await user.keyboard("{ArrowUp}");
  expect(document.activeElement).toBe(item("Review changes…"));
  await user.keyboard("{Home}");
  expect(document.activeElement).toBe(item("Resolve…"));
  await user.keyboard("{Escape}");
  expect(screen.queryByRole("menu")).toBeNull();
  expect(document.activeElement).toBe(button);
  expect(escapeShortcut).not.toHaveBeenCalled();

  fireEvent.keyDown(button, { key: "ArrowUp" });
  expect(document.activeElement).toBe(item("Review changes…"));
  await user.keyboard("{ArrowUp}");
  await user.keyboard("{Enter}");
  expect(carry).toHaveBeenCalledOnce();
  expect(screen.queryByRole("menu")).toBeNull();
  expect(document.activeElement).toBe(button);
});

it("ArrowDown on the button opens at the first item; click selects; outside pointer and Tab close", async () => {
  const user = userEvent.setup();
  const { button, review } = setup();
  button.focus();
  fireEvent.keyDown(button, { key: "ArrowDown" });
  expect(document.activeElement).toBe(item("Resolve…"));
  await user.click(item("Review changes…"));
  expect(review).toHaveBeenCalledOnce();
  expect(screen.queryByRole("menu")).toBeNull();

  await user.click(button);
  fireEvent.pointerDown(screen.getByRole("button", { name: "Outside" }));
  expect(screen.queryByRole("menu")).toBeNull();

  await user.click(button);
  await user.tab();
  expect(screen.queryByRole("menu")).toBeNull();
});

it("items are not in the tab order", async () => {
  const user = userEvent.setup();
  const { button } = setup();
  await user.click(button);
  for (const menuItem of screen.getAllByRole("menuitem")) expect(menuItem.getAttribute("tabindex")).toBe("-1");
});

it("opens below the trigger, flips above near the bottom and stays inside the viewport", () => {
  const viewport = { width: 1000, height: 600 };
  const menu = { width: 200, height: 150 };
  expect(menuPosition({ top: 100, bottom: 130, right: 900 }, menu, viewport)).toEqual({ top: 134, left: 700, maxHeight: 462 });
  expect(menuPosition({ top: 540, bottom: 570, right: 900 }, menu, viewport)).toEqual({ top: 386, left: 700, maxHeight: 532 });
  expect(menuPosition({ top: 100, bottom: 130, right: 150 }, menu, viewport).left).toBe(4);
  expect(menuPosition({ top: 100, bottom: 130, right: 1100 }, menu, viewport).left).toBe(796);
  // Very little room either way: over the trigger, inside the window.
  expect(menuPosition({ top: 20, bottom: 50, right: 900 }, menu, { width: 1000, height: 160 })).toEqual({ top: 6, left: 700, maxHeight: 152 });
});

it("a menu taller than the room on either side takes the side with more room and scrolls; it does not cover its trigger (issue 585)", () => {
  const menu = { width: 200, height: 650 };
  // 1280 × 600, the trigger in the selection bar near the bottom: above, 4 px from the top, as high as the room.
  expect(menuPosition({ top: 547, bottom: 579, right: 900 }, menu, { width: 1280, height: 600 })).toEqual({ top: 4, left: 700, maxHeight: 539 });
  // The trigger near the top of a short window: below, as high as the room.
  expect(menuPosition({ top: 60, bottom: 92, right: 900 }, menu, { width: 1280, height: 400 })).toEqual({ top: 96, left: 700, maxHeight: 300 });
  // Fits above, not below: opens above, its bottom 4 px over the trigger.
  expect(menuPosition({ top: 500, bottom: 532, right: 900 }, { width: 200, height: 450 }, { width: 1280, height: 600 })).toEqual({ top: 46, left: 700, maxHeight: 492 });
});

it("is placed again when its content grows after it opened, e.g. reasons that load late (issue 585)", async () => {
  // jsdom lays nothing out: the trigger sits near the bottom of a 600 px window and each item is 40 px high.
  const height = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "scrollHeight");
  Object.defineProperty(HTMLElement.prototype, "scrollHeight", {
    configurable: true,
    get(this: HTMLElement) { return this.getAttribute("role") === "menu" ? this.querySelectorAll("[role=menuitem]").length * 40 : 0; },
  });
  const rect = vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
    return this.getAttribute("aria-haspopup") ? { top: 500, bottom: 530, right: 900, left: 800, width: 100, height: 30 } as DOMRect
      : { top: 0, bottom: 0, right: 0, left: 0, width: 200, height: 0 } as DOMRect;
  });
  const innerHeight = window.innerHeight;
  window.innerHeight = 600;
  try {
    const items = (count: number) => Array.from({ length: count }, (_, index) => ({ id: `a${index}`, label: `Action ${index}…`, onSelect: () => {} }));
    const { rerender } = render(<MenuButton label="More actions" buttonLabel="More" items={items(2)} />);
    await userEvent.setup().click(screen.getByRole("button", { name: "More actions" }));
    const menu = screen.getByRole("menu", { name: "More actions" });
    expect(menu.style.top).toBe("416px");
    rerender(<MenuButton label="More actions" buttonLabel="More" items={items(4)} />);
    await waitFor(() => expect(menu.style.top).toBe("336px"));
    rerender(<MenuButton label="More actions" buttonLabel="More" items={items(20)} />);
    await waitFor(() => expect(menu.style.top).toBe("4px"));
    expect(menu.style.maxHeight).toBe("492px");
  } finally {
    rect.mockRestore();
    if (height) Object.defineProperty(HTMLElement.prototype, "scrollHeight", height);
    window.innerHeight = innerHeight;
  }
});

it("a disabled item stays focusable with its reason and does nothing when chosen", async () => {
  const user = userEvent.setup();
  const reset = vi.fn();
  render(<MenuButton label="More actions" buttonLabel="More"
    items={[{ id: "reset", label: "Reset all my changes…", description: "Nothing changed in this round yet", disabled: true, onSelect: reset }]} />);
  await user.click(screen.getByRole("button", { name: "More actions" }));
  const entry = item("Reset all my changes…");
  expect(entry.getAttribute("aria-disabled")).toBe("true");
  expect(document.activeElement).toBe(entry);
  expect(document.getElementById(entry.getAttribute("aria-describedby")!)?.textContent).toBe("Nothing changed in this round yet");
  await user.click(entry);
  await user.keyboard("{Enter}");
  expect(reset).not.toHaveBeenCalled();
  expect(screen.getByRole("menu")).toBeDefined();
});

it("groups radio choices: a labelled group, aria-checked, arrows pass through, choosing keeps the menu open", async () => {
  const user = userEvent.setup();
  const first = vi.fn(); const light = vi.fn(); const last = vi.fn();
  function Host() {
    return <MenuButton label="User menu" buttonLabel="Me" items={[
      { id: "first", label: "First", onSelect: first },
      { id: "system", label: "System", group: "Theme", checked: true, onSelect: vi.fn() },
      { id: "light", label: "Light", group: "Theme", checked: false, onSelect: light },
      { id: "last", label: "Last", onSelect: last },
    ]} />;
  }
  render(<Host />);
  const button = screen.getByRole("button", { name: "User menu" });
  await user.click(button);
  const group = screen.getByRole("group", { name: "Theme" });
  expect([...group.querySelectorAll("[role=menuitemradio]")].map(element => [element.textContent, element.getAttribute("aria-checked")])).toEqual([["System", "true"], ["Light", "false"]]);
  expect(screen.getAllByRole("menuitem").map(element => element.textContent)).toEqual(["First", "Last"]);
  await user.keyboard("{ArrowDown}{ArrowDown}");
  expect(document.activeElement?.textContent).toBe("Light");
  await user.keyboard("{Enter}");
  expect(light).toHaveBeenCalledOnce();
  expect(screen.getByRole("menu")).toBeDefined();
  await user.keyboard("{ArrowDown}");
  expect(document.activeElement?.textContent).toBe("Last");
  await user.keyboard("{End}{Home}");
  expect(document.activeElement?.textContent).toBe("First");
  await user.keyboard("{Enter}");
  expect(first).toHaveBeenCalledOnce();
  expect(screen.queryByRole("menu")).toBeNull();
  expect(document.activeElement).toBe(button);
});

it("closes when the browser goes Back or Forward (issue 550, U5-04)", async () => {
  const user = userEvent.setup();
  const { button } = setup();
  for (const event of [new HashChangeEvent("hashchange"), new PopStateEvent("popstate")]) {
    await user.click(button);
    expect(screen.getByRole("menu")).toBeTruthy();
    act(() => { window.dispatchEvent(event); });
    expect(screen.queryByRole("menu")).toBeNull();
    expect(button.getAttribute("aria-expanded")).toBe("false");
  }
});
