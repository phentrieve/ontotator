import { act, fireEvent, render, renderHook, screen } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SidebarResizer } from "../src/editor/SidebarResizer";
import { INSPECTOR_MIN_HEIGHT, TREE_HOST_ID, TREE_MIN_HEIGHT, treeHeightKey, treeHeightLimits, useTreeHeight } from "../src/editor/treeHeight";

const editorCss = readFileSync(resolve(__dirname, "../src/styles/screens/editor.css"), "utf8");

// jsdom has no PointerEvent; without it clientY and pointerId would be dropped.
if (typeof window.PointerEvent === "undefined") {
  class TestPointerEvent extends MouseEvent {
    pointerId: number;
    constructor(type: string, init: PointerEventInit = {}) {
      super(type, init);
      this.pointerId = init.pointerId ?? 0;
    }
  }
  (window as unknown as { PointerEvent: unknown }).PointerEvent = TestPointerEvent;
}

const rect = (height: number) => () => ({ x: 0, y: 0, top: 0, left: 0, right: 0, bottom: height, width: 380, height, toJSON: () => ({}) }) as DOMRect;

/** A layout of this height with the tree host in it, as the case screen has; jsdom lays nothing out. */
function mountLayout(column: number, tree: number) {
  const layout = document.createElement("div");
  const host = document.createElement("div");
  host.id = TREE_HOST_ID;
  layout.append(host);
  document.body.append(layout);
  const size = { column, tree };
  layout.getBoundingClientRect = () => rect(size.column)();
  host.getBoundingClientRect = () => rect(size.tree)();
  return size;
}

beforeEach(() => localStorage.clear());
afterEach(() => {
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
});

describe("treeHeightLimits", () => {
  it("leaves the tree 220 px and the annotation panel 160 px, whatever the column", () => {
    expect(TREE_MIN_HEIGHT).toBe(220);
    expect(INSPECTOR_MIN_HEIGHT).toBe(160);
    // 1440 x 900: the column is 792 px. The default is what the layout's own rows give at least.
    expect(treeHeightLimits(792)).toEqual({ min: 220, max: 632, fallback: 400 });
    // 1280 x 600: 492 px. The tree can still grow beyond its default of 295 px.
    expect(treeHeightLimits(492)).toEqual({ min: 220, max: 332, fallback: 295 });
    // Too low for both: the tree keeps its minimum, never less.
    expect(treeHeightLimits(300)).toEqual({ min: 220, max: 220, fallback: 220 });
    expect(treeHeightLimits(0)).toEqual({ min: 220, max: 220, fallback: 220 });
  });

  it("editor.css gives the same two minimums to the sized rows", () => {
    expect(editorCss).toContain("grid-template-rows: minmax(160px, 1fr) clamp(220px, var(--tree-height), 100% - 160px);");
  });
});

