import { forwardRef, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { IconChevronLeft, IconChevronRight, IconClose } from "../ui/icons";
import { IconButton } from "../ui/IconButton";
import { clearHighlights, setHighlight } from "./highlights";
import { indexText, rangeAt, type TextIndex } from "./textRanges";
import "./translation.css";

/** One text the bar searches: its scrolling pane and the text that pane shows (the proposed text of a change view). */
export interface FindPane { id: string; name: string; element: HTMLElement | null; text: string }
export interface FindHit { pane: string; start: number; end: number }
export interface FindBarHandle { focus: (initial?: string) => void; hasFocus: () => boolean }

const escape = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Every case-insensitive occurrence of `needle` in `text`, in UTF-16 offsets; none for an empty needle. */
export function findMatches(text: string, needle: string): { start: number; end: number }[] {
  if (!needle) return [];
  const found: { start: number; end: number }[] = [];
  for (const match of text.matchAll(new RegExp(escape(needle), "giu"))) {
    const start = match.index ?? 0;
    found.push({ start, end: start + match[0].length });
  }
  return found;
}

/** The node that holds a pane's characters: the editor's mirror behind its textarea, else the pane itself. */
const textRootOf = (pane: HTMLElement): Element => pane.querySelector(".translation-editor-mirror") ?? pane;

/** Brings a hit into the visible part of its scrolling pane, a third from the top, without moving focus. */
function reveal(range: Range, pane: HTMLElement) {
  pane.scrollIntoView?.({ block: "nearest" });
  const rect = range.getBoundingClientRect?.(), box = pane.getBoundingClientRect();
  if (!rect || (rect.top >= box.top && rect.bottom <= box.bottom)) return;
  pane.scrollTop += rect.top - box.top - box.height / 3;
}

/**
 * Find in the texts of the review (Ctrl+F or Cmd+F): searches every column that is shown, in the texts as they read,
 * also inside the editable translation; all hits are highlighted, the current one is scrolled into view in its own
 * pane. Pressing Ctrl+F again in the bar opens the browser's own find.
 */
export const FindBar = forwardRef<FindBarHandle, { panes: readonly FindPane[]; onClose: (hit: FindHit | null) => void }>(function FindBar({ panes, onClose }, ref) {
  const input = useRef<HTMLInputElement | null>(null);
  const [query, setQuery] = useState(""), [current, setCurrent] = useState(0);
  const wantScroll = useRef(false);
  useImperativeHandle(ref, () => ({
    focus: initial => {
      if (initial) { setQuery(initial); setCurrent(0); wantScroll.current = true; }
      input.current?.focus(); input.current?.select();
    },
    hasFocus: () => document.activeElement === input.current,
  }), []);
  const texts = panes.map(pane => `${pane.id}\u0000${pane.text}`).join("\u0001");
  // eslint-disable-next-line react-hooks/exhaustive-deps -- `texts` stands for the panes' texts.
  const hits = useMemo<FindHit[]>(() => panes.flatMap(pane => findMatches(pane.text, query).map(match => ({ pane: pane.id, ...match }))), [texts, query]);
  const index = hits.length ? Math.min(current, hits.length - 1) : -1;
  // Every render: the panes may have drawn their text anew (an edit, another view), which leaves old ranges empty.
  useLayoutEffect(() => {
    const indexes = new Map<string, TextIndex>();
    const ranges = hits.map(hit => {
      const pane = panes.find(row => row.id === hit.pane)?.element;
      if (!pane) return null;
      const text = indexes.get(hit.pane) ?? indexText(textRootOf(pane));
      indexes.set(hit.pane, text);
      return rangeAt(text, hit.start, hit.end);
    });
    setHighlight("review-find", "find", ranges.filter((range, i): range is Range => range !== null && i !== index));
    setHighlight("review-find-current", "find", index >= 0 && ranges[index] ? [ranges[index]!] : []);
    const pane = index >= 0 ? panes.find(row => row.id === hits[index].pane)?.element : null;
    if (wantScroll.current && pane && ranges[index]) reveal(ranges[index]!, pane);
    wantScroll.current = false;
  });
  useLayoutEffect(() => () => clearHighlights("find", ["review-find", "review-find-current"]), []);
  const step = (by: number) => {
    if (!hits.length) return;
    wantScroll.current = true;
    setCurrent((index + by + hits.length) % hits.length);
  };
  const keyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter" && !event.ctrlKey && !event.metaKey) { event.preventDefault(); step(event.shiftKey ? -1 : 1); }
    else if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); onClose(index >= 0 ? hits[index] : null); }
  };
  const perPane = panes.map(pane => ({ name: pane.name, count: hits.filter(hit => hit.pane === pane.id).length }));
  const status = !query ? "" : !hits.length ? "No results" : `${index + 1} of ${hits.length}`;
  return <div className="find-bar" role="search" aria-label="Find in the texts">
    <input ref={input} type="search" className="form-control find-bar-input" aria-label="Find in the texts" placeholder="Find in the texts" value={query}
      onChange={event => { setQuery(event.target.value); setCurrent(0); wantScroll.current = true; }} onKeyDown={keyDown} />
    <span className="find-bar-status" role="status">{status}{query && hits.length > 0 && <span className="find-bar-panes">{perPane.map(row => `${row.name} ${row.count}`).join(" · ")}</span>}</span>
    <IconButton size="sm" variant="quiet" label="Previous result (Shift+Enter)" icon={<IconChevronLeft />} disabled={!hits.length} onClick={() => step(-1)} />
    <IconButton size="sm" variant="quiet" label="Next result (Enter)" icon={<IconChevronRight />} disabled={!hits.length} onClick={() => step(1)} />
    <IconButton size="sm" variant="quiet" label="Close find (Escape)" icon={<IconClose />} onClick={() => onClose(index >= 0 ? hits[index] : null)} />
  </div>;
});
