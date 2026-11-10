import { useCallback, useEffect, useId, useMemo, useRef, useState, type MouseEvent, type ReactNode, type RefObject } from "react";
import { api, ApiError, type SingleTermAncestor, type SingleTermBatch, type SingleTermContexts, type SingleTermDecision, type SingleTermDecisionRequest, type SingleTermGroup } from "../api/client";
import { ErrorNotice } from "../admin/ErrorNotice";
import { routeHref, type Route } from "../app/router";
import { Button, InlineMessage, Kbd, TextInput } from "../ui";
import { useShortcut } from "../ui/shortcuts";
import { AdjustView, type Adjustment } from "./AdjustView";
import { HelpLink } from "../help/HelpLink";
import { ConflictView } from "./ConflictView";
import {
  accepting, batchScope, blockedLabels, contextParts, decisionBadge, flagLabels, GUIDING_QUESTION, label, languageLabel, newRequestId,
  REJECT_REASONS, reasonLabels, type RejectReason,
} from "./labels";
import "./singleterms.css";

type PhraseOnly = NonNullable<SingleTermDecisionRequest["phrase_only"]>;
type Request = Omit<SingleTermDecisionRequest, "request_id">;
type Filter = "open" | "conflicts" | "blocked" | "decided" | "all";
type Item = { kind: "group"; key: string; group: SingleTermGroup } | { kind: "conflict"; key: string; groups: SingleTermGroup[]; outside: number };

export interface ReviewScreenProps {
  projectKey: string;
  batchId: number;
  username: string;
  /** A lead: may open any batch (read-only unless it is their own) and link texts for corrections. */
  canManage: boolean;
  /** Group to open first (route `group`). */
  group?: string;
  onNavigate: (route: Route) => void;
}

export const CONTEXT_PAGE = 5;
const decided = (group: SingleTermGroup) => !!group.decision && group.decision.decision !== "withdrawn";
const itemDecided = (item: Item) => item.kind === "group" ? decided(item.group) : item.groups.every(decided);
const itemGroups = (item: Item) => item.kind === "group" ? [item.group] : item.groups;

/** Queue entries: one per group, but one per phrase for the groups of a phrase conflict. */
export function queueItems(groups: readonly SingleTermGroup[]): Item[] {
  const items: Item[] = [];
  const clusters = new Map<string, { item: Item & { kind: "conflict" }; outside: Set<string> }>();
  const inBatch = new Set(groups.map(group => group.group_id));
  for (const group of groups) {
    if (!group.conflict_with.length) { items.push({ kind: "group", key: group.group_id, group }); continue; }
    const key = `${group.language}\u0000${group.phrase}`;
    let cluster = clusters.get(key);
    if (!cluster) {
      cluster = { item: { kind: "conflict", key: `conflict:${key}`, groups: [], outside: 0 }, outside: new Set() };
      clusters.set(key, cluster);
      items.push(cluster.item);
    }
    cluster.item.groups.push(group);
    for (const other of group.conflict_with) if (!inBatch.has(other)) cluster.outside.add(other);
    cluster.item.outside = cluster.outside.size;
  }
  return items;
}

function matchesFilter(item: Item, filter: Filter): boolean {
  switch (filter) {
    case "all": return true;
    case "open": return !itemDecided(item);
    case "decided": return itemDecided(item);
    case "conflicts": return item.kind === "conflict";
    case "blocked": return itemGroups(item).some(group => !!group.blocked_reason);
  }
}

function RouteLink({ route, onNavigate, children }: { route: Route; onNavigate: (route: Route) => void; children: ReactNode }): JSX.Element {
  return <a href={routeHref(route)} onClick={(event: MouseEvent<HTMLAnchorElement>) => {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault(); onNavigate(route);
  }}>{children}</a>;
}

