import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { api, type ReanchorItem, type PendingReanchorRef, type ReanchorResolution, type AnnotationSnapshot } from '../api/client';
import { ErrorNotice } from '../admin/ErrorNotice';
import { useTermLabels } from '../editor/useTermLabels';
import { Button, Textarea, StatusBadge } from '../ui';
import { ReasonButton } from '../ui/Help';
import { DiffView } from '../translation/DiffView';
import type { TextDiffPart } from '../translation/textDiff';
import { toUtf16 } from '../spans/offsets';
import type { CodepointSegment } from '../spans/adapter';

type Window = ReanchorItem['new_context'];
const length = (text: string) => Array.from(text).length;
const validWindow = (value: Window) => Number.isSafeInteger(value.start) && value.start >= 0 && Number.isSafeInteger(value.end)
  && value.end >= value.start && value.end - value.start === length(value.text);

/** Validate exact server windows/opcodes. Display may word-diff these validated raw windows; alignment and evidence coordinates remain server-owned. */
export function pendingDiffParts(item: ReanchorItem): TextDiffPart[] | null {
  const old = item.old_context, next = item.new_context;
  if (!validWindow(old) || !validWindow(next)) return null;
  let oldPosition = old.start, newPosition = next.start;
  const parts: TextDiffPart[] = [];
  for (const opcode of item.diff) {
    if (!validWindow({ start: opcode.old_start, end: opcode.old_end, text: opcode.old_text })
      || !validWindow({ start: opcode.new_start, end: opcode.new_end, text: opcode.new_text })
      || opcode.old_start !== oldPosition || opcode.new_start !== newPosition
      || opcode.old_end > old.end || opcode.new_end > next.end) return null;
    if (opcode.op === 'equal') {
      if (opcode.old_text !== opcode.new_text) return null;
      parts.push({ op: 'equal', text: opcode.new_text });
    } else if (opcode.op === 'replace') {
      parts.push({ op: 'delete', text: opcode.old_text }, { op: 'insert', text: opcode.new_text });
    } else if (opcode.op === 'delete') {
      if (opcode.new_text) return null;
      parts.push({ op: 'delete', text: opcode.old_text });
    } else if (opcode.op === 'insert') {
      if (opcode.old_text) return null;
      parts.push({ op: 'insert', text: opcode.new_text });
    } else return null;
    oldPosition = opcode.old_end; newPosition = opcode.new_end;
  }
  return oldPosition === old.end && newPosition === next.end
    && parts.filter(part => part.op !== 'insert').map(part => part.text).join('') === old.text
    && parts.filter(part => part.op !== 'delete').map(part => part.text).join('') === next.text ? parts : null;
}

