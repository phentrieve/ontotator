/**
 * Named highlights over text ranges (CSS Custom Highlight API): find hits are painted over the text without
 * changing its DOM, so the editor's mirror keeps its exact characters and selection still works. Each pane owns
 * its ranges; a name paints the ranges of all panes. Browsers without the API draw nothing, and the find bar
 * still gives the counts in words (from the prototype of issue 533).
 */
export type HighlightName = "review-find" | "review-find-current";

/** Higher paints over lower: the current hit over the others. */
const PRIORITY: Record<HighlightName, number> = { "review-find": 0, "review-find-current": 1 };

type Registry = { set(name: string, value: unknown): void; delete(name: string): boolean };
const owned = new Map<HighlightName, Map<string, Range[]>>();

function registry(): { highlights: Registry; create: (ranges: Range[], priority: number) => unknown } | null {
  const css = (globalThis as { CSS?: { highlights?: Registry } }).CSS;
  const Highlight = (globalThis as { Highlight?: new (...ranges: Range[]) => { priority: number } }).Highlight;
  return css?.highlights && Highlight ? { highlights: css.highlights, create: (ranges, priority) => Object.assign(new Highlight(...ranges), { priority }) } : null;
}

export function setHighlight(name: HighlightName, owner: string, ranges: readonly Range[]): void {
  const panes = owned.get(name) ?? new Map<string, Range[]>();
  owned.set(name, panes);
  if (ranges.length) panes.set(owner, [...ranges]); else panes.delete(owner);
  const api = registry();
  if (!api) return;
  const all = [...panes.values()].flat();
  if (all.length) api.highlights.set(name, api.create(all, PRIORITY[name])); else api.highlights.delete(name);
}

export function clearHighlights(owner: string, names: readonly HighlightName[]): void {
  for (const name of names) setHighlight(name, owner, []);
}
