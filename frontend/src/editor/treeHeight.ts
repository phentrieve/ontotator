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
/** Shell header and case toolbar above the columns: an estimate, used only until the column is measured. */
const CHROME_HEIGHT = 108;

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
}

function measured(): Measured {
  const host = typeof document === "undefined" ? null : document.getElementById(TREE_HOST_ID);
  const column = host?.parentElement?.getBoundingClientRect().height ?? 0;
  return {
    column: column > 0 ? column : Math.max(0, (typeof window === "undefined" ? 720 : window.innerHeight) - CHROME_HEIGHT),
    tree: host?.getBoundingClientRect().height ?? 0,
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
      return next.column === previous.column && next.tree === previous.tree ? previous : next;
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
  return { height, value, limits, setHeight, reset, commit, measure };
}
