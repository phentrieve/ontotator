import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CaseScreen, type WorkspaceView } from "../src/app/CaseScreen";
import { AppShell } from "../src/ui/AppShell";
import { DETAILS_STRIP_WIDTH, detailsCollapsedKey, detailsRailLimits, detailsWidthKey } from "../src/editor/detailsRail";
import { DismissibleHint, HINTS_READ_KEY, showHintsAgain } from "../src/editor/DismissibleHint";
import { READ_ONLY_REASON } from "../src/editor/AnnotationPanel";
import { SubmitControl } from "../src/editor/SubmitControl";

// Issues 539 and 540: more room for the text and the tree. Invented test data only.
const TEXT = "severe muscular hypotonia";
const axes = [{ id: "assertion", label: "Assertion", options: ["present", "absent"], allow_empty: true }];
const layers = [{
  layer_id: "phenotype", label: "Phenotype", ontology_id: "hp", access: "editable" as const, default_visible: true, default_type_id: "default",
  annotation_types: [{ type_id: "default", label: "Phenotype", evidence_policy: "optional" as const, axes }],
}];
const snapshot = (annotationId: string, termId: string, note = "") => ({
  schema_version: "ontotator-annotation/v3" as const,
  annotation: {
    annotation_id: annotationId, document_id: "doc", layer_id: "phenotype", type_id: "default", term_id: termId,
    axes_values: { assertion: "present" }, note,
    evidence_refs: [{ evidence_id: `ev-${annotationId}`, version: "ev-v" }],
    provenance: { actor: { actor_id: "dr-a", kind: "human" }, method: "manual" },
  },
  evidence: [{ mention: { evidence_id: `ev-${annotationId}`, segments: [{ start: 16, end: 25 }], cue_segments: [] }, version: "ev-v", document_id: "doc", text_sha256: "text" }],
  version: `${annotationId}-v1`, document_id: "doc", text_sha256: "text", ontology_sha256: "ontology", layer_config_sha256: "layer-sha",
});
const makeView = (annotations: any[], extra: Partial<WorkspaceView> = {}): WorkspaceView => {
  const key = { project_key: "pkg", document_id: "doc", annotator_id: "dr-a", mode: "independent", scope_id: "scope-default", target_set_id: "t" };
  const targets = { target_set_id: "t", targets: [] };
  return {
    key, scope: { scope_id: "scope-default", mode: "independent", editable_layer_ids: ["phenotype"], reference_layer_ids: [] }, layers,
    ontologies: [{ ontology_id: "hp", release: "r", label: "HPO", sha256: "s", format: "obo-graph-json" as const }],
    checked_layer_ids: [], document: { document_id: "doc", text: TEXT, language: "en", text_sha256: "text" }, targets, available_inputs: [],
    submissions: [], term_statuses: {}, require_chosen_axes: false, annotation_policy_revision: 1, allow_spanless_findings: true,
    require_spanless_note: true, enforce_spanless_rules: false, axes_definition: "editor-axes/v1", axes_config: axes, axes_config_sha256: "sha-axes",
    draft: { key, targets, revision: 0, annotations, evidence: annotations.flatMap((a) => a.evidence), decisions: [], checked_layer_ids: [] },
    ...extra,
  } as WorkspaceView;
};
const versionContext = (username: string) => ({ canBrowseVersions: false, username, assignmentId: 1, onNavigate: vi.fn() });

/** A window of this width: every min-width query up to it matches, every max-width query below it does not. */
function windowOf(width: number) {
  vi.stubGlobal("matchMedia", (query: string) => {
    const min = /min-width:\s*(\d+)px/.exec(query), max = /max-width:\s*(\d+)px/.exec(query);
    const matches = (!min || width >= Number(min[1])) && (!max || width <= Number(max[1])) && !/max-height/.test(query);
    return { matches, media: query, addEventListener: vi.fn(), removeEventListener: vi.fn() };
  });
  Object.defineProperty(window, "innerWidth", { configurable: true, value: width });
}

