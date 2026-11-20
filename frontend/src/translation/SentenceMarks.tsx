import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent, type MouseEvent } from "react";
import { IconCheck } from "../ui/icons";
import { clearHighlights, setHighlight } from "./highlights";
import { isChecked, type MarkState, type Sentence } from "./sentences";
import { firstLine, indexText, rangeAt } from "./textRanges";
import "./translation.css";

export interface SentenceGutterProps {
  /** One gutter per side: its highlights are kept apart from the other side's. */
  owner: "source" | "translation";
  sentences: readonly Sentence[];
  states: readonly MarkState[];
  label: string;
  disabled?: boolean;
  /** Changes whenever the text may lay out anew without new sentences (invisible characters, another view). */
  layoutKey?: unknown;
  /** Toggles one sentence. */
  onToggle: (index: number) => void;
  /** Sets the sentences from `from` to `to` to checked or unchecked. */
  onRange: (from: number, to: number, checked: boolean) => void;
}

/** Up to three markers side by side and two rows fit beside one line; more sentences on one line overlap. */
const COLUMNS = 3, MARKER = 14, GAP = 2;
type Place = { top: number; left: number };

/** The text the gutter stands beside: the editor's mirror, else the pane itself. */
const textRootOf = (gutter: HTMLElement): Element | null => {
  const host = gutter.parentElement;
  return host?.querySelector(":scope > .translation-editor-mirror") ?? host;
};

const preview = (text: string) => text.length > 60 ? `${text.slice(0, 57)}…` : text;

/**
 * Mark checked sentences (issue 256) beside a text that stays as it is: editable in the editor, selectable in every
 * view. One marker per sentence stands in the margin at the sentence's first line; checked and changed sentences
 * are tinted in the text itself. A click on a marker toggles its sentence, Shift+click marks the range from the
 * last marker used; the markers are one Tab stop, the arrow keys move between them.
 */
