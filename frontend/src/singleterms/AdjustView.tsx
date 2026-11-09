import { useId, useMemo, useRef, useState, type ReactNode } from "react";
import type { SingleTermContext, SingleTermGroup } from "../api/client";
import { ErrorNotice } from "../admin/ErrorNotice";
import { Button, Select, TextInput } from "../ui";
import { blockedLabels, label } from "./labels";
import { initialSelection, recutProblem, recutWindow, selectionSpan, tokenize } from "./recut";

export type Adjustment =
  | { decision: "adjust_span"; adjusted_span: { occurrence_ref: string; start: number; end: number }; note: string }
  | { decision: "adjust_term"; adjusted_term_id: string; note: string };

export interface AdjustViewProps {
  group: SingleTermGroup;
  contexts: readonly SingleTermContext[];
  busy?: boolean;
  error?: unknown;
  /** Where "term wrong in context" goes (a problem report on the text); null hides the link. */
  problemLink?: (documentId: string) => ReactNode;
  onCancel: () => void;
  onSubmit: (adjustment: Adjustment) => void;
}

const sameRange = (a: readonly [number, number] | null, b: readonly [number, number] | null) => !!a && !!b && a[0] === b[0] && a[1] === b[1];

/**
 * Adjust a case (mockup "Adjust"): re-cut the span of one occurrence by clicking its first and last word
 * (or dragging over them), or generalise the term to an ancestor. One kind of adjustment per decision; the
 * re-cut stays verbatim. A blocked group can only be re-cut.
 */