function oldContext(item: ReanchorItem): ReactNode {
  const context = item.old_context;
  if (!validWindow(context)) return 'Old context is unavailable.';
  const points = Array.from(context.text), cuts = new Set([0, points.length]);
  const windows = item.old_mentions.flatMap(mention => [
    ...mention.segments.map(window => ({ ...window, kind: 'mention' })),
    ...mention.cue_segments.map(window => ({ ...window, kind: 'cue' })),
  ]);
  for (const window of windows) {
    if (!validWindow(window)) return 'Old context is unavailable.';
    const start = Math.max(context.start, window.start), end = Math.min(context.end, window.end);
    if (end <= start) continue;
    if (points.slice(start - context.start, end - context.start).join('') !== Array.from(window.text).slice(start - window.start, end - window.start).join('')) return 'Old context is unavailable.';
    cuts.add(start - context.start); cuts.add(end - context.start);
  }
  const edges = [...cuts].sort((a,b) => a-b);
  return edges.slice(0,-1).map((start,index) => {
    const end = edges[index+1], text = points.slice(start,end).join('');
    const kinds = [...new Set(windows.filter(window => window.start < end + context.start && start + context.start < window.end).map(window => window.kind))].join(' ');
    return kinds ? <mark key={start} data-old-kind={kinds}>{text}</mark> : <span key={start}>{text}</span>;
  });
}
const reasons: Record<ReanchorItem['reason'],string> = {
  source_text_mismatch: 'The source text does not match.', missing_evidence: 'Source evidence is missing.',
  evidence_version_mismatch: 'The evidence version does not match.', ambiguous_evidence: 'The evidence is ambiguous.',
  evidence_source_mismatch: 'The evidence belongs to another source.', invalid_bounds: 'The evidence offsets are invalid.',
  changed_segment: 'The evidence text changed.', changed_cue: 'The cue text changed.',
  changed_modifier_segment: 'The text of a modifier changed.',
};
export const reanchorKey = (item: PendingReanchorRef) => JSON.stringify([item.proposal_set_id,item.source_ref.annotation_id,item.source_ref.version]);
export const reanchorRef = (item: ReanchorItem): PendingReanchorRef => ({proposal_set_id:item.proposal_set_id,source_ref:item.source_ref});
/** A changed/deleted replacement requires a fresh explicit resolution. */
export function currentReanchorResolution(item: PendingReanchorRef, resolutions: readonly ReanchorResolution[], annotations?: readonly AnnotationSnapshot[]) {
  const resolution = resolutions.find(value => reanchorKey(value.item) === reanchorKey(item));
  return resolution?.outcome === 'recreated' && annotations && !annotations.some(snapshot =>
    snapshot.annotation.annotation_id === resolution.replacement?.annotation_id && snapshot.version === resolution.replacement.version)
    ? undefined : resolution;
}
/** The words the finding was on, as one line. */
export const oldWords = (item: ReanchorItem) => item.old_mentions.flatMap(mention => mention.segments.map(segment => segment.text)).join(' … ');
/** Where the old words occur unchanged in the current text (issue 633), each the mention's segments there. */
export const suggestionsOf = (item: ReanchorItem) => (item.suggestions ?? []).filter(place => place.length > 0 && place.every(validWindow));
/** The marks of an item in the current text: its suggested places, else the new wording in place of its words. */
export function reanchorMarks(item: ReanchorItem): { id: string; place: number | null; segments: { start: number; end: number }[] }[] {
  // Encoded: the text keeps the ids of a run comma-separated, and the key is JSON.
  const key = encodeURIComponent(reanchorKey(item)), places = suggestionsOf(item);
  if (places.length) return places.map((place, index) => ({ id: `reanchor:${key}:${index}`, place: index,
    segments: place.map(({ start, end }) => ({ start, end })) }));
  return item.changed_at && validWindow(item.changed_at) && item.changed_at.end > item.changed_at.start
    ? [{ id: `reanchor:${key}:changed`, place: null, segments: [{ start: item.changed_at.start, end: item.changed_at.end }] }] : [];
}
/** The item key and place of a mark id from `reanchorMarks`; null for any other id. */
export function parseReanchorMark(id: string): { key: string; place: number | null } | null {
  if (!id.startsWith('reanchor:')) return null;
  const rest = id.slice('reanchor:'.length), cut = rest.lastIndexOf(':');
  if (cut < 0) return null;
  const tail = rest.slice(cut + 1);
  try { return { key: decodeURIComponent(rest.slice(0, cut)), place: tail === 'changed' ? null : Number(tail) }; }
  catch { return null; }
}
type PanelProps = { items: readonly ReanchorItem[]; labelFor: (layer:string,term:string)=>string|null; onContext:(window:Window)=>void;
  resolutions?:readonly ReanchorResolution[]; annotations?:readonly AnnotationSnapshot[]; busy?:boolean;
  onRecreate?:(item:ReanchorItem)=>void; onDismiss?:(item:ReanchorItem,reason:string)=>Promise<void>;
  recreateUnavailableReason?:(item:ReanchorItem)=>string|undefined;
  onOpenFinding?:(annotationId:string)=>void;
  /** The selected pending item (its marks in the text are framed) and the place of each item's suggestion in use. */
  selectedKey?: string | null; placeOf?: (item: ReanchorItem) => number;
  /** Selects an item (and a place of its suggestions); without it the term shows the item's context. */
  onSelect?: (item: ReanchorItem, place?: number) => void;
  /** Re-creates the finding at a suggested place with its term and values. */
  onUseLocation?: (item: ReanchorItem, place: number) => void;
  /** The values that differ from the defaults, as one line; null when none do. */
  valuesOf?: (item: ReanchorItem) => string | null;
  /** After a dismissal: the screen moves on to the next pending item. */
  onResolved?: (item: ReanchorItem) => void;
};
function ResolutionActions({item,resolution,busy,onRecreate,onDismiss,onResolved,recreateUnavailableReason,onUseLocation,onSelect,place}: Pick<PanelProps,'busy'|'onRecreate'|'onDismiss'|'recreateUnavailableReason'|'onUseLocation'|'onSelect'> & {
  item:ReanchorItem; resolution:ReanchorResolution|undefined; onResolved:()=>void; place:number;
}) {
  const [editing,setEditing]=useState(false), [reason,setReason]=useState(''), [saving,setSaving]=useState(false), [error,setError]=useState<unknown>();
  const input=useRef<HTMLTextAreaElement>(null), trigger=useRef<HTMLButtonElement>(null);
  const unavailable=recreateUnavailableReason?.(item) ?? (!item.type_id ? 'The original finding type is unavailable for re-creation. You can still dismiss this finding with a reason.' : undefined);
  useEffect(()=>{if(editing)input.current?.focus();},[editing]);
  if(resolution) return <div><StatusBadge tone="success">{resolution.outcome === 'dismissed' ? 'Dismissed' : 'Re-created'}</StatusBadge>
    <p>Reviewed by {resolution.reviewer_id}{resolution.reason ? `: ${resolution.reason}` : ''}</p>
    {resolution.replacement && <details><summary>Resolution details</summary>
      <p style={{overflowWrap:'anywhere'}}>Replacement: {resolution.replacement.annotation_id} ({resolution.replacement.version})</p>
    </details>}</div>;
  const cancel=()=>{setEditing(false);setError(undefined);trigger.current?.focus();};
  const places=suggestionsOf(item), offered=!!onUseLocation && places.length>0;
  return <div>
    <div className="reanchor-row__actions">
      {offered && <ReasonButton reason={unavailable ?? null} variant="primary" size="sm" data-reanchor-primary="" disabled={busy || saving}
        onClick={()=>{if(!unavailable)onUseLocation(item,Math.min(place,places.length-1));}}>Use this location</ReasonButton>}
      {offered && places.length>1 && onSelect && <Button variant="quiet" size="sm" disabled={busy || saving}
        onClick={()=>onSelect(item,(place+1)%places.length)}>Next place ({Math.min(place,places.length-1)+1} of {places.length})</Button>}
      {onRecreate && <ReasonButton reason={unavailable ?? null} variant={offered ? 'secondary' : 'primary'} size="sm" data-reanchor-primary={offered ? undefined : ''}
        disabled={busy || saving} onClick={()=>{if(!unavailable)onRecreate(item);}}>Mark in text</ReasonButton>}
      {onDismiss && <Button ref={trigger} size="sm" aria-expanded={editing} disabled={busy || saving} onClick={()=>setEditing(true)}>Dismiss…</Button>}
    </div>
    {editing && onDismiss && <form onSubmit={event=>{
      event.preventDefault(); if(!reason.trim() || saving || busy)return;
      setSaving(true);setError(undefined);
      void onDismiss(item,reason.trim()).then(()=>{setEditing(false);onResolved();},setError).finally(()=>setSaving(false));
    }}>
      <Textarea ref={input} id={`reanchor-reason-${encodeURIComponent(reanchorKey(item))}`} label="Reason for dismissal" required value={reason}
        onChange={event=>setReason(event.target.value)} disabled={saving} />
      {error !== undefined && <ErrorNotice error={error}/>}
      <Button type="submit" loading={saving} disabled={busy || !reason.trim()}>Save dismissal</Button>
      <Button disabled={saving} onClick={cancel}>Cancel</Button>
    </form>}
  </div>;
}
export function ReanchorPanel({ items, labelFor, onContext, resolutions=[], annotations, busy, onRecreate, onDismiss, recreateUnavailableReason, onOpenFinding,
  selectedKey, placeOf, onSelect, onUseLocation, valuesOf, onResolved }: PanelProps) {
  const root=useRef<HTMLElement|null>(null);
  if (!items.length) return null;
  const pending=items.filter(item=>!currentReanchorResolution(item,resolutions,annotations)).length;
  const row = (item: ReanchorItem, index: number) => {
      const parts = pendingDiffParts(item);
      const label = labelFor(item.layer_id,item.term_id);
      const resolution=currentReanchorResolution(item,resolutions,annotations);
      const places=suggestionsOf(item), changed=item.changed_at && validWindow(item.changed_at) ? item.changed_at : null;
      const selected=!resolution && selectedKey===reanchorKey(item), values=valuesOf?.(item);
      const words=oldWords(item);
      return <li key={reanchorKey(item)} className="reanchor-row" data-reanchor-item={reanchorKey(item)} data-reanchor-pending={!resolution}
        data-selected={selected || undefined} aria-current={selected || undefined}>
        <p className="reanchor-row__head">
          <Button variant="quiet" size="sm" className="reanchor-row__term" title={`${label && label !== item.term_id ? `${label} (${item.term_id})` : item.term_id}, ${item.layer_id}`}
            onClick={() => onSelect ? onSelect(item) : onContext(item.new_context)}>{label || item.term_id}</Button>
          {words && <> · <q className="reanchor-row__words">{words}</q></>}
          {!resolution && !places.length && (changed ? <span className="reanchor-row__now"> now “{changed.text}”</span>
            : <span className="reanchor-row__now"> · not found in the corrected text</span>)}
        </p>
        {values && <p className="reanchor-row__values" aria-label="Values">{values}</p>}
        <ResolutionActions item={item} resolution={resolution} busy={busy} onRecreate={onRecreate} onDismiss={onDismiss} recreateUnavailableReason={recreateUnavailableReason}
          onUseLocation={onUseLocation} onSelect={onSelect} place={placeOf?.(item) ?? 0} onResolved={()=>{
          if (onResolved) { onResolved(item); return; }
          const rows=[...(root.current?.querySelectorAll<HTMLElement>('[data-reanchor-item]') ?? [])];
          const next=rows.slice(index+1).concat(rows.slice(0,index)).find(row=>row.dataset.reanchorPending==='true');
          if (next) next.querySelector<HTMLButtonElement>('button')?.focus();
          else root.current?.querySelector<HTMLElement>('.reanchor-completed > summary')?.focus();
        }}/>
        {resolution?.replacement && onOpenFinding && <Button onClick={() => onOpenFinding(resolution.replacement!.annotation_id)}>Open saved finding</Button>}
        <details className="reanchor-row__more"><summary>Show text change</summary>
          <p>{label && label !== item.term_id ? `${label} (${item.term_id})` : item.term_id}, {item.layer_id}</p>
          <p>{Object.prototype.hasOwnProperty.call(reasons, item.reason) ? reasons[item.reason] : `Unknown reason: ${item.reason}`}</p>
          {item.reason === 'changed_modifier_segment' && (item.old_modifiers ?? []).filter(modifier => modifier.segments?.length).map(modifier =>
            <p key={modifier.term_id}>Text of {labelFor(item.layer_id, modifier.term_id) ?? modifier.term_id} changed: “{(modifier.segments ?? []).map(segment => segment.text).join(' … ')}”</p>)}
          {item.axes_values && <p aria-label="Original clinical axes">{Object.entries(item.axes_values).map(([axis,value],axisIndex)=><span key={axis}>
            {axisIndex>0 && ', '}<span>{axis}: {value ?? 'Not specified'}{item.axes_defaulted?.includes(axis) ? ' (defaulted)' : ''}</span>
          </span>)}</p>}
          <p>Original context</p><div className="reanchor-context" data-old-context data-context-start={item.old_context.start}>{oldContext(item)}</div>
          <p>Current context</p><div className="reanchor-context" data-current-context>{validWindow(item.new_context) ? item.new_context.text : 'New context is unavailable.'}</div>
          {parts ? <div data-old-start={item.old_context.start} data-new-start={item.new_context.start}><DiffView before={item.old_context.text} after={item.new_context.text} /></div> : <p>Text changes are unavailable.</p>}
        </details>
      </li>;
  };
  return <section ref={root} className="reanchor-panel detail-section" aria-label="Needs review after the text change">
    <details open><summary><h3>Needs review after the text change ({items.length})</h3></summary>
    {(onRecreate || onDismiss || resolutions.length>0) && <p role="status" data-reanchor-status tabIndex={-1}>{pending} pending, {items.length-pending} resolved</p>}
    <ol>{items.filter(item=>!currentReanchorResolution(item,resolutions,annotations)).map(row)}</ol>
    {pending < items.length && <details className="reanchor-completed"><summary>Completed text-change reviews ({items.length-pending})</summary>
      <ol>{items.filter(item=>!!currentReanchorResolution(item,resolutions,annotations)).map(row)}</ol>
    </details>}
    </details>
  </section>;
}

