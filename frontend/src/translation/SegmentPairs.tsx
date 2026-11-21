import { forwardRef, useLayoutEffect, useMemo, useRef, type KeyboardEvent, type ReactNode } from "react";
import { IconCheck, IconMore, IconWarning, MenuButton } from "../ui";
import { pairState, type PairState, type SegmentPair } from "./alignment";
import { invisibleNodes } from "./invisibles";
import type { TextDiffPart } from "./textDiff";
import "./translation.css";

export interface SegmentPairsProps {
  source: string;
  target: string;
  pairs: readonly SegmentPair[];
  sourceLang?: string;
  targetLang?: string;
  /** The changes from the machine text to `target` (Show changes): inserted and deleted words are marked in the cells. */
  changes?: readonly TextDiffPart[] | null;
  /** The translation cells can be edited (click or Enter). */
  editable: boolean;
  disabled?: boolean;
  showInvisibles?: boolean;
  /** The pair whose translation is being edited, if any. */
  editing: number | null;
  onEditStart: (index: number) => void;
  onEditEnd: () => void;
  /** The new translation of one pair, as typed in its cell. */
  onEditPair: (index: number, value: string) => void;
  onToggle: (index: number) => void;
  onMerge: (index: number) => void;
  onSplit: (index: number) => void;
  /** Whether a pair can be split (it has more than one segment, or a clause, on a side). */
  canSplit: (index: number) => boolean;
}

const STATE_LABEL: Record<PairState, string> = { open: "Not checked", checked: "Checked", stale: "Changed since checked" };

/** The change parts of `target` that fall into each pair, with deleted words where they were removed. */
function partsPerPair(pairs: readonly SegmentPair[], changes: readonly TextDiffPart[]): { op: TextDiffPart["op"]; text: string }[][] {
  const result: { op: TextDiffPart["op"]; text: string }[][] = pairs.map(() => []);
  let position = 0, pair = 0;
  const owner = (at: number, deletion: boolean) => {
    while (pair < pairs.length - 1 && (deletion ? pairs[pair].translation.end < at : pairs[pair].translation.end <= at)) pair++;
    return pair;
  };
  for (const part of changes) {
    if (part.op === "delete") { if (pairs.length) result[owner(position, true)].push(part); continue; }
    let offset = 0;
    while (offset < part.text.length) {
      const at = position + offset, index = owner(at, false), span = pairs[index]?.translation;
      if (!span) break;
      if (at < span.start) { offset = Math.min(part.text.length, span.start - position); continue; }
      const end = Math.min(part.text.length, span.end - position);
      if (end <= offset) { offset = part.text.length; break; }
      result[index].push({ op: part.op, text: part.text.slice(offset, end) }); offset = end;
    }
    position += part.text.length;
  }
  return result;
}

/** A textarea as tall as its text. */
function CellEditor({ value, label, lang, onChange, onDone }: { value: string; label: string; lang?: string; onChange: (value: string) => void; onDone: () => void }): JSX.Element {
  const ref = useRef<HTMLTextAreaElement | null>(null);
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    element.style.height = "auto"; element.style.height = `${element.scrollHeight}px`;
  }, [value]);
  useLayoutEffect(() => { ref.current?.focus({ preventScroll: true }); }, []);
  return <textarea ref={ref} className="pair-editor" aria-label={label} lang={lang} value={value} spellCheck
    onChange={event => onChange(event.target.value)} onBlur={onDone}
    onKeyDown={event => { if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); onDone(); } }} />;
}

/**
 * The source and the translation as aligned pairs (issue 560, prototype): one row per pair, the source on the left,
 * its translation on the right, and the pair's check at the end of the row. Each cell holds exactly its passage, so
 * find can map text offsets to the cells (`data-side`, `data-start`). A translation cell becomes a text box on click.
 */
