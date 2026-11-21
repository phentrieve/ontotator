/** The text card (U3): path on top, the selected part below, History and Text details inside, ‹ › and J / K. */
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api, type AssignmentView, type DocumentRowView } from "../../src/api/client";
import { routeHref, type ProjectDocumentsQuery, type Route } from "../../src/app/router";
import { formatTime } from "../../src/app/submissionLabels";
import { TextCard, type TextCardProps } from "../../src/documents/textCard/TextCard";
import { rowDay, type SegmentId } from "../../src/documents/textCard/cardModel";
import { proposalSetText, sameDaySets } from "../../src/documents/textCard/AnnotationPart";
import { annotateItem, cardRow } from "./cardFixtures";
import { final, round, stepOf, submission, submissions, version, work } from "./fixtures";
import { ana, cell, luc, tom } from "./tableFixtures";
import type { TextVersionsTools } from "../../src/documents/TextVersions";

const now = new Date("2026-10-21T12:00:00");
const query: ProjectDocumentsQuery = { decision: "all", panel: "case-200:de" };
const reportRoute = (reportId: string): Route => ({ name: "projectProblemReport", key: "p", reportId, documents: query });

beforeEach(() => {
  vi.spyOn(api, "getRowSubmissions").mockImplementation(async (_key, caseId, language) => submissions(caseId, language, {
    submissions: [submission({ submission_id: "s-ana", document_id: "case-200-de", author_label: "ann-0003", author: ana })],
  }));
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

/** case-200 de: 17 proposals, 1 annotator · max 2 (Tom, not started), translation not reviewed (optional). */
function assignRow(overrides: Partial<DocumentRowView> = {}): DocumentRowView {
  return cardRow({
    review: cell("not_planned", "none"),
    annotation: cell("partly_assigned", "todo", { assigned: 1, target: 2 }),
    final: cell("after_annotation", "waiting"),
  }, {
    proposal_count: 17,
    annotation_mode: { mode: "proposals", source: "project", locked: true, override: null, proposal_count: 17 },
    work: [annotateItem({ assignment_id: 1, person: tom, author_label: "ann-0004", assigned_at: "2026-10-20T16:44:00" })],
    ...overrides,
  });
}

/** An assignment of the page's inventory (Reassign…, Reopen…, revoking Remove…). */
function toolAssignment(id: number, status: AssignmentView["status"], overrides: Partial<AssignmentView> = {}): AssignmentView {
  return { id, workflow_revision: 0, held: false, lead_correction: false, project_key: "p", document_id: "case-200-de", user_id: id, username: "tom", display_name: "Tom Reis",
    pseudonym: "ann-0004", task: "annotate", status, created_at: "2026-10-14T09:00:00Z", updated_at: "2026-10-14T09:00:00Z", revoked_at: null, last_submission_id: null, ...overrides };
}
const textTools = (assignments: AssignmentView[]): TextVersionsTools => ({
  username: "lead", members: [], assignments, variants: new Map(), requiredLanguages: () => [], onAssignmentsChanged: vi.fn(),
});

type Handlers = Pick<TextCardProps, "onStep" | "onClose" | "onNavigate" | "onAssign" | "onChangePlan" | "onChanged">;

function Harness({ initialSegment, initialView = "path", ...props }: Partial<TextCardProps> & Handlers & { initialSegment?: SegmentId; initialView?: TextCardProps["view"] }): JSX.Element {
  const [segment, setSegment] = useState<SegmentId | undefined>(initialSegment);
  const [view, setView] = useState(initialView);
  const row = props.row ?? assignRow();
  return <TextCard projectKey="p" row={row} rows={[row]} query={query} reportRoute={reportRoute} canManage me={{ username: "lead" }} now={now}
    segment={segment} view={view} onSegment={setSegment} onView={setView} {...props} />;
}

function renderCard(props: Partial<TextCardProps> & { initialSegment?: SegmentId; initialView?: TextCardProps["view"] } = {}) {
  const handlers = {
    onStep: vi.fn(), onClose: vi.fn(), onNavigate: vi.fn(), onAssign: vi.fn(), onChangePlan: vi.fn(), onChanged: vi.fn(),
  };
  render(<Harness {...handlers} {...props} />);
  return handlers;
}

const card = () => screen.getByRole("dialog", { name: "case-200 de" });
const segmentButton = (title: string) => within(card()).getByRole("button", { name: new RegExp(`^${title} `) });

describe("path", () => {
  it("opens on the segment that needs work now", () => {
    renderCard();
    expect(segmentButton("Annotation").getAttribute("aria-current")).toBe("step");
    expect(segmentButton("Annotation").textContent).toContain("1 annotator · max 2");
    expect(segmentButton("Translation").textContent).toContain("not reviewed, optional");
    expect(segmentButton("Finalization").textContent).toContain("waiting");
    expect(within(card()).getByRole("heading", { name: "Annotation" })).toBeTruthy();
  });

  it("the path switches the part below", () => {
    renderCard();
    fireEvent.click(segmentButton("Translation"));
    expect(segmentButton("Translation").getAttribute("aria-current")).toBe("step");
    expect(within(card()).getByRole("heading", { name: "Translation" })).toBeTruthy();
    expect(within(card()).queryByRole("heading", { name: "Annotation" })).toBeNull();
    fireEvent.click(segmentButton("Finalization"));
    expect(within(card()).getByText("Starts once an annotation is submitted (up to 2 per text, fewer is fine): compare the results, consolidate the differences, then accept the result.")).toBeTruthy();
  });
});

describe("header", () => {
  it("the header shows the version only when the text has more versions", () => {
    renderCard();
    expect(within(card()).queryByText(/^v1/)).toBeNull();
    cleanup();
    const versions = [
      version({ document_id: "case-200-de", origin: "machine_translation", derived_from: "case-200-en", is_newest_in_chain: false }),
      version({ document_id: "case-200-de-v2", version: 2, origin: "correction", derived_from: "case-200-de", chain_id: "case-200-de" }),
    ];
    renderCard({ row: assignRow({ versions, work: [annotateItem({ assignment_id: 1, person: tom, version: 1 })] }) });
    expect(within(card()).getByText("v2, newer than the annotations")).toBeTruthy();
    cleanup();
    renderCard({ row: assignRow({ versions, work: [annotateItem({ assignment_id: 1, person: tom, version: 2, document_id: "case-200-de-v2" })] }) });
    expect(within(card()).getByText("v2")).toBeTruthy();
  });

  it("issue 543: after a typo fix the header names who is still on the old version; carried work does not count", () => {
    const versions = [
      version({ document_id: "case-200-de", origin: "machine_translation", derived_from: "case-200-en", is_newest_in_chain: false }),
      version({ document_id: "case-200-de-v2", version: 2, origin: "correction", derived_from: "case-200-de", chain_id: "case-200-de" }),
    ];
    const onV2 = (id: number, person: typeof tom, label: string) => annotateItem({ assignment_id: id, person, author_label: label, version: 2, document_id: "case-200-de-v2", status: "submitted" });
    const onV1 = (id: number, person: typeof tom, label: string) => annotateItem({ assignment_id: id, person, author_label: label, version: 1, status: "submitted" });
    renderCard({ row: assignRow({ versions, work: [onV2(1, tom, "ann-0004"), onV2(2, luc, "ann-0005"), onV1(3, ana, "ann-0003")] }) });
    expect(within(card()).getByText("v2, 1 annotator still on v1")).toBeTruthy();
    cleanup();
    // Ana carried her v1 work to v2 ("Carry to v2…"): her v1 task stays, but nothing waits on v1 any more.
    renderCard({ row: assignRow({ versions, work: [onV2(1, tom, "ann-0004"), onV1(3, ana, "ann-0003"), onV2(4, ana, "ann-0003")] }) });
    expect(within(card()).getByText("v2")).toBeTruthy();
  });

  it("‹ › step through the table order", () => {
    const { onStep } = renderCard();
    fireEvent.click(within(card()).getByRole("button", { name: "Next text" }));
    expect(onStep).toHaveBeenLastCalledWith(1);
    fireEvent.click(within(card()).getByRole("button", { name: "Previous text" }));
    expect(onStep).toHaveBeenLastCalledWith(-1);
    fireEvent.keyDown(document.activeElement ?? document.body, { key: "j" });
    expect(onStep).toHaveBeenLastCalledWith(1);
    fireEvent.keyDown(document.activeElement ?? document.body, { key: "k" });
    expect(onStep).toHaveBeenLastCalledWith(-1);
    expect(onStep).toHaveBeenCalledTimes(4);
  });

  it("J / K do nothing while another dialog is on top of the card", () => {
    const { onStep } = renderCard({ initialSegment: "annotation" });
    fireEvent.click(within(card()).getByRole("button", { name: "Remove Tom Reis’s assignment" }));
    const confirm = screen.getByRole("dialog", { name: "Remove assignment?" });
    fireEvent.keyDown(document.activeElement ?? confirm, { key: "j" });
    fireEvent.keyDown(document.activeElement ?? confirm, { key: "k" });
    expect(onStep).not.toHaveBeenCalled();
  });

  it("Esc and ✕ close without changing the selection", () => {
    const { onClose, onStep } = renderCard();
    fireEvent.keyDown(document.activeElement ?? card(), { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
    fireEvent.click(within(card()).getByRole("button", { name: "Close" }));
    expect(onClose).toHaveBeenCalledTimes(2);
    expect(onStep).not.toHaveBeenCalled();
  });

  it("narrow screens get a full-width sheet", () => {
    vi.stubGlobal("matchMedia", (media: string) => ({ media, matches: media.includes("max-width"), addEventListener: () => {}, removeEventListener: () => {} }));
    renderCard();
    expect(card().classList.contains("text-card--sheet")).toBe(true);
    cleanup();
    vi.unstubAllGlobals();
    renderCard();
    expect(card().classList.contains("text-card--sheet")).toBe(false);
  });
});

describe("annotation part", () => {
  it("the header's Open text opens the text view with the proposals; the part counts the annotators", () => {
    const { onNavigate } = renderCard();
    const link = within(card()).getByRole("link", { name: "Open text, case-200 de" });
    const route: Route = { name: "projectCase", key: "p", caseId: "case-200", variant: "case-200-de", show: "proposals", documents: query };
    expect(link.getAttribute("href")).toBe(routeHref(route));
    fireEvent.click(link);
    expect(onNavigate).toHaveBeenCalledWith(route);
    expect(within(card()).queryByRole("link", { name: "View proposals" })).toBeNull();
    expect(within(card()).getByText("1 of 2 annotators assigned.")).toBeTruthy();
    const people = within(card()).getByRole("list", { name: "Annotators" });
    const tomRow = within(people).getByText("Tom Reis").closest("li")!;
    expect(tomRow.textContent).toBe("Tom Reis ann-0004Assigned yesterday, from proposalsNot startedRemove…");
    expect(within(tomRow).getByText("Assigned yesterday").tagName).toBe("TIME");
  });

  it("issue 543: an annotation a typo fix moved shows the person's submission and assignment, the move and Open annotation", async () => {
    const versions = [
      version({ document_id: "case-200-de", origin: "machine_translation", derived_from: "case-200-en", is_newest_in_chain: false }),
      version({ document_id: "case-200-de-v2", version: 2, origin: "correction", derived_from: "case-200-de", chain_id: "case-200-de" }),
    ];
    const moved = { submission_id: "s-tom-v2", from_version: 1, moved_at: "2026-10-21T11:00:00", submitted_at: "2026-10-15T10:00:00", assigned_at: "2026-10-14T09:00:00", assigned_by: null };
    vi.mocked(api.getRowSubmissions).mockResolvedValue(submissions("case-200", "de", { submissions: [
      submission({ submission_id: "s-tom", document_id: "case-200-de", author_label: "ann-0004", author: tom, finding_count: 2, recorded_at: "2026-10-15T10:00:00" }),
      submission({ submission_id: "s-tom-v2", document_id: "case-200-de-v2", version: 2, kind: "carry_forward", author_label: "ann-0004", author: tom, finding_count: 2,
        recorded_at: "2026-10-21T11:00:00", moved_by_typo_fix: true }),
      // Luc carried his v1 annotation with "Carry to v2…" and submitted it there.
      submission({ submission_id: "s-luc", document_id: "case-200-de", author_label: "ann-0005", author: luc, finding_count: 1, recorded_at: "2026-10-16T10:00:00" }),
      submission({ submission_id: "s-luc-v2", document_id: "case-200-de-v2", version: 2, kind: "carry_forward", author_label: "ann-0005", author: luc, finding_count: 1, recorded_at: "2026-10-20T10:00:00" }),
    ] }));
    renderCard({ row: assignRow({ versions, work: [
      annotateItem({ assignment_id: 1, person: tom, author_label: "ann-0004", version: 2, document_id: "case-200-de-v2", status: "submitted", assigned_at: "2026-10-21T11:00:00", moved_by_typo_fix: moved }),
      annotateItem({ assignment_id: 2, person: luc, author_label: "ann-0005", version: 1, status: "submitted", assigned_at: "2026-10-14T09:00:00" }),
      annotateItem({ assignment_id: 3, person: luc, author_label: "ann-0005", version: 2, document_id: "case-200-de-v2", status: "submitted", assigned_at: "2026-10-20T09:00:00" }),
    ] }) });
    const people = within(card()).getByRole("list", { name: "Annotators" });
    const tomRow = await waitFor(() => {
      const found = within(people).getByText("Tom Reis").closest("li")!;
      expect(found.textContent).toContain("Submitted");
      return found;
    });
    expect(tomRow.querySelector(".person-row-details")!.textContent)
      .toBe(`Submitted ${rowDay("2026-10-15T10:00:00", now)}, 2 findings · moved from v1 by the typo fix ${rowDay("2026-10-21T11:00:00", now)} · assigned ${rowDay("2026-10-14T09:00:00", now)} · v2`);
    expect(within(tomRow).getByRole("link", { name: "Open annotation of Tom Reis" })).toBeTruthy();
    // Luc once, on v2, with his carried annotation.
    const lucRows = within(people).getAllByText("Luc Martin");
    expect(lucRows).toHaveLength(1);
    const lucRow = lucRows[0].closest("li")!;
    expect(lucRow.textContent).toContain("Submitted");
    expect(lucRow.textContent).toContain("1 finding");
    expect(within(lucRow).getByRole("link", { name: "Open annotation of Luc Martin" })).toBeTruthy();
  });

  it("says why a text without proposals is annotated from scratch; Open text shows no proposals", () => {
    renderCard({ row: assignRow({ proposal_count: 0, annotation_mode: { mode: "scratch", source: "no_proposals", locked: false, proposal_count: 0 } }) });
    expect(within(card()).getByText("Annotation, from scratch")).toBeTruthy();
    expect(within(card()).getByText("This text has no tool proposals, so it is annotated from scratch.")).toBeTruthy();
    expect(within(card()).getByRole("link", { name: "Open text, case-200 de" }).getAttribute("href")).not.toContain("proposals");
  });

  it("the Annotation part shows the proposal count in both modes", () => {
    const mode = (name: "proposals" | "scratch", count = 17) => ({ mode: name, source: "project" as const, locked: false, override: null, proposal_count: count });
    const part = () => within(card()).getByRole("region", { name: "Annotation" });
    renderCard({ row: assignRow({ annotation_mode: mode("proposals") }) });
    expect(within(part()).getByText("17 tool proposals")).toBeTruthy();
    cleanup();
    renderCard({ row: assignRow({ annotation_mode: mode("scratch") }) });
    expect(within(part()).getByText("17 tool proposals")).toBeTruthy();
    cleanup();
    renderCard({ row: assignRow({ proposal_count: 0, annotation_mode: mode("proposals", 0) }) });
    expect(within(part()).queryByText(/tool proposals?$/)).toBeNull();
    cleanup();
    renderCard({ row: assignRow({ annotation_mode: { mode: "scratch", source: "no_proposals", locked: false, override: null, proposal_count: 17 } }) });
    expect(within(part()).queryByText(/tool proposals?$/)).toBeNull();
  });

  it("names the proposal set, a newer set with its help link, and a person on another set (issue 337)", () => {
    const set = (set_id: number, imported_at: string, newest: boolean, proposal_count = 17) =>
      ({ set_id, imported_at, tool: "phentrieve", tool_version: "1.4", proposal_count, newest });
    const part = () => within(card()).getByRole("region", { name: "Annotation" });
    const older = set(1, "2026-10-02T09:00:00", false);
    const newer = set(2, "2026-11-10T09:00:00", true, 24);
    renderCard({ row: assignRow({
      proposal_set: older, newer_proposal_set: newer,
      work: [
        annotateItem({ assignment_id: 1, person: tom, author_label: "ann-0004", assigned_at: "2026-10-20T16:44:00", proposal_set: older }),
        annotateItem({ assignment_id: 2, person: luc, author_label: "ann-0005", assigned_at: "2026-10-20T16:44:00", proposal_set: newer }),
        annotateItem({ assignment_id: 3, person: ana, author_label: "ann-0003", assigned_at: "2026-10-20T16:44:00", proposal_set: older }),
      ],
    }) });
    const line = within(part()).getByText("Proposals").closest("p")!;
    expect(line.textContent).toBe("Proposals set 2026-10-02 (phentrieve 1.4), 17 proposals Newer set available: 2026-11-10 How to use it");
    expect(within(part()).queryByText("17 tool proposals")).toBeNull();
    expect(within(line).getByRole("link", { name: "How to use it" }).getAttribute("href")).toContain("work-from-new-tool-proposals");
    const people = within(part()).getByRole("list", { name: "Annotators" });
    expect(within(people).getByText("Luc Martin").closest("li")!.textContent).toContain("newest set");
    expect(within(people).getByText("Tom Reis").closest("li")!.textContent).not.toContain("set");
    cleanup();
    // On the newest set: no pill; from scratch: no pill either.
    renderCard({ row: assignRow({ proposal_set: newer, newer_proposal_set: null }) });
    expect(within(part()).getByText("Proposals").closest("p")!.textContent).toBe("Proposals set 2026-11-10 (phentrieve 1.4), 24 proposals");
    cleanup();
    renderCard({ row: assignRow({ proposal_set: older, newer_proposal_set: newer, annotation_mode: { mode: "scratch", source: "project", locked: false, override: null, proposal_count: 17 } }) });
    expect(within(part()).queryByText(/Newer set available/)).toBeNull();
  });

  it("tells two proposal sets of one day apart by their time, and a submission of today by its time (issue 472)", () => {
    const set = (set_id: number, imported_at: string, newest: boolean) => ({ set_id, imported_at, tool: "phentrieve", tool_version: "1.4", proposal_count: 24, newest });
    const part = () => within(card()).getByRole("region", { name: "Annotation" });
    const morning = set(1, "2026-11-17T09:12:00", false), afternoon = set(2, "2026-11-17T13:40:00", true);
    renderCard({ row: assignRow({ proposal_set: morning, newer_proposal_set: afternoon }) });
    expect(within(part()).getByText("Proposals").closest("p")!.textContent)
      .toBe("Proposals set 2026-11-17 09:12 (phentrieve 1.4), 24 proposals Newer set available: 2026-11-17 13:40 How to use it");
    expect(sameDaySets(morning, [afternoon])).toBe("minutes");
    expect(sameDaySets(morning, [morning, null, set(3, "2026-11-18T08:00:00", true)])).toBe(false);
    // Two imports within one minute: the seconds tell them apart.
    const second = set(4, "2026-11-17T09:12:40", true);
    expect(sameDaySets(morning, [second])).toBe("seconds");
    expect(proposalSetText(second, "seconds")).toBe("set 2026-11-17 09:12:40 (phentrieve 1.4), 24 proposals");
    // The day of a row follows the rule of "assigned today 13:39".
    expect(rowDay("2026-10-21T09:05:00", now)).toBe("today 09:05");
    expect(rowDay("2026-10-20T09:05:00", now)).toBe("yesterday");
    expect(rowDay("2026-10-02T09:05:00", now)).toBe("2 Oct");
    expect(rowDay(null, now)).toBeNull();
  });

  it("names the older set while any task is on it, and says when a set was not recorded (issue 337)", () => {
    const set = (set_id: number, imported_at: string, newest: boolean) => ({ set_id, imported_at, tool: "phentrieve", tool_version: "1.4", proposal_count: 24, newest });
    const part = () => within(card()).getByRole("region", { name: "Annotation" });
    const older = set(1, "2026-10-02T09:00:00", false), newer = set(2, "2026-11-10T09:00:00", true);
    // The mockup: Tom submitted on the old set, Luc is assigned and will start on the newest.
    renderCard({ row: assignRow({ proposal_set: older, newer_proposal_set: newer, work: [
      annotateItem({ assignment_id: 1, person: tom, author_label: "ann-0004", assigned_at: "2026-10-20T16:44:00", status: "submitted", proposal_set: older }),
      annotateItem({ assignment_id: 2, person: luc, author_label: "ann-0005", assigned_at: "2026-10-20T16:44:00", proposal_set: newer }),
    ] }) });
    expect(within(part()).getByText("Proposals").closest("p")!.textContent).toBe("Proposals set 2026-10-02 (phentrieve 1.4), 24 proposals Newer set available: 2026-11-10 How to use it");
    expect(within(part()).getByText("Luc Martin").closest("li")!.textContent).toContain("newest set");
    cleanup();
    // Every task began before sets were recorded: no set is claimed, no pill.
    renderCard({ row: assignRow({ proposal_set: null, newer_proposal_set: null, proposal_set_unrecorded: true, work: [
      annotateItem({ assignment_id: 1, person: tom, author_label: "ann-0004", assigned_at: "2026-10-20T16:44:00", proposal_set_unrecorded: true }),
    ] }) });
    expect(within(part()).getByText("Proposals").closest("p")!.textContent).toBe("Proposals set not recorded (the tasks started before sets were recorded)");
    expect(within(part()).queryByText(/Newer set available/)).toBeNull();
    expect(within(part()).getByText("Tom Reis").closest("li")!.textContent).not.toContain("set not recorded");
    cleanup();
    // One person without a recorded set beside a known one: said in their row.
    renderCard({ row: assignRow({ proposal_set: older, newer_proposal_set: newer, work: [
      annotateItem({ assignment_id: 1, person: tom, author_label: "ann-0004", assigned_at: "2026-10-20T16:44:00", proposal_set: older }),
      annotateItem({ assignment_id: 2, person: luc, author_label: "ann-0005", assigned_at: "2026-10-20T16:44:00", proposal_set_unrecorded: true }),
    ] }) });
    expect(within(part()).getByText("Luc Martin").closest("li")!.textContent).toContain("set not recorded");
  });

  it("names a text's own annotator limit beside the project's (issue 422)", () => {
    const part = () => within(card()).getByRole("region", { name: "Annotation" });
    renderCard({ row: assignRow({ annotations_per_text: { effective: 4, project: 1, override: 4 } }) });
    expect(within(part()).getByText("Annotators: 4 for this text (project: 1)")).toBeTruthy();
    cleanup();
    renderCard({ row: assignRow({ annotations_per_text: { effective: 1, project: 1, override: null } }) });
    expect(within(part()).queryByText(/for this text/)).toBeNull();
  });

  it("shows Translation not reviewed yet only for a flagged row", () => {
    const part = () => within(card()).getByRole("region", { name: "Annotation" });
    renderCard({ row: assignRow({ unreviewed_translation: true }) });
    expect(within(part()).getByText("Translation not reviewed yet")).toBeTruthy();
    cleanup();
    renderCard({ row: assignRow({ unreviewed_translation: false }) });
    expect(within(part()).queryByText("Translation not reviewed yet")).toBeNull();
  });

  it("one Assign annotators… opens the assign dialog; unavailable at the limit", () => {
    const { onAssign } = renderCard();
    expect(within(card()).queryByRole("button", { name: "+ Person" })).toBeNull();
    expect(within(card()).queryByRole("button", { name: "Annotate from proposals myself" })).toBeNull();
    fireEvent.click(within(card()).getByRole("button", { name: "Assign annotators…" }));
    expect(onAssign).toHaveBeenCalledWith(expect.objectContaining({ case_id: "case-200" }), "annotate");
    cleanup();
    const full = renderCard({ row: assignRow({ stages: { review: cell("not_planned", "none"), annotation: cell("in_progress", "running", { assigned: 2, target: 2, submitted: 0, total: 2 }), final: cell("after_annotation", "waiting") } }) });
    const button = screen.getByRole("button", { name: "Assign annotators…" });
    expect(button.getAttribute("aria-disabled")).toBe("true");
    expect(document.getElementById(button.getAttribute("aria-describedby")!)!.textContent).toBe("2 of 2 annotators assigned.");
    fireEvent.click(button);
    expect(full.onAssign).not.toHaveBeenCalled();
    // "Assign another person" is the part's "Assign annotators…" (#108), not a per-person action.
    expect(within(card()).queryByRole("button", { name: /^Assign another person/ })).toBeNull();
  });

  it("one row per person: unsubmitted first, each with only their own actions named after them (#108)", async () => {
    const tools = textTools([toolAssignment(1, "in_progress"), toolAssignment(2, "submitted", { pseudonym: "ann-0003", username: "ana", last_submission_id: "s-ana" }), toolAssignment(3, "reopened", { pseudonym: "ann-0005", username: "luc", last_submission_id: "s-luc" })]);
    const row = assignRow({
      stages: { review: cell("not_planned", "none"), annotation: cell("in_progress", "running", { assigned: 3, target: 3, submitted: 1, total: 3 }), final: cell("after_annotation", "waiting") },
      work: [
        annotateItem({ assignment_id: 2, person: ana, author_label: "ann-0003", status: "submitted", assigned_at: "2026-10-12T09:00:00" }),
        annotateItem({ assignment_id: 1, person: tom, author_label: "ann-0004", status: "in_progress", assigned_at: "2026-10-14T09:00:00", assigned_by: { pseudonym: "lead-0001", display_name: "Lena Lead", is_me: true } }),
        annotateItem({ assignment_id: 3, person: luc, author_label: "ann-0005", status: "reopened", assigned_at: "2026-10-13T09:00:00", annotation_mode: "scratch" }),
      ],
    });
    renderCard({ row, textVersionTools: tools });
    const people = within(card()).getByRole("list", { name: "Annotators" });
    await within(people).findByRole("link", { name: "Open annotation of Ana Weber" });
    const rows = within(people).getAllByRole("listitem");
    expect(rows.map(item => within(item).getByText(/^(Tom Reis|Ana Weber|Luc Martin)$/).textContent)).toEqual(["Luc Martin", "Tom Reis", "Ana Weber"]);
    const actions = (item: HTMLElement) => Array.from(item.querySelectorAll("button, a")).map(element => element.getAttribute("aria-label"));
    expect(rows[0].textContent).toContain("Reopened");
    expect(rows[0].textContent).toContain("13 Oct, from scratch");
    // Reopened work was submitted once: Remove… revokes (removeAssignment refuses it).
    expect(actions(rows[0])).toEqual(["Reassign Luc Martin’s annotation", "Remove Luc Martin’s assignment"]);
    expect(rows[1].textContent).toContain("In progress");
    expect(within(rows[1]).getByText("Assigned 14 Oct").getAttribute("title")).toBe("Assigned 14 Oct 2026, 09:00 by Lena Lead");
    expect(rows[1].textContent).toContain("Assigned 14 Oct by you, from proposals");
    expect(actions(rows[1])).toEqual(["Reassign Tom Reis’s annotation", "Remove Tom Reis’s assignment, the draft is discarded"]);
    expect(rows[2].textContent).toContain("Submitted Sun, 3 findings · assigned 12 Oct");
    expect(actions(rows[2])).toEqual(["Open annotation of Ana Weber", "Reopen Ana Weber’s annotation", "Remove Ana Weber’s assignment"]);
    // The status pills say it in words and shape.
    expect(rows.map(item => item.querySelector(".status-pill")!.textContent)).toEqual(["Reopened", "In progress", "Submitted"]);
    fireEvent.click(within(rows[2]).getByRole("button", { name: "Reopen Ana Weber’s annotation" }));
    expect(screen.getByRole("dialog", { name: /^Reopen case-200 de for / })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    fireEvent.click(within(rows[0]).getByRole("button", { name: "Remove Luc Martin’s assignment" }));
    const revoke = screen.getByRole("dialog", { name: "Remove assignment?" });
    expect(revoke.textContent).toContain("The assignment is revoked; their submitted work stays in the history.");
    fireEvent.click(within(revoke).getByRole("button", { name: "Cancel" }));
    fireEvent.click(within(rows[1]).getByRole("button", { name: "Reassign Tom Reis’s annotation" }));
    expect(screen.getByRole("dialog", { name: "Reassign case-200 de" })).toBeTruthy();
  });

  it("a person removed after submitting stays listed as Removed with Open annotation", async () => {
    const tools = textTools([toolAssignment(4, "submitted", { pseudonym: "ann-0003", username: "ana", display_name: "Ana Weber", last_submission_id: "s-ana", revoked_at: "2026-10-19T10:00:00Z" })]);
    const { onNavigate } = renderCard({ textVersionTools: tools });
    const people = within(card()).getByRole("list", { name: "Annotators" });
    const link = await within(people).findByRole("link", { name: "Open annotation of Ana Weber (assignment removed)" });
    const removed = link.closest("li")!;
    expect(removed.classList.contains("person-row--removed")).toBe(true);
    expect(removed.textContent).toBe("Ana Weber ann-0003Removed Mon · submitted Sun, kept in the historyRemovedOpen annotation");
    expect(within(removed).queryByRole("button")).toBeNull();
    fireEvent.click(link);
    expect(onNavigate).toHaveBeenCalledWith({ name: "projectCase", key: "p", caseId: "case-200", variant: "case-200-de", show: "submission:s-ana", documents: query });
    cleanup();
    // Without the page's assignments (annotators' view) the submission alone keeps the person listed; a proposal check is a layer too.
    vi.mocked(api.getRowSubmissions).mockImplementation(async (_key, caseId, language) => submissions(caseId, language, {
      submissions: [submission({ submission_id: "s-ana", document_id: "case-200-de", author_label: "ann-0003", author: ana, kind: "proposal_check" })],
    }));
    renderCard({ canManage: false });
    const plain = (await within(card()).findByRole("link", { name: "Open annotation of Ana Weber (assignment removed)" })).closest("li")!;
    expect(plain.textContent).toBe("Ana Weber ann-0003Assignment removed · submitted Sun, kept in the historyRemovedOpen annotation");
  });

  it("names the version of each person's task when the text has several versions (issue 445)", async () => {
    // v1 carries Ana's submission and Luc's removed one, Tom is assigned on the correction v2.
    vi.mocked(api.getRowSubmissions).mockImplementation(async (_key, caseId, language) => submissions(caseId, language, {
      submissions: [
        submission({ submission_id: "s-ana", document_id: "case-200-de", author_label: "ann-0003", author: ana }),
        submission({ submission_id: "s-luc", document_id: "case-200-de", author_label: "ann-0005", author: luc, recorded_at: "2026-10-17T10:00:00Z" }),
      ],
    }));
    const versions = [
      version({ document_id: "case-200-de", origin: "machine_translation", derived_from: "case-200-en", chain_name: "Translation", is_newest_in_chain: false }),
      version({ document_id: "case-200-de-v2", version: 2, origin: "correction", derived_from: "case-200-de", chain_id: "case-200-de", chain_name: "Translation" }),
    ];
    const people = [
      annotateItem({ assignment_id: 2, person: ana, author_label: "ann-0003", status: "submitted", assigned_at: "2026-10-12T09:00:00" }),
      annotateItem({ assignment_id: 1, person: tom, author_label: "ann-0004", document_id: "case-200-de-v2", version: 2, assigned_at: "2026-10-14T09:00:00" }),
    ];
    renderCard({ row: assignRow({ versions, work: people }) });
    const list = within(card()).getByRole("list", { name: "Annotators" });
    await within(list).findByRole("link", { name: "Open annotation of Ana Weber" });
    const rows = within(list).getAllByRole("listitem").map(item => item.querySelector(".person-row-details")?.textContent);
    expect(rows).toEqual(["Assigned 14 Oct, from proposals · v2", "Submitted Sun, 3 findings · assigned 12 Oct · v1", "Assignment removed · submitted Sat, kept in the history · v1"]);
    cleanup();
    // Parallel roots: the chain name, as in the submissions table.
    renderCard({ row: assignRow({ versions, work: people, parallel_roots: true }) });
    const parallel = within(card()).getByRole("list", { name: "Annotators" });
    await within(parallel).findByRole("link", { name: "Open annotation of Ana Weber" });
    expect(within(parallel).getAllByRole("listitem")[0].textContent).toContain("Assigned 14 Oct, from proposals · Translation v2");
    cleanup();
    // One version: no version in the rows.
    renderCard({ row: assignRow({ work: [people[0]] }) });
    const single = within(card()).getByRole("list", { name: "Annotators" });
    await within(single).findByRole("link", { name: "Open annotation of Ana Weber" });
    expect(within(single).getAllByRole("listitem")[0].querySelector(".person-row-details")?.textContent).toBe("Submitted Sun, 3 findings · assigned 12 Oct");
  });

  it("after removing a person, focus moves to the next person's first button, else to Assign annotators…", async () => {
    vi.spyOn(api, "removeAssignment").mockResolvedValue({} as Awaited<ReturnType<typeof api.removeAssignment>>);
    renderCard({ initialSegment: "annotation" });
    fireEvent.click(within(card()).getByRole("button", { name: "Remove Tom Reis’s assignment" }));
    const dialog = screen.getByRole("dialog", { name: "Remove assignment?" });
    expect(within(dialog).getByText("Remove Tom Reis from the annotation of case-200? Their draft is discarded.")).toBeTruthy();
    fireEvent.click(within(dialog).getByRole("button", { name: "Remove" }));
    await waitFor(() => expect(document.activeElement).toBe(within(card()).getByRole("button", { name: "Assign annotators…" })));
    cleanup();
    const row = assignRow({ work: [
      annotateItem({ assignment_id: 1, person: tom, author_label: "ann-0004", assigned_at: "2026-10-14T09:00:00" }),
      annotateItem({ assignment_id: 2, person: luc, author_label: "ann-0005", assigned_at: "2026-10-15T09:00:00" }),
    ] });
    renderCard({ row });
    fireEvent.click(within(card()).getByRole("button", { name: "Remove Tom Reis’s assignment" }));
    fireEvent.click(within(screen.getByRole("dialog", { name: "Remove assignment?" })).getByRole("button", { name: "Remove" }));
    await waitFor(() => expect(document.activeElement).toBe(within(card()).getByRole("button", { name: "Remove Luc Martin’s assignment" })));
  });

  it("no chip offers a review of a submitted annotation", async () => {
    const row = assignRow({
      stages: { review: cell("not_planned", "none"), annotation: cell("in_progress", "running", { assigned: 2, target: 2, submitted: 1, total: 2 }), final: cell("after_annotation", "waiting") },
      work: [
        annotateItem({ assignment_id: 1, person: tom, author_label: "ann-0004" }),
        annotateItem({ assignment_id: 2, person: ana, author_label: "ann-0003", status: "submitted" }),
      ],
    });
    const { onNavigate } = renderCard({ row });
    const part = within(card()).getByRole("heading", { name: "Annotation" }).closest("section")!;
    expect(within(part).queryByRole("button", { name: /review/i })).toBeNull();
    // "Open annotation" opens the text view with the person's layer; without the assignments there is nothing to change.
    const link = await within(card()).findByRole("link", { name: "Open annotation of Ana Weber" });
    const person = link.closest("li") as HTMLElement;
    expect(person.textContent).toContain("Submitted");
    expect(within(person).queryByRole("button")).toBeNull();
    fireEvent.click(link);
    expect(onNavigate).toHaveBeenCalledWith({ name: "projectCase", key: "p", caseId: "case-200", variant: "case-200-de", show: "submission:s-ana", documents: query });
  });

  it("people without lead rights see the rows without buttons and no Assign annotators…", () => {
    renderCard({ canManage: false, textVersionTools: textTools([toolAssignment(1, "open")]) });
    const people = within(card()).getByRole("list", { name: "Annotators" });
    expect(within(people).getByText("Tom Reis")).toBeTruthy();
    expect(within(people).queryByRole("button")).toBeNull();
    expect(within(card()).queryByRole("button", { name: "Assign annotators…" })).toBeNull();
  });
});

describe("translation part", () => {
  it("an unassigned review of a machine translation is the one primary next step; Compare with source follows (issue 129, U5)", () => {
    const row = cardRow({ review: cell("unassigned", "todo", { version: 1, note: "machine_translation" }), annotation: cell("after_review", "waiting"), final: cell("after_review", "waiting") }, {
      versions: [version({ document_id: "case-200-de", origin: "machine_translation", derived_from: "case-200-en", translation_status: "ready_for_review" })],
      work: [],
    });
    const { onAssign } = renderCard({ row, initialSegment: "translation" });
    const part = within(card()).getByRole("heading", { name: "Translation" }).closest("section")!;
    const next = within(part).getByRole("group", { name: "Next step: assign someone to review this machine translation." });
    const assign = within(next).getByRole("button", { name: "Assign review…" });
    expect(assign.className).toContain("btn-primary");
    expect(within(part).getAllByRole("button", { name: "Assign review…" })).toHaveLength(1);
    expect(part.querySelectorAll(".btn-primary")).toHaveLength(1);
    expect(within(next).queryByRole("link", { name: "Compare with source" })).toBeNull();
    expect(within(part).getByRole("link", { name: "Compare with source" })).toBeTruthy();
    fireEvent.click(assign);
    expect(onAssign).toHaveBeenCalledWith(row, "translation_review");
  });

  it("names the open reviewers and the actions, without a separate version line", () => {
    const row = assignRow({
      versions: [version({ document_id: "case-200-de", origin: "machine_translation", derived_from: "case-200-en", translation_status: "ready_for_review" })],
      work: [work({ assignment_id: 5, document_id: "case-200-de", task: "translation_review", status: "in_progress", author_label: "ann-0003", person: ana })],
    });
    const { onAssign, onNavigate } = renderCard({ row, initialSegment: "translation" });
    expect(within(card()).queryByText(/^Version 1/)).toBeNull();
    expect(within(card()).queryByText("Automatic check passed")).toBeNull();
    expect(within(card()).getByText("Ready for review")).toBeTruthy();
    const reviewers = within(card()).getByRole("list", { name: "Translation reviewers" });
    expect(within(reviewers).getByRole("listitem").textContent).toBe("Ana Weber ann-0003Review of v1In progress");
    // The review is held: the plain dialog would have nothing to assign (issue 574 F2).
    expect(within(card()).queryByRole("button", { name: "Assign review…" })).toBeNull();
    expect(onAssign).not.toHaveBeenCalled();
    fireEvent.click(within(card()).getByRole("link", { name: "Compare with source" }));
    expect(onNavigate).toHaveBeenCalledWith({ name: "projectCase", key: "p", caseId: "case-200", variant: "case-200-de", compare: "case-200-en", documents: query });
  });

  it("issue 574 F2: Assign review… only where its dialog can assign a review", () => {
    // An accepted version: no step assigns a review, so the plain dialog has nothing to assign.
    const accepted = assignRow({
      versions: [version({ document_id: "case-200-de", origin: "correction", derived_from: "case-200-en", translation_status: "accepted" })],
      work: [],
      steps: [stepOf("assign_annotation", { stage: "annotation" })],
    });
    renderCard({ row: accepted, initialSegment: "translation" });
    expect(within(card()).queryByRole("button", { name: "Assign review…" })).toBeNull();
    cleanup();
    // A failed check needs a reviewer: the row's step assigns one.
    const failed = assignRow({
      versions: [version({ document_id: "case-200-de", origin: "machine_translation", derived_from: "case-200-en", translation_status: "automatic_check_failed" })],
      steps: [stepOf("assign_translation_review")],
    });
    const { onAssign } = renderCard({ row: failed, initialSegment: "translation" });
    fireEvent.click(within(card()).getByRole("button", { name: "Assign review…" }));
    expect(onAssign).toHaveBeenCalledWith(failed, "translation_review");
  });

  it("issue 483: the reason of a correction request with its additions, and Add to the reason… for the lead", async () => {
    const request = {
      reason: "Check the dose.", requested_at: "2026-10-20T09:00:00",
      additions: [{ note: "Paragraph 3 as well.", added_at: "2026-10-20T10:00:00", added_by: { pseudonym: "lead-0001", display_name: null, is_me: true } }],
    };
    const row = assignRow({
      versions: [version({ document_id: "case-200-de", origin: "machine_translation", derived_from: "case-200-en", translation_status: "accepted" })],
      work: [work({ assignment_id: 5, document_id: "case-200-de", task: "translation_review", status: "open", author_label: "ann-0003", person: ana, correction_request: request })],
    });
    const add = vi.spyOn(api, "addCorrectionReason").mockResolvedValue({ assignment_id: 5, note: "And the footnote.", added_at: "2026-10-21T11:00:00" });
    const { onChanged } = renderCard({ row, initialSegment: "translation" });
    const reviewers = within(card()).getByRole("list", { name: "Translation reviewers" });
    const reason = within(reviewers).getByRole("note", { name: "Reason of the correction request" });
    expect(reason.textContent).toContain("“Check the dose.”");
    expect(reason.textContent).toContain("Added by you on ");
    expect(reason.textContent).toContain(": Paragraph 3 as well.");
    fireEvent.click(within(reviewers).getByRole("button", { name: "Add to the reason for Ana Weber" }));
    const dialog = screen.getByRole("dialog", { name: "Add to the reason" });
    const confirm = within(dialog).getAllByRole("button", { name: "Add to the reason" }).at(-1)!;
    expect((confirm as HTMLButtonElement).disabled).toBe(true);
    // Issue 547, U2-08: the grey button says why.
    expect(document.getElementById(confirm.getAttribute("aria-describedby") ?? "")?.textContent).toBe("Enter an addition first.");
    fireEvent.change(within(dialog).getByLabelText("Addition to the reason"), { target: { value: "  And the footnote. " } });
    expect(within(dialog).queryByText("Enter an addition first.")).toBeNull();
    fireEvent.click(confirm);
    await waitFor(() => expect(onChanged).toHaveBeenCalled());
    expect(add).toHaveBeenCalledWith(5, "And the footnote.");
    expect(screen.queryByRole("dialog", { name: "Add to the reason" })).toBeNull();
  });

  it("issue 483: no Add to the reason… without a request or for a reader who is not the lead", () => {
    const row = assignRow({
      versions: [version({ document_id: "case-200-de", origin: "machine_translation", derived_from: "case-200-en", translation_status: "accepted" })],
      work: [work({ assignment_id: 5, document_id: "case-200-de", task: "translation_review", status: "open", author_label: "ann-0003", person: ana })],
    });
    renderCard({ row, initialSegment: "translation" });
    expect(within(card()).queryByRole("button", { name: /^Add to the reason/ })).toBeNull();
    expect(within(card()).queryByRole("note", { name: "Reason of the correction request" })).toBeNull();
    cleanup();
    const requested = { ...row, work: [{ ...row.work[0], correction_request: { reason: "Check the dose.", requested_at: "2026-10-20T09:00:00", additions: [] } }] };
    renderCard({ row: requested, initialSegment: "translation", canManage: false });
    expect(within(card()).getByRole("note", { name: "Reason of the correction request" })).toBeTruthy();
    expect(within(card()).queryByRole("button", { name: /^Add to the reason/ })).toBeNull();
  });

  it("after a review: the newest version per chain, older ones collapsed, one Ask a reviewer to correct…, submitted reviews under their version", () => {
    const versions = [
      version({ document_id: "case-200-de", origin: "machine_translation", derived_from: "case-200-en", translation_status: "reviewed", chain_name: "m1", is_newest_in_chain: false }),
      version({ document_id: "case-200-de-v2", version: 2, origin: "correction", derived_from: "case-200-de", chain_id: "case-200-de", chain_name: "m1", translation_status: "accepted" }),
      version({ document_id: "case-200-mt", origin: "machine_translation", derived_from: "case-200-en", chain_name: "mt", translation_status: "ready_for_review" }),
    ];
    const reviewed = work({ assignment_id: 5, document_id: "case-200-de", task: "translation_review", status: "submitted", author_label: "ann-0003", person: ana });
    const open = work({ assignment_id: 6, document_id: "case-200-mt", task: "translation_review", status: "open", author_label: "ann-0004", person: tom });
    const variant = { document_id: "case-200-de-v2", translation_status: "accepted" } as never;
    const onRequestCorrection = vi.fn();
    const assignment = (id: number, documentId: string, status: string) => ({ id, document_id: documentId, status, task: "translation_review", pseudonym: "ann-0004", username: "tom", project_key: "p", revoked_at: null }) as never;
    const textVersionTools = { username: "lead", members: [], assignments: [assignment(6, "case-200-mt", "open"), assignment(5, "case-200-de", "submitted")],
      variants: new Map([["case-200-de-v2", variant]]), requiredLanguages: () => ["de"], onAssignmentsChanged: vi.fn(), onRequestCorrection };
    const row = assignRow({ versions, parallel_roots: true, work: [reviewed, open] });
    renderCard({ row, initialSegment: "translation", textVersionTools });
    const part = within(card()).getByRole("heading", { name: "Translation" }).closest("section")!;
    // Only the open reviewer has a row, with their own Reassign… and Remove…; the submitted review is listed under its version.
    const reviewers = within(part).getByRole("list", { name: "Translation reviewers" });
    expect(within(reviewers).getAllByRole("listitem")).toHaveLength(1);
    expect(within(reviewers).queryByText("Ana Weber")).toBeNull();
    expect(within(reviewers).getByRole("listitem").textContent).toContain("Review of mt v1");
    expect(within(reviewers).getAllByRole("button").map(button => button.getAttribute("aria-label"))).toEqual(["Reassign Tom Reis’s translation review", "Remove Tom Reis’s review assignment"]);
    fireEvent.click(within(reviewers).getByRole("button", { name: "Remove Tom Reis’s review assignment" }));
    expect(screen.getByRole("dialog", { name: "Remove assignment?" }).textContent).toContain("The assignment is revoked; their draft is kept, not deleted.");
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    const older = within(part).getByText("Older versions (1)").closest("details")!;
    expect(older.open).toBe(false);
    expect(within(older).getByText("m1 v1")).toBeTruthy();
    expect(within(part).getAllByRole("button", { name: "Ask a reviewer to correct m1 v2 of case-200 de…" })).toHaveLength(1);
    fireEvent.click(within(part).getByRole("button", { name: "Ask a reviewer to correct m1 v2 of case-200 de…" }));
    expect(onRequestCorrection).toHaveBeenCalledWith(row, variant);
    expect(within(part).queryByRole("button", { name: "Ask a reviewer to correct…" })).toBeNull();
  });

  it("issue 341: Correct it myself… on the accepted newest version, Accept this version… on the one not reviewed", () => {
    const versions = [
      version({ document_id: "case-200-de", origin: "machine_translation", derived_from: "case-200-en", translation_status: "reviewed", chain_name: "m1", is_newest_in_chain: false }),
      version({ document_id: "case-200-de-v2", version: 2, origin: "correction", derived_from: "case-200-de", chain_id: "case-200-de", chain_name: "m1", translation_status: "accepted" }),
      version({ document_id: "case-200-mt", origin: "machine_translation", derived_from: "case-200-en", chain_name: "mt", translation_status: "ready_for_review" }),
    ];
    const onCorrectTranslation = vi.fn(), onAcceptVersion = vi.fn();
    const textVersionTools = { username: "lead", members: [], assignments: [], variants: new Map(), requiredLanguages: () => ["de"],
      onAssignmentsChanged: vi.fn(), onRequestCorrection: vi.fn(), onCorrectTranslation, onAcceptVersion };
    const row = assignRow({ versions, parallel_roots: true, work: [] });
    renderCard({ row, initialSegment: "translation", textVersionTools });
    const part = within(card()).getByRole("heading", { name: "Translation" }).closest("section")!;
    const correct = within(part).getAllByText("Correct it myself…");
    expect(correct).toHaveLength(1);
    expect(correct[0].getAttribute("aria-label")).toBe("Correct m1 v2 of case-200 de myself…");
    // One action that changes the text: nothing to tell apart, no hint line.
    expect(part.querySelector(".text-version-hint")).toBeNull();
    fireEvent.click(correct[0]);
    expect(onCorrectTranslation).toHaveBeenCalledWith(row, versions[1]);
    const accept = within(part).getAllByText("Accept this version…");
    expect(accept).toHaveLength(1);
    expect(accept[0].getAttribute("aria-label")).toBe("Accept mt v1 of case-200 de…");
    fireEvent.click(accept[0]);
    expect(onAcceptVersion).toHaveBeenCalledWith(row, versions[2]);
  });

  it("issue 483: a version accepted by the lead's decision on a query names the decision and the answer", () => {
    const lead = { pseudonym: "ann-0002", display_name: "Project lead", is_me: false };
    const decision = { decided_document_id: "case-200-de", reviewed_document_id: "case-200-de", reviewer_assignment_id: 31, decided_at: "2026-11-18T10:12:00", decided_by: lead };
    const versions = [
      version({ document_id: "case-200-de", origin: "machine_translation", derived_from: "case-200-en", translation_status: "reviewed", latest_review_decision: "query", chain_name: "m1", is_newest_in_chain: false }),
      version({ document_id: "case-200-de-v2", version: 2, origin: "correction", derived_from: "case-200-de", chain_id: "case-200-de", chain_name: "m1", translation_status: "accepted",
        query_decision: { ...decision, kind: "reviewer_text", answer: "Yes, as proposed.", edited: false } }),
    ];
    const review = work({ assignment_id: 31, document_id: "case-200-de", task: "translation_review", status: "submitted", author_label: "ann-0003", person: { pseudonym: "ann-0003", display_name: "Ana Weber", is_me: false } });
    renderCard({ row: assignRow({ versions, work: [review] }), initialSegment: "translation", now: new Date("2026-11-20T12:00:00") });
    const part = within(card()).getByRole("heading", { name: "Translation" }).closest("section")!;
    expect(within(part).getByText("Accepted: decision on the query of Ana Weber (ann-0003), the reviewer’s text taken, Project lead (ann-0002), 18 Nov, 10:12 · Answer: Yes, as proposed.")).toBeTruthy();
  });

  it("issue 453: a version made by an editorial correction names who corrected it and why", () => {
    const versions = [
      version({ document_id: "case-200-de", origin: "machine_translation", derived_from: "case-200-en", translation_status: "accepted", chain_name: "m1", is_newest_in_chain: false }),
      version({ document_id: "case-200-de-v2", version: 2, origin: "correction", derived_from: "case-200-de", chain_id: "case-200-de", chain_name: "m1", translation_status: "accepted",
        editorial_correction: { reason: "Space before the full stop", previous_document_id: "case-200-de", inserted_characters: 0, deleted_characters: 1,
          corrected_at: "2026-11-17T10:12:00", corrected_by: { pseudonym: "ann-0002", display_name: "Project lead", is_me: false } } }),
    ];
    const row = assignRow({ versions, work: [] });
    renderCard({ row, initialSegment: "translation", now: new Date("2026-11-20T12:00:00") });
    const part = within(card()).getByRole("heading", { name: "Translation" }).closest("section")!;
    expect(within(part).getByText("Typo fix by Project lead (ann-0002), 17 Nov, 10:12 · Space before the full stop")).toBeTruthy();
  });

  it("issue 453: Fix typos… on the newest version of each translation, a rejected one included", () => {
    const versions = [
      version({ document_id: "case-200-de", origin: "machine_translation", derived_from: "case-200-en", translation_status: "accepted", chain_name: "m1", is_newest_in_chain: false }),
      version({ document_id: "case-200-de-v2", version: 2, origin: "correction", derived_from: "case-200-de", chain_id: "case-200-de", chain_name: "m1", translation_status: "accepted" }),
      version({ document_id: "case-200-mt", origin: "machine_translation", derived_from: "case-200-en", chain_name: "mt", translation_status: "reviewed", latest_review_decision: "rejected" }),
    ];
    const onEditorialCorrection = vi.fn();
    const textVersionTools = { username: "lead", members: [], assignments: [], variants: new Map(), requiredLanguages: () => ["de"],
      onAssignmentsChanged: vi.fn(), onRequestCorrection: vi.fn(), onUploadVersion: vi.fn(), onEditorialCorrection };
    const row = assignRow({ versions, parallel_roots: true, work: [] });
    renderCard({ row, initialSegment: "translation", textVersionTools });
    const part = within(card()).getByRole("heading", { name: "Translation" }).closest("section")!;
    // Not on the older version; a rejected newest version can be corrected too.
    const buttons = within(part).getAllByText("Fix typos…");
    expect(buttons.map(button => button.getAttribute("aria-label"))).toEqual(["Fix typos in m1 v2 of case-200 de…", "Fix typos in mt v1 of case-200 de…"]);
    // The tooltip tells it apart from "Correct it myself…" and "Upload a corrected text…".
    expect(buttons[0].getAttribute("title")).toBe("Spacing, typos, grammar. Keeps the status; no review.");
    // Next to the other version actions, before the upload.
    expect(buttons[0].nextElementSibling?.textContent).toBe("Upload a corrected text…");
    // Lead review F8: one visible hint line under the buttons says what tells the offered actions apart.
    const hints = [...part.querySelectorAll(".text-version-hint")].map(hint => hint.textContent);
    expect(hints).toEqual([
      "Fix typos: spacing, typos, grammar; the status stays, no review. Upload: a text made elsewhere becomes the next version.",
      "Fix typos: spacing, typos, grammar; the status stays, no review. Upload: a text made elsewhere becomes the next version.",
    ]);
    fireEvent.click(buttons[0]);
    expect(onEditorialCorrection).toHaveBeenCalledWith(row, versions[1]);
  });

  it("issue 341: Upload a corrected text… on the newest version of each translation, with how an uploaded version was made", () => {
    const versions = [
      version({ document_id: "case-200-de", origin: "machine_translation", derived_from: "case-200-en", translation_status: "accepted", chain_name: "m1", is_newest_in_chain: false }),
      version({ document_id: "case-200-de-v2", version: 2, origin: "correction", derived_from: "case-200-de", chain_id: "case-200-de", chain_name: "m1", translation_status: "ready_for_review",
        upload: { method: "machine_translation", provider: "DeepL", model: "deepl-2026-10", made_on: "2026-11-12", made_by: "Dr. Roe", note: "Checked against the source",
          uploaded_at: "2026-11-16T10:12:00", uploaded_by: { pseudonym: "ann-0002", display_name: "Project lead", is_me: false } } }),
      version({ document_id: "case-200-mt", origin: "machine_translation", derived_from: "case-200-en", chain_name: "mt", translation_status: "accepted" }),
    ];
    const onUploadVersion = vi.fn();
    const textVersionTools = { username: "lead", members: [], assignments: [], variants: new Map(), requiredLanguages: () => ["de"],
      onAssignmentsChanged: vi.fn(), onRequestCorrection: vi.fn(), onUploadVersion };
    const row = assignRow({ versions, parallel_roots: true, work: [] });
    renderCard({ row, initialSegment: "translation", textVersionTools, now: new Date("2026-11-20T12:00:00") });
    const part = within(card()).getByRole("heading", { name: "Translation" }).closest("section")!;
    // The older version sits under "Older versions" and offers no upload.
    const upload = within(part).getAllByText("Upload a corrected text…");
    expect(upload.map(button => button.getAttribute("aria-label"))).toEqual(["Upload a corrected text for m1 v2 of case-200 de…", "Upload a corrected text for mt v1 of case-200 de…"]);
    fireEvent.click(upload[0]);
    expect(onUploadVersion).toHaveBeenCalledWith(row, versions[1]);
    expect(within(part).getByText("Correction of m1 v1 · Machine translation, DeepL, deepl-2026-10")).toBeTruthy();
    expect(within(part).getByText("Uploaded by Project lead (ann-0002), 16 Nov, 10:12 · Made on 12 Nov 2026 by Dr. Roe · Checked against the source")).toBeTruthy();
  });

  it("issue 341: no Upload a corrected text… on a source text or a discarded translation", () => {
    const tools = { username: "lead", members: [], assignments: [], variants: new Map(), requiredLanguages: () => ["de"], onAssignmentsChanged: vi.fn(), onUploadVersion: vi.fn() };
    renderCard({ row: assignRow({ is_source: true, versions: [version({ document_id: "case-200-de" })] }), initialSegment: "translation", textVersionTools: tools });
    expect(within(card()).queryByText("Upload a corrected text…")).toBeNull();
    cleanup();
    const discarded = { ...version({ document_id: "case-200-de", origin: "machine_translation", translation_status: "ready_for_review" }), discarded: { reason: "Wrong text" } };
    renderCard({ row: assignRow({ versions: [discarded] }), initialSegment: "translation", textVersionTools: tools });
    expect(within(card()).queryByText("Upload a corrected text…")).toBeNull();
  });

  it("calls a native text the source text and a failed check failed", () => {
    renderCard({ row: assignRow({ is_source: true, versions: [version({ document_id: "case-200-de" })] }), initialSegment: "translation" });
    expect(within(card()).getByText("Source text")).toBeTruthy();
    expect(within(card()).queryByRole("button", { name: "Assign review…" })).toBeNull();
    cleanup();
    renderCard({ row: assignRow({ versions: [version({ document_id: "case-200-de", origin: "machine_translation", translation_status: "automatic_check_failed" })] }), initialSegment: "translation" });
    expect(within(card()).getByText("Check failed")).toBeTruthy();
  });
});

describe("finalization part", () => {
  it("the finalization part embeds the decision block", () => {
    renderCard({ initialSegment: "finalization", decision: <section aria-label="Decision">Compare results…</section> });
    expect(within(card()).getByRole("region", { name: "Decision" })).toBeTruthy();
  });

  it("opens the final result", () => {
    const chosen = final({ case_id: "case-200", language: "de", document_id: "case-200-de", submission_id: "s-final" });
    const row = assignRow({ final: chosen, stages: { review: cell("accepted", "done"), annotation: cell("submitted", "done", { submitted: 2, total: 2 }), final: cell("final", "done") } });
    const { onNavigate } = renderCard({ row });
    expect(segmentButton("Finalization").getAttribute("aria-current")).toBe("step");
    fireEvent.click(within(card()).getByRole("link", { name: "Open result" }));
    expect(onNavigate).toHaveBeenCalledWith({ name: "projectCase", key: "p", caseId: "case-200", variant: "case-200-de", show: "final:s-final", documents: query });
  });
});

describe("footer", () => {
  it("History and Text details open inside the card with Back", async () => {
    renderCard();
    fireEvent.click(await within(card()).findByRole("button", { name: /^History \(\d+\)$/ }));
    expect(within(card()).getByRole("list", { name: "Activity" })).toBeTruthy();
    // Each view names itself with a level-3 heading next to Back (issue 335).
    expect(within(card()).getByRole("heading", { level: 3, name: "History" })).toBeTruthy();
    expect(within(card()).queryByRole("navigation", { name: "Text path" })).toBeNull();
    fireEvent.click(within(card()).getByRole("button", { name: "Back" }));
    expect(within(card()).getByRole("navigation", { name: "Text path" })).toBeTruthy();
    fireEvent.click(within(card()).getByRole("button", { name: "Details" }));
    expect(await within(card()).findByRole("heading", { level: 4, name: "Technical details" })).toBeTruthy();
    expect(within(card()).getByRole("heading", { level: 3, name: "Details" })).toBeTruthy();
    fireEvent.click(within(card()).getByRole("button", { name: "Back" }));
    expect(within(card()).getByRole("navigation", { name: "Text path" })).toBeTruthy();
  });

  it("the technical details name the version of each submission and open round (issue 445)", async () => {
    vi.mocked(api.getRowSubmissions).mockImplementation(async (_key, caseId, language) => submissions(caseId, language, {
      submissions: [submission({ submission_id: "s-ana", document_id: "case-200-de", author_label: "ann-0003", author: ana, round_id: "r-ana" })],
      rounds: [
        round({ round_id: "r-ana", assignment_id: 2, document_id: "case-200-de", author_label: "ann-0003" }),
        round({ round_id: "r-tom", assignment_id: 1, document_id: "case-200-de-v2", version: 2, chain_name: "Translation", author_label: "ann-0004", state: "open", submitted: false }),
      ],
    }));
    renderCard({ initialView: "details" });
    await within(card()).findByText("Submission ID, ann-0003, v1");
    const terms = Array.from(card().querySelectorAll(".technical-details dt")).map(term => `${term.textContent}: ${term.nextElementSibling?.textContent}`);
    expect(terms).toContain("Submission ID, ann-0003, v1: s-ana, round r-ana, Annotate from scratch");
    expect(terms).toContain("Round ID, ann-0004, v2: r-tom, Annotate from scratch");
    // The submitted round is not listed again.
    expect(terms.filter(term => term.startsWith("Round ID"))).toHaveLength(1);
  });

  it("no Change plan… in the footer; a text outside the plan offers Add to plan… (the dialog)", () => {
    renderCard({ row: assignRow() });
    expect(within(card()).queryByRole("button", { name: "Change plan…" })).toBeNull();
    expect(within(card()).queryByText("This text is not worked on.")).toBeNull();
    cleanup();
    const outside = { ...assignRow(), in_plan: false } as DocumentRowView;
    const { onChangePlan } = renderCard({ row: outside });
    expect(within(card()).getByText("This text is not worked on.")).toBeTruthy();
    fireEvent.click(within(card()).getByRole("button", { name: "Add to plan…" }));
    expect(onChangePlan).toHaveBeenCalledWith(outside);
  });

  it("has no tabs", () => {
    renderCard();
    expect(within(card()).queryByRole("tablist")).toBeNull();
  });
});

describe("problem reports (from the row panel)", () => {
  type RowReport = NonNullable<DocumentRowView["problem_reports"]>[number];
  const report = (overrides: Partial<RowReport> & Pick<RowReport, "report_id">): RowReport =>
    ({ title: "Text is cut off", reporter_label: "ann-0004", created_at: "2026-10-19T08:00:00Z", state: "open", active_hold_count: 1, ...overrides });

  it("lists every problem report of the row, open and closed, under Text details", async () => {
    const { onNavigate } = renderCard({ initialView: "details", row: assignRow({ problem_reports: [
      report({ report_id: "r-2", title: "Wrong language…", created_at: "2026-10-19T10:00:00Z", state: "withdrawn", active_hold_count: 0 }),
      report({ report_id: "r-1", state: "resolved", active_hold_count: 1 }),
    ] }) });
    const section = (await within(card()).findByRole("heading", { name: "Problem reports (2)" })).closest("section")!;
    const items = within(section).getAllByRole("listitem");
    // Title, then a muted line with reporter · date · state, then Open report (issue 335).
    expect(items.map(item => [...item.children].map(child => child.textContent))).toEqual([
      ["Wrong language…", `ann-0004 · ${formatTime("2026-10-19T10:00:00Z", { now })} · Report: Withdrawn · Paused tasks: 0`, "Open report"],
      ["Text is cut off", `ann-0004 · ${formatTime("2026-10-19T08:00:00Z", { now })} · Report: Closed · Paused tasks: 1`, "Open report"],
    ]);
    fireEvent.click(within(items[0]).getByRole("link", { name: "Open report" }));
    expect(onNavigate).toHaveBeenCalledWith(reportRoute("r-2"));
    expect(card().querySelector(".text-card-banner")).toBeNull();
  });

  it("banners open reports above the path", () => {
    const { onNavigate } = renderCard({ row: assignRow({ problem_reports: [report({ report_id: "r-3" }), report({ report_id: "r-4", title: "Second" })] }) });
    const banner = card().querySelector<HTMLElement>(".text-card-banner")!;
    // A notice: its title, then its button row (issue 332).
    expect(banner.getAttribute("role")).toBe("group");
    expect(within(banner).getByText("2 open problem reports").className).toBe("text-card-banner-title");
    expect(banner.textContent).toBe("2 open problem reportsOpen");
    fireEvent.click(within(banner).getByRole("link", { name: "Open problem report, Text is cut off" }));
    expect(onNavigate).toHaveBeenCalledWith(reportRoute("r-3"));
  });
});

describe("one layout for the parts (issues 329, 331, 332)", () => {
  const versions = [
    version({ document_id: "case-200-a1", origin: "machine_translation", derived_from: "case-200-en", translation_status: "reviewed", chain_name: "Provider A", is_newest_in_chain: false }),
    version({ document_id: "case-200-a2", version: 2, origin: "correction", derived_from: "case-200-a1", chain_id: "case-200-a1", chain_name: "Provider A", translation_status: "accepted", is_newest_in_chain: false }),
    version({ document_id: "case-200-a3", version: 3, origin: "correction", derived_from: "case-200-a2", chain_id: "case-200-a1", chain_name: "Provider A", translation_status: "accepted" }),
    version({ document_id: "case-200-b1", origin: "machine_translation", derived_from: "case-200-en", chain_name: "Provider B", translation_status: "reviewed", is_newest_in_chain: false }),
    version({ document_id: "case-200-b2", version: 2, origin: "correction", derived_from: "case-200-b1", chain_id: "case-200-b1", chain_name: "Provider B", translation_status: "ready_for_review" }),
  ];
  const reviewA = work({ assignment_id: 5, document_id: "case-200-a1", task: "translation_review", status: "submitted", author_label: "ann-0003", person: ana });
  const reviewB = work({ assignment_id: 7, document_id: "case-200-b1", task: "translation_review", status: "submitted", author_label: "ann-0004", person: tom });
  const annotation = work({ assignment_id: 8, document_id: "case-200-a1", task: "annotate", status: "submitted", author_label: "ann-0005", person: luc });

  it("the version list shows each person as a person row with a status pill, Reopen… and Remove…, View text as a button; older versions by chain", () => {
    const tools = textTools([toolAssignment(5, "submitted", { task: "translation_review", document_id: "case-200-a1", pseudonym: "ann-0003" }),
      toolAssignment(7, "submitted", { task: "translation_review", document_id: "case-200-b1" }), toolAssignment(8, "submitted", { document_id: "case-200-a1", pseudonym: "ann-0005" })]);
    renderCard({ row: assignRow({ versions, parallel_roots: true, work: [reviewA, reviewB, annotation] }), initialSegment: "translation", textVersionTools: tools });
    const part = within(card()).getByRole("heading", { name: "Translation" }).closest("section")!;
    const older = within(part).getByText("Older versions (3)").closest("details")!;
    older.open = true;
    const v1 = within(part).getByRole("list", { name: "Assignments on Provider A v1" });
    const rows = within(v1).getAllByRole("listitem");
    expect(rows.map(row => row.className)).toEqual(["person-row", "person-row"]);
    expect(rows[0].querySelector(".person-row-name")!.textContent).toBe("Ana Weber");
    expect(rows[0].querySelector(".person-row-details")!.textContent).toBe("Translation review");
    expect(rows[0].querySelector(".person-row-status")!.textContent).toContain("Submitted");
    expect(within(rows[0]).getAllByRole("button").map(button => [button.textContent, button.getAttribute("aria-label")])).toEqual([
      ["Reopen…", "Reopen Ana Weber’s translation review"], ["Remove…", "Remove Ana Weber’s review assignment"]]);
    // The annotation's actions are in the Annotation part.
    expect(within(rows[1]).queryAllByRole("button")).toHaveLength(0);
    // One remove label everywhere (issue 329).
    const removes = within(card()).queryAllByRole("button").filter(button => /^Remove/.test(button.textContent ?? ""));
    expect(removes.length).toBeGreaterThan(0);
    expect(removes.every(button => button.textContent === "Remove…")).toBe(true);
    const view = within(part).getByRole("link", { name: "View text Provider A v3 of case-200 de" });
    expect(view.className).toBe("btn btn-secondary btn-sm");
    // Older versions grouped by chain, each chain a heading; the newest ones stay outside.
    expect(within(older).getAllByRole("heading").map(heading => [heading.tagName, heading.textContent])).toEqual([["H4", "Provider A"], ["H4", "Provider B"]]);
    const groupA = within(older).getByRole("region", { name: "Provider A" });
    expect([...groupA.querySelectorAll(".text-version-name")].map(name => name.textContent)).toEqual(["Provider A v1", "Provider A v2"]);
    // The chain is in the name: no repeated chain column.
    expect(part.querySelector(".text-version-chain")).toBeNull();
  });

  it("review 2, F1: a review of a version a lead fixed typos in is not reopened, and only the newest version is asked to be corrected", () => {
    const fixed = [
      version({ document_id: "case-200-de", origin: "machine_translation", derived_from: "case-200-en", translation_status: "accepted", latest_review_decision: "accepted_unchanged", chain_name: "m1", is_newest_in_chain: false }),
      version({ document_id: "case-200-de-v2", version: 2, origin: "correction", derived_from: "case-200-de", chain_id: "case-200-de", chain_name: "m1", translation_status: "accepted",
        editorial_correction: { reason: "Typo", previous_document_id: "case-200-de", inserted_characters: 1, deleted_characters: 1, corrected_at: "2026-11-17T10:12:00", corrected_by: null } }),
    ];
    const review = work({ assignment_id: 5, document_id: "case-200-de", task: "translation_review", status: "submitted", author_label: "ann-0003", person: ana });
    const variant = (document_id: string) => [document_id, { document_id, translation_status: "accepted", text_sha256: "x" }] as const;
    const tools = { ...textTools([toolAssignment(5, "submitted", { task: "translation_review", pseudonym: "ann-0003" })]),
      variants: new Map([variant("case-200-de"), variant("case-200-de-v2")]) as unknown as TextVersionsTools["variants"], onRequestCorrection: vi.fn() };
    renderCard({ row: assignRow({ versions: fixed, work: [review] }), initialSegment: "translation", textVersionTools: tools });
    const part = within(card()).getByRole("heading", { name: "Translation" }).closest("section")!;
    within(part).getByText("Older versions (1)").closest("details")!.open = true;
    const row = within(within(part).getByRole("list", { name: "Assignments on v1" })).getByRole("listitem");
    // The server refuses the reopening (VARIANT_REVIEW_STALE): the fix is reviewed, so no button offers it.
    expect(within(row).getAllByRole("button").map(button => button.getAttribute("aria-label"))).toEqual(["Remove Ana Weber’s review assignment"]);
    expect(within(part).getAllByText("Ask a reviewer to correct…").map(button => button.getAttribute("aria-label"))).toEqual(["Ask a reviewer to correct v2 of case-200 de…"]);
  });

  it("moved work is a plain person row saying where it went", () => {
    const moved = work({ assignment_id: 9, document_id: "case-200-a3", task: "annotate", status: "in_progress", author_label: "ann-0005", person: luc, moved_to_version: 4 });
    renderCard({ row: assignRow({ versions, parallel_roots: true, work: [], moved_work: [moved] }), initialSegment: "translation", textVersionTools: textTools([]) });
    const v3 = within(card()).getByRole("list", { name: "Assignments on Provider A v3" });
    expect(within(v3).getByRole("listitem").querySelector(".person-row-status")!.textContent).toContain("Moved to v4");
    expect(within(v3).queryAllByRole("button")).toHaveLength(0);
  });

  it("each lead step sits in the banner or part it acts on, with its label; nothing stands between the banners and the path", () => {
    const report = { report_id: "r-1", title: "Text is cut off", reporter_label: "ann-0004", created_at: "2026-10-19T08:00:00Z", state: "open" as const, active_hold_count: 1 };
    const decide = stepOf("decide_report", { report_id: "r-1", stage: "annotation", assignment_id: 1 });
    const resolve = stepOf("resolve_rejected", { stage: "translation_review", action: "resolve" });
    const steps = [decide, resolve].map(step => ({ step, button: <button type="button" className="btn btn-secondary btn-sm">{step.action === "resolve" ? "Resolve…" : "Decide on report…"}</button> }));
    const row = assignRow({ problem_reports: [report], steps: [decide, resolve] });
    renderCard({ row, steps, initialSegment: "translation" });
    const banner = card().querySelector<HTMLElement>(".text-card-banner")!;
    expect(within(banner).getByRole("button", { name: "Decide on report…" })).toBeTruthy();
    expect(banner.querySelector(".text-card-banner-title")!.textContent).toBe("1 open problem report: Text is cut off");
    const part = within(card()).getByRole("heading", { name: "Translation" }).closest("section")!;
    const next = within(part).getByRole("group", { name: "Next step: Resolve rejected translation" });
    expect(within(next).getByRole("button", { name: "Resolve…" })).toBeTruthy();
    // No loose action row in the card body: the banners, the path, the part.
    const body = card().querySelector(".text-card-body")!;
    expect([...body.children].map(child => child.className.split(" ")[0] || child.tagName)).toEqual(["text-card-banners", "NAV", "text-card-part"]);
  });

  it("the card opens on the part of the row's first lead step", () => {
    const carry = stepOf("carry_text_change", { stage: "annotation", assignment_id: 1 });
    const row = assignRow({ steps: [carry], stages: { review: cell("accepted", "done"), annotation: cell("submitted", "done", { submitted: 1, total: 1 }), final: cell("choose", "todo", { submitted: 1 }) } });
    renderCard({ row, steps: [{ step: carry, button: <button type="button">Carry to v2…</button> }] });
    expect(segmentButton("Annotation").getAttribute("aria-current")).toBe("step");
    expect(within(card()).getByRole("group", { name: "Next step: Carry to v2" })).toBeTruthy();
  });

  it("Open result and the stage's Change final… share one action row; a stage without actions adds no block", () => {
    const chosen = final({ case_id: "case-200", language: "de", document_id: "case-200-de", submission_id: "s-final" });
    const row = assignRow({ final: chosen, stages: { review: cell("accepted", "done"), annotation: cell("submitted", "done", { submitted: 2, total: 2 }), final: cell("final", "done") } });
    renderCard({ row, stageActions: stage => (stage === "final" ? <button type="button" className="btn btn-secondary btn-sm">Change final…</button> : null) });
    const part = within(card()).getByRole("heading", { name: "Finalization" }).closest("section")!;
    const rows = part.querySelectorAll(".text-card-actions");
    expect(rows).toHaveLength(1);
    expect([...rows[0].children].map(child => child.textContent)).toEqual(["Open result", "Change final…"]);
    // The part is the last block of the body (no stage-actions sibling after it).
    expect(card().querySelector(".text-card-body")!.lastElementChild).toBe(part);
    fireEvent.click(segmentButton("Annotation"));
    const annotationPart = within(card()).getByRole("heading", { name: "Annotation" }).closest("section")!;
    expect([...annotationPart.querySelectorAll(".text-card-actions")].filter(actions => !actions.matches(":empty"))).toHaveLength(1);
    expect(card().querySelector(".text-card-body")!.lastElementChild).toBe(annotationPart);
  });

  it("the sheet's Open text shares its line with Other languages", () => {
    vi.stubGlobal("matchMedia", (media: string) => ({ matches: media === "(max-width: 699px)", media, addEventListener: vi.fn(), removeEventListener: vi.fn(), addListener: vi.fn(), removeListener: vi.fn() }));
    const en = assignRow({ language: "en", is_source: true });
    const row = assignRow();
    const handlers = { onStep: vi.fn(), onClose: vi.fn(), onNavigate: vi.fn(), onAssign: vi.fn(), onChangePlan: vi.fn(), onChanged: vi.fn() };
    render(<TextCard projectKey="p" row={row} rows={[row, en]} query={query} reportRoute={reportRoute} canManage now={now} onSegment={vi.fn()} onView={vi.fn()} onOpenText={vi.fn()} {...handlers} />);
    const topline = card().querySelector<HTMLElement>(".text-card-topline")!;
    expect(within(topline).getByRole("link", { name: "Open text, case-200 de" })).toBeTruthy();
    expect(within(topline).getByRole("button", { name: "Show case-200 en" })).toBeTruthy();
  });
});
