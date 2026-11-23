/**
 * The header bell (issue 557): the unread count, the list, opening an entry, mark as read, keyboard and screen reader
 * access, and the phone sheet.
 *
 * Every test builds a fresh ``base`` project through ``POST /__test_problem_reports__``: the reporter got a new task;
 * a text problem the reporter files tells the lead. Person labels come from the fixture (``labels.*``).
 * With ``NOTIFICATIONS_SHOTS=<dir>`` the tests also save screenshots there (for review, never baselines).
 */
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import AxeBuilder from "@axe-core/playwright";
import { expect, request as playwrightRequest, test, type APIRequestContext, type Locator, type Page } from "@playwright/test";
import type { components } from "../src/api/generated";
import { loginExisting, TEST_PASSWORD } from "./helpers";
import { problemReportScenario, type ProblemReportScenario } from "./problemReportHelpers";

type Assignment = components["schemas"]["AssignmentView"];
type ProblemReport = components["schemas"]["ProblemReportView"];

test.setTimeout(180_000);
test.use({ actionTimeout: 15_000 });
// Screenshots for review are taken at twice the pixel density.
if (process.env.NOTIFICATIONS_SHOTS) test.use({ deviceScaleFactor: 2 });

const requestId = (prefix: string) => `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;

async function shot(page: Page, name: string): Promise<void> {
  const dir = process.env.NOTIFICATIONS_SHOTS;
  if (!dir) return;
  mkdirSync(dir, { recursive: true });
  await page.screenshot({ path: resolve(dir, `${name}.png`) });
}

/** Calls the API as ``username`` in a context of its own (the page stays logged in as someone else). */
async function as<T>(username: string, steps: (call: <R>(path: string, method?: string, data?: unknown) => Promise<R>) => Promise<T>): Promise<T> {
  const baseURL = test.info().project.use.baseURL!;
  const context: APIRequestContext = await playwrightRequest.newContext({ baseURL });
  try {
    const login = await context.post("/api/v1/auth/login", { data: { username, password: TEST_PASSWORD }, headers: { Origin: baseURL } });
    expect(login.ok(), await login.text()).toBeTruthy();
    const call = async <R>(path: string, method = "GET", data?: unknown): Promise<R> => {
      const me = await context.get("/api/v1/auth/me");
      const { csrf_token } = (await me.json()) as { csrf_token: string };
      const response = await context.fetch(path, { method, data, headers: { Origin: baseURL, ...(method === "GET" ? {} : { "X-CSRF-Token": csrf_token }) } });
      expect(response.ok(), `${method} ${path}: ${await response.text()}`).toBeTruthy();
      return (await response.json()) as R;
    };
    return await steps(call);
  } finally {
    await context.dispose();
  }
}

/** The reporter files a text problem on their task; the lead gets a notification. */
async function fileReport(s: ProblemReportScenario): Promise<ProblemReport> {
  return as(s.users.reporter, async call => {
    const assignment = await call<Assignment>(`/api/v1/assignments/${s.tasks.reporter}`);
    return call<ProblemReport>(`/api/v1/assignments/${s.tasks.reporter}/problem-reports`, "POST", {
      request_id: requestId("report"),
      expected_workflow_revision: assignment.workflow_revision,
      round_id: assignment.active_round_id ?? null,
      reason: "The German text misses a sentence.",
    });
  });
}

const bell = (page: Page) => page.locator(".shell-header").getByRole("button", { name: /^Notifications/ });
const panel = (page: Page) => page.getByRole("dialog", { name: "Notifications" });

async function axeViolations(page: Page, include: string): Promise<string[]> {
  const results = await new AxeBuilder({ page }).include(include).analyze();
  return results.violations.flatMap(v => v.nodes.map(n => `${v.id} ${n.target.join(" ")}: ${n.failureSummary ?? ""}`));
}

test("a lead sees the text problem in the bell and opens the report from it", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const s = await problemReportScenario(page, "base");
  const report = await fileReport(s);
  await loginExisting(page, s.users.lead);
  await expect(bell(page)).toHaveAccessibleName("Notifications, 1 unread");
  await expect(bell(page).locator(".shell-admin-count")).toHaveText("1");
  await bell(page).click();
  await expect(bell(page)).toHaveAttribute("aria-expanded", "true");
  const entry = panel(page).getByRole("link", { name: new RegExp(`^Unread: Text problem from .*\\(${s.labels.reporter}\\): ${s.case_ids.a} de`) });
  await expect(entry).toBeVisible();
  // No clinical text: the reason stays on the report page.
  await expect(panel(page)).not.toContainText("misses a sentence");
  expect(await axeViolations(page, ".ui-popover")).toEqual([]);
  await shot(page, "1-lead-desktop-light");
  await entry.click();
  await expect(page).toHaveURL(new RegExp(`/problem-reports/${encodeURIComponent(report.report_id)}$`));
  await expect(panel(page)).toHaveCount(0);
  await expect(bell(page)).toHaveAccessibleName("Notifications");
  await expect(bell(page).locator(".shell-admin-count")).toHaveCount(0);
});

test("keyboard: the bell opens with Enter, Tab walks the list, Escape gives focus back; mark all as read", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const s = await problemReportScenario(page, "base");
  const report = await fileReport(s);
  // The lead releases the pause: the reporter learns it as well.
  await as(s.users.lead, call => call(`/api/v1/problem-reports/${report.report_id}/actions`, "POST", {
    request_id: requestId("resume"), expected_revision: report.revision, action: "resume", reason: "Go on", assignment_ids: [],
  }));
  await loginExisting(page, s.users.reporter);
  await expect(bell(page)).toHaveAccessibleName("Notifications, 2 unread");
  await bell(page).focus();
  await page.keyboard.press("Enter");
  const released = panel(page).getByRole("link", { name: `Unread: Task released: annotation of ${s.case_ids.a} de` });
  await expect(released).toBeFocused();
  await expect(panel(page).getByRole("link", { name: `Unread: New task: annotation of ${s.case_ids.a} de` })).toBeVisible();
  await page.keyboard.press("Tab");
  await expect(panel(page).getByRole("button", { name: `Mark as read: Task released: annotation of ${s.case_ids.a} de` })).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(bell(page)).toHaveAccessibleName("Notifications, 1 unread");
  await panel(page).getByRole("button", { name: "Mark all as read" }).click();
  await expect(bell(page)).toHaveAccessibleName("Notifications");
  await expect(panel(page).getByRole("link", { name: /^Unread:/ })).toHaveCount(0);
  // The button is disabled now; focus stays in the list.
  await expect(panel(page).getByRole("link").first()).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(panel(page)).toHaveCount(0);
  await expect(bell(page)).toBeFocused();
});

test("phone: the list is a sheet with 44 px targets; dark theme", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const s = await problemReportScenario(page, "base");
  await fileReport(s);
  await loginExisting(page, s.users.lead);
  const button = bell(page);
  await expect(button).toHaveAccessibleName("Notifications, 1 unread");
  const box = await button.boundingBox();
  expect(box!.width).toBeGreaterThanOrEqual(44);
  expect(box!.height).toBeGreaterThanOrEqual(44);
  // The header fits the phone: no sideways scrolling.
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await shot(page, "2-lead-phone-header");
  await button.click();
  const sheet = page.locator(".ui-popover-sheet");
  await expect(sheet).toBeVisible();
  const entry = sheet.getByRole("link", { name: /^Unread: Text problem from / });
  const target = await entry.boundingBox();
  expect(target!.height).toBeGreaterThanOrEqual(44);
  await shot(page, "3-lead-phone-sheet-light");
  await page.emulateMedia({ colorScheme: "dark" });
  await shot(page, "4-lead-phone-sheet-dark");
  await page.keyboard.press("Escape");
  await page.setViewportSize({ width: 1440, height: 900 });
  await bell(page).click();
  await expect(panel(page)).toBeVisible();
  expect(await axeViolations(page, ".ui-popover")).toEqual([]);
  await shot(page, "5-lead-desktop-dark");
});

// Issue 620: the bell's follow-ups from the 0.14.0 acceptance.
const PAUSE_ROWS = (s: ProblemReportScenario) => [{ case_id: s.case_ids.a, language: "de" }];

/** The lead pauses or releases text a de through the preview and its token, as the Documents dialog does. */
async function pauseText(s: ProblemReportScenario, action: "pause" | "release"): Promise<void> {
  await as(s.users.lead, async call => {
    const body = { rows: PAUSE_ROWS(s), ...(action === "pause" ? { reason: "Source is being clarified" } : {}) };
    const url = `/api/v1/projects/${encodeURIComponent(s.project)}/text-pauses/${action}`;
    const preview = await call<{ preview_token: string }>(url, "POST", { ...body, preview: true });
    await call(url, "POST", { ...body, preview_token: preview.preview_token });
  });
}

/** How many line boxes the element's text takes. */
const lineBoxes = (locator: Locator) => locator.evaluate(element => {
  const range = document.createRange();
  range.selectNodeContents(element);
  return new Set([...range.getClientRects()].map(rect => Math.round(rect.top))).size;
});

test.describe("phone, touch (issue 620)", () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true });

  test("the sheet's Close and Mark all as read are 44 px; the pseudonym is not broken; a greyed Mark all says why", async ({ page }) => {
    const s = await problemReportScenario(page, "base");
    await fileReport(s);
    await loginExisting(page, s.users.lead);
    await bell(page).tap();
    const sheet = page.locator(".ui-popover-sheet");
    await expect(sheet).toBeVisible();
    for (const name of ["Close", "Mark all as read"]) {
      const box = (await sheet.getByRole("button", { name, exact: true }).boundingBox())!;
      expect(box.width, name).toBeGreaterThanOrEqual(44);
      expect(box.height, name).toBeGreaterThanOrEqual(44);
    }
    const entry = sheet.getByRole("link", { name: new RegExp(`Text problem from .*\\(${s.labels.reporter}\\): ${s.case_ids.a} de`) });
    await expect(entry).toBeVisible();
    const pseudonym = entry.locator(".notification-nowrap");
    await expect(pseudonym).toHaveText(s.labels.reporter);
    expect(await lineBoxes(pseudonym)).toBe(1);
    // Everything read: the greyed button stays focusable and gives its reason.
    await sheet.getByRole("button", { name: `Mark as read: ${await entry.locator(".notification-text").textContent()}` }).tap();
    const markAll = sheet.getByRole("button", { name: "Mark all as read", exact: true });
    await expect(markAll).toHaveAttribute("aria-disabled", "true");
    await expect(markAll).toHaveAccessibleDescription("Everything is read.");
    await markAll.focus();
    await expect(markAll).toBeFocused();
    await expect(sheet.locator(".ui-reason-tip", { hasText: "Everything is read." })).toBeVisible();
    await shot(page, "6-lead-phone-all-read");
    // Close by touch.
    await sheet.getByRole("button", { name: "Close", exact: true }).tap();
    await expect(sheet).toHaveCount(0);
  });
});

test("keyboard: with nothing unread, Mark all as read is still reached by Tab and gives its reason", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const s = await problemReportScenario(page, "base");
  await loginExisting(page, s.users.reporter);
  await expect(bell(page)).toHaveAccessibleName("Notifications, 1 unread");
  await bell(page).focus();
  await page.keyboard.press("Enter");
  await expect(panel(page).getByRole("link", { name: /^Unread: New task:/ })).toBeFocused();
  await page.keyboard.press("Tab");
  await page.keyboard.press("Enter");
  await expect(bell(page)).toHaveAccessibleName("Notifications");
  // Open again: the list, then Tab to the greyed button (no Mark as read is left before it).
  await page.keyboard.press("Escape");
  await expect(bell(page)).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(panel(page).getByRole("link").first()).toBeFocused();
  await page.keyboard.press("Tab");
  const markAll = panel(page).getByRole("button", { name: "Mark all as read", exact: true });
  await expect(markAll).toBeFocused();
  await expect(markAll).toHaveAttribute("aria-disabled", "true");
  await expect(panel(page).locator(".ui-reason-tip", { hasText: "Everything is read." })).toBeVisible();
  // A press changes nothing.
  await page.keyboard.press("Enter");
  await expect(bell(page)).toHaveAccessibleName("Notifications");
  await expect(markAll).toHaveAccessibleDescription("Everything is read.");
  expect(await axeViolations(page, ".ui-popover")).toEqual([]);
});

test("a release the person did not see yet: My tasks follows the bell on window focus", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const s = await problemReportScenario(page, "base");
  await pauseText(s, "pause");
  await loginExisting(page, s.users.reporter);
  const row = page.getByTestId("task-row").filter({ hasText: `${s.case_ids.a} de` }).first();
  await expect(row).toContainText("Paused by lead");
  await expect(bell(page)).toHaveAccessibleName("Notifications, 1 unread");
  await pauseText(s, "release");
  // The person comes back to the window: the bell, "My tasks (n)" and the list move together.
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect(bell(page)).toHaveAccessibleName("Notifications, 2 unread");
  await expect(row).not.toContainText("Paused");
});

test("the bell reads its count again on a move inside the app", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const s = await problemReportScenario(page, "base");
  await loginExisting(page, s.users.lead);
  await expect(bell(page)).toHaveAccessibleName("Notifications");
  await fileReport(s);
  // No focus change, no minute passed: only the navigation.
  await page.getByRole("link", { name: "Handbook", exact: true }).click();
  await expect(page).toHaveURL(/#\/help$/);
  await expect(bell(page)).toHaveAccessibleName("Notifications, 1 unread");
});
