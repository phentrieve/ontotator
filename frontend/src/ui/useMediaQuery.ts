import { useCallback, useSyncExternalStore } from "react";

function supported(): boolean {
  return typeof window !== "undefined" && typeof window.matchMedia === "function";
}

/** Whether a CSS media query matches; false where `matchMedia` is unavailable (jsdom, SSR). */
export function useMediaQuery(query: string): boolean {
  const subscribe = useCallback((onChange: () => void) => {
    if (!supported()) return () => {};
    const list = window.matchMedia(query);
    list.addEventListener("change", onChange);
    return () => list.removeEventListener("change", onChange);
  }, [query]);
  const getSnapshot = useCallback(() => supported() && window.matchMedia(query).matches, [query]);
  return useSyncExternalStore(subscribe, getSnapshot, () => false);
}

/** A touch screen without a mouse or a keyboard focus ring to speak of (as the CSS rules for touch use). */
export const TOUCH_ONLY = "(hover: none) and (pointer: coarse)";

/** Whether the device is touch-only: its hints say "tap" and leave out keys (issue 612). */
export function useTouchOnly(): boolean {
  return useMediaQuery(TOUCH_ONLY);
}