/** `ancestors`: the group's offered terms, for the name of a generalised term. */
function decisionText(decision: SingleTermDecision, ancestors?: readonly SingleTermAncestor[]): string {
  switch (decision.decision) {
    case "accept": return "Accepted";
    case "adjust_span": {
      const text = (decision.adjusted_span as { text?: string } | null)?.text;
      return text ? `Adjusted and accepted: re-cut to “${text}”` : "Adjusted (span re-cut) and accepted";
    }
    case "adjust_term": {
      const term = decision.adjusted_term_id ?? "";
      const name = ancestors?.find(item => item.term_id === term)?.label;
      return `Adjusted and accepted: generalised to ${name ? `${name} (${term})` : term}`;
    }
    case "reject": return `Rejected: ${decision.reason ? reasonLabels[decision.reason] : ""}`;
    case "withdrawn": return "Withdrawn";
  }
}

/**
 * Review screen of one batch (mockup "Review"): the queue on the left, the work column on the right with the
 * two-step flow: (1) the phrase alone, recorded before (2) the contexts show, then (3) the decision.
 * Keys: Y / N in step 1, A / E / R in step 3.
 */
export function ReviewScreen(props: ReviewScreenProps): JSX.Element {
  return <ReviewContent key={`${props.projectKey}:${props.batchId}`} {...props} />;
}