describe("useTreeHeight", () => {
  it("is unset until changed, and reports the height the layout gives the tree", () => {
    mountLayout(792, 412);
    const { result } = renderHook(() => useTreeHeight("anna", 1));
    expect(result.current.height).toBeNull();
    expect(result.current.value).toBe(412);
    expect(result.current.measure()).toBe(412);
    expect(result.current.limits).toEqual({ min: 220, max: 632, fallback: 400 });
  });

  it("keeps the height per user, clamped to the column", () => {
    mountLayout(792, 400);
    localStorage.setItem(treeHeightKey("anna"), "5000");
    localStorage.setItem(treeHeightKey("ben"), "40");
    const { result, rerender } = renderHook(({ user }) => useTreeHeight(user, 1), { initialProps: { user: "anna" as string | undefined } });
    expect(result.current.height).toBe(632);
    rerender({ user: "ben" });
    expect(result.current.height).toBe(220);
    rerender({ user: "cleo" });
    expect(result.current.height).toBeNull();
    act(() => result.current.setHeight(300));
    act(() => result.current.commit("key"));
    expect(localStorage.getItem(treeHeightKey("cleo"))).toBe("300");
    expect(localStorage.getItem(treeHeightKey("anna"))).toBe("5000");
    // Without a user nothing is read or written.
    rerender({ user: undefined });
    expect(result.current.height).toBeNull();
    act(() => result.current.setHeight(280));
    act(() => result.current.commit("drag"));
    expect(Object.keys(localStorage).sort()).toEqual([treeHeightKey("anna"), treeHeightKey("ben"), treeHeightKey("cleo")].sort());
  });

  it.each(["abc", "", " ", "0", "-200", "1e3", "12.5", "0x200", "NaN", "Infinity", "null"])("ignores the stored value %j", (raw) => {
    mountLayout(792, 400);
    localStorage.setItem(treeHeightKey("anna"), raw);
    const { result } = renderHook(() => useTreeHeight("anna", 1));
    expect(result.current.height).toBeNull();
  });

  it("works while storage is blocked", () => {
    mountLayout(792, 400);
    vi.stubGlobal("localStorage", { getItem: () => { throw new Error("blocked"); }, setItem: () => { throw new Error("blocked"); }, removeItem: () => { throw new Error("blocked"); } });
    const { result } = renderHook(() => useTreeHeight("anna", 1));
    expect(result.current.height).toBeNull();
    act(() => result.current.setHeight(300));
    act(() => result.current.commit("drag"));
    expect(result.current.height).toBe(300);
    act(() => result.current.reset());
    expect(result.current.height).toBeNull();
  });

  it("follows the window: a lower column lowers the maximum and the height, a higher one gives it back", () => {
    const size = mountLayout(792, 500);
    localStorage.setItem(treeHeightKey("anna"), "500");
    const { result } = renderHook(() => useTreeHeight("anna", 1));
    expect(result.current.height).toBe(500);
    size.column = 492;
    act(() => { window.dispatchEvent(new Event("resize")); });
    expect(result.current.limits.max).toBe(332);
    expect(result.current.height).toBe(332);
    // The preference itself is untouched.
    expect(localStorage.getItem(treeHeightKey("anna"))).toBe("500");
    size.column = 792;
    act(() => { window.dispatchEvent(new Event("resize")); });
    expect(result.current.height).toBe(500);
  });

  it("reset returns to the layout's own split and removes the key", () => {
    mountLayout(792, 400);
    localStorage.setItem(treeHeightKey("anna"), "300");
    const { result } = renderHook(() => useTreeHeight("anna", 1));
    act(() => result.current.reset());
    expect(result.current.height).toBeNull();
    expect(localStorage.getItem(treeHeightKey("anna"))).toBeNull();
  });
});

function Harness() {
  const tree = useTreeHeight("anna", 1);
  return (
    <>
      <output data-testid="height">{tree.height === null ? "unset" : String(tree.height)}</output>
      <SidebarResizer orientation="horizontal" side="start" width={tree.value} limits={tree.limits} controls={TREE_HOST_ID}
        onChange={tree.setHeight} onReset={tree.reset} onCommit={tree.commit} label="Resize ontology tree" measure={tree.measure} />
    </>
  );
}

