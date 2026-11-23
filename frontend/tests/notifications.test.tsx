import { act, cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api, type CurrentUser, type NotificationView, type ProblemReportView } from "../src/api/client";
import { parseRoute, routeHref } from "../src/app/router";
import { Shell, type ShellProps } from "../src/app/Shell";
import { bellLabel, notificationRoute, notificationText } from "../src/notifications/notificationLabels";
import { QuestionsPage } from "../src/questions/QuestionsPage";
import { report } from "./problems/fixtures";
import { NOTIFICATIONS_REFRESH_MS } from "../src/notifications/useNotifications";
import { notifyTasksChanged } from "../src/tasks/tasksEvents";
import { notifyQuestionsChanged, QUESTIONS_CHANGED } from "../src/questions/questionsEvents";

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
    expect(notificationText(entry(2, { kind: "answer_received" }))).toBe("Answer from the lead: case-012 de");
  });
  it("names an Ask the lead question and its answer by the asker and the text only", () => {
    const ana = { pseudonym: "ann-0004", display_name: "Ana Weber", is_me: false };
    const lead = { pseudonym: "lead-0001", display_name: "Lea Lead", is_me: false };
    const asked = entry(3, { kind: "question_received", actor: ana, task: "translation_review", target_id: "q-1" });
    expect(notificationText(asked)).toBe("Question from Ana Weber (ann-0004): case-013 de");
    expect(notificationText({ ...asked, actor: null })).toBe("Question from a team member: case-013 de");
    expect(notificationText({ ...asked, version: 2 })).toBe("Question from Ana Weber (ann-0004): case-013 de v2");
    // The answer does not name the lead, so it reads the same for every lead.
    const answered = entry(3, { kind: "answer_received", actor: lead, task: "translation_review", target_id: "q-1" });
    expect(notificationText(answered)).toBe("Answer from the lead: case-013 de");
    expect(notificationText({ ...answered, case_id: null })).toBe("Answer from the lead: a text");
  });
  it("opens the question on the lead's Questions page, and the asker's task for the answer", () => {
    const asked = entry(3, { kind: "question_received", task: "translation_review", target_id: "q-1" });
    expect(notificationRoute(asked)).toEqual({ name: "projectQuestions", key: "synthetic-ready", question: "q-1" });
    expect(routeHref(notificationRoute(asked))).toBe("#/projects/synthetic-ready/questions?question=q-1");
    expect(parseRoute("#/projects/synthetic-ready/questions?question=q-1")).toEqual({ name: "projectQuestions", key: "synthetic-ready", question: "q-1" });
    expect(notificationRoute({ ...asked, target_id: null })).toEqual({ name: "projectQuestions", key: "synthetic-ready" });
    const answered = entry(3, { kind: "answer_received", task: "translation_review", target_id: "q-1" });
    expect(notificationRoute(answered)).toEqual({ name: "task", assignmentId: 103 });
    expect(routeHref(notificationRoute(answered))).toBe("#/tasks/103");
  });
  it("leads to the task, the problem report or the lead's decisions", () => {
    expect(notificationRoute(entry(2))).toEqual({ name: "task", assignmentId: 102 });
    expect(notificationRoute(entry(2, { kind: "text_problem_received", target_id: "report-1" })))
      .toEqual({ name: "projectProblemReport", key: "synthetic-ready", reportId: "report-1" });
    expect(notificationRoute(entry(2, { kind: "question_received", target_id: "report-2" })))
      .toEqual({ name: "projectQuestions", key: "synthetic-ready", question: "report-2" });
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

describe("the question a notification opens (Ask the lead)", () => {
  const question = (id: string, over: Partial<ProblemReportView> = {}) => report({
    report_id: id, kind: "question", reason: `Question ${id}?`, task: "translation_review", pauses: false, holds: [], held_assignment_ids: [],
    viewer_is_lead: true, quote: null, proposed_text: null, ...over,
  });

  it("marks and focuses the question on the lead's Questions page", async () => {
    vi.spyOn(api, "listQuestions").mockResolvedValue([question("q-1"), question("q-2")]);
    render(<QuestionsPage projectKey="p" question="q-2" onNavigate={vi.fn()} />);
    const target = (await screen.findByText("Question q-2?")).closest("li")!;
    expect(target.className).toContain("lead-question--target");
    expect(target.getAttribute("aria-current")).toBe("true");
    await waitFor(() => expect(document.activeElement).toBe(target));
    expect(screen.getByText("Question q-1?").closest("li")!.className).not.toContain("lead-question--target");
  });

  it("shows a question answered since under Answered", async () => {
    vi.spyOn(api, "listQuestions").mockResolvedValue([question("q-1"), question("q-2", { state: "resolved", answer: "Yes." })]);
    render(<QuestionsPage projectKey="p" question="q-2" onNavigate={vi.fn()} />);
    const target = (await screen.findByText("Question q-2?")).closest("li")!;
    expect(target.className).toContain("lead-question--target");
    expect(screen.getByRole("tab", { name: /Answered/ }).getAttribute("aria-selected")).toBe("true");
  });

  // Issue 619: the lead is on Questions when the entry of a new question is opened.
  it("loads the list again when a notification opens a new question while the page is open", async () => {
    const list = vi.spyOn(api, "listQuestions").mockResolvedValueOnce([question("q-1")])
      .mockResolvedValue([question("q-1"), question("q-2")]);
    const { rerender } = render(<QuestionsPage projectKey="p" onNavigate={vi.fn()} />);
    expect(await screen.findByRole("tab", { name: /Open.*1/ })).toBeDefined();
    expect(screen.queryByText("Question q-2?")).toBeNull();
    rerender(<QuestionsPage projectKey="p" question="q-2" onNavigate={vi.fn()} />);
    const target = (await screen.findByText("Question q-2?")).closest("li")!;
    expect(target.className).toContain("lead-question--target");
    await waitFor(() => expect(document.activeElement).toBe(target));
    expect(screen.getByRole("tab", { name: /Open.*2/ }).getAttribute("aria-selected")).toBe("true");
    expect(list).toHaveBeenCalledTimes(2);
  });

  it("switches to Answered for a question opened from the Open tab, again after leaving the question", async () => {
    vi.spyOn(api, "listQuestions").mockResolvedValue([question("q-1"), question("q-2", { state: "resolved", answer: "Yes." })]);
    const { rerender } = render(<QuestionsPage projectKey="p" question="q-2" onNavigate={vi.fn()} />);
    await screen.findByText("Question q-2?");
    await userEvent.setup().click(screen.getByRole("tab", { name: /^Open/ }));
    rerender(<QuestionsPage projectKey="p" onNavigate={vi.fn()} />);
    await screen.findByText("Question q-1?");
    rerender(<QuestionsPage projectKey="p" question="q-2" onNavigate={vi.fn()} />);
    await waitFor(() => expect(screen.getByRole("tab", { name: /Answered/ }).getAttribute("aria-selected")).toBe("true"));
  });

  it("loads the list again on questions-changed and on window focus, as the sidebar count does", async () => {
    const list = vi.spyOn(api, "listQuestions").mockResolvedValueOnce([question("q-1")])
      .mockResolvedValueOnce([question("q-1"), question("q-2")]).mockResolvedValue([question("q-1"), question("q-2"), question("q-3")]);
    render(<QuestionsPage projectKey="p" onNavigate={vi.fn()} />);
    expect(await screen.findByRole("tab", { name: /Open.*1/ })).toBeDefined();
    act(() => { notifyQuestionsChanged(); });
    expect(await screen.findByText("Question q-2?")).toBeDefined();
    act(() => { window.dispatchEvent(new Event("focus")); });
    expect(await screen.findByText("Question q-3?")).toBeDefined();
    expect(list).toHaveBeenCalledWith("p");
  });

  it("opening a question's entry reloads the questions, so Questions (n) counts it too", async () => {
    const changed = vi.fn();
    window.addEventListener(QUESTIONS_CHANGED, changed);
    try {
      vi.spyOn(api, "notificationSummary").mockResolvedValue({ unread: 2 });
      vi.spyOn(api, "listNotifications").mockResolvedValue({ unread: 2, items: [
        entry(2, { kind: "question_received", task: "translation_review", target_id: "q-2" }), entry(1)] });
      vi.spyOn(api, "markNotificationRead").mockResolvedValue({ unread: 1 });
      const state = props();
      render(<Shell {...state} />);
      const input = userEvent.setup();
      await input.click(await screen.findByRole("button", { name: "Notifications, 2 unread" }));
      const links = await within(await screen.findByRole("dialog", { name: "Notifications" })).findAllByRole("link");
      await input.click(links[0]);
      expect(state.onNavigate).toHaveBeenCalledWith({ name: "projectQuestions", key: "synthetic-ready", question: "q-2" });
      expect(changed).toHaveBeenCalledTimes(1);
      // Other entries leave the questions alone.
      await input.click(screen.getByRole("button", { name: /^Notifications/ }));
      await input.click((await within(await screen.findByRole("dialog", { name: "Notifications" })).findAllByRole("link"))[1]);
      expect(changed).toHaveBeenCalledTimes(1);
    } finally { window.removeEventListener(QUESTIONS_CHANGED, changed); }
  });

  // Issue 629: the lead is on Questions when an annotator asks; the bell's count goes up and the page follows.
  it("loads the list again when the bell's unread count changes, not on the first count", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const summary = vi.spyOn(api, "notificationSummary").mockResolvedValue({ unread: 0 });
    const list = vi.spyOn(api, "listQuestions").mockImplementation(async (_key, filter) =>
      (summary.mock.calls.length > 1 ? [question("q-1")] : []).filter(q => !filter?.state || q.state === filter.state));
    const led = { project_key: "led", name: "led", roles: ["lead"], can_manage: true } as unknown as ShellProps["projects"][number];
    render(<Shell {...props({ projects: [led], route: { name: "projectQuestions", key: "led" } })}><QuestionsPage projectKey="led" onNavigate={vi.fn()} /></Shell>);
    await waitFor(() => expect(summary).toHaveBeenCalledTimes(1));
    expect(await screen.findByRole("tab", { name: /Open.*0/ })).toBeDefined();
    const before = list.mock.calls.length;
    summary.mockResolvedValue({ unread: 0 });
    await act(async () => { vi.advanceTimersByTime(NOTIFICATIONS_REFRESH_MS); });
    // The same count again: nothing reloads.
    expect(list.mock.calls.length).toBe(before);
    summary.mockResolvedValue({ unread: 1 });
    await act(async () => { vi.advanceTimersByTime(NOTIFICATIONS_REFRESH_MS); });
    expect(await screen.findByRole("button", { name: "Notifications, 1 unread" })).toBeDefined();
    expect(await screen.findByText("Question q-1?")).toBeDefined();
    expect(screen.getByRole("tab", { name: /Open.*1/ })).toBeDefined();
    // The page and "Questions (n)" in the sidebar, once each.
    expect(list.mock.calls.length).toBe(before + 2);
  });

  it("reloads Questions when its sidebar link is used while the page is open", async () => {
    const changed = vi.fn();
    window.addEventListener(QUESTIONS_CHANGED, changed);
    try {
      vi.spyOn(api, "listQuestions").mockResolvedValue([]);
      const led = { project_key: "led", name: "led", roles: ["lead"], can_manage: true } as unknown as ShellProps["projects"][number];
      const state = props({ projects: [led], route: { name: "projectQuestions", key: "led" } });
      const { rerender } = render(<Shell {...state} />);
      const input = userEvent.setup();
      await input.click(screen.getByRole("link", { name: "Questions" }));
      expect(state.onNavigate).toHaveBeenCalledWith({ name: "projectQuestions", key: "led" });
      expect(changed).toHaveBeenCalledTimes(1);
      // From another page the navigation alone loads the page.
      rerender(<Shell {...state} route={{ name: "projectDocuments", key: "led" }} />);
      await input.click(screen.getByRole("link", { name: "Questions" }));
      expect(changed).toHaveBeenCalledTimes(1);
    } finally { window.removeEventListener(QUESTIONS_CHANGED, changed); }
  });
});