/** Reads only in an explicitly authorized current proposal context; late results stay hidden. */
export function PendingReanchorPanel({ projectKey, documentId, scope, enabled, proposalSetId, onContext }: {
  projectKey:string; documentId:string; scope:string; enabled:boolean; proposalSetId?:string; onContext:(window:Window)=>void;
}) {
  const identity = useMemo(() => ({}),[projectKey,documentId,scope,enabled,proposalSetId]);
  const [state,setState] = useState<{identity:object; items:ReanchorItem[]; error?:unknown}|null>(null);
  useEffect(() => {
    if (!enabled) return;
    let active = true;
    api.getReanchorItems(projectKey,documentId).then(items => {
      if (active) setState({identity,items:proposalSetId === undefined ? items : items.filter(item => String(item.proposal_set_id) === proposalSetId)});
    },error => {if(active)setState({identity,items:[],error});});
    return () => {active=false;};
  },[identity]);
  const current = enabled && state?.identity===identity ? state : null;
  const labelFor = useTermLabels(projectKey,(current?.items ?? []).flatMap(item => [item.term_id, ...(item.old_modifiers ?? []).map(modifier => modifier.term_id)].map(term_id => ({layer_id:item.layer_id,term_id}))));
  return current?.error ? <ErrorNotice error={current.error}/> : <ReanchorPanel items={current?.items ?? []} labelFor={labelFor} onContext={onContext}/>;
}

