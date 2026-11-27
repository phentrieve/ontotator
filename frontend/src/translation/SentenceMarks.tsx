import { forwardRef, useMemo, useRef, type KeyboardEvent, type MouseEvent, type PointerEvent, type ReactNode } from "react";
import { paragraphStarts } from "../variants/paragraphs";
import { diffPartNode } from "./DiffView";
import { invisibleNodes } from "./invisibles";
import { isChecked, type MarkState, type Sentence } from "./sentences";
import type { TextDiffPart } from "./textDiff";
import "./translation.css";

export interface SentenceViewProps {
  text: string;
  sentences: readonly Sentence[];
  states: readonly MarkState[];
  label: string;
  lang?: string;
  disabled?: boolean;
  /** Marks spaces, tabs, line ends and other invisible characters (issue 454). */
  showInvisibles?: boolean;
  /**
   * With Show changes: the changes from the earlier text to `text`, shown inside the sentences as in the diff view.
   * Deleted words are generated content, so find and copy see `text` only (issue 533).
   */
  changes?: readonly TextDiffPart[];
  /** Toggles one sentence. */
  onToggle: (index: number) => void;
  /** Sets the sentences from `from` to `to` to checked or unchecked. */
  onRange: (from: number, to: number, checked: boolean) => void;
  /** Puts one sentence back into a state it had: a double-click selects a word and keeps the mark (issue 533). */
  onRestore: (index: number, state: MarkState) => void;
}

const sentenceOf = (target: EventTarget | null): number | null => {
  const element = target instanceof Element ? target.closest<HTMLElement>("[data-sentence]") : null;
  const index = Number(element?.dataset.sentence);
  return element && Number.isInteger(index) ? index : null;
};

type Located = TextDiffPart & { at: number };

/**
 * Renders the text from `from` to `to` (UTF-16 offsets of `text`). Without changes it is the plain text; with them,
 * the diff parts that fall in the range, clipped to it. A deletion stands at an offset of `text`; it is drawn once,
 * by the first range that reaches it (`to` inclusive with `closed`), so a deletion at a sentence's start or end
 * goes with that sentence and not with the white space beside it.
 */
function textPiece(text: string, changes: Located[] | null, cursor: { next: number }, from: number, to: number, key: string, invisibles: boolean, closed: boolean): ReactNode[] {
  if (!changes) { const part = text.slice(from, to); return part ? invisibles ? invisibleNodes(part, key) : [part] : []; }
  const nodes: ReactNode[] = [];
  let piece = 0;
  for (let index = cursor.next; index < changes.length; index++) {
    const part = changes[index];
    if (part.op === "delete") {
      if (part.at > to || (part.at === to && !closed)) break;
      if (part.at >= from) nodes.push(diffPartNode("delete", part.text, `${key}-${piece++}`, invisibles));
      cursor.next = index + 1;
      continue;
    }
    const end = part.at + part.text.length;
    if (part.at >= to) break;
    const clipped = text.slice(Math.max(from, part.at), Math.min(to, end));
    if (clipped) nodes.push(diffPartNode(part.op, clipped, `${key}-${piece++}`, invisibles));
    if (end > to) break;
    cursor.next = index + 1;
  }
  return nodes;
}

/** Text nodes with the hidden paragraph markers coupled scrolling reads, and one button per sentence. */
function sentenceNodes(text: string, sentences: readonly Sentence[], render: (sentence: Sentence, content: ReactNode[]) => ReactNode, invisibles = false, changes?: readonly TextDiffPart[]): ReactNode[] {
  // Paragraph starts are code-point offsets; sentences use UTF-16 offsets.
  const units: number[] = [];
  let unit = 0;
  for (const char of text) { units.push(unit); unit += char.length; }
  units.push(unit);
  const points = paragraphStarts(text), starts = points.map(point => units[Math.min(point, units.length - 1)]);
  // The changes at their UTF-16 offsets in `text`; deleted words take no room there.
  let at = 0;
  const located = changes ? changes.map(part => { const here = { ...part, at }; if (part.op !== "delete") at += part.text.length; return here; }) : null;
  const cursor = { next: 0 };
  const nodes: ReactNode[] = [];
  let paragraph = 0, position = 0, gaps = 0;
  /** The text between two sentences (spaces, line ends). */
  const between = (from: number, to: number, closed = false) => { nodes.push(...textPiece(text, located, cursor, from, to, `g${gaps++}`, invisibles, closed)); };
  /** Text up to `end`; a marker at `end` comes before the sentence that starts there. */
  const gap = (end: number, closed = false) => {
    for (; paragraph < starts.length && starts[paragraph] <= end; paragraph++) {
      if (starts[paragraph] > position) { between(position, starts[paragraph]); position = starts[paragraph]; }
      nodes.push(<span key={`p${paragraph}`} aria-hidden="true" data-paragraph={paragraph} data-paragraph-offset={points[paragraph]} />);
    }
    if (end > position || closed) { between(position, end, closed); position = end; }
  };
  for (const sentence of sentences) {
    gap(sentence.start);
    nodes.push(render(sentence, textPiece(text, located, cursor, sentence.start, sentence.end, `s${sentence.index}`, invisibles, true)));
    position = sentence.end;
  }
  gap(text.length, true);
  return nodes;
}

