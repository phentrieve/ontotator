// Single-term overview, batch dialog, settings card, reviewer grants, routes and navigation (invented data).
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api, ApiError, type Member, type ProjectSettings } from "../../src/api/client";
import { parseRoute, routeHref } from "../../src/app/router";
import { Shell } from "../../src/app/Shell";
import { BatchDialog, parseTextIds } from "../../src/singleterms/BatchDialog";
import { SingleTermReviewersCard } from "../../src/singleterms/SingleTermReviewersCard";
import { parseCues, singleTermDirty, singleTermOf, singleTermPatch } from "../../src/singleterms/SingleTermSettings";
import { SingleTermsPage } from "../../src/singleterms/SingleTermsPage";
import { notifySingleTermsChanged } from "../../src/singleterms/useSingleTermAccess";
import { ProjectSettingsPage } from "../../src/admin/ProjectSettingsPage";
import { currentUser, ontologies, settings as projectSettings } from "../projectFixtures";
import { batch, summary } from "./fixtures";

const member = (username: string, roles: Member["roles"]): Member => ({
  username, display_name: "", pseudonym: `${username}-p`, roles, languages: ["de"], account: "active",
} as Member);

beforeEach(() => {
  vi.spyOn(api, "listSingleTermBatches").mockResolvedValue([
    batch({ batch_id: 1, state: "submitted", decided: 12, groups: 12 }),
    batch({ batch_id: 2, decided: 3, groups: 20, filter: { language: "de", document_ids: ["A", "B"] } }),
    batch({ batch_id: 4, role: "second", parent_batch_id: 2, reviewer_username: "rev-07", filter: { language: "de", share: 0.2 }, groups: 5 }),
  ]);
  vi.spyOn(api, "singleTermSummary").mockResolvedValue(summary());
  vi.spyOn(api, "listSingleTermReviewers").mockResolvedValue([{ username: "rev-04", pseudonym: "r4", added_at: "2026-11-01T09:00:00Z" }, { username: "rev-07", pseudonym: "r7", added_at: "2026-11-01T09:00:00Z" }]);
  vi.spyOn(api, "listMembers").mockResolvedValue([member("lead-1", ["lead"]), member("rev-04", ["annotator"]), member("rev-07", ["adjudicator"]), member("ann-9", ["annotator"])]);
  vi.spyOn(api, "getProjectSettings").mockResolvedValue({ profile: { layers: [{ layer_id: "hpo", label: "HPO phenotype", annotation_types: [] }] } } as unknown as ProjectSettings);
  vi.spyOn(api, "startSingleTermBasis").mockResolvedValue(summary().basis!);
  vi.spyOn(api, "singleTermBatchAction").mockResolvedValue(batch());
  vi.spyOn(api, "createSingleTermBatch").mockResolvedValue(batch({ batch_id: 5, groups: 28, second_batch_ids: [6], warnings: [{ code: "SINGLE_TERM_REVIEWER_NOT_INDEPENDENT", groups: 4 }] }));
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe("single-term overview", () => {
  it("shows the basis, counts per language, agreement, batches and exclusions", async () => {
    render(<SingleTermsPage projectKey="p" canManage onNavigate={vi.fn()} />);
    expect(await screen.findByText(/Review basis: final results of 2 Nov 2026, 16:40 UTC/)).toBeDefined();
    const german = screen.getByRole("region", { name: "German" });
    expect(within(german).getByText("95 occurrences")).toBeDefined();
    expect(within(german).getByText("open · 4 stale")).toBeDefined();
    expect(within(german).getByText("2 groups in phrase conflicts · 4 blocked groups to re-cut or reject")).toBeDefined();
    // English has nothing left to re-cut or reject.
    expect(within(screen.getByRole("region", { name: "English" })).queryByText(/blocked groups/)).toBeNull();
    expect(screen.getByText(/agreement 90 % · κ 0.78/)).toBeDefined();
    const table = within(screen.getByRole("region", { name: "Review batches" })).getByRole("table");
    const rows = within(table).getAllByRole("row").slice(1).map(row => row.textContent);
    expect(rows[0]).toContain("German · 20 % sample");
    expect(rows[0]).toContain("rev-07 · second of #2");
    expect(rows[1]).toContain("German · 2 texts");
    expect(rows[1]).toContain("3 / 20");
    expect(within(table).getByRole("button", { name: "Reopen batch #1" })).toBeDefined();
    const excluded = screen.getByRole("region", { name: "German findings not offered" });
    expect(within(excluded).getByText("assertion not present").nextElementSibling?.textContent).toBe("14");
    expect(within(excluded).getByText("blocked: contains other finding").nextElementSibling?.textContent).toBe("3");
    expect(screen.getByRole("region", { name: "English findings not offered" })).toBeDefined();
  });

  it("refreshes the basis, reopens and abandons batches", async () => {
    render(<SingleTermsPage projectKey="p" canManage onNavigate={vi.fn()} />);
    fireEvent.click(await screen.findByRole("button", { name: "Refresh review basis" }));
    await waitFor(() => expect(api.startSingleTermBasis).toHaveBeenCalledWith("p", expect.any(String)));
    expect(await screen.findByText(/Only new and stale groups open again/)).toBeDefined();
    fireEvent.click(await screen.findByRole("button", { name: "Reopen batch #1" }));
    await waitFor(() => expect(api.singleTermBatchAction).toHaveBeenCalledWith("p", 1, "reopen", expect.any(String)));
    fireEvent.click(await screen.findByRole("button", { name: "Abandon batch #2" }));
    fireEvent.click(await screen.findByRole("button", { name: "Abandon batch" }));
    await waitFor(() => expect(api.singleTermBatchAction).toHaveBeenCalledWith("p", 2, "abandon", expect.any(String)));
  });

  it("explains the switched-off review and lists only own batches for a reviewer", async () => {
    vi.mocked(api.listSingleTermBatches).mockRejectedValueOnce(new ApiError(409, "off", "SINGLE_TERM_REVIEW_OFF"));
    const { unmount } = render(<SingleTermsPage projectKey="p" canManage onNavigate={vi.fn()} />);
    expect(await screen.findByText(/The single-term review is off in this project/)).toBeDefined();
    expect(screen.getByRole("link", { name: "Settings › Workflow" }).getAttribute("href")).toBe("#/projects/p/settings/workflow");
    unmount();

    render(<SingleTermsPage projectKey="p" canManage={false} onNavigate={vi.fn()} />);
    expect(await screen.findByText("Your review batches.", { exact: false })).toBeDefined();
    expect(api.singleTermSummary).not.toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: /Abandon/ })).toBeNull();
    expect(screen.getByRole("link", { name: "Continue batch #2" }).getAttribute("href")).toBe("#/projects/p/single-terms/batches/2");
  });

  it("creates a batch from the dialog and reports the independence warning", async () => {
    render(<SingleTermsPage projectKey="p" canManage onNavigate={vi.fn()} />);
    fireEvent.click(await screen.findByRole("button", { name: "New review batch…" }));
    const dialog = await screen.findByRole("dialog", { name: "New review batch" });
    // Groups already in an open batch are not counted.
    expect(within(dialog).getByText("(up to 13)")).toBeDefined();
    expect(within(dialog).getByText("(1)")).toBeDefined();
    expect(within(dialog).getAllByRole("option").map(option => option.textContent)).toContain("HPO phenotype");
    const reviewer = within(dialog).getByLabelText(/^Reviewer/) as HTMLSelectElement;
    expect([...reviewer.options].map(option => option.value)).toEqual(["rev-04", "rev-07", "lead-1"]);
    fireEvent.click(within(dialog).getByRole("checkbox", { name: /Draw a sample/ }));
    expect((within(dialog).getByLabelText("Second reviewer") as HTMLSelectElement).value).toBe("rev-07");
    fireEvent.change(within(dialog).getByLabelText("Share (%)"), { target: { value: "25" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Create batch" }));
    await waitFor(() => expect(api.createSingleTermBatch).toHaveBeenCalledOnce());
    expect(vi.mocked(api.createSingleTermBatch).mock.calls[0][1]).toEqual({
      request_id: expect.any(String), reviewer: "rev-04", language: "de", layer_id: null, document_ids: null, stale_only: false, limit: null,
      second_review: { reviewer: "rev-07", share: 0.25 },
    });
    expect(await screen.findByText(/Batch #5 created with 28 groups for rev-04\. Second review: batch #6\. rev-04 annotated or consolidated texts of 4/)).toBeDefined();
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});

describe("batch dialog", () => {
  const languages = summary().languages;
  it("filters by chosen texts or stale groups and checks its fields", async () => {
    const onCreated = vi.fn();
    render(<BatchDialog open projectKey="p" languages={languages} reviewers={["rev-04"]} onCreated={onCreated} onClose={vi.fn()} />);
    const dialog = screen.getByRole("dialog");
    expect((within(dialog).getByRole("checkbox", { name: /Draw a sample/ }) as HTMLInputElement).disabled).toBe(true);
    fireEvent.click(within(dialog).getByRole("radio", { name: /chosen texts/ }));
    fireEvent.click(within(dialog).getByRole("button", { name: "Create batch" }));
    expect(await within(dialog).findByRole("alert")).toHaveProperty("textContent", "Name at least one text ID.");
    fireEvent.change(within(dialog).getByLabelText("Text IDs"), { target: { value: "T-1, T-2\nT-1" } });
    fireEvent.change(within(dialog).getByLabelText("Language"), { target: { value: "en" } });
    fireEvent.change(within(dialog).getByLabelText(/At most/), { target: { value: "40" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Create batch" }));
    await waitFor(() => expect(onCreated).toHaveBeenCalled());
    expect(vi.mocked(api.createSingleTermBatch).mock.calls[0][1]).toMatchObject({ language: "en", document_ids: ["T-1", "T-2"], stale_only: false, limit: 40, second_review: null });
  });

  it("keeps the request id for a retry and closes with Escape", async () => {
    const onClose = vi.fn();
    vi.mocked(api.createSingleTermBatch).mockRejectedValueOnce(new ApiError(409, "empty", "SINGLE_TERM_BATCH_EMPTY"));
    render(<BatchDialog open projectKey="p" languages={languages} reviewers={["rev-04"]} onCreated={vi.fn()} onClose={onClose} />);
    fireEvent.click(screen.getByRole("radio", { name: /Stale decisions only/ }));
    fireEvent.click(screen.getByRole("button", { name: "Create batch" }));
    expect(await screen.findByText(/No open or stale single-term group matches/)).toBeDefined();
    fireEvent.click(screen.getByRole("button", { name: "Create batch" }));
    await waitFor(() => expect(api.createSingleTermBatch).toHaveBeenCalledTimes(2));
    const [first, second] = vi.mocked(api.createSingleTermBatch).mock.calls.map(call => call[1]);
    expect(second.request_id).toBe(first.request_id);
    expect(first.stale_only).toBe(true);
    fireEvent.keyDown(document.activeElement ?? document.body, { key: "Escape" });
    expect(onClose).toHaveBeenCalled();
    expect(parseTextIds(" a,b ;c\n\na ")).toEqual(["a", "b", "c"]);
  });
});

describe("single-term settings and reviewer grants", () => {
  it("turns cue text into the settings change", () => {
    const settings = { languages: ["de", "en"], single_term_review: true, single_term_negation_cues: { de: ["kein", "nicht"], fr: ["pas"] } } as unknown as ProjectSettings;
    const draft = singleTermOf(settings);
    expect(draft.cues).toEqual({ de: "kein\nnicht", en: "", fr: "pas" });
    expect(parseCues(" ohne,\nkein \n\nkein")).toEqual(["ohne", "kein"]);
    expect(singleTermPatch({ ...draft, cues: { ...draft.cues, en: "no\n", fr: "" } })).toEqual({ single_term_review: true, single_term_negation_cues: { de: ["kein", "nicht"], en: ["no"] } });
    expect(singleTermDirty({ ...draft, cues: { ...draft.cues, de: "kein\n nicht \n" } }, draft)).toBe(false);
    expect(singleTermDirty({ ...draft, single_term_review: false }, draft)).toBe(true);
  });

  it("saves the switch and the cues in their own form under Workflow", async () => {
    vi.mocked(api.getProjectSettings).mockResolvedValue(projectSettings);
    vi.spyOn(api, "listOntologies").mockResolvedValue(ontologies);
    const update = vi.spyOn(api, "updateProjectSettings").mockImplementation(async (_key, change) => ({ ...projectSettings, ...change } as ProjectSettings));
    const changed = vi.fn();
    window.addEventListener("ontotator:single-terms-changed", changed);
    render(<ProjectSettingsPage projectKey="p/key" currentUser={currentUser} section="workflow" />);
    const form = await screen.findByRole("form", { name: "Single-term review" });
    const save = within(form).getByRole("button", { name: "Save single-term review" }) as HTMLButtonElement;
    expect(save.disabled).toBe(true);
    fireEvent.click(within(form).getByRole("checkbox", { name: /Review single terms/ }));
    fireEvent.change(within(form).getByLabelText(/Negation cues, German/), { target: { value: "kein\nohne" } });
    expect(save.disabled).toBe(false);
    fireEvent.click(save);
    await within(form).findByText("Single-term review saved.");
    expect(update).toHaveBeenCalledWith("p/key", { single_term_review: true, single_term_negation_cues: { de: ["kein", "ohne"] } });
    expect(changed).toHaveBeenCalled();
    // The Workflow form above is untouched by it.
    expect((within(screen.getByRole("form", { name: "Workflow" })).getByRole("button", { name: "Save changes" }) as HTMLButtonElement).disabled).toBe(true);
    window.removeEventListener("ontotator:single-terms-changed", changed);
  });

  it("grants and revokes the capability; leads review without a grant", async () => {
    vi.spyOn(api, "grantSingleTermReviewer").mockResolvedValue([{ username: "ann-9", pseudonym: "a9", added_at: "2026-11-01T09:00:00Z" }]);
    vi.spyOn(api, "revokeSingleTermReviewer").mockResolvedValue([]);
    const changed = vi.fn();
    window.addEventListener("ontotator:single-terms-changed", changed);
    render(<SingleTermReviewersCard projectKey="p" />);
    const lead = await screen.findByRole("checkbox", { name: "lead-1: single-term reviewer" }) as HTMLInputElement;
    expect([lead.checked, lead.disabled]).toEqual([true, true]);
    expect((screen.getByRole("checkbox", { name: "rev-04: single-term reviewer" }) as HTMLInputElement).checked).toBe(true);
    fireEvent.click(screen.getByRole("checkbox", { name: "ann-9: single-term reviewer" }));
    await waitFor(() => expect(api.grantSingleTermReviewer).toHaveBeenCalledWith("p", "ann-9"));
    expect(await screen.findByText("ann-9 can now review single terms.")).toBeDefined();
    expect(changed).toHaveBeenCalled();
    fireEvent.click(screen.getByRole("checkbox", { name: "ann-9: single-term reviewer" }));
    await waitFor(() => expect(api.revokeSingleTermReviewer).toHaveBeenCalledWith("p", "ann-9"));
    window.removeEventListener("ontotator:single-terms-changed", changed);
  });

  it("stays hidden while the review is off", async () => {
    vi.mocked(api.listSingleTermReviewers).mockRejectedValue(new ApiError(409, "off", "SINGLE_TERM_REVIEW_OFF"));
    const { container } = render(<SingleTermReviewersCard projectKey="p" />);
    await waitFor(() => expect(api.listSingleTermReviewers).toHaveBeenCalled());
    await Promise.resolve();
    expect(container.textContent).toBe("");
  });
});

describe("single-term routes and navigation", () => {
  it("parses and writes the overview and batch addresses", () => {
    expect(parseRoute("#/projects/p%2F1/single-terms")).toEqual({ name: "projectSingleTerms", key: "p/1" });
    expect(parseRoute("#/projects/p/single-terms/batches/12?group=abc")).toEqual({ name: "projectSingleTermBatch", key: "p", batchId: 12, group: "abc" });
    expect(parseRoute("#/projects/p/single-terms/batches/0").name).toBe("notFound");
    expect(routeHref({ name: "projectSingleTermBatch", key: "p", batchId: 3 })).toBe("#/projects/p/single-terms/batches/3");
  });

  it("shows Single terms in the navigation only when the batch list answers", async () => {
    vi.spyOn(api, "listMyTasks").mockReturnValue(new Promise(() => {}));
    vi.spyOn(api, "documentsSummary").mockReturnValue(new Promise(() => {}));
    vi.mocked(api.listSingleTermBatches).mockRejectedValue(new ApiError(409, "off", "SINGLE_TERM_REVIEW_OFF"));
    const user = { username: "alex", display_name: "Alex", pseudonym: "a1", is_system_admin: false, csrf_token: "t" };
    const projects = [{ project_key: "p", name: "Research", description: null, roles: ["lead" as const], allowed_modes: ["independent" as const], document_count: 0, can_manage: true }];
    render(<Shell user={user} projects={projects} route={{ name: "projectProgress", key: "p" }} onNavigate={vi.fn()} onLogout={vi.fn()}>Page</Shell>);
    await waitFor(() => expect(api.listSingleTermBatches).toHaveBeenCalledWith("p"));
    expect(screen.queryByRole("link", { name: "Single terms" })).toBeNull();
    vi.mocked(api.listSingleTermBatches).mockResolvedValue([]);
    notifySingleTermsChanged();
    const link = await screen.findByRole("link", { name: "Single terms" });
    expect(link.getAttribute("href")).toBe("#/projects/p/single-terms");
  });
});
