import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { api, ApiError, AuthError, type ProjectJobView } from "../src/api/client";
import * as downloads from "../src/api/download";
import { ExportHistory, formatJobDuration } from "../src/admin/ExportHistory";

const job = (id: number, overrides: Partial<ProjectJobView> = {}): ProjectJobView => ({
  id, kind: "final_t1_export", status: "succeeded", requested_by: { pseudonym: "ann-0004", display_name: "Lena Lead", is_me: true },
  requested_by_command_line: false, created_at: "2026-11-05T10:00:00Z", started_at: "2026-11-05T10:00:05Z", finished_at: "2026-11-05T10:01:00Z",
  error: null, error_code: null, download_path: `/api/v1/jobs/${id}/download`, ...overrides,
});
const history = () => within(screen.getByRole("region", { name: "Export history" }));
const row = (name: string) => within(history().getByRole("row", { name }));
/** The history is a disclosure, closed at first; it loads when first opened. */
const open = () => fireEvent.click(history().getByText("Export history", { selector: "summary" }));

beforeEach(() => {
  vi.spyOn(api, "downloadJob").mockResolvedValue({ blob: new Blob(["result"]), filename: "p-final.zip" });
  vi.spyOn(downloads, "saveDownload").mockImplementation(() => {});
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

it("loads nothing until the disclosure is opened", async () => {
  vi.spyOn(api, "listProjectJobs").mockResolvedValue({ jobs: [job(7)], total: 1, limit: 20, offset: 0 });
  const { rerender } = render(<ExportHistory projectKey="p" />);
  const details = history().getByText("Export history", { selector: "summary" }).closest("details")!;
  expect(details.open).toBe(false);
  rerender(<ExportHistory projectKey="p" revision={1} />);
  expect(api.listProjectJobs).not.toHaveBeenCalled();
  open();
  await history().findByRole("row", { name: "Final results 7" });
  expect(details.open).toBe(true);
  expect(api.listProjectJobs).toHaveBeenCalledOnce();
  // Closing and opening again keeps the list; Refresh history or a new revision reload it.
  open(); open();
  expect(api.listProjectJobs).toHaveBeenCalledOnce();
  rerender(<ExportHistory projectKey="p" revision={2} />);
  await waitFor(() => expect(api.listProjectJobs).toHaveBeenCalledTimes(2));
});

it("lists the project's exports newest first with state, requester, start, duration and errors", async () => {
  vi.spyOn(api, "listProjectJobs").mockResolvedValue({ total: 4, limit: 20, offset: 0, jobs: [
    job(10, { kind: "translation_review_export", started_at: "2026-11-05T10:00:00Z", finished_at: "2026-11-05T10:01:12Z" }),
    job(9, { kind: "edit_log_export", status: "failed", error: "DomainError: [EXPORT_FAILED] source missing", error_code: "EXPORT_FAILED", download_path: null,
      requested_by: { pseudonym: "ann-0007", display_name: "Max Muster", is_me: false } }),
    job(8, { kind: "t1_export", status: "running", finished_at: null, download_path: null, requested_by: null, requested_by_command_line: true }),
    job(7),
  ] });
  render(<ExportHistory projectKey="p" />);
  open();
  await history().findByRole("row", { name: "Final results 7" });
  // Only export jobs, asked for page by page.
  expect(api.listProjectJobs).toHaveBeenCalledWith("p", expect.objectContaining({ limit: 20, offset: 0, kind: expect.arrayContaining(["final_t1_export", "edit_log_export", "translation_review_export"]) }));
  expect(vi.mocked(api.listProjectJobs).mock.calls[0][1]?.kind).not.toContain("t1_import");
  const names = history().getAllByRole("row").slice(1).map(item => item.getAttribute("aria-label"));
  expect(names).toEqual(["Translation reviews 10", "Edit log 9", "Annotation results 8", "Final results 7"]);
  expect(history().getAllByRole("columnheader").map(cell => cell.textContent)).toEqual(["Export", "State", "Requested by", "Started", "Duration", "Action"]);
  expect(row("Edit log 9").getByText("Failed")).toBeTruthy();
  expect(row("Edit log 9").getByText("EXPORT_FAILED")).toBeTruthy();
  expect(row("Edit log 9").getByText("Max Muster (ann-0007)")).toBeTruthy();
  expect(row("Edit log 9").queryByRole("button", { name: "Download" })).toBeNull();
  expect(row("Annotation results 8").getByText("Running")).toBeTruthy();
  expect(row("Annotation results 8").getByText("Command line")).toBeTruthy();
  expect(row("Annotation results 8").getByText("not finished yet")).toBeTruthy();
  expect(row("Annotation results 8").getByText("–")).toBeTruthy();
  expect(row("Translation reviews 10").getByText("1 min 12 s")).toBeTruthy();
  expect(row("Final results 7").getByText("Ready")).toBeTruthy();
  expect(row("Final results 7").getByText("Lena Lead (ann-0004, you)")).toBeTruthy();
  // Started to the minute; the exact start and finish in the duration's title and for screen readers.
  const started = row("Final results 7").getAllByRole("time")[0];
  expect(started.textContent).toMatch(/^5 Nov(?: 2026)?, \d\d:\d\d$/);
  const ran = row("Final results 7").getByText("55 s");
  expect(ran.getAttribute("dateTime")).toBe("PT55S");
  expect(ran.getAttribute("title")).toMatch(/^Started .+, finished .+$/);
  expect(row("Final results 7").getByText(`. ${ran.getAttribute("title")}`)).toBeTruthy();
  expect(history().queryByRole("button", { name: "Show older exports" })).toBeNull();
});

it("downloads through the authorized download route on every click", async () => {
  vi.spyOn(api, "listProjectJobs").mockResolvedValue({ jobs: [job(7)], total: 1, limit: 20, offset: 0 });
  render(<ExportHistory projectKey="p" />);
  open();
  await history().findByRole("row", { name: "Final results 7" });
  fireEvent.click(row("Final results 7").getByRole("button", { name: "Download" }));
  await waitFor(() => expect(downloads.saveDownload).toHaveBeenCalledWith(expect.objectContaining({ filename: "p-final.zip" }), "p-7.zip"));
  expect(api.downloadJob).toHaveBeenCalledWith(7);
  vi.mocked(api.downloadJob).mockRejectedValueOnce(new ApiError(404, "Job not found."));
  fireEvent.click(row("Final results 7").getByRole("button", { name: "Download" }));
  await history().findByText("Job not found.");
  expect(downloads.saveDownload).toHaveBeenCalledOnce();
});

it("shows older exports and reloads on Refresh history", async () => {
  const list = vi.spyOn(api, "listProjectJobs")
    .mockResolvedValueOnce({ jobs: [job(7)], total: 2, limit: 20, offset: 0 })
    .mockResolvedValueOnce({ jobs: [job(6, { kind: "work_time_export" })], total: 2, limit: 20, offset: 1 })
    .mockResolvedValueOnce({ jobs: [job(8), job(7)], total: 3, limit: 20, offset: 0 });
  render(<ExportHistory projectKey="p" />);
  open();
  fireEvent.click(await history().findByRole("button", { name: "Show older exports" }));
  await history().findByRole("row", { name: "Working time 6" });
  expect(list).toHaveBeenLastCalledWith("p", expect.objectContaining({ offset: 1 }));
  expect(history().queryByRole("button", { name: "Show older exports" })).toBeNull();
  fireEvent.click(history().getByRole("button", { name: "Refresh history" }));
  await history().findByRole("row", { name: "Final results 8" });
  expect(list).toHaveBeenLastCalledWith("p", expect.objectContaining({ offset: 0 }));
  expect(history().queryByRole("row", { name: "Working time 6" })).toBeNull();
});

it("says so when there are no exports yet", async () => {
  vi.spyOn(api, "listProjectJobs").mockResolvedValue({ jobs: [], total: 0, limit: 20, offset: 0 });
  render(<ExportHistory projectKey="p" />);
  open();
  await history().findByText("No exports yet.");
  expect(history().queryByRole("table")).toBeNull();
});

it.each([[new AuthError("Forbidden")], [new ApiError(404, "There is no project 'p'.")]])("stays away for people who may not list the jobs (%s)", async error => {
  vi.spyOn(api, "listProjectJobs").mockRejectedValue(error);
  const { container } = render(<ExportHistory projectKey="p" />);
  open();
  await waitFor(() => expect(api.listProjectJobs).toHaveBeenCalled());
  await waitFor(() => expect(container.querySelector("section")).toBeNull());
});

it("offers to try again when the list fails to load", async () => {
  vi.spyOn(api, "listProjectJobs").mockRejectedValueOnce(new ApiError(500, "Server error")).mockResolvedValueOnce({ jobs: [job(7)], total: 1, limit: 20, offset: 0 });
  render(<ExportHistory projectKey="p" />);
  open();
  fireEvent.click(await history().findByRole("button", { name: "Try again" }));
  await history().findByRole("row", { name: "Final results 7" });
});

it("words durations so they never read as a clock", () => {
  expect([4, 59.6, 60, 72, 3599, 3600, 7500].map(formatJobDuration)).toEqual(["4 s", "1 min", "1 min", "1 min 12 s", "59 min 59 s", "1 h 00 min", "2 h 05 min"]);
});