export function SentenceGutter({ owner, sentences, states, label, disabled = false, layoutKey, onToggle, onRange }: SentenceGutterProps): JSX.Element {
  const ref = useRef<HTMLDivElement | null>(null);
  const ranges = useRef<(Range | null)[]>([]);
  const [places, setPlaces] = useState<(Place | null)[]>([]);
  const [active, setActive] = useState(0);
  const anchor = useRef<number | null>(null);
  useLayoutEffect(() => {
    const gutter = ref.current, root = gutter && textRootOf(gutter);
    if (!gutter || !root) return;
    const measure = () => {
      const index = indexText(root);
      const found = sentences.map(sentence => rangeAt(index, sentence.start, sentence.end));
      ranges.current = found;
      const lines = found.map(range => range ? firstLine(range, gutter) : null);
      // Sentences whose first lines share a line box share its margin.
      const groups: { top: number; height: number; members: number[] }[] = [];
      lines.forEach((line, i) => {
        if (!line) return;
        const group = groups.find(row => Math.abs(row.top - line.top) < 4);
        if (group) group.members.push(i); else groups.push({ top: line.top, height: line.height, members: [i] });
      });
      const next: (Place | null)[] = sentences.map(() => null);
      for (const group of groups) {
        const rows = Math.ceil(group.members.length / COLUMNS), height = rows * MARKER + (rows - 1) * GAP;
        group.members.forEach((member, slot) => {
          next[member] = { top: group.top + Math.max(0, (group.height - height) / 2) + Math.floor(slot / COLUMNS) * (MARKER + GAP), left: GAP + (slot % COLUMNS) * (MARKER + GAP) };
        });
      }
      setPlaces(next);
      setHighlight("review-checked", owner, found.filter((range, i): range is Range => range !== null && isChecked(states[i])));
      setHighlight("review-stale", owner, found.filter((range, i): range is Range => range !== null && states[i]?.kind === "stale"));
      // A tint paints over the text's own change marks: the changes are painted again above it.
      const changes = (selector: string) => Array.from(root.querySelectorAll(selector), element => { const range = document.createRange(); range.selectNodeContents(element); return range; });
      setHighlight("review-insert", owner, changes("ins"));
      setHighlight("review-delete", owner, changes("del"));
    };
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(root);
    return () => observer.disconnect();
  }, [owner, sentences, states, layoutKey]);
  useEffect(() => () => clearHighlights(owner, ["review-checked", "review-stale", "review-sentence-hover", "review-insert", "review-delete"]), [owner]);
  useEffect(() => { if (active >= sentences.length) setActive(Math.max(0, sentences.length - 1)); }, [active, sentences.length]);
  const hover = (index: number | null) => {
    const range = index === null ? null : ranges.current[index];
    setHighlight("review-sentence-hover", owner, range ? [range] : []);
  };
  const markerOf = (index: number) => ref.current?.querySelector<HTMLElement>(`[data-sentence="${index}"]`);
  const apply = (index: number, range: boolean) => {
    if (disabled) return;
    if (range && anchor.current !== null) onRange(anchor.current, index, true); else onToggle(index);
    anchor.current = index; setActive(index);
  };
  const click = (event: MouseEvent<HTMLButtonElement>, index: number) => { event.preventDefault(); apply(index, event.shiftKey); };
  const keyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const index = Number((event.target as HTMLElement).dataset.sentence);
    if (!Number.isInteger(index)) return;
    // Ctrl+Enter is the screen's submit shortcut, not a mark.
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    const last = sentences.length - 1;
    const to = { ArrowDown: index + 1, ArrowRight: index + 1, ArrowUp: index - 1, ArrowLeft: index - 1, Home: 0, End: last }[event.key];
    if (to !== undefined) {
      event.preventDefault();
      const next = Math.max(0, Math.min(last, to));
      setActive(next); markerOf(next)?.focus(); hover(next);
      return;
    }
    if (event.key === "Enter" || event.key === " ") { event.preventDefault(); apply(index, event.shiftKey); }
  };
  return <div ref={ref} className="sentence-gutter" data-gutter="" role="group" aria-label={label} onKeyDown={keyDown}>
    {sentences.map(sentence => {
      const state = states[sentence.index], place = places[sentence.index], stale = state?.kind === "stale";
      const name = `Sentence ${sentence.index + 1}: ${preview(sentence.text)}${stale ? " (changed since checked)" : ""}`;
      return <button key={sentence.index} type="button" data-sentence={sentence.index} aria-pressed={isChecked(state)} aria-label={name}
        aria-disabled={disabled || undefined} title={stale ? "Changed since checked" : isChecked(state) ? "Checked" : "Mark as checked"}
        tabIndex={sentence.index === active ? 0 : -1}
        className={["sentence-marker", isChecked(state) && "is-checked", stale && "is-stale"].filter(Boolean).join(" ")}
        style={place ? { top: place.top, left: place.left } : undefined}
        onClick={event => click(event, sentence.index)} onMouseDown={event => { if (event.shiftKey) event.preventDefault(); }}
        onPointerEnter={() => hover(sentence.index)} onPointerLeave={() => hover(null)}
        onFocus={() => { setActive(sentence.index); hover(sentence.index); }} onBlur={() => hover(null)}>
        {isChecked(state) && <IconCheck />}
      </button>;
    })}
  </div>;
}

/** Counts of one side. */
export interface SideCount { checked: number; total: number; stale: number }

/** How far one side is, in its column head. */
export function SentenceCount({ name, count }: { name: string; count: SideCount }): JSX.Element {
  return <p className="sentence-count" role="status"><span className="review-sr-only">{`${name}: `}</span><strong>{count.checked}</strong>{` of ${count.total} checked`}
    {count.stale > 0 && <span title="Changed since checked">{` · ${count.stale} changed`}</span>}</p>;
}
