import { assigned, assignedList } from "./assignments";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { api, ValidationError, type ProjectSummary } from "../src/api/client";
import { App } from "../src/App";
import { CaseScreen, type WorkspaceView } from "../src/app/CaseScreen";
import { loggedInAs } from "./session";

const key = {
  project_key: "pkg",
  document_id: "doc",
  annotator_id: "dr-a",
  mode: "independent" as const,
  scope_id: "scope-default",
  target_set_id: "empty",
};
const scope = {
  scope_id: "scope-default",
  mode: "independent" as const,
  editable_layer_ids: ["phenotype"],
  reference_layer_ids: [],
};
const layers = [{
  layer_id: "phenotype",
  label: "Phenotype",
  ontology_id: "hp",
  access: "editable" as const,
  default_visible: true,
  default_type_id: "default",
  annotation_types: [{
    type_id: "default",
    label: "Phenotype",
    evidence_policy: "optional" as const,
    axes: [{ id: "assertion", label: "Assertion", options: ["present", "absent", "uncertain"], allow_empty: true }],
  }],
}];

/** A snapshot, usable as a draft annotation, a proposal or a reference. */
const snapshot = (annotationId: string, termId: string, sourceRefs?: string[]) => ({
  schema_version: "ontotator-annotation/v3" as const,
  annotation: {
    annotation_id: annotationId,
    document_id: "doc",
    layer_id: "phenotype",
    type_id: "default",
    term_id: termId,
    axes_values: { assertion: "present" },
    evidence_refs: [{ evidence_id: `ev-${annotationId}`, version: "ev-v" }],
    provenance: { actor: { actor_id: "dr-a", kind: "human" as const }, method: "manual", source_refs: sourceRefs },
  },
  evidence: [{
    mention: { evidence_id: `ev-${annotationId}`, segments: [{ start: 0, end: 5 }], cue_segments: [] },
    version: "ev-v", document_id: "doc", text_sha256: "text",
  }],
  version: `${annotationId}-v1`,
  document_id: "doc",
  text_sha256: "text",
  ontology_sha256: "ontology",
  layer_config_sha256: "layer-sha",
});

const baseView = (annotations: any[] = []): WorkspaceView => ({
  key,
  scope,
  layers,
  ontologies: [{ ontology_id: "hp", release: "r", label: "HPO", sha256: "s", format: "obo-graph-json" as const }],
  checked_layer_ids: [],
  document: { document_id: "doc", text: "alpha beta gamma", language: "en", text_sha256: "text" },
  targets: { target_set_id: "empty", targets: [] },
  available_inputs: [],
  submissions: [],
  term_statuses: {},
  require_chosen_axes: false, annotation_policy_revision: 1, allow_spanless_findings: true, require_spanless_note: true, enforce_spanless_rules: false, axes_definition: "editor-axes/v1",
  axes_config: [{ id: "assertion", label: "Assertion", options: ["present", "absent", "uncertain"], allow_empty: true }],
  axes_config_sha256: "sha-axes",
  draft: {
    key,
    targets: { target_set_id: "empty", targets: [] },
    revision: 0,
    annotations,
    evidence: annotations.flatMap((a) => a.evidence),
    decisions: [],
    checked_layer_ids: [],
  },
} as WorkspaceView);

/** Review view: `prop` (HP:P) is a proposal to decide, `ref` (HP:F) a reference, `annotations` the draft. */
const reviewView = (annotations: any[], decisions: any[] = []): WorkspaceView => {
  const view = baseView(annotations);
  const reviewKey = { ...key, mode: "review" as const, target_set_id: "targets" };
  const targets = { target_set_id: "targets", targets: [{ annotation_id: "prop", version: "prop-v1" }] };
  return {
    ...view,
    key: reviewKey,
    scope: { ...scope, mode: "review" as const },
    targets,
    available_inputs: [snapshot("prop", "HP:P"), snapshot("ref", "HP:F")],
    draft: { ...view.draft, key: reviewKey, targets, decisions },
  } as WorkspaceView;
};

/**
 * A tree for any start term: Root > (the start term, "Beta term" HP:B). Every walk gets its own id.
 */
const mockTree = (extra: { synonyms?: string[]; definition?: string } = {}) => {
  let walks = 0;
  const labelOf = (termId: string) => (termId === "HP:B" ? "Beta term" : `Term ${termId}`);
  const root = { term_id: "HP:R", label: "Root", child_count: 2, role: "finding" as const };
  const detailOf = (termId: string) => ({
    external_url: `https://hpo.jax.org/browse/term/${termId}`,

    term_id: termId,
    label: labelOf(termId),
    definition: "",
    synonyms: [],
    translations: {},
    parents: [root],
    ...extra,
  });
  const open = vi.spyOn(api, "openTree").mockImplementation(async (req) => {
    walks += 1;
    return {
      browse_id: `walk-${walks}`,
      start_status: "valid" as const,
      roots: [root],
      path: ["HP:R", req.term_id],
      levels: [
        {
          term_id: "HP:R",
          children: [
            { term_id: req.term_id, label: labelOf(req.term_id), child_count: 0, role: "finding" as const },
            { term_id: "HP:B", label: "Beta term", child_count: 0, role: "finding" as const },
          ],
        },
        { term_id: req.term_id, children: [] },
      ],
      detail: detailOf(req.term_id),
    };
  });
  const node = vi.spyOn(api, "loadTreeNode").mockImplementation(async (req) => ({
    detail: detailOf(req.term_id),
    children: [],
    path: [],
    levels: [],
  }));
  return { open, node };
};

/** A server that applies set_term (new version "<id>-v2") and counts decisions. */
const mockServer = (view: WorkspaceView) => {
  let current = view.draft;
  const apply = vi.spyOn(api, "applyCommand").mockImplementation(async (_workspaceId, envelope) => {
    const command: any = envelope.payload;
    if (command.command === "create_annotation") {
      const source = command.source_annotation_id ? [`${command.source_annotation_id}:${command.source_version}`] : undefined;
      const created = snapshot(command.annotation_id, command.term_id, source);
      current = {
        ...current, revision: current.revision + 1,
        annotations: [...(current.annotations ?? []), created], evidence: [...(current.evidence ?? []), ...created.evidence],
      };
      return current;
    }
    current = {
      ...current,
      revision: current.revision + 1,
      annotations: (current.annotations ?? []).map((a) =>
        command.command === "set_term" && a.annotation.annotation_id === command.annotation_id
          ? { ...a, version: `${command.annotation_id}-v2`, annotation: { ...a.annotation, term_id: command.term_id } }
          : a,
      ),
    };
    return current;
  });
  const decide = vi.spyOn(api, "recordDecision").mockImplementation(async () => {
    current = { ...current, revision: current.revision + 1 };
    return current;
  });
  return { apply, decide };
};

