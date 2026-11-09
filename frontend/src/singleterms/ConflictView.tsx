import { useEffect, useId, useState } from "react";
import type { SingleTermContexts, SingleTermDecisionRequest, SingleTermGroup } from "../api/client";
import { ErrorNotice } from "../admin/ErrorNotice";
import { Button } from "../ui";
import { accepting, blockedLabels, decisionBadge, label } from "./labels";

type Request = Omit<SingleTermDecisionRequest, "request_id">;

export interface ConflictViewProps {
  /** The groups of this batch that share the phrase (same language) and differ in term. */
  groups: readonly SingleTermGroup[];
  /** Conflicting groups of the phrase that are not in this batch. */
  outside: number;
  contexts: Readonly<Record<string, SingleTermContexts | undefined>>;
  loadContexts: (groupId: string) => void;
  readOnly: boolean;
  busy: boolean;
  error?: unknown;
  /** Sent in order; the rejections go first so that the accept is never refused for another accepted term. */
  onDecide: (requests: Request[]) => void;
}

const decided = (group: SingleTermGroup) => !!group.decision && group.decision.decision !== "withdrawn";

/**
 * Phrase conflict (mockup "Conflict"): one phrase annotated with several terms. A case gets exactly one term,
 * so the reviewer chooses one (the others are rejected with reason "conflict") or rejects them all. Step 1
 * records which term the phrase alone suggests before the contexts show.
 */
export function ConflictView({ groups, outside, contexts, loadContexts, readOnly, busy, error, onDecide }: ConflictViewProps): JSX.Element {
  const id = useId().replace(/:/g, "");
  const previous = groups.find(group => group.decision?.phrase_only === "would_accept")?.group_id
    ?? (groups.some(group => group.decision?.phrase_only) ? "none" : null);
  const [phraseChoice, setPhraseChoice] = useState<string | null>(previous);
  const shown = readOnly || phraseChoice !== null;
  useEffect(() => { if (shown) for (const group of groups) loadContexts(group.group_id); }, [shown, groups, loadContexts]);
  const phraseOnly = (group: SingleTermGroup) => phraseChoice === group.group_id ? "would_accept" as const : "would_reject" as const;
  const choose = (chosen: SingleTermGroup) => onDecide([
    ...groups.filter(group => group !== chosen && !(group.decision?.decision === "reject" && group.decision.reason === "conflict"))
      .map(group => ({ group_id: group.group_id, decision: "reject" as const, reason: "conflict" as const, phrase_only: phraseOnly(group) })),
    ...(chosen.decision?.decision === "accept" ? [] : [{ group_id: chosen.group_id, decision: "accept" as const, phrase_only: phraseOnly(chosen) }]),
  ]);
  const rejectAll = () => onDecide(groups.map(group => ({ group_id: group.group_id, decision: "reject" as const, reason: "needs_context" as const, phrase_only: phraseOnly(group) })));
  const withdrawAll = () => onDecide(groups.filter(decided).map(group => ({ group_id: group.group_id, decision: "withdrawn" as const })));
  const phrase = groups[0]?.display_text ?? "";
  const anyDecided = groups.some(decided);
  const acceptedGroup = groups.find(group => accepting(group.decision?.decision));

  return <div className="st-work" style={{ flex: "1 1 auto" }}>
    <section className="st-card" aria-labelledby={`${id}-phrase`}>
      <p className="st-row" style={{ margin: 0 }}><span className="st-pill st-pill--warning">same phrase, {groups.length + outside} terms</span><span className="st-muted">A case gets exactly one term. Choose one or reject them all.</span></p>
      <h2 id={`${id}-phrase`} className="st-phrase">{phrase}</h2>
      {outside > 0 && <p className="st-small st-muted" style={{ margin: 0 }}>{outside} other {outside === 1 ? "term" : "terms"} of this phrase {outside === 1 ? "is" : "are"} in another batch.</p>}
      {!readOnly && <>
        <p className="st-step">Step 1 · Phrase only</p>
        <p className="st-question">Which term would a clinician map this phrase alone, without its sentence, to?</p>
        {phraseChoice === null ? <div className="st-row" role="group" aria-label="Phrase-only judgment">
          {groups.map(group => <Button key={group.group_id} onClick={() => setPhraseChoice(group.group_id)}>{group.label ?? group.term_id}</Button>)}
          <Button variant="danger" onClick={() => setPhraseChoice("none")}>None of them</Button>
          <span className="st-muted st-small">Recorded before the contexts are shown.</span>
        </div> : <p className="st-recorded st-small" role="status">Phrase-only judgment recorded: <strong>{phraseChoice === "none" ? "none of the terms" : groups.find(group => group.group_id === phraseChoice)?.label ?? phraseChoice}</strong></p>}
      </>}
    </section>
    {shown && <>
      <div className="st-versus">
        {groups.map(group => {
          const badge = decisionBadge(group.decision);
          const view = contexts[group.group_id];
          return <section key={group.group_id} className="st-card" aria-label={`${group.label ?? group.term_id} · ${group.term_id}`}>
            <div className="st-spread"><strong>{group.label ?? group.term_id} · {group.term_id}</strong><span className="st-muted">{group.occurrences} {group.occurrences === 1 ? "occurrence" : "occurrences"}</span></div>
            {badge && <p style={{ margin: 0 }}><span className={`st-pill st-pill--${badge.tone}`}>{badge.text}{group.decision?.reason ? `: ${group.decision.reason.replace(/_/g, " ")}` : ""}</span></p>}
            {group.blocked_reason && <p className="st-warn st-small">Blocked: {label(blockedLabels, group.blocked_reason)}. Re-cut it in the group's own review, or reject.</p>}
            {view ? <ul className="st-contexts">{view.contexts.slice(0, 2).map(item => <li key={item.occurrence_ref} className="st-context">
              …{[...item.before].slice(-60).join("")}<mark>{item.text}</mark>{[...item.after].slice(0, 60).join("")}… <span className="st-muted st-small">{item.document_id}</span>
            </li>)}</ul> : <p className="st-muted st-small">Loading contexts…</p>}
            {!readOnly && <Button variant="primary" disabled={!!group.blocked_reason || acceptedGroup === group} loading={busy} onClick={() => choose(group)}>Use this term</Button>}
          </section>;
        })}
      </div>
      {!readOnly && <div className="st-row">
        <Button variant="danger" loading={busy} onClick={rejectAll}>Reject all: needs context</Button>
        {anyDecided && <Button variant="quiet" disabled={busy} onClick={withdrawAll}>Undo these decisions</Button>}
        <span className="st-muted st-small">Choosing one term rejects the other groups with reason “conflict”. Every decision is recorded.</span>
      </div>}
      {error !== undefined && <ErrorNotice error={error} />}
    </>}
  </div>;
}
