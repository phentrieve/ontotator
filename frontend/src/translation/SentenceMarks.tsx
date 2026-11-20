import { forwardRef, useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent, type MouseEvent, type ReactNode } from "react";
import { IconCheck } from "../ui/icons";
import { paragraphStarts } from "../variants/paragraphs";
import { clearHighlights, setHighlight } from "./highlights";
import { invisibleNodes } from "./invisibles";
import { isChecked, type MarkState, type Sentence } from "./sentences";
import { firstLine, indexText, lastLine, rangeAt } from "./textRanges";
import "./translation.css";

interface MarkProps {
  sentences: readonly Sentence[];
  states: readonly MarkState[];
  label: string;
  disabled?: boolean;
  /** Toggles one sentence. */
  onToggle: (index: number) => void;
  /** Sets the sentences from `from` to `to` to checked or unchecked. */
  onRange: (from: number, to: number, checked: boolean) => void;
}

export interface SentenceMarkersProps extends MarkProps {
  /** One set of markers per side: its highlights are kept apart from the other side's. */
  owner: "source" | "translation";
  /** Changes whenever the text may lay out anew without new sentences (invisible characters, another view). */
  layoutKey?: unknown;
}

/** The circle's size in px; at a line start it ends this far before the sentence's first character. */
const SIZE = 8, MARGIN = 4;
type Place = { top: number; left: number };

/** The text the markers stand in: the editor's mirror, else the pane itself. */
const textRootOf = (overlay: HTMLElement): Element | null => {
  const host = overlay.parentElement;
  return host?.querySelector(":scope > .translation-editor-mirror") ?? host;
};

const preview = (text: string) => text.length > 60 ? `${text.slice(0, 57)}…` : text;
const stateName = (state: MarkState) => state?.kind === "stale" ? "Changed since checked" : isChecked(state) ? "Checked" : "Mark as checked";
const markerClass = (base: string, state: MarkState) => [base, isChecked(state) && "is-checked", state?.kind === "stale" && "is-stale"].filter(Boolean).join(" ");

/**
 * Click, Shift+click and the keys shared by both ways of showing the marks: one Tab stop per side, the arrow keys,
 * Home and End move between the markers, Enter or Space toggles, Shift with either marks the range from the last
 * marker used.
 */
function useMarkerKeys({ sentences, disabled, onToggle, onRange, container, onActive }: MarkProps & { container: () => HTMLElement | null; onActive?: (index: number | null) => void }) {
  const [active, setActive] = useState(0);
  const anchor = useRef<number | null>(null);
  useEffect(() => { if (active >= sentences.length) setActive(Math.max(0, sentences.length - 1)); }, [active, sentences.length]);
  const markerOf = (index: number) => container()?.querySelector<HTMLElement>(`[data-sentence="${index}"]`);
  const apply = (index: number, range: boolean) => {
    if (disabled) return;
    if (range && anchor.current !== null) onRange(anchor.current, index, true); else onToggle(index);
    anchor.current = index; setActive(index);
  };
  const keyDown = (event: KeyboardEvent<HTMLElement>) => {
    const index = Number((event.target as HTMLElement).dataset.sentence);
    if (!Number.isInteger(index)) return;
    // Ctrl+Enter is the screen's submit shortcut, not a mark.
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    const last = sentences.length - 1;
    const to = { ArrowDown: index + 1, ArrowRight: index + 1, ArrowUp: index - 1, ArrowLeft: index - 1, Home: 0, End: last }[event.key];
    if (to !== undefined) {
      event.preventDefault();
      const next = Math.max(0, Math.min(last, to));
      setActive(next); markerOf(next)?.focus(); onActive?.(next);
      return;
    }
    if (event.key === "Enter" || event.key === " ") { event.preventDefault(); apply(index, event.shiftKey); }
  };
  /** The props of the marker of sentence `index`. */
  const marker = (index: number, state: MarkState, text: string) => ({
    type: "button" as const, "data-sentence": index, "aria-pressed": isChecked(state),
    "aria-label": `Sentence ${index + 1}: ${preview(text)}${state?.kind === "stale" ? " (changed since checked)" : ""}`,
    "aria-disabled": disabled || undefined, title: stateName(state), tabIndex: index === active ? 0 : -1,
    onClick: (event: MouseEvent<HTMLButtonElement>) => { event.preventDefault(); apply(index, event.shiftKey); },
    // Shift+click must not extend a text selection; a plain press keeps the caret where it is in the editor.
    onMouseDown: (event: MouseEvent<HTMLButtonElement>) => { if (event.shiftKey) event.preventDefault(); },
    onFocus: () => { setActive(index); onActive?.(index); }, onBlur: () => onActive?.(null),
  });
  return { keyDown, marker };
}