/** Display state only: no evidence, draft or selection mutation. */
export function useReanchorContext(text:string, element:HTMLElement|null, identity:string) {
  const latest = useRef({text,element,identity}); latest.current={text,element,identity};
  const timer = useRef<ReturnType<typeof setTimeout>|null>(null);
  const [shown,setShown] = useState<{text:string;element:HTMLElement;identity:string;window:Window}|null>(null);
  useEffect(() => () => {if(timer.current!==null)clearTimeout(timer.current);timer.current=null;},[text,element,identity]);
  /** Scrolls the text to the window and frames it for 2 s; `highlight: false` only scrolls (no reliable location). */
  const reveal = useCallback((window:Window, options?:{highlight?:boolean}) => {
    if(latest.current.text!==text || latest.current.element!==element || latest.current.identity!==identity || !element) return;
    if(timer.current!==null)clearTimeout(timer.current); timer.current=null;setShown(null);
    const points=Array.from(text);
    if(!validWindow(window) || window.end>points.length || points.slice(window.start,window.end).join('')!==window.text) return;
    const offset=toUtf16(text,window.start);
    const runs=[...element.querySelectorAll<HTMLElement>('.run[data-start]')];
    const run=runs.find(node => {const start=Number(node.dataset.start);return start<=offset && offset<start+(node.textContent?.length ?? 0);}) ?? (offset===text.length ? runs.at(-1) : undefined);
    if(run?.firstChild?.nodeType===Node.TEXT_NODE){
      const range=document.createRange(); const local=offset-Number(run.dataset.start);
      range.setStart(run.firstChild,local);range.setEnd(run.firstChild,local);
      const rect=range.getBoundingClientRect?.();
      const top=rect && (rect.width || rect.height) ? rect.top : run.getBoundingClientRect().top;
      element.scrollTop += top-element.getBoundingClientRect().top-element.clientTop;
    }
    if(options?.highlight===false) return;
    setShown({text,element,identity,window});
    const owned=setTimeout(()=>{if(timer.current===owned){setShown(null);timer.current=null;}},2000);timer.current=owned;
  },[text,element,identity]);
  const current=shown?.text===text && shown.element===element && shown.identity===identity ? shown.window : null;
  const contextSegments:CodepointSegment[] = useMemo(()=>current && current.end>current.start ? [{start:current.start,end:current.end}] : [],[current]);
  return {contextSegments,reveal};
}