function ReviewContent({ projectKey, batchId, username, canManage, group: initialGroup, onNavigate }: ReviewScreenProps): JSX.Element {
  const id = useId().replace(/:/g, "");
  const [batch, setBatch] = useState<SingleTermBatch | null>(null);
  const [groups, setGroups] = useState<SingleTermGroup[] | null>(null);
  const [loadError, setLoadError] = useState<unknown>();
  const [retry, setRetry] = useState(0);
  const [filter, setFilter] = useState<Filter>("open");
  const [current, setCurrent] = useState<string | null>(initialGroup ?? null);
  const [mode, setMode] = useState<"review" | "adjust">("review");
  const [phraseOnly, setPhraseOnly] = useState<Record<string, PhraseOnly>>({});
  const [reason, setReason] = useState<RejectReason | null>(null);
  const [note, setNote] = useState("");
  const [contexts, setContexts] = useState<Record<string, SingleTermContexts | undefined>>({});
  const [contextError, setContextError] = useState<unknown>();
  const [ancestors, setAncestors] = useState<Record<string, readonly SingleTermAncestor[] | undefined>>({});
  const [ancestorError, setAncestorError] = useState<unknown>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>();
  const [last, setLast] = useState<{ groupId: string; text: string } | null>(null);
  const requests = useRef(new Map<string, string>());
  const loading = useRef(new Set<string>());
  const reasonsRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let active = true;
    setLoadError(undefined);
    void Promise.all([api.getSingleTermBatch(projectKey, batchId), api.listSingleTermGroups(projectKey, { batch: batchId })]).then(([batchView, rows]) => {
      if (!active) return;
      setBatch(batchView); setGroups(rows);
      setPhraseOnly(current => {
        const next = { ...current };
        for (const row of rows) if (row.decision?.phrase_only && !next[row.group_id]) next[row.group_id] = row.decision.phrase_only;
        return next;
      });
    }, failure => { if (active) setLoadError(failure); });
    return () => { active = false; };
  }, [projectKey, batchId, retry]);

  const items = useMemo(() => queueItems(groups ?? []), [groups]);
  const visible = items.filter(item => matchesFilter(item, filter));
  const currentItem = items.find(item => itemGroups(item).some(group => group.group_id === current))
    ?? visible[0] ?? items[0];
  const currentGroup = currentItem?.kind === "group" ? currentItem.group : undefined;
  const readOnly = !batch || batch.state !== "open" || batch.reviewer_username !== username;
  const decidedCount = (groups ?? []).filter(decided).length;
  const total = groups?.length ?? 0;

  const contextsRef = useRef(contexts);
  contextsRef.current = contexts;
  const loadContexts = useCallback((groupId: string, more = false) => {
    const key = `${groupId}:${more}`;
    const have = contextsRef.current[groupId];
    if (loading.current.has(key) || (have && !more)) return;
    loading.current.add(key);
    setContextError(undefined);
    void api.singleTermContexts(projectKey, groupId, { batch: batchId, limit: CONTEXT_PAGE, offset: more ? have?.contexts.length ?? 0 : 0 }).then(view => {
      setContexts(now => {
        const before = now[groupId];
        return { ...now, [groupId]: more && before ? { ...view, contexts: [...before.contexts, ...view.contexts] } : view };
      });
    }, failure => setContextError(failure)).finally(() => loading.current.delete(key));
  }, [projectKey, batchId]);

  const judged = currentGroup ? phraseOnly[currentGroup.group_id] : undefined;
  useEffect(() => {
    if (currentGroup && (judged || readOnly || decided(currentGroup))) loadContexts(currentGroup.group_id);
  }, [currentGroup, judged, readOnly, loadContexts]);

  // Also for a decided term adjustment, to name the generalised term.
  const adjustGroup = mode === "adjust" || currentGroup?.decision?.decision === "adjust_term" ? currentGroup?.group_id : undefined;
  const haveAncestors = adjustGroup !== undefined && ancestors[adjustGroup] !== undefined;
  useEffect(() => {
    if (adjustGroup === undefined || haveAncestors) return;
    let active = true;
    setAncestorError(undefined);
    void api.singleTermAncestors(projectKey, adjustGroup, { batch: batchId }).then(view => {
      if (active) setAncestors(now => ({ ...now, [adjustGroup]: view.ancestors }));
    }, failure => { if (active) setAncestorError(failure); });
    return () => { active = false; };
  }, [projectKey, batchId, adjustGroup, haveAncestors]);

  const select = (item: Item) => {
    setCurrent(itemGroups(item)[0].group_id);
    setMode("review"); setReason(null); setNote(""); setError(undefined);
  };
  const nextOpen = (after: string, rows: readonly SingleTermGroup[]) => {
    const list = queueItems(rows);
    const index = list.findIndex(item => itemGroups(item).some(group => group.group_id === after));
    const ordered = [...list.slice(index + 1), ...list.slice(0, Math.max(index, 0))];
    return ordered.find(item => item.kind === "group" && !itemDecided(item));
  };

  const send = async (request: Request): Promise<SingleTermDecision> => {
    const signature = JSON.stringify(request);
    const requestId = requests.current.get(signature) ?? newRequestId();
    requests.current.set(signature, requestId);
    const view = await api.decideSingleTerm(projectKey, batchId, { ...request, request_id: requestId });
    requests.current.delete(signature);
    return view;
  };
  const apply = (rows: SingleTermGroup[], view: SingleTermDecision): SingleTermGroup[] => rows.map(row => row.group_id !== view.group_id ? row
    : { ...row, decision: view, state: view.decision === "withdrawn" ? (row.blocked_reason ? "blocked" : "open") : "decided" });

  const decide = async (requestsToSend: Request[], options: { advance?: boolean } = {}) => {
    if (busy || readOnly || !groups || !requestsToSend.length) return;
    setBusy(true); setError(undefined);
    let rows = groups;
    try {
      let lastView: SingleTermDecision | null = null;
      for (const request of requestsToSend) {
        const view = await send(request);
        rows = apply(rows, view);
        setGroups(rows);
        lastView = view;
      }
      if (lastView) {
        const decidedGroup = rows.find(row => row.group_id === lastView!.group_id);
        setLast(lastView.decision === "withdrawn" ? null : { groupId: lastView.group_id, text: `${decidedGroup?.display_text ?? ""}: ${decisionText(lastView, ancestors[lastView.group_id])}.` });
        setMode("review"); setReason(null); setNote("");
        if (options.advance && lastView.decision !== "withdrawn") {
          const next = nextOpen(lastView.group_id, rows);
          if (next) setCurrent(itemGroups(next)[0].group_id);
        }
      }
    } catch (failure: unknown) {
      setError(failure);
      if (failure instanceof ApiError && failure.code === "SINGLE_TERM_BATCH_NOT_OPEN") setRetry(value => value + 1);
    } finally { setBusy(false); }
  };

  const decideCurrent = (kind: "accept" | "reject", extra: Partial<Request> = {}) => {
    if (!currentGroup || !judged) return;
    void decide([{ group_id: currentGroup.group_id, decision: kind, phrase_only: judged, note: note.trim() || null, ...extra }], { advance: true });
  };
  const undo = (groupId: string) => {
    setCurrent(groupId);
    void decide([{ group_id: groupId, decision: "withdrawn" }]);
  };
  const submitAdjustment = (adjustment: Adjustment) => {
    if (!currentGroup || !judged) return;
    const { note: adjustNote, ...rest } = adjustment;
    void decide([{ group_id: currentGroup.group_id, phrase_only: judged, note: adjustNote.trim() || null, ...rest }], { advance: true });
  };
  const submitBatch = async () => {
    if (!batch || busy) return;
    setBusy(true); setError(undefined);
    const signature = "submit";
    const requestId = requests.current.get(signature) ?? newRequestId();
    requests.current.set(signature, requestId);
    try {
      setBatch(await api.singleTermBatchAction(projectKey, batchId, "submit", requestId));
      requests.current.delete(signature);
    } catch (failure: unknown) { setError(failure); } finally { setBusy(false); }
  };

  // Step 1 and step 3 keys, only while the review column shows them.
  const reviewing = mode === "review" && !readOnly && !!currentGroup && !decided(currentGroup);
  const step1 = reviewing && !judged;
  const step3 = reviewing && !!judged && !busy;
  const keyOptions = { group: "Single-term review" };
  const judge = (value: PhraseOnly) => { if (currentGroup) setPhraseOnly(now => ({ ...now, [currentGroup.group_id]: value })); };
  useShortcut("y", () => judge("would_accept"), { ...keyOptions, enabled: step1, description: "Yes, as a phrase" });
  useShortcut("n", () => judge("would_reject"), { ...keyOptions, enabled: step1, description: "No, not as a phrase" });
  useShortcut("a", () => { if (!currentGroup?.blocked_reason) decideCurrent("accept"); }, { ...keyOptions, enabled: step3 && !currentGroup?.blocked_reason, description: "Accept" });
  useShortcut("e", () => setMode("adjust"), { ...keyOptions, enabled: step3, description: "Adjust" });
  useShortcut("r", () => {
    if (reason) decideCurrent("reject", { reason });
    else reasonsRef.current?.querySelector<HTMLButtonElement>("button")?.focus();
  }, { ...keyOptions, enabled: step3, description: "Reject (choose a reason first)" });

  if (loadError !== undefined) return <section className="st-page"><h1>Single-term review</h1><ErrorNotice error={loadError} onRetry={() => setRetry(value => value + 1)} /></section>;
  if (!batch || !groups) return <section className="st-page"><h1>Single-term review</h1><InlineMessage tone="info">Loading the batch…</InlineMessage></section>;

  const counts = {
    open: items.filter(item => matchesFilter(item, "open")).length,
    conflicts: items.filter(item => item.kind === "conflict").length,
    blocked: items.filter(item => matchesFilter(item, "blocked")).length,
    decided: items.filter(item => matchesFilter(item, "decided")).length,
  };
  const chip = (value: Filter, text: string) => <button type="button" className="st-chip" aria-pressed={filter === value} onClick={() => setFilter(value)}>{text}</button>;
  const problemLink = (documentId: string) => canManage
    ? <RouteLink route={{ name: "projectDocuments", key: projectKey, q: documentId }} onNavigate={onNavigate}>correct the final result of text {documentId}</RouteLink>
    : <>ask a lead for a problem report on text {documentId}</>;
  const language = (batch.filter as { language?: string | null }).language;

  let work: ReactNode = null;
  if (!currentItem) work = <p className="st-muted">This batch has no groups.</p>;
  else if (currentItem.kind === "conflict") {
    work = <ConflictView key={currentItem.key} groups={currentItem.groups} outside={currentItem.outside} contexts={contexts} loadContexts={loadContexts}
      readOnly={readOnly} busy={busy} error={error} onDecide={list => void decide(list)} />;
  } else if (mode === "adjust" && currentGroup) {
    work = <AdjustView key={currentGroup.group_id} group={currentGroup} contexts={contexts[currentGroup.group_id]?.contexts ?? []} busy={busy} error={error}
      ancestors={ancestors[currentGroup.group_id]} ancestorError={ancestorError}
      problemLink={problemLink} onCancel={() => { setMode("review"); setError(undefined); }} onSubmit={submitAdjustment} />;
  } else if (currentGroup) {
    work = <GroupWork id={id} group={currentGroup} ancestors={ancestors[currentGroup.group_id]} judged={judged} readOnly={readOnly} contexts={contexts[currentGroup.group_id]} contextError={contextError}
      onJudge={judge} onMore={() => loadContexts(currentGroup.group_id, true)} busy={busy} error={error} reason={reason} onReason={setReason}
      note={note} onNote={setNote} reasonsRef={reasonsRef} problemLink={problemLink}
      onAccept={() => decideCurrent("accept")} onAdjust={() => setMode("adjust")} onReject={() => { if (reason) decideCurrent("reject", { reason }); }}
      onUndo={() => undo(currentGroup.group_id)} />;
  }

  return <section className="st-page" aria-labelledby={`${id}-title`}>
    <div className="st-spread">
      <div className="st-row">
        <RouteLink route={{ name: "projectSingleTerms", key: projectKey }} onNavigate={onNavigate}>← Single terms</RouteLink>
        <h1 id={`${id}-title`} style={{ fontSize: "var(--size-md)" }}>Batch #{batch.batch_id} · {language ? languageLabel(language) : batchScope(batch)}{batch.role === "second" ? " · second review" : ""}</h1>
        <span className="st-muted" role="status">{decidedCount} of {total} decided</span>
      </div>
      <div className="st-row">
        <RouteLink route={{ name: "projectGuidelines", key: projectKey }} onNavigate={onNavigate}>Guidelines</RouteLink>
        <HelpLink screen="singleTermReview" />
        {!readOnly && <Button variant="primary" disabled={decidedCount < total} loading={busy && decidedCount === total} onClick={() => void submitBatch()}
          title={decidedCount < total ? "Decide every group first." : undefined}>Submit batch</Button>}
      </div>
    </div>
    {batch.state !== "open" && <InlineMessage tone="info">{batch.state === "submitted" ? "This batch is submitted. A lead can reopen it." : "This batch was abandoned; its decisions no longer count."}</InlineMessage>}
    {batch.state === "open" && batch.reviewer_username !== username && <InlineMessage tone="info">{`This batch belongs to ${batch.reviewer_username}. You see it read-only.`}</InlineMessage>}
    {last && <p className="st-recorded" role="status">{last.text} {!readOnly && <Button size="sm" variant="quiet" disabled={busy} onClick={() => undo(last.groupId)}>Undo</Button>}</p>}
    <div className="st-review">
      <aside className="st-card st-queue" aria-label="Groups in this batch">
        <div className="st-queue-filters" role="group" aria-label="Show">
          {chip("open", `Open ${counts.open}`)}{chip("conflicts", `Conflicts ${counts.conflicts}`)}{chip("blocked", `Blocked ${counts.blocked}`)}{chip("decided", `Decided ${counts.decided}`)}{chip("all", "All")}
        </div>
        <ul className="st-queue-list">
          {visible.map(item => {
            const active = item === currentItem;
            const first = itemGroups(item)[0];
            const badge = item.kind === "group" ? decisionBadge(item.group.decision) : itemDecided(item) ? { text: "decided", tone: "success" as const } : { text: "conflict", tone: "warning" as const };
            const blocked = item.kind === "group" && item.group.blocked_reason;
            return <li key={item.key}><button type="button" className="st-queue-item" aria-current={active} onClick={() => select(item)}>
              <span className="st-queue-item-head"><strong>{first.display_text}</strong><span className="st-muted st-small">{item.kind === "group" ? item.group.term_id : `${item.groups.length + item.outside} terms`}</span></span>
              <span className="st-small st-muted">{item.kind === "conflict" ? "phrase conflict" : blocked ? `blocked: ${label(blockedLabels, blocked)}` : `${first.occurrences} ${first.occurrences === 1 ? "occurrence" : "occurrences"} in ${first.documents} ${first.documents === 1 ? "text" : "texts"}`}</span>
              {badge ? <span className={`st-pill st-pill--${badge.tone}`}>{badge.text}</span> : blocked ? <span className="st-pill st-pill--warning">blocked</span> : null}
            </button></li>;
          })}
          {!visible.length && <li className="st-queue-item st-muted st-small" style={{ cursor: "default" }}>Nothing to show here.</li>}
        </ul>
      </aside>
      {mode === "adjust" ? <div style={{ flex: "999 1 520px", minWidth: 0 }}>{work}</div> : <div className="st-work">{work}</div>}
    </div>
  </section>;
}

