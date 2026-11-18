import { useCallback, useEffect, useState } from "react";
import { clampSidebarWidth, type SidebarCommitSource, type SidebarLimits } from "./sidebarWidth";

/**
 * Height of the ontology tree under the inspector (three-column layout only). Unset (null), the
 * layout's own rows apply (editor.css); once dragged, the tree keeps that height in this browser.
 */
const STORAGE_KEY = "ontotator.editor.treeHeight.v1";
const MIN_HEIGHT = 160;
/** Room the inspector above keeps, with the header and toolbar of the screen. */
const INSPECTOR_RESERVE = 320;

export function treeHeightLimits(viewportHeight: number): SidebarLimits {
  const max = Math.max(MIN_HEIGHT, viewportHeight - INSPECTOR_RESERVE);
  return { min: MIN_HEIGHT, max, fallback: clampSidebarWidth(Math.round(viewportHeight * 0.5), { min: MIN_HEIGHT, max, fallback: MIN_HEIGHT }) };
}

const read = (): number | null => {
  try {
    const value = Number(window.localStorage.getItem(STORAGE_KEY));
    return Number.isFinite(value) && value > 0 ? value : null;
  } catch {
    return null;
  }
};

const write = (value: number | null) => {
  try {
    if (value === null) window.localStorage.removeItem(STORAGE_KEY);
    else window.localStorage.setItem(STORAGE_KEY, String(value));
  } catch { /* Blocked storage: the height lasts for this page only. */ }
};

export function useTreeHeight() {
  const [viewport, setViewport] = useState(() => window.innerHeight);
  const [stored, setStored] = useState<number | null>(read);
  useEffect(() => {
    const onResize = () => setViewport(window.innerHeight);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);
  const limits = treeHeightLimits(viewport);
  const height = stored === null ? null : clampSidebarWidth(stored, limits);
  const setHeight = useCallback((value: number) => setStored(value), []);
  const reset = useCallback(() => { setStored(null); write(null); }, []);
  const commit = useCallback((source: SidebarCommitSource) => {
    if (source === "drag-start") return;
    setStored(current => { write(current); return current; });
  }, []);
  /** The tree's height on screen (the layout's default before the first drag). */
  const measure = useCallback(() => {
    if (height !== null) return height;
    const element = document.getElementById("ontology-tree");
    return element ? clampSidebarWidth(element.getBoundingClientRect().height, limits) : limits.fallback;
  }, [height, limits]);
  return { height, value: height ?? limits.fallback, limits, setHeight, reset, commit, measure };
}