export const SegmentPairs = forwardRef<HTMLDivElement, SegmentPairsProps>(function SegmentPairs(props, ref) {
  const { source, target, pairs, sourceLang, targetLang, changes, editable, disabled = false, showInvisibles = false, editing } = props;
  const perPair = useMemo(() => changes ? partsPerPair(pairs, changes) : null, [pairs, changes]);
  const text = (value: string, key: string): ReactNode => showInvisibles ? invisibleNodes(value, key) : value;
  const moveFocus = (event: KeyboardEvent<HTMLElement>, index: number) => {
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
    const next = event.currentTarget.closest(".segment-pairs")?.querySelector<HTMLElement>(`[data-pair-check="${index + (event.key === "ArrowDown" ? 1 : -1)}"]`);
    if (next) { event.preventDefault(); next.focus(); next.scrollIntoView?.({ block: "nearest" }); }
  };
  return <div ref={ref} className={`segment-pairs${showInvisibles ? " show-invisibles" : ""}`} role="table" aria-label="Segment pairs" aria-rowcount={pairs.length + 1}>
    <div className="segment-pairs-head" role="row">
      <span role="columnheader" className="segment-pairs-number"><span className="review-sr-only">Pair</span></span>
      <span role="columnheader">Source</span><span role="columnheader">Translation</span><span role="columnheader"><span className="review-sr-only">Check</span></span>
    </div>
    {pairs.map((pair, index) => {
      const state = pairState(target, pair);
      const sourceText = source.slice(pair.source.start, pair.source.end), targetText = target.slice(pair.translation.start, pair.translation.end);
      const previous = pairs[index - 1];
      const paragraph = previous && (source.slice(previous.source.end, pair.source.start).includes("\n") || target.slice(previous.translation.end, pair.translation.start).includes("\n"));
      const number = index + 1;
      const cell = editing === index
        ? <CellEditor value={targetText} label={`Translation of pair ${number}`} lang={targetLang} onChange={value => props.onEditPair(index, value)} onDone={props.onEditEnd} />
        : <div className={`segment-cell segment-cell--translation${editable ? " is-editable" : ""}`} data-side="translation" data-start={pair.translation.start} lang={targetLang}
            tabIndex={editable ? 0 : undefined} role={editable ? "button" : undefined} aria-label={editable ? `Edit the translation of pair ${number}` : undefined}
            onClick={() => { if (editable && !disabled && !window.getSelection()?.toString()) props.onEditStart(index); }}
            onKeyDown={event => { if (editable && !disabled && event.key === "Enter" && !event.ctrlKey && !event.metaKey) { event.preventDefault(); props.onEditStart(index); } }}>
            {targetText === "" ? <span className="segment-empty" data-gutter="">Not in the translation</span>
              : perPair ? perPair[index].map((part, k) => part.op === "delete" ? <del key={k} data-diff-op="delete">{text(part.text, `d${index}-${k}`)}</del>
                : part.op === "insert" ? <ins key={k} data-diff-op="insert">{text(part.text, `i${index}-${k}`)}</ins> : <span key={k}>{text(part.text, `e${index}-${k}`)}</span>)
              : text(targetText, `t${index}`)}
          </div>;
      return <div key={`${pair.source.start}:${pair.translation.start}:${index}`} role="row" aria-rowindex={number + 1}
        className={`segment-pair is-${state}${paragraph ? " starts-paragraph" : ""}${pair.manual ? " is-manual" : ""}`} data-pair={index}>
        <span role="cell" className="segment-pairs-number" aria-hidden="true">{number}</span>
        <div role="cell" className="segment-cell segment-cell--source" data-side="source" data-start={pair.source.start} lang={sourceLang}>
          {sourceText === "" ? <span className="segment-empty" data-gutter="">Not in the source</span> : text(sourceText, `s${index}`)}
        </div>
        <div role="cell" className="segment-cell-wrap">{cell}</div>
        <div role="cell" className="segment-pair-actions">
          <button type="button" className={`pair-check is-${state}`} data-pair-check={index} aria-pressed={state === "checked"} disabled={disabled}
            aria-label={`Pair ${number}: ${STATE_LABEL[state]}`} title={state === "stale" ? "Changed since checked: click to check again" : state === "checked" ? "Checked: click to undo" : "Mark this pair as checked"}
            onClick={() => props.onToggle(index)} onKeyDown={event => moveFocus(event, index)}>
            {state === "checked" ? <IconCheck /> : state === "stale" ? <IconWarning /> : null}
          </button>
          {editable && <MenuButton className="pair-more" label={`Pair ${number}: change the pairing`} buttonLabel="" content={<IconMore />} items={[
            { id: "merge-previous", label: "Merge with the pair above", disabled: index === 0 || disabled, onSelect: () => props.onMerge(index - 1) },
            { id: "merge-next", label: "Merge with the pair below", disabled: index === pairs.length - 1 || disabled, onSelect: () => props.onMerge(index) },
            { id: "split", label: "Split this pair", description: props.canSplit(index) ? undefined : "Nothing to split: one clause on each side.", disabled: disabled || !props.canSplit(index), onSelect: () => props.onSplit(index) },
          ]} />}
        </div>
      </div>;
    })}
  </div>;
});

/** How far the pairs are, for the head of the view. */
export function PairCount({ target, pairs }: { target: string; pairs: readonly SegmentPair[] }): JSX.Element {
  const states = pairs.map(pair => pairState(target, pair));
  const checked = states.filter(state => state === "checked").length, stale = states.filter(state => state === "stale").length;
  return <p className="sentence-count" role="status"><strong>{checked}</strong>{` of ${pairs.length} pairs checked`}
    {stale > 0 && <span title="Changed since checked">{` · ${stale} changed`}</span>}</p>;
}