interface GroupWorkProps {
  id: string;
  group: SingleTermGroup;
  ancestors: readonly SingleTermAncestor[] | undefined;
  judged: PhraseOnly | undefined;
  readOnly: boolean;
  contexts: SingleTermContexts | undefined;
  contextError: unknown;
  busy: boolean;
  error: unknown;
  reason: RejectReason | null;
  note: string;
  reasonsRef: RefObject<HTMLDivElement>;
  problemLink: (documentId: string) => ReactNode;
  onJudge: (value: PhraseOnly) => void;
  onMore: () => void;
  onReason: (reason: RejectReason) => void;
  onNote: (note: string) => void;
  onAccept: () => void;
  onAdjust: () => void;
  onReject: () => void;
  onUndo: () => void;
}

function GroupWork({ id, group, ancestors, judged, readOnly, contexts, contextError, busy, error, reason, note, reasonsRef, problemLink, onJudge, onMore, onReason, onNote, onAccept, onAdjust, onReject, onUndo }: GroupWorkProps): JSX.Element {
  const isDecided = decided(group);
  const showContexts = readOnly || isDecided || !!judged;
  const blocked = group.blocked_reason;
  return <>
    <section className="st-card" aria-labelledby={`${id}-phrase`}>
      <p className="st-step">Step 1 · Phrase only</p>
      <h2 id={`${id}-phrase`} className="st-phrase">{group.display_text}</h2>
      <p className="st-row" style={{ margin: 0 }}><strong>{group.label ?? group.term_id}</strong><span className="st-muted">{group.term_id}</span>
        {group.flags.map(flag => <span key={flag} className="st-pill st-pill--neutral">{label(flagLabels, flag)}</span>)}</p>
      {group.surface_variants.length > 1 && <p className="st-small st-muted" style={{ margin: 0 }}>Written as: {group.surface_variants.map(item => `${item.text} (${item.count})`).join(", ")}</p>}
      {blocked && !isDecided && <p className="st-warn st-small">Blocked: the span {blocked === "negation_in_span" ? "holds a negation cue" : "contains another finding"}. It cannot be accepted as it is; re-cut it or reject it.</p>}
      <p className="st-question">{GUIDING_QUESTION}</p>
      {!readOnly && !isDecided && !judged && <div className="st-row" role="group" aria-label="Phrase-only judgment">
        <Button onClick={() => onJudge("would_accept")}>Yes, as a phrase <Kbd>Y</Kbd></Button>
        <Button variant="danger" onClick={() => onJudge("would_reject")}>No <Kbd>N</Kbd></Button>
        <span className="st-muted st-small">Recorded before the contexts are shown.</span>
      </div>}
      {(judged || group.decision?.phrase_only) && <p className="st-recorded st-small" role="status">Phrase-only judgment recorded: <strong>{(judged ?? group.decision?.phrase_only) === "would_accept" ? "would accept" : "would reject"}</strong></p>}
    </section>
    {showContexts && <section className="st-card" aria-labelledby={`${id}-contexts`}>
      <div className="st-spread"><h2 id={`${id}-contexts`} className="st-step">Step 2 · Contexts (check for annotation errors)</h2>
        {contexts && <span className="st-muted st-small">{contexts.contexts.length} of {contexts.total}</span>}</div>
      {contextError !== undefined && !contexts && <ErrorNotice error={contextError} />}
      {!contexts && contextError === undefined && <p className="st-muted st-small">Loading contexts…</p>}
      {contexts && <ul className="st-contexts">{contexts.contexts.map(item => <li key={item.occurrence_ref} className="st-context">
        {contextParts(item).before}<mark>{item.text}</mark>{contextParts(item).after} <span className="st-muted st-small">{item.document_id}</span>
      </li>)}</ul>}
      {contexts && contexts.contexts.length < contexts.total && <Button size="sm" onClick={onMore}>Show more contexts</Button>}
      {group.unseen_occurrences > 0 && <p className="st-small st-muted" style={{ margin: 0 }}>{group.unseen_occurrences} {group.unseen_occurrences === 1 ? "occurrence is" : "occurrences are"} new since the decision and were not seen by its reviewer.</p>}
    </section>}
    {showContexts && isDecided && group.decision && <p className="st-recorded" role="status">{decisionText(group.decision, ancestors)}.{group.decision.note ? ` Note: ${group.decision.note}` : ""} {!readOnly && <Button size="sm" variant="quiet" disabled={busy} onClick={onUndo}>Undo</Button>}</p>}
    {!readOnly && !isDecided && judged && <section className="st-card" aria-labelledby={`${id}-decision`}>
      <h2 id={`${id}-decision`} className="st-step">Step 3 · Decision</h2>
      <div className="st-row">
        <Button variant="primary" disabled={!!blocked} loading={busy} onClick={onAccept} title={blocked ? "A blocked group cannot be accepted as it is." : undefined}>Accept <Kbd>A</Kbd></Button>
        <Button onClick={onAdjust} disabled={busy || !contexts}>Adjust… <Kbd>E</Kbd></Button>
        <Button variant="danger" disabled={!reason} loading={busy} onClick={onReject}>Reject <Kbd>R</Kbd></Button>
      </div>
      <div ref={reasonsRef} className="st-reasons" role="group" aria-label="Reject reason">
        {REJECT_REASONS.map(item => <button key={item} type="button" className="st-chip" aria-pressed={reason === item} onClick={() => onReason(item)}>{reasonLabels[item]}</button>)}
      </div>
      <TextInput id={`${id}-note`} label="Note (optional)" value={note} maxLength={2000} onChange={event => onNote(event.target.value)} />
      <p className="st-small st-muted" style={{ margin: 0 }}>Term wrong in its context? Then the final result has an error: {contexts?.contexts[0] ? problemLink(contexts.contexts[0].document_id) : "ask a lead for a problem report on the text"}, instead of rejecting.</p>
      {error !== undefined && <ErrorNotice error={error} />}
    </section>}
    {isDecided && error !== undefined && <ErrorNotice error={error} />}
    {accepting(group.second_decision?.decision) !== accepting(group.decision?.decision) && group.second_decision && <p className="st-small st-muted">Second review differs: {decisionText(group.second_decision)}.</p>}
  </>;
}
