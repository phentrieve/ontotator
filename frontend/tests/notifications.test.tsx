import { act, cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api, type CurrentUser, type NotificationView } from "../src/api/client";
import { Shell, type ShellProps } from "../src/app/Shell";
import { bellLabel, notificationRoute, notificationText } from "../src/notifications/notificationLabels";
import { NOTIFICATIONS_REFRESH_MS } from "../src/notifications/useNotifications";
import { notifyTasksChanged } from "../src/tasks/tasksEvents";

const user: CurrentUser = { username: "alex", display_name: "Alex", pseudonym: "a1", is_system_admin: false, csrf_token: "test" };
const props = (extra: Partial<ShellProps> = {}): ShellProps => ({
  user, projects: [], route: { name: "tasks" }, onNavigate: vi.fn(), onLogout: vi.fn(), children: "Page content", ...extra,
});

const entry = (id: number, extra: Partial<NotificationView> = {}): NotificationView => ({
  id, kind: "task_assigned", created_at: "2026-11-20T10:00:00Z", read: false, project_key: "synthetic-ready", project_name: "Synthetic ready",
  actor: null, assignment_id: 100 + id, task: "annotate", case_id: `case-01${id}`, language: "de", version: 1, target_id: null, ...extra,
});

beforeEach(() => {
  vi.spyOn(api, "listMyTasks").mockReturnValue(new Promise(() => {}));
  vi.spyOn(api, "documentsSummary").mockReturnValue(new Promise(() => {}));
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.useRealTimers(); });

describe("notification texts (issue 557)", () => {
  it("names the task and the text, never more", () => {
    expect(notificationText(entry(2))).toBe("New task: annotation of case-012 de");
    expect(notificationText(entry(2, { kind: "task_reopened", task: "translation_review" }))).toBe("Task reopened: translation review of case-012 de");
    expect(notificationText(entry(2, { kind: "task_released", version: 2 }))).toBe("Task released: annotation of case-012 de v2");
    const ana = { pseudonym: "ann-0004", display_name: "Ana Weber", is_me: false };
    expect(notificationText(entry(2, { kind: "text_problem_received", actor: ana }))).toBe("Text problem from Ana Weber (ann-0004): case-012 de");
    expect(notificationText(entry(2, { kind: "question_received", actor: { pseudonym: "ann-0004", is_me: false } }))).toBe("Question from ann-0004: case-012 de");
    expect(notificationText(entry(2, { kind: "answer_received" }))).toBe("Answer from the lead on case-012 de");
  });
  it("leads to the task, the problem report or the lead's decisions", () => {
    expect(notificationRoute(entry(2))).toEqual({ name: "task", assignmentId: 102 });
    expect(notificationRoute(entry(2, { kind: "text_problem_received", target_id: "report-1" })))
      .toEqual({ name: "projectProblemReport", key: "synthetic-ready", reportId: "report-1" });
    expect(notificationRoute(entry(2, { kind: "question_received", target_id: "report-2" })))
      .toEqual({ name: "projectQuestions", key: "synthetic-ready" });
    expect(notificationRoute(entry(2, { kind: "submission_waiting", assignment_id: null })))
      .toEqual({ name: "projectDocuments", key: "synthetic-ready", segment: "decision" });
    expect(bellLabel(3)).toBe("Notifications, 3 unread");
    expect(bellLabel(0)).toBe("Notifications");
  });
});

