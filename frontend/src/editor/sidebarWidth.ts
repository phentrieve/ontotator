import { useCallback, useEffect, useRef, useState } from "react";

/** Width rules of the resizable findings column (spec section 10). */
export interface SidebarLimits {
  min: number;
  max: number;
  fallback: number;
}

/**
 * Where the commit came from: a drag end writes at once, keys are debounced. A drag start
 * suspends a pending key write; a cancelled drag writes the restored width only if that
 * suspended key write had not happened yet, so storage ends where it was before the drag.
 */
export type SidebarCommitSource = "drag" | "key" | "drag-start" | "drag-cancel";

const MIN_WIDTH = 220;
const MAX_WIDTH = 480;
const TWO_COLUMN_MAX_VIEWPORT = 1024;
/**
 * Inspector width of the three-column layout, as `--inspector-width` in editor.css:
 * clamp(380px, 380px + (100vw - 1440px) * 0.35, 520px), and at least 420 px while it holds the guidelines.
 */
export const INSPECTOR_WIDTH = { min: 380, max: 520, from: 1440, slope: 0.35, withGuidelines: 420 } as const;
const TEXT_RESERVE = 420;
/** Default findings width above 1024 px: clamp(260, 260 + (viewport - 1280) * 0.25, 340). */
const DEFAULT_WIDTH = { twoColumns: 220, min: 260, max: 340, from: 1280, slope: 0.25 } as const;
const KEY_COMMIT_DELAY_MS = 300;

export function storageKey(username: string): string {
  return `ontotator.editor.sidebarWidth.v1:${username}`;
}

const clamp = (min: number, value: number, max: number) => Math.min(max, Math.max(min, value));

/** Width of the inspector column at this viewport width (0 in the two-column layout). */
export function inspectorWidth(viewport: number, withGuidelines = false): number {
  if (viewport <= TWO_COLUMN_MAX_VIEWPORT) return 0;
  const { min, max, from, slope } = INSPECTOR_WIDTH;
  const width = clamp(min, min + (viewport - from) * slope, max);
  return withGuidelines ? Math.max(INSPECTOR_WIDTH.withGuidelines, width) : width;
}

/** Default findings width: 220 px up to 1024 px, then 260 at 1280, 300 at 1440 and 340 from 1600 px. */
export function defaultSidebarWidth(viewport: number): number {
  if (viewport <= TWO_COLUMN_MAX_VIEWPORT) return DEFAULT_WIDTH.twoColumns;
  const { min, max, from, slope } = DEFAULT_WIDTH;
  return Math.round(clamp(min, min + (viewport - from) * slope, max));
}

export function sidebarLimits({ viewport, inspector }: { viewport: number; inspector: number }): SidebarLimits {
  const twoColumns = viewport <= TWO_COLUMN_MAX_VIEWPORT;
  const share = Math.floor(viewport * 0.35);
  const max = twoColumns
    ? Math.min(MAX_WIDTH, share)
    : Math.min(MAX_WIDTH, share, Math.floor(viewport - inspector - TEXT_RESERVE));
  return { min: MIN_WIDTH, max: Math.max(MIN_WIDTH, max), fallback: defaultSidebarWidth(viewport) };
}

export function clampSidebarWidth(value: number, limits: SidebarLimits): number {
  return Math.round(Math.min(limits.max, Math.max(limits.min, value)));
}