const entry = (container: HTMLElement, annotationId: string) =>
  container.querySelector<HTMLElement>(`[data-list-key="annotation:${annotationId}"]`)!;
const showInTree = () => screen.queryByRole("button", { name: "Show in tree" });
const rowOf = (scopeEl: HTMLElement, label: string) =>
  within(scopeEl).getByText(label, { selector: ".tree-label" }).closest('[role="treeitem"]') as HTMLElement;
const useButton = (scopeEl: HTMLElement) =>
  within(scopeEl).getByRole("button", { name: "Use this term" }) as HTMLButtonElement;

/** Select the draft annotation and open its tree. */
const openPanel = async (container: HTMLElement, annotationId: string) => {
  fireEvent.click(entry(container, annotationId));
  fireEvent.click(screen.getByRole("button", { name: "Show in tree" }));
  const panel = await screen.findByRole("region", { name: "Ontology tree" });
  await within(panel).findByText("Beta term", { selector: ".tree-label" });
  return panel;
};
const panelNow = () => screen.getByRole("region", { name: "Ontology tree" });
const noTree = () => {
  expect(screen.queryByRole("region", { name: "Ontology tree" })).toBeNull();
  expect(screen.queryByRole("dialog", { name: "Ontology tree" })).toBeNull();
};

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  delete (window as any).matchMedia;
});

