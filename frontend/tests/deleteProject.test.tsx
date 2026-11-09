import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api, ApiError } from "../src/api/client";
import { projectWorkText } from "../src/admin/DeleteProjectSection";
import { ProjectSettingsPage } from "../src/admin/ProjectSettingsPage";
import { forgetProject, LAST_PROJECT_PREFIX, rememberProject } from "../src/app/lastProject";
import { currentUser, guidelineListing, guidelineSummary, ontologies, settings } from "./projectFixtures";

const admin = { ...currentUser, is_system_admin: true };

beforeEach(() => {
  vi.spyOn(api, "listOntologies").mockResolvedValue(ontologies);
  vi.spyOn(api, "getProjectSettings").mockResolvedValue(settings);
  vi.spyOn(api, "listMembers").mockResolvedValue([]);
  vi.spyOn(api, "listGuidelines").mockResolvedValue(guidelineListing([guidelineSummary(1)]));
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

async function openDialog(onDeleted = vi.fn()) {
  render(<ProjectSettingsPage projectKey={settings.project_key} currentUser={admin} section="general" onDeleted={onDeleted} />);
  expect(await screen.findByRole("heading", { name: "Delete this project" })).toBeDefined();
  fireEvent.click(screen.getByRole("button", { name: "Delete project…" }));
  return { dialog: await screen.findByRole("dialog", { name: "Delete project?" }), onDeleted };
}

describe("Delete this project in the General settings (issue 191)", () => {
  it("is for system administrators only, under General", async () => {
    const { unmount } = render(<ProjectSettingsPage projectKey={settings.project_key} currentUser={currentUser} section="general" onDeleted={vi.fn()} />);
    await screen.findByLabelText(/^Name/);
    expect(screen.queryByRole("button", { name: "Delete project…" })).toBeNull();
    unmount();
    render(<ProjectSettingsPage projectKey={settings.project_key} currentUser={admin} section="workflow" onDeleted={vi.fn()} />);
    await screen.findByRole("form", { name: "Workflow" });
    expect(screen.queryByRole("button", { name: "Delete project…" })).toBeNull();
  });

  it("deletes after the confirmation and hands over to the page", async () => {
    const remove = vi.spyOn(api, "adminDeleteProject").mockResolvedValue(undefined);
    const { dialog, onDeleted } = await openDialog();
    expect(dialog.textContent).toContain("“Research” (key p/key) is deleted with its settings and members.");
    expect(dialog.textContent).toContain("Its key can be used again.");
    expect(remove).not.toHaveBeenCalled();
    expect(within(dialog).getByRole("button", { name: "Delete project" }).className).toContain("btn-danger-solid");
    fireEvent.click(within(dialog).getByRole("button", { name: "Delete project" }));
    await waitFor(() => expect(remove).toHaveBeenCalledWith("p/key"));
    await waitFor(() => expect(onDeleted).toHaveBeenCalledTimes(1));
    expect(screen.queryByRole("dialog", { name: "Delete project?" })).toBeNull();
  });

  it("after a refusal names the work, drops the consequence sentence and offers only Close", async () => {
    vi.spyOn(api, "adminDeleteProject").mockRejectedValue(new ApiError(409, "refused", "PROJECT_HAS_WORK", { work: ["documents", "guideline_versions", "guideline_reads"] }));
    const { dialog, onDeleted } = await openDialog();
    fireEvent.click(within(dialog).getByRole("button", { name: "Delete project" }));
    expect(await within(dialog).findByText("This project has texts and a guideline, so it cannot be deleted. Only a project nobody has worked in can be deleted.")).toBeDefined();
    expect(dialog.textContent).not.toContain("is deleted with its settings");
    expect(within(dialog).queryByRole("button", { name: "Delete project" })).toBeNull();
    expect(within(dialog).getAllByRole("button").map(button => button.textContent)).toContain("Close");
    expect(onDeleted).not.toHaveBeenCalled();
    await waitFor(() => expect(document.activeElement?.textContent).toBe("Close"));
    // The footer offers Close (besides the dialog's own close button).
    fireEvent.click(within(dialog).getAllByRole("button", { name: "Close" }).at(-1)!);
    expect(screen.queryByRole("dialog", { name: "Delete project?" })).toBeNull();
    // Opened again, the dialog asks afresh.
    fireEvent.click(screen.getByRole("button", { name: "Delete project…" }));
    const again = await screen.findByRole("dialog", { name: "Delete project?" });
    expect(within(again).getByRole("button", { name: "Delete project" })).toBeDefined();
  });

  it("falls back to the generic message for other refusals", async () => {
    vi.spyOn(api, "adminDeleteProject").mockRejectedValue(new ApiError(409, "refused", "IS_A_PRACTICE_PROJECT"));
    const { dialog } = await openDialog();
    fireEvent.click(within(dialog).getByRole("button", { name: "Delete project" }));
    expect(await within(dialog).findByText("This is a practice project. Delete it under Show practice projects.")).toBeDefined();
    expect(within(dialog).queryByRole("button", { name: "Delete project" })).toBeNull();
  });
});

describe("projectWorkText", () => {
  const refusal = (work: unknown) => new ApiError(409, "refused", "PROJECT_HAS_WORK", { work });
  it("maps tables to kinds of work in plain words, each once", () => {
    expect(projectWorkText(refusal(["assignments", "task_holds", "proposal_sets", "work_plans"])))
      .toBe("This project has tool proposals, tasks and a work plan, so it cannot be deleted. Only a project nobody has worked in can be deleted.");
    expect(projectWorkText(refusal(["uploads"]))).toContain("This project has a committed upload, so");
  });
  it("names unknown tables as other work and gives null without a list", () => {
    expect(projectWorkText(refusal(["documents", "new_table"]))).toContain("This project has texts and other work, so");
    expect(projectWorkText(refusal([]))).toBeNull();
    expect(projectWorkText(new ApiError(409, "refused", "PROJECT_HAS_WORK"))).toBeNull();
    expect(projectWorkText(new Error("offline"))).toBeNull();
  });
});

it("forgets the remembered project only when it is the deleted one", () => {
  rememberProject("lead", "other");
  forgetProject("lead", "p/key");
  expect(window.localStorage.getItem(`${LAST_PROJECT_PREFIX}lead`)).toBe("other");
  rememberProject("lead", "p/key");
  forgetProject("lead", "p/key");
  expect(window.localStorage.getItem(`${LAST_PROJECT_PREFIX}lead`)).toBeNull();
});
