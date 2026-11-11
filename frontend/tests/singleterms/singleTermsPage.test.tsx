// Single-term overview, batch dialog, settings card, routes and navigation (invented data).
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api, ApiError, type Member, type ProjectSettings } from "../../src/api/client";
import { parseRoute, routeHref } from "../../src/app/router";
import { Shell } from "../../src/app/Shell";
import { BatchDialog } from "../../src/singleterms/BatchDialog";
import { kappaReading } from "../../src/singleterms/labels";
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
    batch({ batch_id: 1, decided: 12, groups: 12 }),
    batch({ batch_id: 2, decided: 3, groups: 20, filter: { language: "de", limit: 20 } }),
    batch({ batch_id: 4, role: "second", parent_batch_id: 2, reviewer_username: "rev-07", filter: { language: "de", share: 0.2 }, groups: 5 }),
  ]);
  vi.spyOn(api, "singleTermSummary").mockResolvedValue(summary());
  vi.spyOn(api, "listMembers").mockResolvedValue([member("lead-1", ["lead"]), member("rev-04", ["annotator"]), member("rev-07", ["adjudicator"]), member("ann-9", ["annotator"])]);
  vi.spyOn(api, "refreshSingleTermBasis").mockResolvedValue(summary().basis!);
  vi.spyOn(api, "abandonSingleTermBatch").mockResolvedValue(batch());
  vi.spyOn(api, "createSingleTermBatch").mockResolvedValue(batch({ batch_id: 5, groups: 28, second_batch_ids: [6], warnings: [{ code: "SINGLE_TERM_REVIEWER_NOT_INDEPENDENT", groups: 4 }] }));
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe("single-term overview", () => {
  it("refreshes the basis on opening and shows counts per language, agreement, batches and exclusions", async () => {
    render(<SingleTermsPage projectKey="p" canManage onNavigate={vi.fn()} />);
    expect(await screen.findByText(/Review basis: final results of 2 Nov 2026, 16:40 UTC, refreshed when they change/)).toBeDefined();
    expect(api.refreshSingleTermBasis).toHaveBeenCalledWith("p");
    expect(screen.queryByRole("button", { name: /review basis|Start single-term review/ })).toBeNull();
    const german = screen.getByRole("region", { name: "German" });
    expect(within(german).getByText("95 occurrences")).toBeDefined();
    expect(within(german).getByText("open · 4 stale")).toBeDefined();
    expect(within(german).getByText("2 groups in phrase conflicts · 4 blocked groups to re-cut or reject")).toBeDefined();
    // English has nothing left to re-cut or reject.
    expect(within(screen.getByRole("region", { name: "English" })).queryByText(/blocked groups/)).toBeNull();
    expect(screen.getByText(/agreement 90 % · κ 0.78 \(substantial agreement beyond chance\)/)).toBeDefined();
    const table = within(screen.getByRole("region", { name: "Review batches" })).getByRole("table");
    const rows = within(table).getAllByRole("row").slice(1).map(row => row.textContent);
    expect(rows[0]).toContain("German · 20 % sample");
    expect(rows[0]).toContain("rev-07 · second of #2");
    expect(rows[1]).toContain("German · first 20");
    expect(rows[1]).toContain("3 / 20");
    expect(rows[2]).toContain("done");
    expect(within(table).getByRole("link", { name: "Open batch #1" })).toBeDefined();
    expect(within(table).queryByRole("button", { name: /Reopen/ })).toBeNull();
    const excluded = screen.getByRole("region", { name: "German findings not offered" });
    expect(within(excluded).getByText("assertion not present").nextElementSibling?.textContent).toBe("14");
    expect(within(excluded).getByText("blocked: contains other finding").nextElementSibling?.textContent).toBe("3");
    expect(screen.getByRole("region", { name: "English findings not offered" })).toBeDefined();
  });

  it("abandons a batch and reads kappa in plain words", async () => {
    render(<SingleTermsPage projectKey="p" canManage onNavigate={vi.fn()} />);
    fireEvent.click(await screen.findByRole("button", { name: "Abandon batch #2" }));
    fireEvent.click(await screen.findByRole("button", { name: "Abandon batch" }));
    await waitFor(() => expect(api.abandonSingleTermBatch).toHaveBeenCalledWith("p", 2, expect.any(String)));
    expect([-0.1, 0.1, 0.3, 0.5, 0.7, 0.9, null].map(kappaReading)).toEqual(["less than chance", "slight", "fair", "moderate", "substantial", "almost perfect", null]);
  });

  it("says so while no final result is accepted", async () => {
    vi.mocked(api.refreshSingleTermBasis).mockResolvedValue(null);
    vi.mocked(api.singleTermSummary).mockResolvedValue(summary({ basis: null, languages: [] }));
    render(<SingleTermsPage projectKey="p" canManage onNavigate={vi.fn()} />);
    expect(await screen.findByText(/No final result is accepted yet/)).toBeDefined();
    expect(screen.queryByRole("button", { name: "New review batch…" })).toBeNull();
  });

  it("explains the switched-off review and lists only own batches for a reviewer", async () => {
    vi.mocked(api.refreshSingleTermBasis).mockRejectedValueOnce(new ApiError(409, "off", "SINGLE_TERM_REVIEW_OFF"));
    const { unmount } = render(<SingleTermsPage projectKey="p" canManage onNavigate={vi.fn()} />);
    expect(await screen.findByText(/The single-term review is off in this project/)).toBeDefined();
    expect(screen.getByRole("link", { name: "Settings › Workflow" }).getAttribute("href")).toBe("#/projects/p/settings/workflow");
    unmount();
    vi.mocked(api.refreshSingleTermBasis).mockClear();

    render(<SingleTermsPage projectKey="p" canManage={false} onNavigate={vi.fn()} />);
    expect(await screen.findByText("Your review batches.", { exact: false })).toBeDefined();
    expect(api.singleTermSummary).not.toHaveBeenCalled();
    expect(api.refreshSingleTermBasis).not.toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: /Abandon/ })).toBeNull();
    expect(screen.getByRole("link", { name: "Continue batch #2" }).getAttribute("href")).toBe("#/projects/p/single-terms/batches/2");
  });

  it("creates a batch from the dialog and reports the independence warning", async () => {
    render(<SingleTermsPage projectKey="p" canManage onNavigate={vi.fn()} />);
    fireEvent.click(await screen.findByRole("button", { name: "New review batch…" }));
    const dialog = await screen.findByRole("dialog", { name: "New review batch" });
    // All languages by default; groups already in an open batch are not counted.
    expect((within(dialog).getByLabelText("Language") as HTMLSelectElement).value).toBe("");
    expect(within(dialog).getByText("43 open groups, stale ones included.")).toBeDefined();
    expect(within(dialog).queryByLabelText(/Layer|Text IDs|Share/)).toBeNull();
    // Every project member may review.
    const reviewer = within(dialog).getByLabelText(/^Reviewer/) as HTMLSelectElement;
    expect([...reviewer.options].map(option => option.value)).toEqual(["lead-1", "rev-04", "rev-07", "ann-9"]);
    fireEvent.change(reviewer, { target: { value: "rev-04" } });
    fireEvent.click(within(dialog).getByRole("checkbox", { name: /Draw a sample/ }));
    expect((within(dialog).getByLabelText("Second reviewer") as HTMLSelectElement).value).toBe("lead-1");
    fireEvent.change(within(dialog).getByLabelText("Second reviewer"), { target: { value: "rev-07" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Create batch" }));
    await waitFor(() => expect(api.createSingleTermBatch).toHaveBeenCalledOnce());
    expect(vi.mocked(api.createSingleTermBatch).mock.calls[0][1]).toEqual({
      request_id: expect.any(String), reviewer: "rev-04", language: null, limit: null, second_review: { reviewer: "rev-07" },
    });
    expect(await screen.findByText(/Batch #5 created with 28 groups for rev-04\. Second review: batch #6\. rev-04 annotated or consolidated texts of 4/)).toBeDefined();
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});

describe("batch dialog", () => {
  const languages = summary().languages;
  it("takes one language and a cap and checks its fields", async () => {
    const onCreated = vi.fn();
    render(<BatchDialog open projectKey="p" languages={languages} reviewers={["rev-04"]} onCreated={onCreated} onClose={vi.fn()} />);
    const dialog = screen.getByRole("dialog");
    expect((within(dialog).getByRole("checkbox", { name: /Draw a sample/ }) as HTMLInputElement).disabled).toBe(true);
    fireEvent.change(within(dialog).getByLabelText("Language"), { target: { value: "en" } });
    expect(within(dialog).getByText("30 open groups, stale ones included.")).toBeDefined();
    fireEvent.change(within(dialog).getByLabelText(/At most/), { target: { value: "40" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Create batch" }));
    await waitFor(() => expect(onCreated).toHaveBeenCalled());
    expect(vi.mocked(api.createSingleTermBatch).mock.calls[0][1]).toMatchObject({ language: "en", limit: 40, second_review: null });
  });

  it("keeps the request id for a retry and closes with Escape", async () => {
    const onClose = vi.fn();
    vi.mocked(api.createSingleTermBatch).mockRejectedValueOnce(new ApiError(409, "empty", "SINGLE_TERM_BATCH_EMPTY"));
    render(<BatchDialog open projectKey="p" languages={languages} reviewers={["rev-04"]} onCreated={vi.fn()} onClose={onClose} />);
    fireEvent.click(screen.getByRole("button", { name: "Create batch" }));
    expect(await screen.findByText(/No open or stale single-term group matches/)).toBeDefined();
    fireEvent.click(screen.getByRole("button", { name: "Create batch" }));
    await waitFor(() => expect(api.createSingleTermBatch).toHaveBeenCalledTimes(2));
    const [first, second] = vi.mocked(api.createSingleTermBatch).mock.calls.map(call => call[1]);
    expect(second.request_id).toBe(first.request_id);
    fireEvent.keyDown(document.activeElement ?? document.body, { key: "Escape" });
    expect(onClose).toHaveBeenCalled();
  });
});

describe("single-term settings", () => {
  it("saves the switch in its own form under Workflow, without cue fields", async () => {
    vi.spyOn(api, "getProjectSettings").mockResolvedValue(projectSettings);
    vi.spyOn(api, "listOntologies").mockResolvedValue(ontologies);
    const update = vi.spyOn(api, "updateProjectSettings").mockImplementation(async (_key, change) => ({ ...projectSettings, ...change } as ProjectSettings));
    const changed = vi.fn();
    window.addEventListener("ontotator:single-terms-changed", changed);
    render(<ProjectSettingsPage projectKey="p/key" currentUser={currentUser} section="workflow" />);
    const form = await screen.findByRole("form", { name: "Single-term review" });
    const save = within(form).getByRole("button", { name: "Save single-term review" }) as HTMLButtonElement;
    expect(save.disabled).toBe(true);
    expect(within(form).queryByLabelText(/Negation cues/)).toBeNull();
    fireEvent.click(within(form).getByRole("checkbox", { name: /Review single terms/ }));
    expect(save.disabled).toBe(false);
    fireEvent.click(save);
    await within(form).findByText("Single-term review saved.");
    expect(update).toHaveBeenCalledWith("p/key", { single_term_review: true });
    expect(changed).toHaveBeenCalled();
    // The Workflow form above is untouched by it.
    expect((within(screen.getByRole("form", { name: "Workflow" })).getByRole("button", { name: "Save changes" }) as HTMLButtonElement).disabled).toBe(true);
    window.removeEventListener("ontotator:single-terms-changed", changed);
  });
});

describe("single-term routes and navigation", () => {
  it("parses and writes the overview and batch addresses", () => {
    expect(parseRoute("#/projects/p%2F1/single-terms")).toEqual({ name: "projectSingleTerms", key: "p/1" });
    expect(parseRoute("#/projects/p/single-terms/batches/12?group=abc")).toEqual({ name: "projectSingleTermBatch", key: "p", batchId: 12, group: "abc" });
    expect(parseRoute("#/projects/p/single-terms/batches/0").name).toBe("notFound");
    expect(routeHref({ name: "projectSingleTermBatch", key: "p", batchId: 3 })).toBe("#/projects/p/single-terms/batches/3");
  });

  it("shows Single terms in the navigation only when the batch list answers (members: with a batch)", async () => {
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