describe("the tree in the case screen", () => {
  it("links the selected term to its official page next to its id", async () => {
    const view = baseView([snapshot("a1", "HP:A")]);
    mockTree();
    const { container } = render(<CaseScreen view={view} workspaceId="ws" onClose={vi.fn()} />);

    const panel = await openPanel(container, "a1");
    const detail = panel.querySelector<HTMLElement>(".tree-detail")!;

    const link = await within(detail).findByRole("link", { name: "View HP:A on hpo.jax.org" });
    expect(link.getAttribute("href")).toBe("https://hpo.jax.org/browse/term/HP:A");
    expect(link.getAttribute("target")).toBe("_blank");
    expect(link.getAttribute("rel")).toBe("noopener noreferrer");
    // The id element holds the id alone; the link is its sibling.
    expect(detail.querySelector(".tree-detail__id")?.textContent).toBe("HP:A");
    expect(link.parentElement).toBe(detail.querySelector(".tree-detail__id")?.parentElement);
  });

  it("hides the details under the tree down to name and id, and remembers that for the user", async () => {
    window.localStorage.clear();
    mockTree({ synonyms: ["Alpha synonym"], definition: "A made-up definition." });
    const versionContext = { canBrowseVersions: false, username: "ada", assignmentId: 1, onNavigate: vi.fn() };
    const first = render(<CaseScreen view={baseView([snapshot("a1", "HP:A")])} workspaceId="ws" onClose={vi.fn()} versionContext={versionContext} />);
    const panel = await openPanel(first.container, "a1");
    const detail = panel.querySelector<HTMLElement>(".tree-detail")!;
    expect(await within(detail).findByText("Alpha synonym")).toBeTruthy();

    const hide = within(detail).getByRole("button", { name: "Hide details" });
    expect(hide.getAttribute("aria-expanded")).toBe("true");
    // The switch names what it shows and hides, open or closed.
    expect(detail.querySelector(`#${hide.getAttribute("aria-controls")}`)).not.toBeNull();
    // It stands by the name; the action row is "Use this term" and its hint, as before.
    expect(hide.parentElement).toBe(detail.querySelector(".tree-detail__name")?.parentElement);
    expect(detail.querySelectorAll(".tree-detail__actions button")).toHaveLength(1);
    fireEvent.click(hide);
    expect(within(detail).queryByText("Alpha synonym")).toBeNull();
    expect(within(detail).queryByText("A made-up definition.")).toBeNull();
    expect(detail.querySelector(".tree-detail__id")?.textContent).toBe("HP:A");
    expect(detail.classList.contains("tree-detail--compact")).toBe(true);
    const show = within(detail).getByRole("button", { name: "Show details" });
    expect(show.getAttribute("aria-expanded")).toBe("false");
    expect(detail.querySelector(`#${show.getAttribute("aria-controls")}`)).not.toBeNull();
    expect(within(detail).getByRole("button", { name: "Use this term" })).toBeTruthy();
    expect(window.localStorage.getItem("ontotator.editor.treeDetails.v1:ada")).toBe("closed");
    first.unmount();

    // Another person at this browser starts with the details shown; "ada" finds them hidden again.
    const other = render(<CaseScreen view={baseView([snapshot("a1", "HP:A")])} workspaceId="ws" onClose={vi.fn()}
      versionContext={{ ...versionContext, username: "ben" }} />);
    expect(within(await openPanel(other.container, "a1")).getByRole("button", { name: "Hide details" })).toBeTruthy();
    other.unmount();
    const again = render(<CaseScreen view={baseView([snapshot("a1", "HP:A")])} workspaceId="ws" onClose={vi.fn()} versionContext={versionContext} />);
    const reopened = (await openPanel(again.container, "a1")).querySelector<HTMLElement>(".tree-detail")!;
    expect(reopened.classList.contains("tree-detail--compact")).toBe(true);
    expect(within(reopened).queryByText("Alpha synonym")).toBeNull();

    fireEvent.click(within(reopened).getByRole("button", { name: "Show details" }));
    expect(await within(reopened).findByText("Alpha synonym")).toBeTruthy();
    expect(window.localStorage.getItem("ontotator.editor.treeDetails.v1:ada")).toBe("open");
    window.localStorage.clear();
  });

  it("is offered wherever a term is shown: an own finding, a proposal, a reference (issue 523)", () => {
    const { container } = render(
      <CaseScreen view={reviewView([snapshot("a1", "HP:A")])} workspaceId="ws" onClose={vi.fn()} />,
    );

    expect(showInTree()).toBeNull();

    fireEvent.click(container.querySelector<HTMLElement>('[data-list-key^="target:"]')!);
    expect(screen.getByText(/Review decision for this proposal/i)).toBeDefined();
    expect(showInTree()).not.toBeNull();

    fireEvent.click(container.querySelector<HTMLElement>('[data-list-key^="source:"]')!);
    expect(screen.getByLabelText("Reference details")).toBeDefined();
    expect(showInTree()).not.toBeNull();

    fireEvent.click(entry(container, "a1"));
    expect(showInTree()).not.toBeNull();

    // A new annotation has no term yet: the tree is offered at a hit of its search (see below).
    fireEvent.click(screen.getByRole("button", { name: /Add finding without a text span/ }));
    expect(showInTree()).toBeNull();
  });

  it("opens the tree at the annotation's term, docked under the annotation panel", async () => {
    const view = baseView([snapshot("a1", "HP:A")]);
    const { open } = mockTree();
    const { container } = render(<CaseScreen view={view} workspaceId="ws" onClose={vi.fn()} />);

    // Never by itself: selecting an annotation is not asking for the tree.
    fireEvent.click(entry(container, "a1"));
    noTree();
    fireEvent.click(entry(container, "a1")); // deselect again

    const panel = await openPanel(container, "a1");

    expect(screen.queryByRole("dialog", { name: "Ontology tree" })).toBeNull();
    expect(open).toHaveBeenCalledTimes(1);
    expect(open.mock.calls[0][0]).toEqual({
      workspace_key: view.key,
      annotation_id: "a1",
      layer_id: "phenotype",
      term_id: "HP:A",
    });
    expect(rowOf(panel, "Term HP:A").getAttribute("aria-selected")).toBe("true");
    expect(rowOf(panel, "Term HP:A").getAttribute("aria-current")).toBe("true");
    expect(useButton(panel).disabled).toBe(true);
    // Docked into the layout, right after the annotation panel.
    const layout = container.querySelector(".app-layout")!;
    expect(layout.classList.contains("tree-open")).toBe(true);
    expect(panel.parentElement!.className).toBe("tree-host");
    expect(panel.parentElement!.parentElement).toBe(layout);
    // Only the divider that sets the tree's height follows it.
    expect(panel.parentElement!.nextElementSibling?.getAttribute("aria-label")).toBe("Resize ontology tree");
    expect(layout.lastElementChild).toBe(panel.parentElement!.nextElementSibling);
    expect(panel.parentElement!.previousElementSibling).toBe(container.querySelector(".inspector-pane"));
    // One control in the header: close. There is nothing to keep open or to store.
    const header = panel.querySelector<HTMLElement>(".tree-browser__header")!;
    expect(within(header).getAllByRole("button").map((b) => b.getAttribute("aria-label"))).toEqual(["Close tree"]);
    expect(screen.queryByRole("button", { name: "Keep open" })).toBeNull();
    // Opened by hand it takes the focus, on the start term; nothing is modal.
    expect(document.activeElement).toBe(rowOf(panel, "Term HP:A"));
    expect(panel.hasAttribute("aria-modal")).toBe(false);
  });

  it("is docked all the same in a narrow window", async () => {
    // Whatever the window's width, there is one form.
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      writable: true,
      value: (query: string) => ({
        matches: false,
        media: query,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      }),
    });
    const view = baseView([snapshot("a1", "HP:A")]);
    mockTree();
    const { container } = render(<CaseScreen view={view} workspaceId="ws" onClose={vi.fn()} />);

    const panel = await openPanel(container, "a1");

    expect(screen.queryByRole("dialog", { name: "Ontology tree" })).toBeNull();
    expect(container.querySelector(".app-layout")!.classList.contains("tree-open")).toBe(true);
    expect(panel.parentElement!.previousElementSibling).toBe(container.querySelector(".inspector-pane"));
  });

  it("'Use this term' sends set_term bound to the walk, as a search selection would, and keeps the annotation selected", async () => {
    const view = baseView([snapshot("a1", "HP:A")]);
    mockTree();
    const { apply, decide } = mockServer(view);
    const { container } = render(<CaseScreen view={view} workspaceId="ws" onClose={vi.fn()} />);
    const panel = await openPanel(container, "a1");

    fireEvent.click(rowOf(panel, "Beta term"));
    // Selecting a node assigns nothing.
    expect(apply).not.toHaveBeenCalled();
    fireEvent.click(useButton(panel));

    await waitFor(() => expect(rowOf(panel, "Beta term").getAttribute("aria-current")).toBe("true"));
    expect(apply).toHaveBeenCalledTimes(1);
    expect(apply.mock.calls[0][1].payload).toEqual({
      command: "set_term",
      annotation_id: "a1",
      term_id: "HP:B",
      search_event_id: "walk-1",
    });
    expect(decide).not.toHaveBeenCalled();
    expect(entry(container, "a1").classList.contains("selected")).toBe(true);
    expect(entry(container, "a1").textContent).toContain("HP:B");
    expect(showInTree()).not.toBeNull();
    // The tree is still there.
    expect(panelNow()).toBe(panel);
  });

  it("stays open after 'Use this term' and marks the new term as the current one", async () => {
    const view = baseView([snapshot("a1", "HP:A")]);
    const { open } = mockTree();
    const { apply } = mockServer(view);
    const { container } = render(<CaseScreen view={view} workspaceId="ws" onClose={vi.fn()} />);
    const panel = await openPanel(container, "a1");

    fireEvent.click(rowOf(panel, "Beta term"));
    fireEvent.click(useButton(panel));

    await waitFor(() => expect(rowOf(panel, "Beta term").getAttribute("aria-current")).toBe("true"));
    expect(apply).toHaveBeenCalledTimes(1);
    expect(panelNow()).toBe(panel);
    expect(rowOf(panel, "Term HP:A").hasAttribute("aria-current")).toBe(false);
    await waitFor(() => expect(within(panel).getByText("This is the finding's current term.")).toBeDefined());
    expect(useButton(panel).disabled).toBe(true);
    // Still the same walk.
    expect(open).toHaveBeenCalledTimes(1);

    // A second change from the same walk carries the same id.
    fireEvent.click(rowOf(panel, "Term HP:A"));
    await waitFor(() => expect(useButton(panel).disabled).toBe(false));
    fireEvent.click(useButton(panel));
    await waitFor(() => expect(apply).toHaveBeenCalledTimes(2));
    expect(apply.mock.calls[1][1].payload).toMatchObject({ term_id: "HP:A", search_event_id: "walk-1" });
  });

  it("says in the tree why the server refuses the term, and leaves the annotation as it was", async () => {
    const view = baseView([snapshot("a1", "HP:A")]);
    mockTree();
    // A 422 as the server sends it. (Any other error would count as "server unreachable":
    // the mutation queue then keeps the edit pending instead of rejecting it.)
    vi.spyOn(api, "applyCommand").mockRejectedValue(
      new ValidationError("Search selection does not match", "INVALID_SEARCH_SELECTION"),
    );
    const { container } = render(<CaseScreen view={view} workspaceId="ws" onClose={vi.fn()} />);
    const panel = await openPanel(container, "a1");

    fireEvent.click(rowOf(panel, "Beta term"));
    fireEvent.click(useButton(panel));

    expect((await within(panel).findByRole("alert")).textContent).toBe("Search selection does not match");
    expect(panelNow()).toBe(panel);
    expect(entry(container, "a1").textContent).toContain("HP:A");
    expect(rowOf(panel, "Term HP:A").getAttribute("aria-current")).toBe("true");
    expect(rowOf(panel, "Beta term").hasAttribute("aria-current")).toBe(false);
    // Still usable: the term can be tried again.
    await waitFor(() => expect(useButton(panel).disabled).toBe(false));
  });

  it("Escape inside the tree closes it, leaves the selection and hands the focus back; a second Escape clears the selection as before", async () => {
    const view = baseView([snapshot("a1", "HP:A")]);
    mockTree();
    const { container } = render(<CaseScreen view={view} workspaceId="ws" onClose={vi.fn()} />);
    const panel = await openPanel(container, "a1");
    const row = rowOf(panel, "Term HP:A");
    expect(document.activeElement).toBe(row);

    fireEvent.keyDown(row, { key: "Escape" });
    noTree();
    expect(container.querySelector(".app-layout")!.classList.contains("tree-open")).toBe(false);
    expect(entry(container, "a1").classList.contains("selected")).toBe(true);
    // The focus was in the tree: it goes back to where the tree was asked for.
    expect(document.activeElement).toBe(showInTree());

    fireEvent.keyDown(document.body, { key: "Escape" });
    expect(entry(container, "a1").classList.contains("selected")).toBe(false);
  });

  it("Escape outside the tree widget is the case screen's: it clears the selection, and the tree closes with it", async () => {
    const view = baseView([snapshot("a1", "HP:A")]);
    mockTree();
    const { container } = render(<CaseScreen view={view} workspaceId="ws" onClose={vi.fn()} />);
    const panel = await openPanel(container, "a1");

    const close = within(panel).getByRole("button", { name: "Close tree" });
    close.focus();
    fireEvent.keyDown(close, { key: "Escape" });

    expect(entry(container, "a1").classList.contains("selected")).toBe(false);
    noTree();
    // "Show in tree" went with the selection: the focus is on the text, not lost to the page.
    expect(document.activeElement?.classList.contains("text-container")).toBe(true);
  });

  it("closes with its close button or with Escape inside the tree, and does not come back by itself", async () => {
    const view = baseView([snapshot("a1", "HP:A"), snapshot("a2", "HP:C")]);
    const { open } = mockTree();
    const { container } = render(<CaseScreen view={view} workspaceId="ws" onClose={vi.fn()} />);
    const panel = await openPanel(container, "a1");
    const row = rowOf(panel, "Term HP:A");
    expect(document.activeElement).toBe(row);

    fireEvent.keyDown(row, { key: "Escape" });

    noTree();
    // Escape closed the tree only: the annotation is still selected.
    expect(entry(container, "a1").classList.contains("selected")).toBe(true);

    // Selecting another annotation does not bring the tree back.
    fireEvent.click(entry(container, "a2"));
    await new Promise((resolve) => setTimeout(resolve, 0));
    noTree();
    expect(open).toHaveBeenCalledTimes(1);

    // Asked for again, it is docked again; its close button closes it.
    fireEvent.click(screen.getByRole("button", { name: "Show in tree" }));
    await screen.findByRole("region", { name: "Ontology tree" });
    expect(open).toHaveBeenCalledTimes(2);
    const close = screen.getByRole("button", { name: "Close tree" });
    close.focus();
    fireEvent.click(close);
    noTree();
    expect(entry(container, "a2").classList.contains("selected")).toBe(true);
    expect(document.activeElement).toBe(showInTree());

    // Closed while the focus is elsewhere, the focus stays where it is.
    fireEvent.click(screen.getByRole("button", { name: "Show in tree" }));
    const again = await screen.findByRole("region", { name: "Ontology tree" });
    await within(again).findByText("Beta term", { selector: ".tree-label" });
    const elsewhere = entry(container, "a1");
    elsewhere.tabIndex = 0;
    elsewhere.focus();
    expect(document.activeElement).toBe(elsewhere);
    fireEvent.click(screen.getByRole("button", { name: "Close tree" }));
    noTree();
    expect(document.activeElement).toBe(elsewhere);
  });

  it("in review, a term from the tree makes the adopted proposal count as changed", async () => {
    const view = reviewView([snapshot("copy", "HP:P", ["prop:prop-v1"])]);
    mockTree();
    const { apply, decide } = mockServer(view);
    const { container } = render(<CaseScreen view={view} workspaceId="ws" onClose={vi.fn()} />);
    const panel = await openPanel(container, "copy");

    fireEvent.click(rowOf(panel, "Beta term"));
    fireEvent.click(useButton(panel));

    await waitFor(() => expect(decide).toHaveBeenCalledTimes(1));
    expect(apply).toHaveBeenCalledTimes(1);
    expect(apply.mock.calls[0][1].payload).toEqual({
      command: "set_term",
      annotation_id: "copy",
      term_id: "HP:B",
      search_event_id: "walk-1",
    });
    expect(decide.mock.calls[0][1].payload).toMatchObject({
      target: { annotation_id: "prop", version: "prop-v1" },
      outcome: "changed",
      replacement: { annotation_id: "copy", version: "copy-v2" },
    });
    await waitFor(() => expect(rowOf(panelNow(), "Beta term").getAttribute("aria-current")).toBe("true"));
  });

  it("in review, an explicit rejection of the proposal stays", async () => {
    const rejected = {
      decision_id: "d1",
      target: { annotation_id: "prop", version: "prop-v1" },
      outcome: "rejected",
      reviewer_id: "dr-a",
    };
    const view = reviewView([snapshot("copy", "HP:P", ["prop:prop-v1"])], [rejected]);
    mockTree();
    const { apply, decide } = mockServer(view);
    const { container } = render(<CaseScreen view={view} workspaceId="ws" onClose={vi.fn()} />);
    const panel = await openPanel(container, "copy");

    fireEvent.click(rowOf(panel, "Beta term"));
    fireEvent.click(useButton(panel));

    // The tree can assign again only after set_term and its post-processing are through:
    // the term it started at is then no longer the current one, and nothing is being saved.
    await waitFor(() => expect(rowOf(panel, "Beta term").getAttribute("aria-current")).toBe("true"));
    fireEvent.click(rowOf(panel, "Term HP:P"));
    await waitFor(() => expect(useButton(panel).disabled).toBe(false));
    expect(apply).toHaveBeenCalledTimes(1);
    expect(decide).not.toHaveBeenCalled();
  });

  it("follows every selection with a term, and closes when nothing is selected", async () => {
    const view = reviewView([snapshot("a1", "HP:A"), snapshot("a2", "HP:C")]);
    const { open } = mockTree();
    const { container } = render(<CaseScreen view={view} workspaceId="ws" onClose={vi.fn()} />);
    await openPanel(container, "a1");
    expect(open.mock.calls[0][0]).toMatchObject({ annotation_id: "a1", term_id: "HP:A" });

    // Another own annotation: a new walk at its term.
    fireEvent.click(entry(container, "a2"));
    await waitFor(() => expect(open).toHaveBeenCalledTimes(2));
    expect(open.mock.calls[1][0]).toEqual({
      workspace_key: view.key,
      annotation_id: "a2",
      layer_id: "phenotype",
      term_id: "HP:C",
    });
    await within(panelNow()).findByText("Term HP:C", { selector: ".tree-label" });
    expect(rowOf(panelNow(), "Term HP:C").getAttribute("aria-selected")).toBe("true");
    // The jump does not take the keyboard focus away from where the annotator is working.
    expect(panelNow().contains(document.activeElement)).toBe(false);

    // Picking a term inside the tree changes no selection: no new walk.
    fireEvent.click(rowOf(panelNow(), "Beta term"));
    expect(useButton(panelNow()).disabled).toBe(false);
    expect(open).toHaveBeenCalledTimes(2);

    // A proposal: the tree stays and moves to the proposed term, only to look until a term is confirmed.
    fireEvent.click(container.querySelector<HTMLElement>('[data-list-key^="target:"]')!);
    await waitFor(() => expect(open).toHaveBeenCalledTimes(3));
    expect(open.mock.calls[2][0]).toMatchObject({ layer_id: "phenotype", term_id: "HP:P" });
    // The id its copy would get, never the proposal's own.
    expect(open.mock.calls[2][0].annotation_id).toMatch(/^ann-/);
    await within(panelNow()).findByText("Term HP:P", { selector: ".tree-label" });
    expect(within(panelNow()).getByRole("status").textContent).toBe("Only looking: nothing changes until you choose a term and confirm.");
    expect(within(panelNow()).getByRole("button", { name: "Use this term instead…" })).toBeDefined();

    // A reference: looking only, and the walk is logged under an id of its own.
    fireEvent.click(container.querySelector<HTMLElement>('[data-list-key^="source:"]')!);
    await waitFor(() => expect(open).toHaveBeenCalledTimes(4));
    expect(open.mock.calls[3][0]).toMatchObject({ layer_id: "phenotype", term_id: "HP:F" });
    expect(open.mock.calls[3][0].annotation_id).toMatch(/^look-/);
    await within(panelNow()).findByText("Term HP:F", { selector: ".tree-label" });
    expect(within(panelNow()).getByRole("status").textContent).toBe("Only looking: nothing can be changed from here.");
    expect(within(panelNow()).queryByRole("button", { name: /Use this term/ })).toBeNull();

    // Selecting nothing at all closes it, and it does not come back by itself.
    fireEvent.keyDown(document.body, { key: "Escape" });
    expect(container.querySelector(".doc-item.selected")).toBeNull();
    noTree();
    fireEvent.click(entry(container, "a2"));
    await new Promise((resolve) => setTimeout(resolve, 0));
    noTree();
    expect(open).toHaveBeenCalledTimes(4);
  });

  it("makes room for the term search of a new annotation, and comes back as it was", async () => {
    const view = baseView([snapshot("a1", "HP:A")]);
    const { open } = mockTree();
    const { container } = render(<CaseScreen view={view} workspaceId="ws" onClose={vi.fn()} />);
    const panel = await openPanel(container, "a1");
    fireEvent.click(rowOf(panel, "Beta term"));
    const layout = container.querySelector(".app-layout")!;
    expect(layout.classList.contains("tree-open")).toBe(true);

    // A new annotation has no term yet: the search gets the whole column.
    fireEvent.click(screen.getByRole("button", { name: "Add finding without a text span" }));
    expect(screen.getByRole("combobox", { name: "Search term" })).toBeDefined();
    noTree();
    expect(panel.parentElement!.hidden).toBe(true);
    expect(layout.classList.contains("tree-open")).toBe(false);
    expect(panel.contains(document.activeElement)).toBe(false);

    // The search is given up: the tree is back, the same walk, with what was selected in it.
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(panelNow()).toBe(panel);
    expect(panel.parentElement!.hidden).toBe(false);
    expect(layout.classList.contains("tree-open")).toBe(true);
    expect(rowOf(panel, "Beta term").getAttribute("aria-selected")).toBe("true");
    expect(open).toHaveBeenCalledTimes(1);
  });
});

