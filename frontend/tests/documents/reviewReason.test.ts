import { describe, expect, it } from "vitest";
import { reasonDocumentId } from "../../src/documents/reviewReason";
import { version, work } from "./fixtures";

const fix = (previous: string) => ({ reason: "Typo", previous_document_id: previous, inserted_characters: 1, deleted_characters: 1, corrected_at: "2026-11-17T10:12:00", corrected_by: null });
const v1 = version({ document_id: "c-de", translation_status: "reviewed", latest_review_decision: "query", is_newest_in_chain: false });
const v2 = version({ document_id: "c-de-v2", version: 2, origin: "correction", derived_from: "c-de", translation_status: "reviewed", latest_review_decision: "query", is_newest_in_chain: false, editorial_correction: fix("c-de") });
const v3 = version({ document_id: "c-de-v3", version: 3, origin: "correction", derived_from: "c-de-v2", translation_status: "reviewed", latest_review_decision: "query", editorial_correction: fix("c-de-v2") });
const review = (document_id: string) => work({ assignment_id: 1, document_id, task: "translation_review", status: "submitted" });

describe("reasonDocumentId", () => {
  it("is the newest rejected or queried version", () => {
    expect(reasonDocumentId({ is_source: false, versions: [v1] })).toBe("c-de");
    expect(reasonDocumentId({ is_source: true, versions: [v1] })).toBeNull();
    expect(reasonDocumentId({ is_source: false, versions: [{ ...v1, latest_review_decision: "accepted_unchanged" }] })).toBeNull();
  });
  it("review 2, F1: a typo fix has the decision of the version it fixes, so the reason is read there", () => {
    expect(reasonDocumentId({ is_source: false, versions: [v1, v2, v3], work: [review("c-de")] })).toBe("c-de");
  });
  it("a typo fix that was reviewed itself has its own reason", () => {
    expect(reasonDocumentId({ is_source: false, versions: [v1, v2, v3], work: [review("c-de"), review("c-de-v2")] })).toBe("c-de-v2");
  });
});
