import { useEffect, useRef, type KeyboardEvent, type PointerEvent } from "react";
import { useShortcutHint } from "../ui/shortcuts";
import { clampSidebarWidth, type SidebarCommitSource, type SidebarLimits } from "./sidebarWidth";

const STEP = 16;
const LARGE_STEP = 64;

export interface SidebarResizerProps {
  width: number;
  limits: SidebarLimits;
  /** id of the sidebar element this separator resizes. */
  controls: string;
  onChange: (width: number) => void;
  onReset: () => void;
  onCommit: (source: SidebarCommitSource) => void;
  /** Accessible name (default "Resize findings column"). */
  label?: string;
  /** Keyboard help entry (default "Resize the findings column (focus the divider)"). */
  hint?: string;
  /**
   * Edge of the panel the divider sits on: "end" (default, the findings column on the left: moving right widens it)
   * or "start" (a panel on the right, such as "Your review": moving left widens it).
   */
  side?: "start" | "end";
  /**
   * "vertical" (default): a divider between two columns, dragged left and right.
   * "horizontal": a divider between two rows, dragged up and down (↑ / ↓); `width` is then the
   * height of the panel, and "start" means the panel lies below the divider (moving up enlarges it).
   */
  orientation?: "vertical" | "horizontal";
  /** The panel's size as it is on screen, when `width` is only a default until the first change. */
  measure?: () => number;
}

interface Drag {
  pointerId: number;
  /** Pointer position on the drag axis at the start. */
  startX: number;
  startWidth: number;
  latest: number;
}

/** Vertical separator between the findings column and the text pane (spec section 10). */
export function SidebarResizer({ width, limits, controls, onChange, onReset, onCommit, label = "Resize findings column",
  hint = "Resize the findings column (focus the divider)", side = "end", orientation = "vertical", measure }: SidebarResizerProps) {
  const rows = orientation === "horizontal";
  const along = (event: PointerEvent<HTMLDivElement>) => (rows ? event.clientY : event.clientX);
  const drag = useRef<Drag | null>(null);
  const frame = useRef<number | null>(null);
  /** +1: moving right widens the panel; -1: moving left does. */
  const direction = side === "start" ? -1 : 1;

  useShortcutHint(
    [rows ? "↑ / ↓" : "← / →", rows ? "Shift + ↑ / ↓" : "Shift + ← / →", "Home / End", "Enter"],
    hint,
    { group: "Layout" },
  );

  const cancelFrame = () => {
    if (frame.current != null) {
      cancelAnimationFrame(frame.current);
      frame.current = null;
    }
  };
  useEffect(() => cancelFrame, []);

  const endDrag = (element: HTMLElement) => {
    const current = drag.current;
    drag.current = null;
    cancelFrame();
    if (current && element.hasPointerCapture?.(current.pointerId)) element.releasePointerCapture(current.pointerId);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Escape") {
      const current = drag.current;
      if (!current) return;
      event.preventDefault();
      endDrag(event.currentTarget);
      onChange(current.startWidth);
      onCommit("drag-cancel");
      return;
    }
    if (event.key === "Enter") {
      event.preventDefault();
      // End an active drag first so later movement or pointer-up cannot reapply its width.
      if (drag.current) endDrag(event.currentTarget);
      onReset();
      return;
    }
    let next: number | null = null;
    const step = event.shiftKey ? LARGE_STEP : STEP;
    const base = measure ? Math.round(measure()) : width;
    if (event.key === (rows ? "ArrowUp" : "ArrowLeft")) next = base - step * direction;
    else if (event.key === (rows ? "ArrowDown" : "ArrowRight")) next = base + step * direction;
    else if (event.key === "Home") next = limits.min;
    else if (event.key === "End") next = limits.max;
    if (next == null) return;
    event.preventDefault();
    onChange(clampSidebarWidth(next, limits));
    onCommit("key");
  };

  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (event.button !== undefined && event.button !== 0) return;
    event.preventDefault();
    event.currentTarget.focus();
    event.currentTarget.setPointerCapture?.(event.pointerId);
    const start = measure ? Math.round(measure()) : width;
    drag.current = { pointerId: event.pointerId, startX: along(event), startWidth: start, latest: start };
    onCommit("drag-start");
  };

  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    const current = drag.current;
    if (!current || event.pointerId !== current.pointerId || !Number.isFinite(along(event))) return;
    current.latest = clampSidebarWidth(current.startWidth + direction * (along(event) - current.startX), limits);
    if (frame.current != null) return;
    frame.current = requestAnimationFrame(() => {
      frame.current = null;
      if (drag.current) onChange(drag.current.latest);
    });
  };

  const onPointerUp = (event: PointerEvent<HTMLDivElement>) => {
    const current = drag.current;
    if (!current || event.pointerId !== current.pointerId) return;
    endDrag(event.currentTarget);
    onChange(current.latest);
    onCommit("drag");
  };

  const onPointerCancel = (event: PointerEvent<HTMLDivElement>) => {
    const current = drag.current;
    if (!current || event.pointerId !== current.pointerId) return;
    endDrag(event.currentTarget);
    onChange(current.startWidth);
    onCommit("drag-cancel");
  };

  return (
    <div
      className={rows ? "sidebar-resizer sidebar-resizer--rows" : "sidebar-resizer"}
      role="separator"
      aria-orientation={orientation}
      aria-controls={controls}
      aria-label={label}
      aria-valuenow={width}
      aria-valuemin={limits.min}
      aria-valuemax={limits.max}
      aria-valuetext={`${width} pixels (default ${limits.fallback})`}
      tabIndex={0}
      onKeyDown={onKeyDown}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerCancel}
      onDoubleClick={onReset}
    >
      <span className="sidebar-resizer-grip" aria-hidden="true" />
    </div>
  );
}