/**
 * Mark checked sentences (issue 256) in a text that stays as it is: editable in the editor, selectable in every view.
 * A small circle stands right before each sentence, in the text: open, checked (green) or changed since checked
 * (half amber). The circles are drawn over the text, in the gap before the sentence or in the margin at a line start;
 * they take no room, so the editor's textarea and its mirror keep the same characters and line breaks, and they are
 * never part of the text (not in the textarea, not copied, not found). Checked and changed sentences are also tinted.
 */
export function SentenceMarkers({ owner, sentences, states, label, disabled = false, layoutKey, onToggle, onRange }: SentenceMarkersProps): JSX.Element {
  const ref = useRef<HTMLDivElement | null>(null);
  const ranges = useRef<(Range | null)[]>([]);
  const [places, setPlaces] = useState<(Place | null)[]>([]);
  useLayoutEffect(() => {
    const overlay = ref.current, root = overlay && textRootOf(overlay);
    if (!overlay || !root) return;
    const measure = () => {
      const index = indexText(root);
      const found = sentences.map(sentence => rangeAt(index, sentence.start, sentence.end));
      ranges.current = found;
      setPlaces(sentences.map((sentence, i) => {
        // The first character, a whole code point; its left edge is where the sentence starts on its line.
        const width = (sentence.text.codePointAt(0) ?? 0) > 0xffff ? 2 : 1;
        const first = rangeAt(index, sentence.start, Math.min(sentence.end, sentence.start + width));
        const line = first && firstLine(first, overlay);
        if (!line) return null;
        // Upright in the middle of the lower-case letters, clear of a full stop on the baseline.
        const top = Math.round(line.top + line.height * 0.45 - SIZE / 2);
        // In the space before the sentence when it is on the same line, centred there; else in the margin.
        const before = i > 0 ? rangeAt(index, sentences[i - 1].end, sentence.start) : null;
        const space = before && lastLine(before, overlay);
        const inLine = space && Math.abs(space.top - line.top) < 4 && line.left - space.left >= SIZE + 2;
        return { top, left: Math.round(inLine ? (space.left + line.left - SIZE) / 2 + 1 : line.left - SIZE - MARGIN) };
      }));
      setHighlight("review-checked", owner, found.filter((range, i): range is Range => range !== null && isChecked(states[i])));
      setHighlight("review-stale", owner, found.filter((range, i): range is Range => range !== null && states[i]?.kind === "stale"));
      // A tint paints over the text's own change marks: the changes are painted again above it.
      const changes = (selector: string) => Array.from(root.querySelectorAll(selector), element => { const range = document.createRange(); range.selectNodeContents(element); return range; });
      setHighlight("review-insert", owner, changes("ins"));
      setHighlight("review-delete", owner, changes("del"));
    };
    measure();
    // The reading font may arrive after the first layout and move every line.
    let alive = true;
    void document.fonts?.ready?.then(() => { if (alive) measure(); });
    if (typeof ResizeObserver === "undefined") return () => { alive = false; };
    const observer = new ResizeObserver(measure);
    observer.observe(root);
    return () => { alive = false; observer.disconnect(); };
  }, [owner, sentences, states, layoutKey]);
  useEffect(() => () => clearHighlights(owner, ["review-checked", "review-stale", "review-sentence-hover", "review-insert", "review-delete"]), [owner]);
  const hover = (index: number | null) => {
    const range = index === null ? null : ranges.current[index];
    setHighlight("review-sentence-hover", owner, range ? [range] : []);
  };
  const { keyDown, marker } = useMarkerKeys({ sentences, states, label, disabled, onToggle, onRange, container: () => ref.current, onActive: hover });
  return <div ref={ref} className="sentence-markers" data-gutter="" role="group" aria-label={label} onKeyDown={keyDown}>
    {sentences.map(sentence => {
      const state = states[sentence.index], place = places[sentence.index];
      return <button key={sentence.index} {...marker(sentence.index, state, sentence.text)} data-start={sentence.start} className={`${markerClass("sentence-marker", state)}${place ? "" : " is-unplaced"}`}
        style={place ? { top: place.top, left: place.left } : undefined}
        onPointerEnter={() => hover(sentence.index)} onPointerLeave={() => hover(null)} />;
    })}
  </div>;
}