export function AdjustView({ group, contexts, busy = false, error, problemLink, onCancel, onSubmit }: AdjustViewProps): JSX.Element {
  const id = useId().replace(/:/g, "");
  const [occurrence, setOccurrence] = useState(0);
  const context = contexts[Math.min(occurrence, contexts.length - 1)];
  const win = useMemo(() => context ? recutWindow(context) : null, [context]);
  const tokens = useMemo(() => win ? tokenize(win.text) : [], [win]);
  const initial = useMemo(() => win ? initialSelection(tokens, win) : null, [tokens, win]);
  const [selection, setSelection] = useState<[number, number] | null>(initial);
  const [pickStart, setPickStart] = useState(true);
  const [termMode, setTermMode] = useState<"keep" | "general">("keep");
  const [ancestor, setAncestor] = useState("");
  const [note, setNote] = useState("");
  const drag = useRef<{ anchor: number; moved: boolean } | null>(null);
  const skipClick = useRef(false);

  const chooseOccurrence = (index: number) => {
    setOccurrence(index);
    const next = contexts[index] ? recutWindow(contexts[index]) : null;
    setSelection(next ? initialSelection(tokenize(next.text), next) : null);
    setPickStart(true);
  };
  const pick = (index: number) => {
    if (skipClick.current) { skipClick.current = false; return; }
    if (pickStart || !selection) { setSelection([index, index]); setPickStart(false); }
    else { setSelection([Math.min(selection[0], index), Math.max(selection[0], index)]); setPickStart(true); }
    if (termMode === "general") setTermMode("keep");
  };

  const span = win && selection ? selectionSpan(win, tokens, selection[0], selection[1]) : null;
  const recut = !sameRange(selection, initial) && span !== null;
  const general = termMode === "general";
  const ancestorId = ancestor.trim();
  let problem: string | null = null;
  if (recut && general) problem = "One adjustment per decision: re-cut the span or generalise the term, not both.";
  else if (general && group.blocked_reason) problem = "A generalised term does not lift the block: re-cut the span instead, or reject.";
  else if (recut && win && span) problem = recutProblem(win, span);
  const ready = !problem && (recut || (general && !!ancestorId));
  const blockedNote = group.blocked_reason ? `blocked: ${label(blockedLabels, group.blocked_reason)}` : null;

  const submit = () => {
    if (!ready || busy || !context) return;
    if (recut && span) onSubmit({ decision: "adjust_span", adjusted_span: { occurrence_ref: context.occurrence_ref, start: span.start, end: span.end }, note });
    else onSubmit({ decision: "adjust_term", adjusted_term_id: ancestorId, note });
  };

  const words: ReactNode[] = [];
  if (win) {
    let last = 0;
    for (const token of tokens) {
      if (token.start > last) words.push(win.text.slice(last, token.start));
      const inside = !!selection && token.index >= selection[0] && token.index <= selection[1];
      words.push(<button key={token.index} type="button" className={`st-recut-word${inside ? " st-recut-word--in" : ""}`} aria-pressed={inside}
        onMouseDown={event => { if (event.button === 0) drag.current = { anchor: token.index, moved: false }; }}
        onMouseEnter={event => {
          const state = drag.current;
          if (!state || (event.buttons & 1) === 0 || (state.anchor === token.index && !state.moved)) return;
          state.moved = true;
          setSelection([Math.min(state.anchor, token.index), Math.max(state.anchor, token.index)]);
        }}
        onMouseUp={() => {
          const state = drag.current; drag.current = null;
          if (state?.moved) { skipClick.current = true; setPickStart(true); if (termMode === "general") setTermMode("keep"); }
        }}
        onClick={() => pick(token.index)}>{token.text}</button>);
      last = token.end;
    }
    if (last < win.text.length) words.push(win.text.slice(last));
  }

  return <div className="st-review">
    <div className="st-work">
      <section className="st-card" aria-labelledby={`${id}-annotated`}>
        {blockedNote && <p className="st-row" style={{ margin: 0 }}><span className="st-pill st-pill--warning">{blockedNote}</span><span className="st-muted st-small">Accept is possible only after a re-cut.</span></p>}
        <h2 id={`${id}-annotated`} className="st-step">Annotated span</h2>
        <p className={`st-phrase${recut ? " st-recut-original st-muted" : ""}`} style={{ fontSize: "var(--size-xl)" }}>{context?.text ?? group.display_text}</p>
        <p className="st-muted st-small" style={{ margin: 0 }}>{group.label ?? group.term_id} · {group.term_id}</p>
      </section>
      <section className="st-card st-card--focus" aria-labelledby={`${id}-recut`}>
        <div className="st-spread"><h2 id={`${id}-recut`}>Re-cut the span</h2><span className="st-small" style={{ color: "var(--success)" }}>stays verbatim</span></div>
        <p className="st-muted st-small" style={{ margin: 0 }}>Click the first word, then the last word, or drag over them. The new span must stay clear of other findings and negations; the server checks both.</p>
        {contexts.length > 1 && <Select id={`${id}-occurrence`} label="Occurrence" value={String(occurrence)} onChange={event => chooseOccurrence(Number(event.target.value))}>
          {contexts.map((item, index) => <option key={item.occurrence_ref} value={index}>{`${index + 1}: text ${item.document_id}`}</option>)}
        </Select>}
        {win ? <div className="st-recut" role="group" aria-label="Words of the context">{words}</div> : <p className="st-muted">No context loaded.</p>}
        <p className="st-row" style={{ margin: 0 }}><span className="st-muted">New phrase</span><strong style={{ fontSize: "var(--size-xl)" }} aria-live="polite">{span?.text ?? ""}</strong></p>
        {problem && <p className="st-warn st-small" role="status">{problem}</p>}
      </section>
      <section className="st-card" aria-labelledby={`${id}-term`}>
        <div className="st-spread"><h2 id={`${id}-term`}>Or generalise the term</h2><span className="st-small st-muted">ancestors only</span></div>
        <fieldset className="st-options"><legend>Term</legend>
          <label className="st-option"><input type="radio" name={`${id}-term`} checked={!general} onChange={() => setTermMode("keep")} /> <span>{group.label ?? group.term_id} · {group.term_id} <span className="st-muted">(annotated)</span></span></label>
          <label className="st-option"><input type="radio" name={`${id}-term`} checked={general} disabled={!!group.blocked_reason}
            onChange={() => { setTermMode("general"); setSelection(initial); setPickStart(true); }} /> <span>A more general term</span></label>
          {general && <TextInput id={`${id}-ancestor`} label="Ancestor term ID" hint="It must be an active ancestor of the annotated term in the release of every occurrence." value={ancestor} onChange={event => setAncestor(event.target.value)} />}
        </fieldset>
        <p className="st-small st-muted" style={{ margin: 0 }}>Is the term wrong in its context? Then the final result has an error{context && problemLink ? <>: {problemLink(context.document_id)}</> : ": ask a lead to correct it (problem report)"}. The case returns after the correction.</p>
      </section>
    </div>
    <div className="st-work" style={{ flex: "1 1 300px" }}>
      <section className="st-card st-card--quiet" aria-labelledby={`${id}-rewrite`}>
        <div className="st-spread"><h2 id={`${id}-rewrite`} className="st-muted">Rewrite the text</h2><span className="st-pill st-pill--neutral">not offered</span></div>
        <p className="st-small st-muted" style={{ margin: 0 }}>Free text would leave the annotated data, so cases stay verbatim.</p>
      </section>
      <section className="st-card" aria-labelledby={`${id}-result`}>
        <h2 id={`${id}-result`}>Resulting case</h2>
        <p style={{ margin: 0 }}><span className="st-muted">Text</span> <strong>{recut && span ? span.text : group.display_text}</strong></p>
        <p style={{ margin: 0 }}><span className="st-muted">Term</span> <strong>{general && ancestorId ? ancestorId : group.label ?? group.term_id}</strong>{!(general && ancestorId) && <> {group.term_id}</>}</p>
        <p style={{ margin: 0 }}><span className="st-muted">Origin</span> {recut ? "span re-cut · term as annotated" : general ? "term generalised · span as annotated" : "unchanged"}</p>
        <TextInput id={`${id}-note`} label="Note (optional)" value={note} maxLength={2000} onChange={event => setNote(event.target.value)} />
      </section>
      {error !== undefined && <ErrorNotice error={error} />}
      <div className="st-row">
        <Button variant="primary" disabled={!ready} loading={busy} onClick={submit}>Accept adjusted case</Button>
        <Button onClick={onCancel} disabled={busy}>Cancel</Button>
      </div>
    </div>
  </div>;
}
