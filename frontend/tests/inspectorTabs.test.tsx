import { act, cleanup, fireEvent, render, renderHook, screen, waitFor, within } from "@testing-library/react";
import { createRef } from "react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { api, type AnnotationSnapshot, type AssignmentView } from "../src/api/client";
import { CaseScreen, type WorkspaceView } from "../src/app/CaseScreen";
import {
  initialInspectorTabs, inspectorTabsReducer, tabForKey, useInspectorTabs, type DetailsDemand, type InspectorTabsState,
} from "../src/editor/InspectorTabs";
import { TaskEditor } from "../src/tasks/TaskEditor";
import { guidelineDocument, guidelineListing, guidelineSummary } from "./projectFixtures";
import { assigned, workspaceFixture } from "./assignments";
import { testUser } from "./session";

describe("inspector tabs: state", () => {
  const hosted = (state: InspectorTabsState, request: number) => inspectorTabsReducer(state, { type: "sync", hosted: true, request });

  it("a request shows the Guidelines tab and asks to focus its panel; every further request again", () => {
    let state = initialInspectorTabs(false, 0);
    expect(state.tab).toBe("details");
    state = hosted(state, 1);
    expect(state).toMatchObject({ tab: "guidelines", hosted: true, request: 1, focus: 1, focusAlways: true });
    state = inspectorTabsReducer(state, { type: "select", tab: "details" });
    expect(state.tab).toBe("details");
    // The same request again (a re-render) changes nothing; a new one brings the guidelines forward.
    expect(hosted(state, 1)).toBe(state);
    state = hosted(state, 2);
    expect(state).toMatchObject({ tab: "guidelines", focus: 2, focusAlways: true });
  });

  it("guidelines arriving without a request (a wider window) show the tab but take focus only from nowhere", () => {
    const state = hosted({ ...initialInspectorTabs(false, 3) }, 3);
    expect(state).toMatchObject({ tab: "guidelines", hosted: true, focus: 1, focusAlways: false });
  });

  it("losing the host or closing returns to Details; select is ignored without guidelines", () => {
    let state = hosted(initialInspectorTabs(false, 0), 1);
    state = inspectorTabsReducer(state, { type: "sync", hosted: false, request: 1 });
    expect(state).toMatchObject({ tab: "details", hosted: false });
    expect(inspectorTabsReducer(state, { type: "select", tab: "guidelines" })).toBe(state);
    // A request while the drawer shows the guidelines is only recorded.
    expect(inspectorTabsReducer(state, { type: "sync", hosted: false, request: 2 })).toMatchObject({ tab: "details", request: 2 });
  });

  it("details shows Details and is a no-op there", () => {
    const state = hosted(initialInspectorTabs(false, 0), 1);
    const details = inspectorTabsReducer(state, { type: "details" });
    expect(details.tab).toBe("details");
    expect(inspectorTabsReducer(details, { type: "details" })).toBe(details);
  });

  it("arrow keys wrap between the two tabs, Home and End jump", () => {
    expect(tabForKey("details", "ArrowRight")).toBe("guidelines");
    expect(tabForKey("guidelines", "ArrowRight")).toBe("details");
    expect(tabForKey("details", "ArrowLeft")).toBe("guidelines");
    expect(tabForKey("guidelines", "Home")).toBe("details");
    expect(tabForKey("details", "End")).toBe("guidelines");
    expect(tabForKey("details", "Enter")).toBeNull();
  });
});

describe("inspector tabs: what brings Details back", () => {
  function setup() {
    const scroller = createRef<HTMLElement>();
    const panel = createRef<HTMLElement>();
    return renderHook((props: { demand: DetailsDemand; hosted?: boolean; request?: number }) => useInspectorTabs({
      hosted: props.hosted ?? true, open: true, request: props.request ?? 1, returnFocus: undefined, scroller, panel, demand: props.demand,
    }), { initialProps: { demand: { key: "none", active: false } } });
  }

  it("a selection (no demand) keeps Guidelines; a new finding or a required field shows Details", () => {
    const hook = setup();
    expect(hook.result.current.tab).toBe("guidelines");
    // Selecting another finding changes no demand.
    hook.rerender({ demand: { key: "none", active: false } });
    expect(hook.result.current.tab).toBe("guidelines");
    // A demand that ends (a focus request done) does not switch.
    hook.rerender({ demand: { key: "ended", active: false } });
    expect(hook.result.current.tab).toBe("guidelines");
    hook.rerender({ demand: { key: "pending:a1", active: true } });
    expect(hook.result.current.tab).toBe("details");
    // Back to Guidelines by hand: the same open demand does not take it away again.
    act(() => hook.result.current.select("guidelines"));
    hook.rerender({ demand: { key: "pending:a1", active: true } });
    expect(hook.result.current.tab).toBe("guidelines");
    act(() => hook.result.current.showDetailsNow());
    expect(hook.result.current.tab).toBe("details");
  });
});