beforeEach(() => { window.localStorage.clear(); });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks(); window.localStorage.clear(); });

describe("the right column as a rail (issue 540)", () => {
  it("has limits that keep the text 420 px beside a 220 px findings column, and its old width by default", () => {
    expect(detailsRailLimits(1440, false)).toEqual({ min: 320, max: 640, fallback: 380 });
    expect(detailsRailLimits(1280, false)).toEqual({ min: 320, max: 640, fallback: 380 });
    expect(detailsRailLimits(1100, false)).toEqual({ min: 320, max: 460, fallback: 380 });
    // With the guidelines in it, at least 420 px.
    expect(detailsRailLimits(1100, true)).toEqual({ min: 420, max: 460, fallback: 420 });
    expect(detailsRailLimits(1840, false).fallback).toBe(520);
  });

  it("collapses to a strip and expands again; the focus follows and the choice is kept per user", async () => {
    windowOf(1440);
    const { container, unmount } = render(<CaseScreen view={makeView([snapshot("a1", "HP:1")])} workspaceId="ws" onClose={vi.fn()} versionContext={versionContext("ada")} />);
    const layout = container.querySelector<HTMLElement>(".app-layout")!;
    const divider = screen.getByRole("separator", { name: "Resize details panel" });
    expect(divider.getAttribute("aria-controls")).toBe("details-column");
    expect(layout.style.getPropertyValue("--inspector-width")).toBe("380px");

    const collapse = screen.getByRole("button", { name: "Collapse details panel" });
    expect(collapse.getAttribute("aria-expanded")).toBe("true");
    fireEvent.click(collapse);
    const expand = screen.getByRole("button", { name: "Expand details panel" });
    expect(expand.getAttribute("aria-expanded")).toBe("false");
    await waitFor(() => expect(document.activeElement).toBe(expand));
    expect(layout.classList.contains("details-collapsed")).toBe(true);
    expect(layout.style.getPropertyValue("--inspector-width")).toBe(`${DETAILS_STRIP_WIDTH}px`);
    expect(screen.queryByRole("separator", { name: "Resize details panel" })).toBeNull();
    // The panel stays mounted (its input is kept), only out of sight.
    expect(container.querySelector("#details-column")).not.toBeNull();
    expect(window.localStorage.getItem(detailsCollapsedKey("ada"))).toBe("1");
    unmount();

    // Kept for this user, not for another one.
    const again = render(<CaseScreen view={makeView([snapshot("a1", "HP:1")])} workspaceId="ws" onClose={vi.fn()} versionContext={versionContext("ada")} />);
    fireEvent.click(again.getByRole("button", { name: "Expand details panel" }));
    await waitFor(() => expect(document.activeElement).toBe(again.getByRole("button", { name: "Collapse details panel" })));
    expect(window.localStorage.getItem(detailsCollapsedKey("ada"))).toBe("0");
    again.unmount();
    window.localStorage.setItem(detailsCollapsedKey("ada"), "1");
    render(<CaseScreen view={makeView([snapshot("a1", "HP:1")])} workspaceId="ws" onClose={vi.fn()} versionContext={versionContext("ben")} />);
    expect(screen.getByRole("button", { name: "Collapse details panel" })).toBeDefined();
  });

  it("is resized from the keyboard as the findings column is, and remembers the width", async () => {
    windowOf(1440);
    const { container } = render(<CaseScreen view={makeView([snapshot("a1", "HP:1")])} workspaceId="ws" onClose={vi.fn()} versionContext={versionContext("ada")} />);
    const divider = screen.getByRole("separator", { name: "Resize details panel" });
    fireEvent.keyDown(divider, { key: "ArrowLeft", shiftKey: true });
    expect(container.querySelector<HTMLElement>(".app-layout")!.style.getPropertyValue("--inspector-width")).toBe("444px");
    fireEvent.keyDown(divider, { key: "End" });
    expect(divider.getAttribute("aria-valuenow")).toBe("640");
    await waitFor(() => expect(window.localStorage.getItem(detailsWidthKey("ada"))).toBe("640"));
    fireEvent.keyDown(divider, { key: "Enter" });
    expect(divider.getAttribute("aria-valuenow")).toBe("380");
    expect(window.localStorage.getItem(detailsWidthKey("ada"))).toBeNull();
  });

  it("opens again by itself when work needs the panel: a new mark and its term search", () => {
    windowOf(1440);
    window.localStorage.setItem(detailsCollapsedKey("ada"), "1");
    const { container } = render(<CaseScreen view={makeView([])} workspaceId="ws" onClose={vi.fn()} versionContext={versionContext("ada")} />);
    expect(container.querySelector(".app-layout")!.classList.contains("details-collapsed")).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Add finding without a text span" }));
    expect(container.querySelector(".app-layout")!.classList.contains("details-collapsed")).toBe(false);
    expect(screen.getByRole("button", { name: "Collapse details panel" })).toBeDefined();
  });

  it("is no rail in two columns: no divider, no collapse, and a collapsed choice does not hide the panel", () => {
    windowOf(1024);
    window.localStorage.setItem(detailsCollapsedKey("ada"), "1");
    const { container } = render(<CaseScreen view={makeView([snapshot("a1", "HP:1")])} workspaceId="ws" onClose={vi.fn()} versionContext={versionContext("ada")} />);
    expect(screen.queryByRole("separator", { name: "Resize details panel" })).toBeNull();
    expect(screen.queryByRole("button", { name: /details panel/ })).toBeNull();
    const layout = container.querySelector<HTMLElement>(".app-layout")!;
    expect(layout.classList.contains("details-collapsed")).toBe(false);
    expect(layout.style.getPropertyValue("--inspector-width")).toBe("");
  });

  it("puts 'Show in tree' into the term's action row as an icon with its name and tooltip", () => {
    windowOf(1440);
    const { container } = render(<CaseScreen view={makeView([snapshot("a1", "HP:1")])} workspaceId="ws" onClose={vi.fn()} />);
    fireEvent.click(container.querySelector<HTMLElement>('[data-list-key="annotation:a1"]')!);
    const row = container.querySelector<HTMLElement>(".term-heading-actions")!;
    const tree = within(row).getByRole("button", { name: "Show in tree" });
    expect(tree.getAttribute("title")).toMatch(/^Show in tree/);
    expect(tree.textContent).toBe("");
    // Visual order is keyboard order: the tree, the term, the way out.
    expect(within(row).getAllByRole("button").map(button => button.getAttribute("aria-label") ?? button.textContent?.trim()))
      .toEqual(["Show in tree", "Change term /", "Clear selection"]);
    // The sections in the order they are used: values, mentions, then the note.
    const order = [".values-section", ".mentions-header", "[data-repair=annotation-note]"].map(selector => container.querySelector(selector)!);
    expect(order[0].compareDocumentPosition(order[1]) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(order[1].compareDocumentPosition(order[2]) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
});

describe("one bar for the app header and the case (issue 539)", () => {
  it("from 1025 px the case toolbar is in the header, after its own controls; Skip to content reaches it first", () => {
    windowOf(1440);
    const { container } = render(<AppShell user={null} density="reading" breadcrumb={[{ label: "My tasks", href: "#/" }, { label: "doc, Annotation" }]}>
      <CaseScreen view={makeView([snapshot("a1", "HP:1")])} workspaceId="ws" onClose={vi.fn()} />
    </AppShell>);
    const header = container.querySelector("header.shell-header")!;
    const toolbar = within(header as HTMLElement).getByRole("group", { name: "Case" });
    expect(toolbar.classList.contains("case-toolbar--merged")).toBe(true);
    // After the header's own controls in the DOM, so the Tab order is what it was.
    expect(header.querySelector(".shell-actions")!.compareDocumentPosition(toolbar) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(container.querySelector("main .case-toolbar")).toBeNull();
    fireEvent.click(screen.getByRole("link", { name: "Skip to content" }));
    expect(document.activeElement).toBe(header.querySelector(".shell-case-bar"));
  });

  it("below 1025 px the case toolbar stays above the panes, and Skip to content goes to the content", () => {
    windowOf(1000);
    const { container } = render(<AppShell user={null} density="reading"><CaseScreen view={makeView([])} workspaceId="ws" onClose={vi.fn()} /></AppShell>);
    expect(container.querySelector("main .case-toolbar")).not.toBeNull();
    expect(container.querySelector(".shell-case-bar")!.childElementCount).toBe(0);
    fireEvent.click(screen.getByRole("link", { name: "Skip to content" }));
    expect(document.activeElement).toBe(container.querySelector("main"));
  });

  it("'Next open item' is an icon with that name in the one bar", () => {
    render(<SubmitControl onSubmit={vi.fn()} disabled={false} pending={false} openCount={2} onNextOpen={vi.fn()} compact />);
    const next = screen.getByRole("button", { name: "Next open item" });
    expect(next.textContent).toBe("");
    expect(next.getAttribute("title")).toBe("Next open item");
  });
});

describe("hints that can be hidden once read (issue 540)", () => {
  it("hides a hint, keeps it hidden in this browser, and 'Show hints again' brings it back", () => {
    const first = render(<div><DismissibleHint id="demo">Read me once.</DismissibleHint></div>);
    const button = screen.getByRole("button", { name: "Hide this hint" });
    button.focus();
    fireEvent.click(button);
    expect(screen.queryByText("Read me once.")).toBeNull();
    // The focus stays in the section, not on the page.
    expect(document.activeElement).toBe(first.container.firstElementChild);
    expect(JSON.parse(window.localStorage.getItem(HINTS_READ_KEY)!)).toEqual(["demo"]);
    first.unmount();
    render(<DismissibleHint id="demo">Read me once.</DismissibleHint>);
    expect(screen.queryByText("Read me once.")).toBeNull();
    act(() => showHintsAgain());
    expect(screen.getByText("Read me once.")).toBeDefined();
    expect(window.localStorage.getItem(HINTS_READ_KEY)).toBeNull();
  });

  it("offers 'Show hints again' in More only while a hint is hidden", async () => {
    windowOf(1440);
    window.localStorage.setItem(HINTS_READ_KEY, JSON.stringify(["adjust-mark"]));
    render(<CaseScreen view={makeView([])} workspaceId="ws" onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "More actions" }));
    fireEvent.click(await screen.findByRole("menuitem", { name: "Show hints again" }));
    expect(window.localStorage.getItem(HINTS_READ_KEY)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "More actions" }));
    expect(screen.queryByRole("menuitem", { name: "Show hints again" })).toBeNull();
  });
});

describe("read-only work says why it is locked (issue 542, U1-05)", () => {
  it("drops the note hint under Remove and names the lock on the greyed-out controls", () => {
    windowOf(1440);
    const view = makeView([snapshot("a1", "HP:1")], { enforce_spanless_rules: true } as Partial<WorkspaceView>);
    const editable = render(<CaseScreen view={view} workspaceId="ws" onClose={vi.fn()} />);
    fireEvent.click(editable.container.querySelector<HTMLElement>('[data-list-key="annotation:a1"]')!);
    expect(screen.getByText("Enter a reason in the note before removing the last mention.")).toBeDefined();
    editable.unmount();

    const { container } = render(<CaseScreen view={view} workspaceId="ws" onClose={vi.fn()} readOnly />);
    fireEvent.click(container.querySelector<HTMLElement>('[data-list-key="annotation:a1"]')!);
    expect(screen.queryByText("Enter a reason in the note before removing the last mention.")).toBeNull();
    expect(screen.getByRole("button", { name: "Add mention" }).getAttribute("title")).toBe(READ_ONLY_REASON);
    expect(screen.getByRole("button", { name: "Remove" }).getAttribute("title")).toBe(READ_ONLY_REASON);
    expect((screen.getByLabelText("Note") as HTMLTextAreaElement).readOnly).toBe(true);
  });
});