/** Text nodes, with invisible characters marked when asked. */
const textNodes = (text: string, key: string, invisibles: boolean): ReactNode => invisibles ? invisibleNodes(text, key) : text;

export interface SentenceLinesProps extends MarkProps {
  text: string;
  lang?: string;
  showInvisibles?: boolean;
}

/**
 * "One sentence per line": one side's sentences as a list, a box before each. It only shows the text another way:
 * nothing is edited here, and no sentence is paired with a sentence of the other side. The white space between
 * sentences ends each row, so the rows hold exactly the text's characters: the find bar and coupled scrolling read
 * the list as they read the flowing text.
 */
export const SentenceLines = forwardRef<HTMLDivElement, SentenceLinesProps>(function SentenceLines(
  { text, lang, showInvisibles = false, sentences, states, label, disabled = false, onToggle, onRange }, ref,
) {
  const list = useRef<HTMLDivElement | null>(null);
  const { keyDown, marker } = useMarkerKeys({ sentences, states, label, disabled, onToggle, onRange, container: () => list.current });
  // Paragraph starts are code-point offsets; sentences use UTF-16 offsets. A sentence never spans paragraphs.
  const units: number[] = [];
  let unit = 0;
  for (const char of text) { units.push(unit); unit += char.length; }
  units.push(unit);
  const points = paragraphStarts(text);
  let paragraph = 0;
  return <div ref={element => { list.current = element; if (typeof ref === "function") ref(element); else if (ref) ref.current = element; }}
    className={`translation-text sentence-lines${showInvisibles ? " show-invisibles" : ""}`} role="group" aria-label={label} lang={lang} onKeyDown={keyDown}><ol>
    {sentences.map((sentence, i) => {
      const state = states[sentence.index];
      const lead = i === 0 ? text.slice(0, sentence.start) : "";
      const gap = text.slice(sentence.end, sentences[i + 1]?.start ?? text.length);
      const paragraphs: ReactNode[] = [];
      for (; paragraph < points.length && units[Math.min(points[paragraph], units.length - 1)] <= sentence.start; paragraph++)
        paragraphs.push(<span key={`p${paragraph}`} aria-hidden="true" data-paragraph={paragraph} data-paragraph-offset={points[paragraph]} />);
      return <li key={sentence.index} className={`${markerClass("sentence-line", state)}${i > 0 && paragraphs.length ? " starts-paragraph" : ""}`}>
        <button {...marker(sentence.index, state, sentence.text)} data-gutter="" className={markerClass("sentence-box", state)}>{isChecked(state) && <IconCheck />}</button>
        <span className="sentence-line-text">{paragraphs}{lead && textNodes(lead, `l${i}`, showInvisibles)}{textNodes(sentence.text, `s${i}`, showInvisibles)}
          {gap && <span className="sentence-line-gap">{textNodes(gap, `g${i}`, showInvisibles)}</span>}</span>
      </li>;
    })}
  </ol></div>;
});

/** Counts of one side. */
export interface SideCount { checked: number; total: number; stale: number }

/** How far one side is, in its column head. */
export function SentenceCount({ name, count }: { name: string; count: SideCount }): JSX.Element {
  return <p className="sentence-count" role="status"><span className="review-sr-only">{`${name}: `}</span><strong>{count.checked}</strong>{` of ${count.total} checked`}
    {count.stale > 0 && <span title="Changed since checked">{` · ${count.stale} changed`}</span>}</p>;
}
