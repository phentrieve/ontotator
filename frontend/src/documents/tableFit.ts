import { useLayoutEffect, type DependencyList, type RefObject } from "react";

/** Columns that have a wide and a narrow form; their cells carry `data-stage`. */
export const FIT_COLUMNS = ["review", "annotation", "final", "waiting"] as const;
export type FitColumn = typeof FIT_COLUMNS[number];

/** The words the table shows: columns in their wide form, flags as icons, a crowded Text cell on two lines. */
export interface Fit { wide: readonly FitColumn[]; compact: boolean; wrap: boolean }

/** The cells that must never be cut while a form still fits. */
const CUTTABLE = ".documents-status, .documents-waiting-on, .waiting-name";

/** The table fits its scroll box and no status or Waiting on cell is cut. */
export function tableFits(scroller: HTMLElement, table: HTMLElement): boolean {
  if (scroller.scrollWidth > scroller.clientWidth) return false;
  for (const element of table.querySelectorAll<HTMLElement>(CUTTABLE)) {
    if (element.getClientRects().length && element.scrollWidth > element.clientWidth + 1) return false;
  }
  return true;
}

export function applyFit(table: HTMLElement, fit: Fit): void {
  table.setAttribute("data-wide", fit.wide.join(" "));
  table.classList.toggle("documents-table--compact", fit.compact);
  table.classList.toggle("documents-table--wrap", fit.wrap);
}

/** Width of a column's widest cell in the current form. */
const columnWidth = (table: HTMLElement, column: FitColumn): number =>
  Math.max(0, ...[...table.querySelectorAll<HTMLElement>(`[data-stage="${column}"]`)].map(cell => cell.scrollWidth));

/**
 * How much the Documents table says per cell (issues 519, 544): as much as fits the page without sideways scroll and
 * without a cut status or Waiting on cell. It starts with every column in its wide form (the full states with their
 * people, "assigned, not started (Ana Weber)"; every waiting person) and gives up, one step at a time, until the
 * table fits: first the Text cell's "Paused by lead" and "Typography hints" become icons, then the widest column
 * takes its narrow form ("not started"; one name and "+n"), then the next; last, a crowded Text cell takes a second
 * line. When nothing fits (below 1280 px) the table scrolls sideways with the Text column pinned.
 * The choice follows the content, not a window width: a short page shows every word at 1440 px, a crowded one
 * takes the narrow form at 1920 px. Without layout (unit tests) every column stays wide.
 */
export function fitTable(scroller: HTMLElement): Fit | null {
  const table = scroller.querySelector<HTMLElement>("table");
  if (!table) return null;
  let fit: Fit = { wide: FIT_COLUMNS, compact: false, wrap: false };
  applyFit(table, fit);
  if (!scroller.clientWidth || tableFits(scroller, table)) return fit;
  const widest = [...FIT_COLUMNS].sort((a, b) => columnWidth(table, b) - columnWidth(table, a));
  const steps: ((current: Fit) => Fit)[] = [
    current => ({ ...current, compact: true }),
    ...widest.map(column => (current: Fit) => ({ ...current, wide: current.wide.filter(item => item !== column) })),
    current => ({ ...current, wrap: true }),
  ];
  for (const step of steps) {
    fit = step(fit);
    applyFit(table, fit);
    if (tableFits(scroller, table)) break;
  }
  // The narrow columns may have made room for the flags' words again (a wrapped Text cell always keeps the icons).
  if (fit.compact && !fit.wrap && tableFits(scroller, table)) {
    applyFit(table, { ...fit, compact: false });
    if (tableFits(scroller, table)) return { ...fit, compact: false };
    applyFit(table, fit);
  }
  return fit;
}

/**
 * Fits the table in `scrollRef` again whenever its box changes width, the fonts finish loading or `deps` change
 * (new rows, another tab). It sets the table's attribute and classes directly and before paint, so no form flashes.
 */
export function useTableFit(scrollRef: RefObject<HTMLElement>, deps: DependencyList): void {
  useLayoutEffect(() => {
    const scroller = scrollRef.current;
    if (!scroller) return;
    let width = -1;
    const fit = () => { width = scroller.clientWidth; fitTable(scroller); };
    fit();
    let active = true;
    void document.fonts?.ready.then(() => { if (active) fit(); });
    if (typeof ResizeObserver === "undefined") return () => { active = false; };
    // Height changes (rows loading below) do not change the fit; only a new width does.
    const observer = new ResizeObserver(() => { if (scroller.clientWidth !== width) fit(); });
    observer.observe(scroller);
    return () => { active = false; observer.disconnect(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the caller names what the fit depends on
  }, deps);
}