describe("the tree only to look, and taking a term after a confirmation (issue 523)", () => {
  const takeButton = (scopeEl: HTMLElement) =>
    within(scopeEl).getByRole("button", { name: "Use this term instead…" }) as HTMLButtonElement;
  const showFor = async (container: HTMLElement, selector: string) => {
    fireEvent.click(container.querySelector<HTMLElement>(selector)!);
    fireEvent.click(screen.getByRole("button", { name: "Show in tree" }));
    const panel = await screen.findByRole("region", { name: "Ontology tree" });
    await within(panel).findByText("Beta term", { selector: ".tree-label" });
    return panel;
  };

  it("an undecided proposal: looking changes nothing; Confirm runs Edit & Replace with the term, decided as Changed", async () => {
    const view = reviewView([]);
    const { open } = mockTree();
    const { apply, decide } = mockServer(view);
    const { container } = render(<CaseScreen view={view} workspaceId="ws" onClose={vi.fn()} />);
    const panel = await showFor(container, '[data-list-key^="target:"]');
    const walkId = open.mock.calls[0][0].annotation_id;
    expect(open.mock.calls[0][0]).toMatchObject({ term_id: "HP:P", layer_id: "phenotype" });
    // The proposed term itself is nothing to take.
    expect(takeButton(panel).disabled).toBe(true);
    expect(within(panel).getByText("This is the proposed term.")).toBeDefined();

    fireEvent.click(rowOf(panel, "Beta term"));
    expect(apply).not.toHaveBeenCalled();
    await waitFor(() => expect(takeButton(panel).disabled).toBe(false));
    fireEvent.click(takeButton(panel));
    expect(apply).not.toHaveBeenCalled();
    const confirm = within(panel).getByRole("group", { name: "Proposal: decide as Changed with Beta term (HP:B)" });
    fireEvent.click(within(confirm).getByRole("button", { name: "Confirm" }));

    await waitFor(() => expect(decide).toHaveBeenCalledTimes(1));
    // The same commands as Edit & Replace and a new term: the copy (with the walk's id), then its term.
    expect(apply.mock.calls.map(([, envelope]) => (envelope.payload as any).command)).toEqual(["create_annotation", "set_term"]);
    expect(apply.mock.calls[0][1].payload).toMatchObject({
      command: "create_annotation", annotation_id: walkId, term_id: "HP:P", source_annotation_id: "prop", source_version: "prop-v1",
    });
    expect(apply.mock.calls[1][1].payload).toEqual({
      command: "set_term", annotation_id: walkId, term_id: "HP:B", search_event_id: "walk-1",
    });
    expect(decide.mock.calls[0][1].payload).toMatchObject({
      target: { annotation_id: "prop", version: "prop-v1" },
      outcome: "changed",
      replacement: { annotation_id: walkId, version: `${walkId}-v2` },
    });
    // The copy is selected; the tree stays with it, the same walk, and now assigns directly.
    expect(entry(container, walkId).classList.contains("selected")).toBe(true);
    expect(panelNow()).toBe(panel);
    expect(open).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(rowOf(panel, "Beta term").getAttribute("aria-current")).toBe("true"));
    expect(within(panel).queryByRole("status")).toBeNull();
    expect(useButton(panel).disabled).toBe(true);
  });

  it.each([
    ["a decided proposal", () => reviewView([], [{ decision_id: "d1", target: { annotation_id: "prop", version: "prop-v1" }, outcome: "confirmed", reviewer_id: "dr-a" }]), '[data-list-key^="target:"]', {}],
    ["a reference", () => reviewView([]), '[data-list-key^="source:"]', {}],
    ["other people's findings in a consolidation", () => reviewView([]), '[data-list-key^="target:"]', { roundKind: "consolidation" as const }],
    ["a submitted own finding", () => baseView([snapshot("a1", "HP:A")]), '[data-list-key="annotation:a1"]', { readOnly: true }],
  ])("%s: only to look, with no button", async (_name, viewOf, selector, extra) => {
    mockTree();
    const { apply, decide } = mockServer(viewOf());
    const { container } = render(<CaseScreen view={viewOf()} workspaceId="ws" onClose={vi.fn()} {...extra} />);
    const panel = await showFor(container, selector);

    expect(within(panel).getByRole("status").textContent).toBe("Only looking: nothing can be changed from here.");
    fireEvent.click(rowOf(panel, "Beta term"));
    await within(panel).findByText("Beta term", { selector: ".tree-detail__name" });
    expect(within(panel).queryByRole("button", { name: /Use this term/ })).toBeNull();
    expect(apply).not.toHaveBeenCalled();
    expect(decide).not.toHaveBeenCalled();
  });

  it("a hit of the search for a new finding: the tree opens there; Confirm chooses the term as the hit would", async () => {
    const view = baseView([]);
    const { open } = mockTree();
    const { apply } = mockServer(view);
    vi.spyOn(api, "searchOntology").mockResolvedValue({ search_id: "s1", candidates: [{ term_id: "HP:H", label: "Hit term", rank: 1 }] } as any);
    render(<CaseScreen view={view} workspaceId="ws" onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Add finding without a text span" }));
    fireEvent.change(screen.getByRole("combobox", { name: "Search term" }), { target: { value: "hit" } });
    fireEvent.click(await screen.findByRole("button", { name: "Show in tree: Hit term" }));

    const panel = await screen.findByRole("region", { name: "Ontology tree" });
    await within(panel).findByText("Beta term", { selector: ".tree-label" });
    // Out in the open next to the search, not stepped aside.
    expect(panel.parentElement!.hidden).toBe(false);
    const pendingId = open.mock.calls[0][0].annotation_id;
    expect(pendingId).toMatch(/^ann-/);
    expect(open.mock.calls[0][0]).toMatchObject({ term_id: "HP:H", layer_id: "phenotype" });
    expect(within(panel).getByRole("status").textContent).toBe("Only looking: nothing changes until you choose a term and confirm.");

    fireEvent.click(rowOf(panel, "Beta term"));
    await waitFor(() => expect(takeButton(panel).disabled).toBe(false));
    fireEvent.click(takeButton(panel));
    expect(apply).not.toHaveBeenCalled();
    const confirm = within(panel).getByRole("group", { name: "New finding: choose Beta term (HP:B)" });
    fireEvent.click(within(confirm).getByRole("button", { name: "Confirm" }));

    await waitFor(() => expect(apply).toHaveBeenCalledTimes(1));
    expect(apply.mock.calls[0][1].payload).toMatchObject({
      command: "create_annotation", annotation_id: pendingId, term_id: "HP:B", search_event_id: "walk-1",
    });
    // The new finding is selected and the walk stays with it.
    await waitFor(() => expect(screen.queryByRole("combobox", { name: "Search term" })).toBeNull());
    expect(panelNow()).toBe(panel);
    expect(open).toHaveBeenCalledTimes(1);
  });
});