// --- In the editor (TaskEditor › CaseScreen) --------------------------------------------------

beforeAll(async () => { await import("../src/ui/MarkdownBody"); }, 30_000);

const T = `${new Date().getFullYear()}-10-20T14:02:00`;
let viewport = 1280;
function stubViewport(width: number) {
  viewport = width;
  window.matchMedia = ((query: string) => {
    const min = /\(min-width:\s*(\d+)px\)/.exec(query);
    const max = /\(max-width:\s*(\d+)px\)/.exec(query);
    const matches = (!min || viewport >= Number(min[1])) && (!max || viewport <= Number(max[1])) && (!!min || !!max);
    return { matches, media: query, onchange: null, addEventListener: vi.fn(), removeEventListener: vi.fn(),
      addListener: vi.fn(), removeListener: vi.fn(), dispatchEvent: vi.fn() };
  }) as unknown as typeof window.matchMedia;
}
const originalMatchMedia = window.matchMedia;

beforeEach(() => {
  vi.spyOn(api, "recordGuidelineRead").mockResolvedValue(undefined);
  vi.spyOn(api, "listGuidelines").mockResolvedValue(guidelineListing([guidelineSummary(3)], { my_latest_seen: 3 }));
  vi.spyOn(api, "getGuideline").mockImplementation(async (_key, version) => guidelineDocument(guidelineSummary(version)));
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); window.matchMedia = originalMatchMedia; });

function annotationTask(notice = false) {
  const initial = assigned(workspaceFixture());
  const assignment = { ...initial.assignment, workflow_revision: 3, guideline: { version: 3, kind: "markdown", created_at: T },
    guideline_notice: notice ? { from_version: null, to_version: 3, more: 0, changes: [{ version: 3, change_note: null, created_at: T, withdrawn: false }] } : null } as AssignmentView;
  vi.spyOn(api, "getAssignmentMetadata").mockResolvedValue(assignment);
  vi.spyOn(api, "openAssignment").mockResolvedValue({ ...initial, assignment });
  vi.spyOn(api, "listMyTasks").mockResolvedValue([]);
  vi.spyOn(api, "listProjects").mockResolvedValue([]);
  vi.spyOn(api, "resolveTermLabels").mockResolvedValue([]);
  vi.spyOn(api, "getPreferences").mockResolvedValue({ last_annotator_id: "alice", mode_by_package: {} });
  vi.spyOn(api, "listPackageOntologies").mockResolvedValue([]);
  vi.spyOn(api, "listWorkRounds").mockResolvedValue([]);
  vi.spyOn(api, "listRoundInputs").mockResolvedValue([]);
  vi.spyOn(api, "listTaskProblemReports").mockResolvedValue([]);
  render(<TaskEditor assignmentId={1} user={testUser("alice")} onNavigate={vi.fn()} routeLeaveRef={{ current: null }} leaveGuardRef={{ current: null }} />);
}

async function openFromMenu() {
  fireEvent.click(await screen.findByRole("button", { name: "More actions" }));
  fireEvent.click(await screen.findByRole("menuitem", { name: "Guidelines v3" }));
}
const inspector = () => document.querySelector<HTMLElement>(".inspector-pane")!;

/** A proposal check with three tool proposals (as in proposalCheckScreen.test.tsx). */
function proposalView(): WorkspaceView {
  const key = { project_key: "pkg-1", document_id: "doc-pc-1", annotator_id: "user-test", mode: "proposal_check" as const, scope_id: "scope-default", target_set_id: "targets-0" };
  const axes = [{ id: "assertion", label: "Assertion", options: ["present", "absent", "uncertain"], allow_empty: true }];
  const proposal = (id: string, term: string): AnnotationSnapshot => ({
    schema_version: "ontotator-annotation/v3", version: `${id}-v1`, document_id: "doc-pc-1", text_sha256: "text", ontology_sha256: "ontology", layer_config_sha256: "layer",
    annotation: { annotation_id: id, document_id: "doc-pc-1", layer_id: "phenotype", type_id: "default", term_id: term, axes_values: {}, evidence_refs: [],
      provenance: { actor: { actor_id: "tool", kind: "tool" }, method: "automatic", source_refs: [] } }, evidence: [],
  } as unknown as AnnotationSnapshot);
  const proposals = [proposal("p-1", "HP:0001252"), proposal("p-2", "HP:0001250"), proposal("p-3", "HP:0000001")];
  const targets = { target_set_id: "targets-0", targets: proposals.map(p => ({ annotation_id: p.annotation.annotation_id, version: p.version })) };
  return {
    require_chosen_axes: false, annotation_policy_revision: 1, allow_spanless_findings: true, require_spanless_note: true, enforce_spanless_rules: false,
    document: { document_id: "doc-pc-1", text: "The patient showed severe hypotonia and seizure activity.", language: "de", text_sha256: "sha-text" },
    key,
    scope: { scope_id: "scope-default", mode: "proposal_check", editable_layer_ids: ["phenotype"], reference_layer_ids: [] },
    layers: [{ layer_id: "phenotype", label: "Phenotype", ontology_id: "hp", access: "editable", default_visible: true, default_type_id: "default",
      annotation_types: [{ type_id: "default", label: "Phenotype", evidence_policy: "optional", axes }] }],
    ontologies: [{ ontology_id: "hp", release: "2024-06-25", label: "Human Phenotype Ontology", sha256: "hp-sha", format: "obo-graph-json" }],
    checked_layer_ids: [],
    draft: { key, targets, revision: 0, annotations: [], evidence: [], decisions: [], checked_layer_ids: [] },
    targets, submissions: [], available_inputs: proposals, term_statuses: {},
    axes_definition: "editor-axes/v1", axes_config: axes, axes_config_sha256: "sha-axes",
  } as unknown as WorkspaceView;
}

