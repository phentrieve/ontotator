import { useCallback, useState } from "react";
import { INSPECTOR_WIDTH, inspectorWidth, type SidebarLimits } from "./sidebarWidth";

/**
 * The editor's right column as a rail (issue 540), as "Your review" in the translation review (issue 410): from
 * 1060 px (three columns) it can be resized by dragging its left edge and collapsed to a narrow strip. Both are
 * remembered per user in this browser. The column holds the annotation panel and, while it is open, the ontology tree.
 */
export const detailsWidthKey = (username: string) => `ontotator.editor.detailsWidth.v1:${username}`;
export const detailsCollapsedKey = (username: string) => `ontotator.editor.detailsCollapsed.v1:${username}`;

/** The least the column takes: 320 px, or the 420 px the guidelines need while it holds them. */
export const DETAILS_MIN_WIDTH = 320;
/** The most it takes: 640 px, and never so much that the text gets less than 420 px beside a 220 px findings column. */
export const DETAILS_MAX_WIDTH = 640;
const TEXT_AND_FINDINGS = 420 + 220;
/** Width of the collapsed strip, as the translation review's. */
export const DETAILS_STRIP_WIDTH = 44;

/** Limits of the column at this viewport width; the default is the width it had before it could be resized. */
export function detailsRailLimits(viewport: number, withGuidelines: boolean): SidebarLimits {
  const min = withGuidelines ? INSPECTOR_WIDTH.withGuidelines : DETAILS_MIN_WIDTH;
  const max = Math.max(min, Math.min(DETAILS_MAX_WIDTH, Math.floor(viewport - TEXT_AND_FINDINGS)));
  return { min, max, fallback: Math.min(max, Math.max(min, Math.round(inspectorWidth(viewport, withGuidelines)))) };
}

function readCollapsed(username: string | undefined): boolean {
  if (!username) return false;
  try { return window.localStorage.getItem(detailsCollapsedKey(username)) === "1"; } catch { return false; }
}

/** Whether the column is collapsed, per user in this browser; blocked storage only means it is not remembered. */
export function useDetailsCollapsed(username: string | undefined): [boolean, (collapsed: boolean) => void] {
  const [state, setState] = useState(() => ({ username, collapsed: readCollapsed(username) }));
  // Another user brings their own choice.
  const current = state.username === username ? state : { username, collapsed: readCollapsed(username) };
  if (current !== state) setState(current);
  const set = useCallback((collapsed: boolean) => {
    setState({ username, collapsed });
    if (!username) return;
    try { window.localStorage.setItem(detailsCollapsedKey(username), collapsed ? "1" : "0"); } catch { /* Blocked storage: not remembered. */ }
  }, [username]);
  return [current.collapsed, set];
}
