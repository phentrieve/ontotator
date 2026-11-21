import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import {
  clampSidebarWidth, clearStoredWidth, readStoredWidth, writeStoredWidth, type SidebarCommitSource, type SidebarLimits,
} from "./sidebarWidth";

/**
 * Height of the ontology tree under the inspector (three-column layout only). Unset (null), the
 * layout's own rows apply (editor.css); once dragged, the tree keeps that height. Kept per user in
 * this browser, as the widths of the editor's columns are (sidebarWidth.ts), and read as strictly.
 */
export const TREE_HOST_ID = "ontology-tree";
export const treeHeightKey = (username: string) => `ontotator.editor.treeHeight.v1:${username}`;
/**
 * The least the tree takes (its header, three rows and "Use this term" in full; at 160 px that button
 * was cut in half), and the least it leaves the annotation panel above: the rows of `.tree-sized` in editor.css.
 */
export const TREE_MIN_HEIGHT = 220;
export const INSPECTOR_MIN_HEIGHT = 160;
/**
 * Shell header and case toolbar above the columns: an estimate, used only until the column is measured. From 1025 px
 * they share one bar of about 40 px (issue 539); the estimate stays on the side of a lower column.
 */
const CHROME_HEIGHT = 56;

/**
 * What the tree needs to be useful: its header, the details of the selected term, "Use this term"
 * (together about 160 px, measured at 1280 × 600) and ten rows of 26 px.
 */
export const TREE_USEFUL_HEIGHT = 420;
/**
 * A low window (issue 521): the layout is lower than the annotation panel's least (160 px) and the
 * tree's useful height together. Then the open tree takes the whole right column and the panel
 * shrinks to one line. Measured heights of the layout under the one header bar (issue 539): 1440 × 900 about
 * 860 px, 1440 × 700 about 660 px (not low), 1280 × 600 about 563 px (low); below 1025 px wide, where the case
 * toolbar has its own line, about 70 px less.
 */
export const LOW_LAYOUT_BELOW = INSPECTOR_MIN_HEIGHT + TREE_USEFUL_HEIGHT;
/**
 * Once low, the layout stays low until it is this much higher: a window resized across the
 * threshold, or a header that takes another line, does not switch the layout back and forth.
 */
export const LOW_LAYOUT_HYSTERESIS = 24;

/** Whether a layout of this height is low, given whether it was low before. */
export function isLowLayout(column: number, wasLow: boolean): boolean {
  if (column <= 0) return wasLow;
  return wasLow ? column < LOW_LAYOUT_BELOW + LOW_LAYOUT_HYSTERESIS : column < LOW_LAYOUT_BELOW;
}

/**
 * Where the tree and the annotation panel can trade places. "column": three columns, the tree under
 * the panel in the right column (editor.css: from 1025 px and an editor of at least 1060 px).
 * "beside": two columns in a low window, a phone in landscape (701–1024 px wide, at most 560 px high),
 * where the panel stands beside the text. null: every other layout, where nothing changes.
 */
export type SharedLayout = "column" | "beside" | null;
export const BESIDE_MEDIA = "(min-width: 701px) and (max-width: 1024px) and (max-height: 560px)";

function sharedLayout(): SharedLayout {
  if (typeof document === "undefined" || typeof window === "undefined") return null;
  const screen = document.querySelector(".case-screen");
  if (!screen || screen.classList.contains("case-comparing")) return null;
  if (window.matchMedia?.(BESIDE_MEDIA).matches) return "beside";
  if (window.matchMedia?.("(min-width: 1025px)").matches && screen.getBoundingClientRect().width >= 1060) return "column";
  return null;
}

/**
 * Limits for a column (the editor's layout) of this height: the tree takes at least 220 px and
 * leaves the annotation panel at least 160 px. `fallback` is the least the tree has while unset,
 * as the rows of `.tree-open` give it: max(50%, min(400px, 60%)).
 */
export function treeHeightLimits(columnHeight: number): SidebarLimits {
  const limits = { min: TREE_MIN_HEIGHT, max: Math.max(TREE_MIN_HEIGHT, Math.floor(columnHeight - INSPECTOR_MIN_HEIGHT)), fallback: TREE_MIN_HEIGHT };
  return { ...limits, fallback: clampSidebarWidth(Math.max(columnHeight * 0.5, Math.min(400, columnHeight * 0.6)), limits) };
}

interface Measured {
  /** Height of the layout the tree and the annotation panel share. */
  column: number;
  /** Height of the tree on screen; 0 while it is not shown. */
  tree: number;
  layout: SharedLayout;
}

