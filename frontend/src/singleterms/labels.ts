import type { SingleTermBatch, SingleTermContext, SingleTermDecision, SingleTermGroup } from "../api/client";
import { languageName } from "../translation/labels";

export type RejectReason = NonNullable<SingleTermDecision["reason"]>;
export type DecisionKind = SingleTermDecision["decision"];
export type GroupState = SingleTermGroup["state"];

/** The guiding question of step 1 (spec section 3). */
export const GUIDING_QUESTION = "Would a clinician map this phrase alone, without its sentence, to this term?";

/** Reasons a reviewer can pick in step 3; `conflict` belongs to the conflict view. */
export const REJECT_REASONS: readonly RejectReason[] = [
  "needs_context", "ambiguous_abbreviation", "too_general", "term_wrong_out_of_context",
  "contains_other_finding", "negation_in_span", "needs_rewrite", "other",
];

export const reasonLabels: Readonly<Record<RejectReason, string>> = {
  needs_context: "needs context",
  ambiguous_abbreviation: "ambiguous abbreviation",
  too_general: "too general",
  term_wrong_out_of_context: "term wrong out of context",
  contains_other_finding: "contains other finding",
  negation_in_span: "negation in span",
  needs_rewrite: "only usable rewritten (words inside removed)",
  conflict: "conflict",
  other: "other",
};

export const decisionLabels: Readonly<Record<DecisionKind, string>> = {
  accept: "accepted",
  adjust_span: "adjusted (re-cut)",
  adjust_term: "adjusted (term)",
  reject: "rejected",
  withdrawn: "withdrawn",
};

export const stateLabels: Readonly<Record<GroupState, string>> = {
  open: "open", blocked: "blocked", decided: "decided", stale: "stale",
};

/** Exclusion rules in the order the derivation applies them (exchange/single_terms.py). */
export const exclusionLabels: Readonly<Record<string, string>> = {
  other_layer: "not an HPO layer",
  not_present: "assertion not present",
  not_patient: "experiencer not patient",
  unresolved: "left unresolved",
  no_span: "whole-text finding",
  discontinuous: "discontinuous passage",
  shared_span: "span shared with another term",
  obsolete_term: "obsolete term",
  measurement: "non-verbalised measurement",
};

export const blockedLabels: Readonly<Record<string, string>> = {
  contains_other_finding: "contains other finding",
  negation_in_span: "negation in span",
};

export const flagLabels: Readonly<Record<string, string>> = {
  modifier_in_span: "modifier inside the span",
  outside_phenotypic_abnormality: "outside Phenotypic abnormality",
};

export const label = (labels: Readonly<Record<string, string>>, key: string): string => labels[key] ?? key.replace(/_/g, " ");

export const languageLabel = (code: string): string => languageName(code);

/** "German · texts", "German · stale only", "German · 20 % sample": the batch's frozen filter in words. */
export function batchScope(batch: Pick<SingleTermBatch, "filter" | "role">): string {
  const filter = batch.filter as { language?: string | null; layer_id?: string | null; document_ids?: string[] | null; stale_only?: boolean; limit?: number | null; share?: number };
  const parts = [filter.language ? languageLabel(filter.language) : "All languages"];
  if (batch.role === "second" && typeof filter.share === "number") parts.push(`${Math.round(filter.share * 100)} % sample`);
  if (filter.stale_only) parts.push("stale only");
  if (filter.document_ids?.length) parts.push(`${filter.document_ids.length} ${filter.document_ids.length === 1 ? "text" : "texts"}`);
  if (filter.layer_id) parts.push(filter.layer_id);
  if (filter.limit) parts.push(`first ${filter.limit}`);
  return parts.join(" · ");
}

/** True when the decision lets the group into the export (accept or an adjustment). */
export const accepting = (decision: DecisionKind | undefined | null): boolean =>
  decision === "accept" || decision === "adjust_span" || decision === "adjust_term";

/** Short words for a group's own decision in the queue. */
export function decisionBadge(decision: SingleTermDecision | null): { text: string; tone: "success" | "info" | "danger" } | null {
  if (!decision || decision.decision === "withdrawn") return null;
  if (decision.decision === "accept") return { text: "accepted", tone: "success" };
  if (decision.decision === "reject") return { text: "rejected", tone: "danger" };
  return { text: "adjusted", tone: "info" };
}

/** A context's text before and after the phrase, with "…" only where it stops short of the text's start or end. */
export function contextParts(item: SingleTermContext, width?: number): { before: string; after: string } {
  const before = width === undefined ? [...item.before] : [...item.before].slice(-width);
  const after = width === undefined ? [...item.after] : [...item.after].slice(0, width);
  return {
    before: (item.start > before.length ? "…" : "") + before.join(""),
    after: after.join("") + (item.end + after.length < item.text_length ? "…" : ""),
  };
}

export const percent = (value: number | null | undefined): string => value == null ? "–" : `${Math.round(value)} %`;
export const kappa = (value: number | null | undefined): string => value == null ? "–" : value.toFixed(2);

/** A fresh idempotency key for one user action. */
export function newRequestId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") return crypto.randomUUID();
  return `st-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}
