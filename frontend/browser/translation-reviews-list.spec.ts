/**
 * The lead's list of translation reviews (issue 483): one row per review with reviewer, decision, rationale and the
 * number of changed passages, filtered by person and decision, each row opening the comparison; at 1440 and 390 px.
 *
 * Every test builds a fresh project; the reviewer's part runs through the API.
 */
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { authenticatedRequest } from "./helpers";
import { loginScenarioUser, reviewFlowScenario, type ReviewFlowScenario } from "./reviewFlowHelpers";

test.setTimeout(180_000);
test.use({ actionTimeout: 15_000 });

const sizes = [["1440", { width: 1440, height: 900 }], ["390", { width: 390, height: 844 }]] as const;
const REMARK = "The dose looks low, but the source says so.";

function watchErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on("console", message => { if (message.type() === "error") errors.push(message.text()); });
  page.on("pageerror", error => errors.push(String(error)));
  return errors;
}
const noPageScroll = async (page: Page) =>
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);

async function call<T>(page: Page, path: string, method = "GET", data?: unknown): Promise<T> {
  const response = await authenticatedRequest(page, path, method, data);
  expect(response.ok(), `${method} ${path}: ${response.status()} ${await response.text()}`).toBeTruthy();
  return await response.json() as T;
}
interface Workspace { draft: { text: string; revision: number } }
async function submitReview(page: Page, id: number, form: Record<string, unknown>, edit: (text: string) => string = text => text) {
  const workspace = await call<Workspace>(page, `/api/v1/translation-reviews/${id}`);
  await call(page, `/api/v1/translation-reviews/${id}/draft`, "PUT", { text: edit(workspace.draft.text), form, expected_revision: workspace.draft.revision });
  await call(page, `/api/v1/translation-reviews/${id}/submit`, "POST", { expected_revision: workspace.draft.revision + 1 });
}

/** Ana corrects two passages of the first text and accepts the second unchanged, with a remark; then the lead logs in. */
async function reviewed(page: Page): Promise<ReviewFlowScenario> {
  const s = await reviewFlowScenario(page, "REVIEW_FLOW");
  await loginScenarioUser(page, s, "ana");
  await submitReview(page, s.assignments["failed-translation"], { decision: "accepted_corrected", clinical_change: false, categories: [] },
    text => text.replace("Absatz 1. Dosis 5 mg.", "Absatz 1. Dosis 5 Milligramm.").replace("Absatz 9.", "Abschnitt 9."));
  await submitReview(page, s.assignments["second-translation"], { decision: "accepted_unchanged", clinical_change: false, categories: [], rationale: REMARK });
  await page.context().clearCookies();
  await loginScenarioUser(page, s, "lead");
  return s;
}
const reviewRows = (page: Page) => page.getByRole("table", { name: "Translation reviews" }).locator("tbody tr");

for (const [label, viewport] of sizes) {
  test(`the lead reads a reviewer's translation reviews and opens the comparison (${label} px)`, async ({ page }) => {
    await page.setViewportSize(viewport);
    const errors = watchErrors(page);
    const s = await reviewed(page);
    const project = encodeURIComponent(s.project);

    // Progress links to the list.
    await page.goto(`/#/projects/${project}/progress`);
    await page.getByRole("link", { name: "Translation reviews", exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`#/projects/${project}/translation-reviews$`));
    await expect(page.getByRole("heading", { name: "Translation reviews", level: 1 })).toBeVisible();
    await expect(reviewRows(page)).toHaveCount(2);
    await expect(page.getByText("2 reviews.")).toBeVisible();

    // Newest first: the accepted review with its remark, then the corrected one with its two changed passages.
    const accepted = page.getByRole("row", { name: "second-translation de v1, Accepted unchanged" });
    await expect(accepted).toContainText(REMARK);
    await expect(accepted).toContainText(s.display_names.ana);
    await expect(accepted).toContainText("None");
    const corrected = page.getByRole("row", { name: "failed-translation de v1, Accepted with corrections" });
    await expect(corrected).toContainText("2 passages");
    await expect(reviewRows(page).first()).toContainText("second-translation");
    await noPageScroll(page);
    const axe = await new AxeBuilder({ page }).include("main").analyze();
    expect(axe.violations.flatMap(v => v.nodes.map(n => `${v.id} ${n.target.join(" ")}: ${n.failureSummary ?? ""}`))).toEqual([]);

    // Filter by decision and person; the address keeps the filters.
    await page.getByLabel("Decision").selectOption({ label: "Accepted with corrections" });
    await expect(page).toHaveURL(/translation-reviews\?decision=accepted_corrected$/);
    await expect(reviewRows(page)).toHaveCount(1);
    await expect(page.getByText("1 review matches the filters.")).toBeVisible();
    await page.getByLabel("Person").selectOption({ index: 1 });
    await expect(page).toHaveURL(/reviewer=[^&]+&decision=accepted_corrected$/);
    await expect(reviewRows(page)).toHaveCount(1);
    await page.getByLabel("Decision").selectOption({ label: "Open" });
    await expect(page.getByText("No review matches the filters")).toBeVisible();
    await noPageScroll(page);
    await page.getByRole("link", { name: "Show all reviews" }).click();
    await expect(reviewRows(page)).toHaveCount(2);
    await page.getByLabel("Order").selectOption({ label: "Oldest first" });
    await expect(page).toHaveURL(/translation-reviews\?sort=oldest$/);
    await expect(reviewRows(page).first()).toContainText("failed-translation");

    // The row opens the text view with the corrected version beside the reviewed one.
    await corrected.getByRole("link", { name: /^Compare versions/ }).click();
    await expect(page).toHaveURL(/cases\/failed-translation\?variant=.+&compare=.+/);
    const changes = page.getByRole("checkbox", { name: "Show changes" });
    await changes.check();
    await expect(page.locator(".text-changes-legend")).toContainText("2 passages added, 2 passages removed.");
    await noPageScroll(page);

    // Back: the list is where the lead left it.
    await page.goBack();
    await expect(page).toHaveURL(/translation-reviews\?sort=oldest$/);
    await expect(reviewRows(page)).toHaveCount(2);
    expect(errors).toEqual([]);
  });
}

test("a reviewer does not get the list", async ({ page }) => {
  const s = await reviewFlowScenario(page, "REVIEW_FLOW");
  await loginScenarioUser(page, s, "ana");
  const refused = await authenticatedRequest(page, `/api/v1/projects/${encodeURIComponent(s.project)}/translation-review-list`);
  expect(refused.status()).toBe(403);
  await page.goto(`/#/projects/${encodeURIComponent(s.project)}/translation-reviews`);
  await expect(page.getByText("You do not have access to this page.")).toBeVisible();
  await expect(page.getByRole("table", { name: "Translation reviews" })).toHaveCount(0);
});