function measured(): Measured {
  const host = typeof document === "undefined" ? null : document.getElementById(TREE_HOST_ID);
  const column = host?.parentElement?.getBoundingClientRect().height ?? 0;
  return {
    column: column > 0 ? column : Math.max(0, (typeof window === "undefined" ? 720 : window.innerHeight) - CHROME_HEIGHT),
    tree: host?.getBoundingClientRect().height ?? 0,
    layout: sharedLayout(),
  };
}

/**
 * `walk`: what tells one docked tree from the next (each walk mounts a new host element), or null
 * while no tree is shown. The column and the tree are measured while one is.
 */
export function useTreeHeight(username: string | undefined, walk: string | number | null) {
  const [box, setBox] = useState<Measured>(measured);
  const [stored, setStored] = useState<number | null>(() => (username ? readStoredWidth(username, treeHeightKey) : null));
  const storedRef = useRef(stored);
  const userRef = useRef(username);
  userRef.current = username;
  /** The state a drag started from, to return to when it is cancelled or nothing was moved. */
  const beforeDrag = useRef<{ stored: number | null; shown: number } | null>(null);

  const apply = useCallback((value: number | null) => {
    storedRef.current = value;
    setStored(value);
  }, []);

  // A different user brings their own height.
  const loadedFor = useRef(username);
  useEffect(() => {
    if (loadedFor.current === username) return;
    loadedFor.current = username;
    apply(username ? readStoredWidth(username, treeHeightKey) : null);
  }, [username, apply]);

  // The limits follow the room the column really has: the window, the header above it (which can wrap), and the tree itself.
  useLayoutEffect(() => {
    const update = () => setBox((previous) => {
      const next = measured();
      return next.column === previous.column && next.tree === previous.tree && next.layout === previous.layout ? previous : next;
    });
    update();
    window.addEventListener("resize", update);
    const host = document.getElementById(TREE_HOST_ID);
    const observer = walk !== null && host && typeof ResizeObserver !== "undefined" ? new ResizeObserver(update) : null;
    if (observer && host) {
      observer.observe(host);
      if (host.parentElement) observer.observe(host.parentElement);
    }
    return () => {
      window.removeEventListener("resize", update);
      observer?.disconnect();
    };
  }, [walk]);

  // Low or not, with hysteresis: kept across renders, decided anew only when the column is measured again.
  const lowRef = useRef<{ column: number; low: boolean }>({ column: -1, low: false });
  if (lowRef.current.column !== box.column) lowRef.current = { column: box.column, low: isLowLayout(box.column, lowRef.current.low) };
  /**
   * Where the open tree takes the panel's place in a low window: "column" (three columns, the panel
   * shrinks to one line above the tree) or "beside" (a phone in landscape, the tree beside the text).
   */
  const low: SharedLayout = box.layout === "beside" ? "beside" : box.layout === "column" && lowRef.current.low ? "column" : null;

  const limits = treeHeightLimits(box.column);
  const limitsRef = useRef(limits);
  limitsRef.current = limits;
  const height = stored === null ? null : clampSidebarWidth(stored, limits);
  /** What the divider reports and starts from: the set height, or the height the layout gives the tree. */
  const value = height ?? (box.tree > 0 ? clampSidebarWidth(box.tree, limits) : limits.fallback);

  /** The tree's height on screen (the layout's own before the first change). */
  const measure = useCallback(() => {
    if (storedRef.current !== null) return clampSidebarWidth(storedRef.current, limitsRef.current);
    const tree = measured().tree;
    return tree > 0 ? clampSidebarWidth(tree, limitsRef.current) : limitsRef.current.fallback;
  }, []);
  const setHeight = useCallback((next: number) => apply(Math.round(next)), [apply]);
  const reset = useCallback(() => {
    beforeDrag.current = null;
    apply(null);
    if (userRef.current) clearStoredWidth(userRef.current, treeHeightKey);
  }, [apply]);
  const commit = useCallback((source: SidebarCommitSource) => {
    if (source === "drag-start") {
      beforeDrag.current = { stored: storedRef.current, shown: measure() };
      return;
    }
    const before = beforeDrag.current;
    beforeDrag.current = null;
    if (source === "drag-cancel") {
      // Storage was not written during the drag: it is where it was.
      if (before) apply(before.stored);
      return;
    }
    // A click on the divider that moved nothing does not turn the layout's own split into a fixed height.
    if (source === "drag" && before && before.stored === null && storedRef.current === before.shown) {
      apply(null);
      return;
    }
    const user = userRef.current;
    if (user && storedRef.current !== null) writeStoredWidth(user, clampSidebarWidth(storedRef.current, limitsRef.current), treeHeightKey);
  }, [apply, measure]);
  return { height, value, limits, setHeight, reset, commit, measure, low };
}
