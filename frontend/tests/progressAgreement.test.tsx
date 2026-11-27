import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { api, ApiError, type AgreementPooled, type ProjectAgreement } from "../src/api/client";
import { agreementBreakdown, ProgressAgreement } from "../src/admin/ProgressAgreement";

// The worked example of docs/design/hierarchy-agreement.md (#600): six findings each, one equal,
// three parent/child term conflicts with the same values, one sibling conflict, one each alone.
const pooled: AgreementPooled = {
  texts: 1, pairs: 1,
  annotation_strict_f1: 2 / 12, annotation_tolerant_f1: 2 / 12, annotation_hierarchical_f1: (2 * 2.5) / 12,
  mention_strict_f1: null, mention_tolerant_f1: null, term_f1: 0.2, modifier_agreement: 1,
  findings_a: 6, findings_b: 6, equal: 1, compatible: 0, axis_conflicts: 0, term_conflicts: 4, a_only: 1, b_only: 1,
  mentions_a: 6, mentions_b: 6, mentions_equal: 1, mentions_compatible: 0, terms_a: 6, terms_b: 6, terms_equal: 1,
  modifiers_compared: 1, modifiers_agreeing: 1, related_term_conflicts: 3, hierarchy_credited: 3,
};
const agreement = (summary: AgreementPooled): ProjectAgreement => ({
  project: "demo", state_digest: "0".repeat(64), selected_texts: summary.texts,
  summary: { pooled: summary, macro_mean: { ...summary } },
  annotator_pairs: summary.pairs ? [{ pseudonym_a: "ann-0002", pseudonym_b: "ann-0005", pooled: summary, macro_mean: { ...summary } }] : [],
  texts: [], pairs: [],
} as unknown as ProjectAgreement);

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

it("shows the hierarchical figure next to strict and tolerant, with its gain", async () => {
  vi.spyOn(api, "getProjectAgreement").mockResolvedValue(agreement(pooled));
  render(<ProgressAgreement projectKey="demo" revision={0} />);
  const figures = await screen.findByRole("list", { name: "Pooled agreement" });
  const items = within(figures).getAllByRole("listitem").map(item => item.textContent);
  expect(items[0]).toContain("Strict F1");
  expect(items[0]).toContain("0.17");
  expect(items[2]).toContain("Hierarchical F1");
  expect(items[2]).toContain("0.42");
  expect(items[2]).toContain("+0.25 from parent/child terms");
  expect(screen.getByText(/3 of the 4 term differences are a parent and its child/)).toBeTruthy();
  const pairs = screen.getByRole("table", { name: "By pair of annotators" });
  expect(within(pairs).getByRole("rowheader").textContent).toBe("ann-0002 · ann-0005");
});

it("splits the paired findings by how they count", () => {
  const rows = Object.fromEntries(agreementBreakdown({ ...pooled, related_term_conflicts: 4, hierarchy_credited: 3, term_conflicts: 5 }).map(row => [row.key, row.count]));
  // A parent/child pair with other values is a conflict; siblings and unrelated terms are "Other term".
  expect(rows).toEqual({ equal: 1, compatible: 0, related: 3, "related-values": 1, term: 1, values: 0 });
});

it("says why there is no agreement yet when no pair has a final result", async () => {
  vi.spyOn(api, "getProjectAgreement").mockResolvedValue(agreement({ ...pooled, texts: 0, pairs: 0 }));
  render(<ProgressAgreement projectKey="demo" revision={0} />);
  expect(await screen.findByText(/No agreement yet/)).toBeTruthy();
  expect(screen.queryByRole("list", { name: "Pooled agreement" })).toBeNull();
});

it("shows a dash and no gain without an ontology to look the hierarchy up in", async () => {
  vi.spyOn(api, "getProjectAgreement").mockResolvedValue(agreement({ ...pooled, annotation_hierarchical_f1: null }));
  render(<ProgressAgreement projectKey="demo" revision={0} />);
  const figures = await screen.findByRole("list", { name: "Pooled agreement" });
  expect(within(figures).getAllByRole("listitem")[2].textContent).toContain("no ontology to look up");
});

it("stays away for people who may not see the agreement", async () => {
  const call = vi.spyOn(api, "getProjectAgreement").mockRejectedValue(new ApiError(403, "forbidden"));
  const { container } = render(<ProgressAgreement projectKey="demo" revision={0} />);
  await vi.waitFor(() => expect(call).toHaveBeenCalled());
  await Promise.resolve();
  expect(container.innerHTML).toBe("");
});
