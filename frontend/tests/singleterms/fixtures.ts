// Invented example data for the single-term review tests; no real report text.
import type { SingleTermBatch, SingleTermContext, SingleTermContexts, SingleTermDecision, SingleTermGroup, SingleTermSummary } from "../../src/api/client";

export const gid = (n: number): string => n.toString(16).padStart(64, "0");

export function group(n: number, extra: Partial<SingleTermGroup> = {}): SingleTermGroup {
  return {
    group_id: gid(n), language: "de", phrase: `phrase ${n}`, display_text: `Phrase ${n}`, term_id: `HP:${String(1000 + n).padStart(7, "0")}`,
    label: `Term ${n}`, surface_variants: [{ text: `Phrase ${n}`, count: 2 }], occurrences: 2, documents: 2, flags: [], blocked_reason: null,
    conflict_with: [], state: "open", unseen_occurrences: 0, decision: null, second_decision: null, ...extra,
  };
}

export function batch(extra: Partial<SingleTermBatch> = {}): SingleTermBatch {
  return {
    batch_id: 3, basis_id: 1, role: "primary", parent_batch_id: null, second_batch_ids: [], reviewer_username: "rev-04", reviewer_pseudonym: "r4",
    state: "open", filter: { language: "de", stale_only: false }, groups: 3, decided: 0, current_basis: true,
    created_at: "2026-11-02T16:40:00Z", updated_at: "2026-11-02T16:40:00Z", warnings: [], ...extra,
  };
}

export function context(n: number, extra: Partial<SingleTermContext> = {}): SingleTermContext {
  return { occurrence_ref: `occ-${n}`, document_id: `DOC-${n}`, start: 28, end: 37, before: "Seit gestern klagt sie über ", text: "Schwindel", after: " beim Aufstehen.", flags: [], blocked: [], ...extra };
}

export function contexts(groupId: string, items: SingleTermContext[], total = items.length): SingleTermContexts {
  return { group_id: groupId, total, offset: 0, contexts: items };
}

export function decision(groupId: string, extra: Partial<SingleTermDecision> = {}): SingleTermDecision {
  return {
    decision_id: 1, batch_id: 3, basis_id: 1, group_id: groupId, role: "primary", phrase_only: "would_accept", decision: "accept", reason: null, note: null,
    adjusted_span: null, adjusted_term_id: null, reviewer_independent: true, guideline_version: null, created_at: "2026-11-03T10:00:00Z", ...extra,
  };
}

export function summary(extra: Partial<SingleTermSummary> = {}): SingleTermSummary {
  return {
    basis: { basis_id: 2, snapshot_id: "snap-2", derivation_sha256: "a".repeat(64), created_at: "2026-11-02T16:40:00Z", report: {} },
    bases: 2,
    languages: [
      { language: "de", groups: 40, occurrences: 95, open: 20, blocked: 4, decided: 12, stale: 4, conflicts: 2 },
      { language: "en", groups: 30, occurrences: 61, open: 30, blocked: 0, decided: 0, stale: 0, conflicts: 0 },
    ],
    exclusions: { not_present: { de: 14, en: 3 }, not_patient: { de: 2 }, obsolete_term: {} },
    blocked: { contains_other_finding: { de: 3 }, negation_in_span: { de: 1 } },
    batches: { open: 1, submitted: 1, abandoned: 0 },
    agreement: { pairs: 10, agreeing: 9, percent: 90, kappa: 0.78 },
    ...extra,
  };
}