describe("guidelines in the editor's inspector", () => {
  it("from 1060 px, More › Guidelines opens the inspector's Guidelines tab, not a drawer", async () => {
    stubViewport(1280);
    annotationTask();
    await openFromMenu();
    const tablist = await within(inspector()).findByRole("tablist", { name: "Inspector" });
    const tabs = within(tablist).getAllByRole("tab");
    expect(tabs.map(tab => tab.textContent)).toEqual(["Details", "Guidelines v3"]);
    expect(tabs.map(tab => tab.getAttribute("aria-selected"))).toEqual(["false", "true"]);
    expect(tabs.map(tab => tab.tabIndex)).toEqual([-1, 0]);
    const panel = within(inspector()).getByRole("tabpanel", { name: "Guidelines v3" });
    expect(document.activeElement).toBe(panel);
    expect(await within(panel).findByText("Annotate negations.")).toBeDefined();
    expect(within(panel).getByRole("heading", { level: 2, name: "Guidelines v3" })).toBeDefined();
    expect(within(panel).getByRole("link", { name: "All versions" }).getAttribute("target")).toBe("_blank");
    expect(screen.queryByRole("complementary", { name: "Guidelines v3" })).toBeNull();
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.querySelector(".app-layout")!.classList.contains("inspector-with-guidelines")).toBe(true);
    // Details stays mounted (hidden), so its fields keep their input.
    const details = inspector().querySelector<HTMLElement>(".inspector-details")!;
    expect(details.hidden).toBe(true);
    expect(details.getAttribute("role")).toBe("tabpanel");
    expect(details.getAttribute("aria-labelledby")).toBe(tabs[0].id);
  });

  it("arrow keys switch the tabs (automatic activation); ✕ closes and leaves the plain inspector", async () => {
    stubViewport(1440);
    annotationTask();
    await openFromMenu();
    const guidelinesTab = await screen.findByRole("tab", { name: "Guidelines v3" });
    guidelinesTab.focus();
    fireEvent.keyDown(guidelinesTab, { key: "ArrowLeft" });
    const detailsTab = screen.getByRole("tab", { name: "Details" });
    expect(detailsTab.getAttribute("aria-selected")).toBe("true");
    expect(document.activeElement).toBe(detailsTab);
    expect(inspector().querySelector<HTMLElement>(".inspector-guidelines")!.hidden).toBe(true);
    expect(inspector().querySelector<HTMLElement>(".inspector-details")!.hidden).toBe(false);
    fireEvent.keyDown(detailsTab, { key: "End" });
    expect(screen.getByRole("tab", { name: "Guidelines v3" }).getAttribute("aria-selected")).toBe("true");
    fireEvent.click(screen.getByRole("button", { name: "Close guidelines" }));
    expect(screen.queryByRole("tablist", { name: "Inspector" })).toBeNull();
    expect(inspector().querySelector(".inspector-guidelines")).toBeNull();
    const details = inspector().querySelector<HTMLElement>(".inspector-details")!;
    expect(details.hidden).toBe(false);
    expect(details.hasAttribute("role")).toBe(false);
    expect(document.querySelector(".app-layout")!.classList.contains("inspector-with-guidelines")).toBe(false);
  });

  it("Escape in the panel and the footer's Close both close the guidelines", async () => {
    stubViewport(1280);
    annotationTask();
    await openFromMenu();
    const panel = await screen.findByRole("tabpanel", { name: "Guidelines v3" });
    fireEvent.keyDown(panel, { key: "Escape" });
    expect(screen.queryByRole("tablist", { name: "Inspector" })).toBeNull();
    await openFromMenu();
    const again = await screen.findByRole("tabpanel", { name: "Guidelines v3" });
    expect(document.activeElement).toBe(again);
    fireEvent.click(within(again).getByRole("button", { name: "Close" }));
    expect(screen.queryByRole("tabpanel", { name: "Guidelines v3" })).toBeNull();
  });

  it("the notice's Read guidelines opens the same tab; a further request brings it back from Details", async () => {
    stubViewport(1280);
    annotationTask(true);
    fireEvent.click(await screen.findByRole("button", { name: "Read guidelines v3" }));
    expect(await screen.findByRole("tabpanel", { name: "Guidelines v3" })).toBeDefined();
    fireEvent.click(screen.getByRole("tab", { name: "Details" }));
    expect(screen.getByRole("tab", { name: "Details" }).getAttribute("aria-selected")).toBe("true");
    await openFromMenu();
    await waitFor(() => expect(screen.getByRole("tab", { name: "Guidelines v3" }).getAttribute("aria-selected")).toBe("true"));
    expect(document.activeElement).toBe(screen.getByRole("tabpanel", { name: "Guidelines v3" }));
  });

  it("with Guidelines in front, selecting proposals keeps it; 1 decides the selected proposal, 4 shows Details for the note", async () => {
    stubViewport(1280);
    const view = proposalView();
    const record = vi.spyOn(api, "recordDecision").mockImplementation(async (_id, envelope) => {
      const payload = envelope.payload as { target: { annotation_id: string; version: string }; outcome: "confirmed" };
      return { ...view.draft, revision: 1, decisions: [{ decision_id: "d", target: payload.target, outcome: payload.outcome, reviewer_id: "user-test" }] };
    });
    const close = vi.fn();
    render(<CaseScreen view={view} workspaceId="ws-pc" onClose={vi.fn()} guidelines={{
      open: true, version: 1, request: 1, reader: <p>Mark the shortest span.</p>, footer: <button type="button">Close</button>,
      close, returnFocus: createRef<HTMLElement>(), drawer: null,
    }} />);
    const guidelinesTab = () => screen.getByRole("tab", { name: "Guidelines v1" });
    expect(guidelinesTab().getAttribute("aria-selected")).toBe("true");
    const rows = () => Array.from(document.querySelectorAll<HTMLElement>('[data-list-key^="target:"]'));
    fireEvent.click(rows()[0]);
    fireEvent.keyDown(window, { key: "j" });
    expect(rows()[1].classList.contains("selected")).toBe(true);
    expect(guidelinesTab().getAttribute("aria-selected")).toBe("true");
    // From inside the guidelines panel too: the key reaches the editor.
    fireEvent.keyDown(screen.getByRole("tabpanel", { name: "Guidelines v1" }), { key: "1" });
    await waitFor(() => expect(record).toHaveBeenLastCalledWith("ws-pc", expect.objectContaining({
      payload: expect.objectContaining({ outcome: "confirmed", target: { annotation_id: "p-2", version: "p-2-v1" } }) })));
    expect(guidelinesTab().getAttribute("aria-selected")).toBe("true");
    // Unresolved needs a reviewer note, which is in Details.
    fireEvent.keyDown(window, { key: "4" });
    await waitFor(() => expect(screen.getByRole("tab", { name: "Details" }).getAttribute("aria-selected")).toBe("true"));
    await waitFor(() => expect(document.activeElement?.getAttribute("aria-label")).toBe("Reviewer note"));
    expect(close).not.toHaveBeenCalled();
  });

  it("an older version shown (no inspector) or below 1060 px: the screen renders the drawer instead", () => {
    stubViewport(1000);
    render(<CaseScreen view={proposalView()} workspaceId="ws-pc" onClose={vi.fn()} guidelines={{
      open: true, version: 1, request: 1, reader: <p>Rules</p>, footer: null, close: vi.fn(), returnFocus: createRef<HTMLElement>(),
      drawer: <div data-testid="drawer">Drawer</div>,
    }} />);
    expect(screen.getByTestId("drawer")).toBeDefined();
    expect(screen.queryByRole("tablist", { name: "Inspector" })).toBeNull();
  });

  it("below 1060 px the guidelines keep their drawer (a dialog between 700 and 1279 px)", async () => {
    stubViewport(1024);
    annotationTask();
    await openFromMenu();
    expect(await screen.findByRole("dialog", { name: "Guidelines v3" })).toBeDefined();
    expect(screen.queryByRole("tablist", { name: "Inspector" })).toBeNull();
  });
});
