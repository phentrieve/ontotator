import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { api, type AssignmentView, type ProblemReportView } from "../src/api/client";
import { notifyNotificationsChanged } from "../src/notifications/notificationsEvents";
import { useTaskReports } from "../src/problems/useTaskReports";
import { useTaskQuestions } from "../src/questions/useTaskQuestions";

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

// Issue 651: a person who stays in the task gets the lead's answer when the bell's unread count changes
// (a new notification, or the bell entry for this task marked read), not only on window focus.
describe("a task's questions and reports reload when the bell's unread count changes", () => {
  it("reloads the questions, and stops after unmount", async () => {
    const list = vi.spyOn(api, "listQuestions").mockResolvedValue([]);
    const { unmount } = renderHook(() => useTaskQuestions("p", 7));
    await waitFor(() => expect(list).toHaveBeenCalledTimes(1));
    act(() => notifyNotificationsChanged());
    await waitFor(() => expect(list).toHaveBeenCalledTimes(2));
    expect(list).toHaveBeenLastCalledWith("p", { assignmentId: 7 });
    unmount();
    act(() => notifyNotificationsChanged());
    expect(list).toHaveBeenCalledTimes(2);
  });

  it("reloads the reports with the task, so an answer that resumes a paused task ends the pause", async () => {
    const paused = { id: 7, task: "translation_review", project_key: "p", held: true, hold_reason: "Waiting", workflow_revision: 1 } as unknown as AssignmentView;
    const resumed = { ...paused, held: false, hold_reason: null, workflow_revision: 2 } as unknown as AssignmentView;
    vi.spyOn(api, "listTaskProblemReports").mockResolvedValue([] as ProblemReportView[]);
    const metadata = vi.spyOn(api, "getAssignmentMetadata").mockResolvedValue(resumed);
    const onRefresh = vi.fn();
    const { unmount } = renderHook(() => useTaskReports(paused, onRefresh));
    await waitFor(() => expect(api.listTaskProblemReports).toHaveBeenCalledTimes(1));
    expect(metadata).not.toHaveBeenCalled();
    act(() => notifyNotificationsChanged());
    await waitFor(() => expect(onRefresh).toHaveBeenCalledWith(resumed));
    expect(metadata).toHaveBeenCalledWith(7);
    unmount();
  });
});