describe("the header bell", () => {
  it("shows the unread count, lists the entries and opens one, marking it read", async () => {
    vi.spyOn(api, "notificationSummary").mockResolvedValue({ unread: 2 });
    vi.spyOn(api, "listNotifications").mockResolvedValue({ unread: 2, items: [entry(2), entry(1, { read: true })] });
    const markRead = vi.spyOn(api, "markNotificationRead").mockResolvedValue({ unread: 1 });
    const state = props();
    render(<Shell {...state} />);
    const bell = await screen.findByRole("button", { name: "Notifications, 2 unread" });
    expect(bell.getAttribute("aria-expanded")).toBe("false");
    // Next to the user menu, after the other header controls.
    const menu = document.querySelector(".shell-user-menu")!;
    expect(bell.compareDocumentPosition(menu) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(bell.closest(".shell-actions")).toBe(menu.closest(".shell-actions"));
    const input = userEvent.setup();
    await input.click(bell);
    const panel = await screen.findByRole("dialog", { name: "Notifications" });
    expect(bell.getAttribute("aria-expanded")).toBe("true");
    const links = await within(panel).findAllByRole("link");
    expect(links.map(link => link.textContent)).toEqual([
      expect.stringContaining("Unread: New task: annotation of case-012 de"),
      expect.stringContaining("New task: annotation of case-011 de"),
    ]);
    expect(links[1].textContent).not.toContain("Unread");
    // Focus moves into the list.
    expect(document.activeElement).toBe(links[0]);
    await input.click(links[0]);
    expect(markRead).toHaveBeenCalledWith(2);
    expect(state.onNavigate).toHaveBeenCalledWith({ name: "task", assignmentId: 102 });
    expect(screen.queryByRole("dialog", { name: "Notifications" })).toBeNull();
    await screen.findByRole("button", { name: "Notifications, 1 unread" });
  });

  it("marks one or all as read, up to the newest entry shown", async () => {
    vi.spyOn(api, "notificationSummary").mockResolvedValue({ unread: 2 });
    vi.spyOn(api, "listNotifications").mockResolvedValue({ unread: 2, items: [entry(2), entry(1)] });
    vi.spyOn(api, "markNotificationRead").mockResolvedValue({ unread: 1 });
    const markAll = vi.spyOn(api, "markAllNotificationsRead").mockResolvedValue({ unread: 0 });
    render(<Shell {...props()} />);
    const input = userEvent.setup();
    await input.click(await screen.findByRole("button", { name: "Notifications, 2 unread" }));
    const panel = await screen.findByRole("dialog", { name: "Notifications" });
    await input.click(await within(panel).findByRole("button", { name: "Mark as read: New task: annotation of case-011 de" }));
    expect(within(panel).getAllByRole("button", { name: /^Mark as read:/ })).toHaveLength(1);
    await input.click(within(panel).getByRole("button", { name: "Mark all as read" }));
    expect(markAll).toHaveBeenCalledWith(2);
    expect(within(panel).queryAllByRole("button", { name: /^Mark as read:/ })).toHaveLength(0);
    expect(within(panel).getByRole("button", { name: "Mark all as read" }).hasAttribute("disabled")).toBe(true);
    expect(document.activeElement).toBe(within(panel).getAllByRole("link")[0]);
    await screen.findByRole("button", { name: "Notifications" });
  });

  it("closes on Escape and gives focus back to the bell; an empty list says so", async () => {
    vi.spyOn(api, "notificationSummary").mockResolvedValue({ unread: 0 });
    vi.spyOn(api, "listNotifications").mockResolvedValue({ unread: 0, items: [] });
    render(<Shell {...props()} />);
    const input = userEvent.setup();
    const bell = screen.getByRole("button", { name: "Notifications" });
    await input.click(bell);
    const panel = await screen.findByRole("dialog", { name: "Notifications" });
    await within(panel).findByText(/No notifications\./);
    await input.keyboard("{Escape}");
    expect(screen.queryByRole("dialog", { name: "Notifications" })).toBeNull();
    expect(document.activeElement).toBe(bell);
  });

  it("reloads the count on tasks-changed and every minute, not the list", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const summary = vi.spyOn(api, "notificationSummary").mockResolvedValue({ unread: 0 });
    const list = vi.spyOn(api, "listNotifications").mockResolvedValue({ unread: 0, items: [] });
    render(<Shell {...props()} />);
    await waitFor(() => expect(summary).toHaveBeenCalledTimes(1));
    act(() => notifyTasksChanged());
    expect(summary).toHaveBeenCalledTimes(2);
    summary.mockResolvedValue({ unread: 120 });
    await act(async () => { vi.advanceTimersByTime(NOTIFICATIONS_REFRESH_MS); });
    expect(summary).toHaveBeenCalledTimes(3);
    const bell = await screen.findByRole("button", { name: "Notifications, 120 unread" });
    expect(bell.querySelector(".shell-admin-count")?.textContent).toBe("99+");
    expect(list).not.toHaveBeenCalled();
  });
});