describe("the stepped-aside tree after a new finding", () => {
  it("goes to the new finding's term once its term is chosen from the search", async () => {
    const view = baseView([snapshot("a1", "HP:A")]);
    const { open } = mockTree();
    mockServer(view);
    vi.spyOn(api, "searchOntology").mockResolvedValue({ search_id: "s1", candidates: [{ term_id: "HP:H", label: "Hit term", rank: 1 }] } as any);
    const { container } = render(<CaseScreen view={view} workspaceId="ws" onClose={vi.fn()} />);
    await openPanel(container, "a1");
    fireEvent.click(screen.getByRole("button", { name: "Add finding without a text span" }));
    fireEvent.change(screen.getByRole("combobox", { name: "Search term" }), { target: { value: "hit" } });
    fireEvent.click(await screen.findByText("Hit term", { selector: ".candidate-label" }));

    await waitFor(() => expect(open).toHaveBeenCalledTimes(2));
    expect(open.mock.calls[1][0]).toMatchObject({ term_id: "HP:H" });
    expect(open.mock.calls[1][0].annotation_id).toBe((api.applyCommand as any).mock.calls[0][1].payload.annotation_id);
  });
});

describe("the annotation panel", () => {
  it("starts at its top when it shows another annotation, and stays put while one is edited", async () => {
    const view = baseView([snapshot("a1", "HP:A"), snapshot("a2", "HP:C")]);
    mockServer(view);
    const { container } = render(<CaseScreen view={view} workspaceId="ws" onClose={vi.fn()} />);
    const pane = container.querySelector<HTMLElement>(".inspector-pane")!;

    // Next to a docked tree the panel is short: its content is scrolled, for
    // instance down to a candidate of the search.
    fireEvent.click(entry(container, "a1"));
    pane.scrollTop = 120;
    expect(pane.scrollTop).toBe(120);

    // Editing the annotation that is shown does not move the panel ...
    fireEvent.click(within(pane).getByLabelText("Absent"));
    await waitFor(() => expect(api.applyCommand).toHaveBeenCalledTimes(1));
    expect(pane.scrollTop).toBe(120);

    // ... another annotation is shown from its top, with its term name ...
    fireEvent.click(entry(container, "a2"));
    expect(within(pane).getByRole("heading", { level: 2 }).textContent).toContain("HP:C");
    expect(pane.scrollTop).toBe(0);

    // ... and so is the search for a new one, and the panel after it was cancelled.
    pane.scrollTop = 80;
    fireEvent.click(screen.getByRole("button", { name: "Add finding without a text span" }));
    expect(within(pane).getByRole("combobox", { name: "Search term" })).toBeDefined();
    expect(pane.scrollTop).toBe(0);
    pane.scrollTop = 60;
    fireEvent.click(entry(container, "a1"));
    expect(pane.scrollTop).toBe(0);
  });
});