/**
 * A review text in marking mode: every sentence is a toggle button. Click toggles it, and Shift+click marks the
 * range from the last clicked sentence. The text stays selectable (issue 533): a drag selects text and marks
 * nothing, a double-click selects a word and leaves the mark as it was, and the browser's find can select its hits.
 */
export const SentenceView = forwardRef<HTMLDivElement, SentenceViewProps>(function SentenceView(
  { text, sentences, states, label, lang, disabled = false, showInvisibles = false, changes, onToggle, onRange, onRestore }, ref,
) {
  const anchor = useRef<number | null>(null);
  /** The sentence the last click toggled and its state before, so that a double-click can put it back. */
  const lastToggle = useRef<{ index: number; state: MarkState } | null>(null);
  /** A Shift+press that marked a range; its click does nothing more. */
  const rangePress = useRef(false);
  const pointerDown = (event: PointerEvent<HTMLDivElement>) => {
    rangePress.current = false;
    if (disabled || event.button > 0 || !event.shiftKey || anchor.current === null) return;
    const index = sentenceOf(event.target);
    if (index === null) return;
    // Shift+press would extend the text selection; here it marks the range.
    event.preventDefault();
    (event.target as HTMLElement).closest<HTMLElement>("[data-sentence]")?.focus({ preventScroll: true });
    onRange(anchor.current, index, true); anchor.current = index; lastToggle.current = null; rangePress.current = true;
  };
  const keyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const index = sentenceOf(event.target);
    if (disabled || index === null || (event.key !== "Enter" && event.key !== " ")) return;
    // Ctrl+Enter is the screen's submit shortcut, not a mark.
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    event.preventDefault();
    if (event.shiftKey && anchor.current !== null) onRange(anchor.current, index, true);
    else onToggle(index);
    anchor.current = index; lastToggle.current = null;
  };
  const click = (event: MouseEvent<HTMLDivElement>) => {
    const index = sentenceOf(event.target);
    if (disabled || index === null) return;
    if (rangePress.current) { rangePress.current = false; return; }
    // A click without a pointer press (assistive technology) toggles the sentence.
    if (event.detail === 0) { onToggle(index); anchor.current = index; lastToggle.current = null; return; }
    if (event.detail > 1) {
      // The second click of a double-click selected a word: the first one's toggle is undone.
      const last = lastToggle.current;
      lastToggle.current = null;
      if (last?.index === index) onRestore(index, last.state);
      return;
    }
    // A drag selected text: that is not a mark.
    const selection = window.getSelection();
    if (selection && !selection.isCollapsed && selection.rangeCount > 0 && selection.getRangeAt(0).intersectsNode(event.currentTarget)) { lastToggle.current = null; return; }
    lastToggle.current = { index, state: states[index] ?? null };
    onToggle(index); anchor.current = index;
  };
  const content = useMemo(() => sentenceNodes(text, sentences, (sentence, nodes) => {
    const state = states[sentence.index];
    const className = ["review-sentence", isChecked(state) && "is-checked", state?.kind === "stale" && "is-stale"].filter(Boolean).join(" ");
    return <span key={`s${sentence.index}`} className={className} role="button" tabIndex={0} data-sentence={sentence.index}
      aria-pressed={isChecked(state)} aria-disabled={disabled || undefined}
      title={state?.kind === "stale" ? "Changed since checked" : undefined}>
      {nodes}{state?.kind === "stale" && <span className="review-sr-only"> (changed since checked)</span>}</span>;
  }, showInvisibles, changes), [text, sentences, states, disabled, showInvisibles, changes]);
  return <div ref={ref} className={`translation-text translation-sentences${changes ? " has-changes" : ""}${showInvisibles ? " show-invisibles" : ""}`} role="region" aria-label={label} lang={lang}
    onPointerDown={pointerDown} onKeyDown={keyDown} onClick={click}>{content}</div>;
});

/** Counts of one side. */
export interface SideCount { checked: number; total: number; stale: number }

/** How far one side is, in its column head. */
export function SentenceCount({ name, count }: { name: string; count: SideCount }): JSX.Element {
  return <p className="sentence-count" role="status"><span className="review-sr-only">{`${name}: `}</span><strong>{count.checked}</strong>{` of ${count.total} checked`}
    {count.stale > 0 && <span title="Changed since checked">{` · ${count.stale} changed`}</span>}</p>;
}