function storage(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

export function readStoredWidth(username: string): number | null {
  const raw = storage()?.getItem(storageKey(username));
  if (raw == null || !/^\d+$/.test(raw.trim())) return null;
  const value = Number(raw);
  return Number.isFinite(value) && Number.isInteger(value) && value > 0 ? value : null;
}

export function writeStoredWidth(username: string, value: number): void {
  try {
    storage()?.setItem(storageKey(username), String(Math.round(value)));
  } catch {
    // Storage full or blocked: the width simply is not remembered.
  }
}

export function clearStoredWidth(username: string): void {
  try {
    storage()?.removeItem(storageKey(username));
  } catch {
    // Ignore blocked storage.
  }
}

function currentLimits(withGuidelines = false): SidebarLimits {
  const viewport = typeof window === "undefined" ? 1280 : window.innerWidth;
  return sidebarLimits({ viewport, inspector: inspectorWidth(viewport, withGuidelines) });
}

const sameLimits = (a: SidebarLimits, b: SidebarLimits) => a.min === b.min && a.max === b.max && a.fallback === b.fallback;

export interface SidebarWidthState {
  width: number;
  limits: SidebarLimits;
  setWidth: (value: number) => void;
  commit: (source?: SidebarCommitSource) => void;
  reset: () => void;
}

/**
 * Preferred findings-column width per user. The stored value is applied clamped to the
 * current limits; it is written after a drag end or 300 ms after the last key, never
 * during render. Reset removes the stored key. `inspectorWithGuidelines`: the inspector
 * holds the guidelines (at least 420 px), which lowers the maximum.
 */
export function useSidebarWidth(username: string | undefined, { inspectorWithGuidelines = false } = {}): SidebarWidthState {
  const [limits, setLimits] = useState<SidebarLimits>(() => currentLimits(inspectorWithGuidelines));
  const guidelinesRef = useRef(inspectorWithGuidelines);
  guidelinesRef.current = inspectorWithGuidelines;
  const [preferred, setPreferred] = useState<number | null>(() => (username ? readStoredWidth(username) : null));
  const preferredRef = useRef(preferred);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** A key write was pending when a drag started; it is owed if the drag is cancelled. */
  const suspendedKeyWrite = useRef(false);
  const userRef = useRef(username);
  userRef.current = username;

  // A different user brings their own preference.
  const loadedFor = useRef(username);
  useEffect(() => {
    if (loadedFor.current === username) return;
    loadedFor.current = username;
    const stored = username ? readStoredWidth(username) : null;
    preferredRef.current = stored;
    setPreferred(stored);
  }, [username]);

  useEffect(() => {
    const update = () => setLimits((previous) => {
      const next = currentLimits(guidelinesRef.current);
      return sameLimits(next, previous) ? previous : next;
    });
    update();
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, [inspectorWithGuidelines]);

  const clearTimer = useCallback(() => {
    if (timer.current != null) {
      clearTimeout(timer.current);
      timer.current = null;
    }
  }, []);
  const setWidth = useCallback((value: number) => {
    const next = Math.round(value);
    preferredRef.current = next;
    setPreferred(next);
  }, []);

  const write = useCallback(() => {
    timer.current = null;
    const user = userRef.current;
    const value = preferredRef.current;
    if (user && value != null) writeStoredWidth(user, clampSidebarWidth(value, currentLimits(guidelinesRef.current)));
  }, []);
  // Unmount: a pending keyboard write is flushed, not dropped (a drag in progress is not committed).
  useEffect(() => () => {
    const owed = timer.current != null;
    clearTimer();
    if (owed) write();
  }, [clearTimer, write]);

  const commit = useCallback((source: SidebarCommitSource = "drag") => {
    if (source === "drag-start") {
      if (timer.current != null) suspendedKeyWrite.current = true;
      clearTimer();
      return;
    }
    clearTimer();
    const owed = suspendedKeyWrite.current;
    suspendedKeyWrite.current = false;
    if (source === "key") timer.current = setTimeout(write, KEY_COMMIT_DELAY_MS);
    else if (source === "drag" || owed) write();
  }, [clearTimer, write]);

  const reset = useCallback(() => {
    clearTimer();
    suspendedKeyWrite.current = false;
    preferredRef.current = null;
    setPreferred(null);
    if (userRef.current) clearStoredWidth(userRef.current);
  }, [clearTimer]);

  const width = clampSidebarWidth(preferred ?? limits.fallback, limits);
  return { width, limits, setWidth, commit, reset };
}