describe("copying the text of a finding", () => {
  /** "alpha beta gamma": a1's mention covers "alpha" and "gamma". */
  const twoSegments = () => {
    const a1 = snapshot("a1", "HP:A");
    a1.evidence[0].mention.segments = [{ start: 0, end: 5 }, { start: 11, end: 16 }];
    return baseView([a1]);
  };
  const copyOn = (target: Element) => {
    const setData = vi.fn();
    const notPrevented = fireEvent.copy(target, { clipboardData: { setData } });
    return { setData, notPrevented };
  };

  it("Ctrl+C copies the selected finding's mention, segments joined by a space, unless a field has its own selection", () => {
    const { container } = render(<CaseScreen view={twoSegments()} workspaceId="ws" onClose={vi.fn()} />);
    // Nothing selected: the browser copies as usual.
    expect(copyOn(document.body)).toMatchObject({ notPrevented: true });

    fireEvent.click(entry(container, "a1"));
    const copied = copyOn(document.body);
    expect(copied.setData).toHaveBeenCalledWith("text/plain", "alpha gamma");
    expect(copied.notPrevented).toBe(false);

    // A field with selected text copies that text.
    const note = container.querySelector<HTMLTextAreaElement>(".inspector-pane textarea")!;
    fireEvent.change(note, { target: { value: "my note" } });
    note.focus();
    note.setSelectionRange(0, 2);
    const own = copyOn(note);
    expect(own.setData).not.toHaveBeenCalled();
    expect(own.notPrevented).toBe(true);
    // The same field without a selection: the finding's text again.
    note.setSelectionRange(2, 2);
    expect(copyOn(note).setData).toHaveBeenCalledWith("text/plain", "alpha gamma");
  });

  it("Ctrl+C copies the passage of a selected tool proposal by the same rules (review F4)", () => {
    const view = reviewView([]);
    // "alpha beta gamma": the proposal's mention covers "alpha" and "gamma".
    view.available_inputs![0].evidence[0].mention.segments = [{ start: 0, end: 5 }, { start: 11, end: 16 }];
    const { container } = render(<CaseScreen view={view} workspaceId="ws" onClose={vi.fn()} />);
    expect(copyOn(document.body)).toMatchObject({ notPrevented: true });

    fireEvent.click(container.querySelector<HTMLElement>('[data-list-key^="target:"]')!);
    const copied = copyOn(document.body);
    expect(copied.setData).toHaveBeenCalledWith("text/plain", "alpha gamma");
    expect(copied.notPrevented).toBe(false);
    expect(within(container.querySelector<HTMLElement>(".review-actions__proposal")!).getByRole("button", { name: "Copy text" })).toBeDefined();

    // The reviewer note with its own selection copies that selection; without one, the proposal's passage.
    const note = screen.getByRole<HTMLTextAreaElement>("textbox", { name: "Reviewer note" });
    fireEvent.change(note, { target: { value: "my note" } });
    note.focus();
    note.setSelectionRange(0, 2);
    const own = copyOn(note);
    expect(own.setData).not.toHaveBeenCalled();
    expect(own.notPrevented).toBe(true);
    note.setSelectionRange(2, 2);
    expect(copyOn(note).setData).toHaveBeenCalledWith("text/plain", "alpha gamma");
  });

  /** A line break inside the passage and more than PREFILL_MAX (80) codepoints. */
  const LONG = "Mild weakness\r\nof both legs, worse in the evening and after long walks, with frequent falls since spring";
  const longView = (annotations: any[] = []) => {
    const view = baseView(annotations);
    view.document.text = LONG;
    return view;
  };
  const markAll = (container: HTMLElement) => {
    const text = container.querySelector(".text-container")!;
    const runs = text.querySelectorAll(".run");
    const range = document.createRange();
    range.setStart(runs[0].firstChild!, 0);
    const last = runs[runs.length - 1].firstChild!;
    range.setEnd(last, last.textContent!.length);
    window.getSelection()!.removeAllRanges(); window.getSelection()!.addRange(range);
    fireEvent.mouseUp(text);
  };
  const FLAT = LONG.replace(/\s+/gu, " ");

  it("Ctrl+C copies a mention over a line break as one line", () => {
    const a1 = snapshot("a1", "HP:A");
    a1.evidence[0].mention.segments = [{ start: 0, end: 27 }];
    const { container } = render(<CaseScreen view={longView([a1])} workspaceId="ws" onClose={vi.fn()} />);
    fireEvent.click(entry(container, "a1"));
    expect(copyOn(document.body).setData).toHaveBeenCalledWith("text/plain", "Mild weakness of both legs");
  });

  it("Ctrl+C right after marking copies the whole passage, not the selected, shortened prefill; a selection made in the field copies as usual", () => {
    vi.spyOn(api, "searchOntology").mockResolvedValue({ search_id: "s", candidates: [] } as any);
    const { container } = render(<CaseScreen view={longView()} workspaceId="ws" onClose={vi.fn()} />);
    markAll(container);
    const field = screen.getByRole<HTMLInputElement>("combobox", { name: "Search term" });
    expect(document.activeElement).toBe(field);
    // The prefill is shortened and selected by the panel.
    expect(field.value.length).toBeLessThan(FLAT.length);
    expect([field.selectionStart, field.selectionEnd]).toEqual([0, field.value.length]);
    const copied = copyOn(field);
    expect(copied.setData).toHaveBeenCalledWith("text/plain", FLAT);
    expect(copied.notPrevented).toBe(false);
    // Ctrl and C alone leave the prefill untouched: a second Ctrl+C copies the passage again.
    fireEvent.keyDown(field, { key: "Control", ctrlKey: true });
    fireEvent.keyDown(field, { key: "c", ctrlKey: true });
    expect(copyOn(field).setData).toHaveBeenCalledWith("text/plain", FLAT);

    // The user selects the whole field again by hand (a click, then Ctrl+A): the field's text is copied.
    fireEvent.pointerDown(field);
    fireEvent.keyDown(field, { key: "a", ctrlKey: true });
    field.setSelectionRange(0, field.value.length);
    const own = copyOn(field);
    expect(own.setData).not.toHaveBeenCalled();
    expect(own.notPrevented).toBe(true);
    // A part of it, too.
    field.setSelectionRange(0, 4);
    expect(copyOn(field).notPrevented).toBe(true);
    // No selection in the field: the passage.
    field.setSelectionRange(4, 4);
    expect(copyOn(field).setData).toHaveBeenCalledWith("text/plain", FLAT);
  });

  it("text selected in the text pane copies as the document's plain text, line breaks kept", () => {
    const { container } = render(<CaseScreen view={longView()} workspaceId="ws" onClose={vi.fn()} />);
    const runs = [...container.querySelectorAll<HTMLElement>(".text-container .run")];
    const at = (offset: number): [Node, number] => {
      const run = [...runs].reverse().find((candidate) => Number(candidate.dataset.start) <= offset)!;
      return [run.firstChild!, offset - Number(run.dataset.start)];
    };
    const range = document.createRange(); range.setStart(...at(5)); range.setEnd(...at(27));
    // Not committed as a mark (no mouseup): a selection the user is making, or one in a read-only text.
    window.getSelection()!.removeAllRanges(); window.getSelection()!.addRange(range);
    const copied = copyOn(document.body);
    expect(copied.setData).toHaveBeenCalledTimes(1);
    expect(copied.setData).toHaveBeenCalledWith("text/plain", "weakness\r\nof both legs");
    expect(copied.notPrevented).toBe(false);
    window.getSelection()!.removeAllRanges();
  });

  it("'Copy text' copies a passage over a line break as one line", async () => {
    const writeText = vi.fn(async () => undefined);
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    vi.spyOn(api, "searchOntology").mockResolvedValue({ search_id: "s", candidates: [] } as any);
    const { container } = render(<CaseScreen view={longView()} workspaceId="ws" onClose={vi.fn()} />);
    markAll(container);
    fireEvent.click(within(container.querySelector<HTMLElement>(".inspector-pane")!).getByRole("button", { name: "Copy text" }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(FLAT));
    delete (navigator as any).clipboard;
  });

  it("'Copy text' at a mention puts its text on the clipboard and says so", async () => {
    const writeText = vi.fn(async () => undefined);
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    const { container } = render(<CaseScreen view={twoSegments()} workspaceId="ws" onClose={vi.fn()} />);
    fireEvent.click(entry(container, "a1"));
    fireEvent.click(screen.getByRole("button", { name: "Copy text" }));
    expect(await screen.findByRole("button", { name: "Copied" })).toBeDefined();
    expect(writeText).toHaveBeenCalledWith("alpha gamma");
    expect(container.querySelector("[data-carried-announcer]")!.textContent).toBe("Copied the text.");
    delete (navigator as any).clipboard;
  });
});

describe("the tree in the App", () => {
  it("is docked whatever an older workspace has stored about it, and stores nothing", async () => {
    window.localStorage.clear();
    // A preferences answer as an earlier version gave it: this annotator had released
    // "Keep open" there, which made the tree a dialog.
    const stored: any = {
      last_annotator_id: "dr-a",
      mode_by_package: {},
      tree_pinned_by_annotator: { "dr-a": false },
    };
    loggedInAs("dr-a");
    vi.spyOn(api, "getPreferences").mockResolvedValue(stored);
    const save = vi.spyOn(api, "updatePreferences").mockResolvedValue({ last_annotator_id: "dr-a", mode_by_package: {} });
    const project: ProjectSummary = {
      project_key: "pkg", name: "Tree test project", description: null,
      roles: ["annotator"], allowed_modes: ["independent"],
      document_count: 1, can_manage: false,
    };
    vi.spyOn(api, "listProjects").mockResolvedValue([project]);
    vi.spyOn(api, "listDocuments").mockResolvedValue([
      { document_id: "doc", text_length: 10, language: "en", position: 1, status: "not_started" },
    ]);
    assignedList(baseView());
    vi.spyOn(api, "getAssignmentMetadata").mockResolvedValue(assigned({ read_only: false, workspace_id: "ws", view: baseView() }).assignment);
    vi.spyOn(api, "openAssignment").mockResolvedValue(assigned({
      read_only: false, workspace_id: "ws",
      view: baseView([snapshot("a1", "HP:A")]),
    }));
    mockTree();
    const { container } = render(<App />);
    await waitFor(() =>
      expect(screen.getByRole("link", { name: /^(Start|Continue|View)$/ }).hasAttribute("disabled")).toBe(false),
    );
    fireEvent.click(screen.getByRole("link", { name: /^(Start|Continue|View)$/ }));
    await waitFor(() => expect(entry(container, "a1")).not.toBeNull());

    const panel = await openPanel(container, "a1");

    expect(screen.queryByRole("dialog", { name: "Ontology tree" })).toBeNull();
    expect(container.querySelector(".app-layout")!.classList.contains("tree-open")).toBe(true);
    expect(within(panel).queryByRole("button", { name: "Keep open" })).toBeNull();
    // Opening and closing the tree are not settings: neither is stored.
    fireEvent.click(within(panel).getByRole("button", { name: "Close tree" }));
    noTree();
    const treeSaves = save.mock.calls.filter(([change]) => Object.keys(change).some((name) => name.includes("tree")));
    expect(treeSaves).toEqual([]);
  });
});
