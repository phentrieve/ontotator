/**
 * Issue 268: a review the lead reopened (a correction request to a reviewer who already
 * submitted) reads "assigned, not started" on Documents until the reviewer saves a change;
 * then it reads "in review". Overview scenario 16, at 1440 and 390 px, without console
 * errors or page-level horizontal scroll.
 */
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { expect, request as playwrightRequest, test, type Page } from "@playwright/test";
import { TEST_PASSWORD } from "./helpers";
import { documentsReady, expectStage, openDocuments, rowCell, textRow } from "./documentsOverviewHelpers";
import { loginOverviewUser, overviewScenario } from "./overviewHelpers";

test.setTimeout(240_000);

const ANA = "Ana Weber";
const SHOTS = process.env.LEAD_FIXES_SHOTS;
const noHorizontalScroll = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);

/** The phone layout's text card of case-116 de: its Translation line. */
const phoneCell = (page: Page) => page.getByRole("article", { name: "case-116 de", exact: true }).getByRole("button", { name: /^Translation: / });

async function shot(page: Page, name: string): Promise<void> {
  if (!SHOTS) return;
  mkdirSync(SHOTS, { recursive: true });
  await page.screenshot({ path: resolve(SHOTS, `${name}.png`) });
}

/** The reviewer saves her review draft unchanged in her own session (no submit). */
async function saveReviewDraft(username: string, assignmentId: number): Promise<void> {
  const baseURL = test.info().project.use.baseURL!;
  const context = await playwrightRequest.newContext({ baseURL });
  try {
    const login = await context.post("/api/v1/auth/login", { data: { username, password: TEST_PASSWORD }, headers: { Origin: baseURL } });
    expect(login.ok(), await login.text()).toBeTruthy();
    const { csrf_token } = (await (await context.get("/api/v1/auth/me")).json()) as { csrf_token: string };
    const url = `/api/v1/translation-reviews/${assignmentId}`;
    const opened = (await (await context.get(url)).json()) as { text: string; draft: { revision: number; form: Record<string, unknown> } };
    const saved = await context.put(`${url}/draft`, {
      data: { expected_revision: opened.draft.revision, text: opened.text, form: { decision: "accepted_unchanged", clinical_change: false } },
      headers: { Origin: baseURL, "X-CSRF-Token": csrf_token },
    });
    expect(saved.ok(), await saved.text()).toBeTruthy();
  } finally {
    await context.dispose();
  }
}

test("a reopened review reads not started until the reviewer saves", async ({ page }) => {
  const errors: string[] = [];
  page.on("console", message => { if (message.type() === "error") errors.push(message.text()); });
  page.on("pageerror", error => errors.push(String(error)));
  await page.setViewportSize({ width: 1440, height: 900 });
  const s = await overviewScenario(page, "S16");
  await loginOverviewUser(page, s, "lead");
  await openDocuments(page, s.project);
  const translation = () => rowCell(textRow(page, "case-116", "de"), "translation");

  // Ana submitted her review; the lead asked her to correct it: nothing saved since.
  await expectStage(translation(), { state: `assigned, not started (${ANA})`, who: "" });
  expect(await noHorizontalScroll(page)).toBe(true);
  await shot(page, "268-reopened-not-started-after");
  await page.setViewportSize({ width: 390, height: 844 });
  await documentsReady(page);
  await expect(phoneCell(page)).toHaveText("Re-review assigned, not started");
  expect(await noHorizontalScroll(page)).toBe(true);
  await phoneCell(page).scrollIntoViewIfNeeded();
  await shot(page, "268-reopened-not-started-after-phone");

  await saveReviewDraft(s.users.ana, s.assignments.ana_review);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.reload();
  await documentsReady(page);
  await expectStage(translation(), { state: `in review (${ANA})`, who: "" });
  expect(await noHorizontalScroll(page)).toBe(true);
  await shot(page, "268-reopened-saved-after");
  await page.setViewportSize({ width: 390, height: 844 });
  await documentsReady(page);
  await expect(phoneCell(page)).not.toContainText("not started");
  await expect(phoneCell(page)).toContainText(/re-review/i);
  expect(await noHorizontalScroll(page)).toBe(true);
  await phoneCell(page).scrollIntoViewIfNeeded();
  await shot(page, "268-reopened-saved-after-phone");
  expect(errors).toEqual([]);
});