describe("the divider above the tree", () => {
  const height = () => screen.getByTestId("height").textContent;
  const stored = () => localStorage.getItem(treeHeightKey("anna"));
  const flushFrame = () => act(() => { vi.advanceTimersByTime(20); });
  beforeEach(() => vi.useFakeTimers({ toFake: ["requestAnimationFrame", "cancelAnimationFrame", "setTimeout", "clearTimeout"] }));
  afterEach(() => vi.useRealTimers());

  it("is a horizontal separator with the tree's height as its value", () => {
    mountLayout(792, 412);
    render(<Harness />);
    const sep = screen.getByRole("separator", { name: "Resize ontology tree" });
    expect(sep.getAttribute("aria-orientation")).toBe("horizontal");
    expect(sep.getAttribute("aria-controls")).toBe(TREE_HOST_ID);
    expect(sep.getAttribute("aria-valuenow")).toBe("412");
    expect(sep.getAttribute("aria-valuemin")).toBe("220");
    expect(sep.getAttribute("aria-valuemax")).toBe("632");
    expect(sep.getAttribute("aria-valuetext")).toBe("412 pixels (default 400)");
    expect(sep.tabIndex).toBe(0);
    expect(sep.className).toBe("sidebar-resizer sidebar-resizer--rows");
  });

  it("arrow up enlarges the tree and arrow down shrinks it, from the height on screen; left and right do nothing", () => {
    mountLayout(792, 412);
    render(<Harness />);
    const sep = screen.getByRole("separator");
    fireEvent.keyDown(sep, { key: "ArrowLeft" });
    fireEvent.keyDown(sep, { key: "ArrowRight" });
    expect(height()).toBe("unset");
    fireEvent.keyDown(sep, { key: "ArrowUp" });
    expect(height()).toBe("428");
    expect(stored()).toBe("428");
    fireEvent.keyDown(sep, { key: "ArrowDown", shiftKey: true });
    expect(height()).toBe("364");
    fireEvent.keyDown(sep, { key: "End" });
    expect(height()).toBe("632");
    fireEvent.keyDown(sep, { key: "Home" });
    expect(height()).toBe("220");
    expect(stored()).toBe("220");
    fireEvent.keyDown(sep, { key: "Enter" });
    expect(height()).toBe("unset");
    expect(stored()).toBeNull();
  });

  it("dragging up enlarges the tree, within the limits, and a double click resets", () => {
    mountLayout(792, 412);
    render(<Harness />);
    const sep = screen.getByRole("separator");
    fireEvent.pointerDown(sep, { clientY: 380, clientX: 1200, pointerId: 1 });
    fireEvent.pointerMove(sep, { clientY: 280, clientX: 900, pointerId: 1 });
    flushFrame();
    expect(height()).toBe("512");
    expect(stored()).toBeNull();
    fireEvent.pointerMove(sep, { clientY: -500, clientX: 900, pointerId: 1 });
    fireEvent.pointerUp(sep, { clientY: -500, clientX: 900, pointerId: 1 });
    expect(height()).toBe("632");
    expect(stored()).toBe("632");
    fireEvent.doubleClick(sep);
    expect(height()).toBe("unset");
    expect(stored()).toBeNull();
  });

  it("a click that moves nothing, or a cancelled drag, leaves the layout's own split", () => {
    mountLayout(792, 412);
    render(<Harness />);
    const sep = screen.getByRole("separator");
    fireEvent.pointerDown(sep, { clientY: 380, pointerId: 1 });
    fireEvent.pointerUp(sep, { clientY: 380, pointerId: 1 });
    expect(height()).toBe("unset");
    expect(stored()).toBeNull();

    fireEvent.pointerDown(sep, { clientY: 380, pointerId: 2 });
    fireEvent.pointerMove(sep, { clientY: 300, pointerId: 2 });
    flushFrame();
    expect(height()).toBe("492");
    fireEvent.keyDown(sep, { key: "Escape" });
    expect(height()).toBe("unset");
    expect(stored()).toBeNull();

    fireEvent.pointerDown(sep, { clientY: 380, pointerId: 3 });
    fireEvent.pointerMove(sep, { clientY: 300, pointerId: 3 });
    fireEvent.pointerCancel(sep, { pointerId: 3 });
    expect(height()).toBe("unset");
    expect(stored()).toBeNull();
  });

  it("Escape that gives up a drag stays with the divider; without a drag it is the screen's", () => {
    mountLayout(792, 412);
    render(<Harness />);
    const sep = screen.getByRole("separator");
    const screenEscape = vi.fn();
    window.addEventListener("keydown", screenEscape);
    try {
      fireEvent.pointerDown(sep, { clientY: 380, pointerId: 1 });
      fireEvent.pointerMove(sep, { clientY: 300, pointerId: 1 });
      fireEvent.keyDown(sep, { key: "Escape" });
      expect(screenEscape).not.toHaveBeenCalled();
      fireEvent.keyDown(sep, { key: "Escape" });
      expect(screenEscape).toHaveBeenCalledTimes(1);
    } finally {
      window.removeEventListener("keydown", screenEscape);
    }
  });

  it("a cancelled drag returns to the height set before, and storage keeps it", () => {
    mountLayout(792, 300);
    localStorage.setItem(treeHeightKey("anna"), "300");
    render(<Harness />);
    const sep = screen.getByRole("separator");
    fireEvent.pointerDown(sep, { clientY: 480, pointerId: 1 });
    fireEvent.pointerMove(sep, { clientY: 400, pointerId: 1 });
    flushFrame();
    expect(height()).toBe("380");
    fireEvent.keyDown(sep, { key: "Escape" });
    expect(height()).toBe("300");
    expect(stored()).toBe("300");
    // A click on a set height keeps it.
    fireEvent.pointerDown(sep, { clientY: 480, pointerId: 2 });
    fireEvent.pointerUp(sep, { clientY: 480, pointerId: 2 });
    expect(height()).toBe("300");
  });
});
