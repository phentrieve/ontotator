import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { loginExisting, selectText } from "./helpers";

/**
 * Show changes since vN (issue 421): a round carried to a corrected text offers the switch above the text; the marks
 * are an overlay (the text keeps its characters and offsets), marking a finding works while they are on, and the
 * removed-text marker shows the earlier wording on keyboard focus. The lead sees the same on the submitted annotation
 * in the text view. Data: ``POST /__test_carry_forward__`` (tests/browser_carry_fixture.py).
 */

interface Scenario {
  project: string;
  case_id: string;
  documents: string[];
  assignment_id: number;
  username: string;
  text: string;
  old_text: string;
  submissions: Record<string, string>;
  recreate_span: { start: number; end: number };
  lead_username?: string;
}

test.setTimeout(180_000);
test.use({ actionTimeout: 15_000, viewport: { width: 1440, height: 900 } });

async function scenario(page: Page, name: "corrected" | "corrected_done"): Promise<Scenario> {
  const response = await page.request.post("/__test_carry_forward__", { params: { scenario: name }, timeout: 120_000 });
  expect(response.ok(), await response.text()).toBeTruthy();
  return (await response.json()) as Scenario;
}

function consoleErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on("console", message => { if (message.type() === "error") errors.push(message.text()); });
  page.on("pageerror", error => errors.push(error.message));
  return errors;
}

const text = (page: Page) => page.locator(".text-container").first();
const passage = (page: Page) => text(page).locator(".change-passage");
const marker = (page: Page) => text(page).locator(".change-removed");
/** First offset and text of the marked runs. */
const marked = (page: Page) => text(page).evaluate(node => {
  const runs = [...node.querySelectorAll<HTMLElement>(".run--marked")];
  return runs.length ? { start: Number(runs[0].dataset.start), text: runs.map(run => run.textContent).join("") } : null;
});

test("annotator: the switch by keyboard, marks over the exact text, the removed wording, and marking stays possible", async ({ page }) => {
  const errors = consoleErrors(page);
  const s = await scenario(page, "corrected");
  await loginExisting(page, s.username);
  await page.goto(`/#/tasks/${s.assignment_id}`);
  await expect(text(page)).toBeVisible();

  const toggle = page.getByRole("checkbox", { name: "Show changes since v1" });
  await expect(toggle).not.toBeChecked();
  await expect(passage(page)).toHaveCount(0);
  await toggle.focus();
  await page.keyboard.press("Space");
  await expect(toggle).toBeChecked();
  await expect(page.getByRole("status").filter({ hasText: /passage changed/ })).toHaveText("1 passage changed");
  await expect(passage(page)).toHaveCount(1);
  await expect(passage(page)).toContainText("epileptische Anfälle");
  await expect(text(page).locator(".run--marker").first()).toBeVisible();
  // The marks add no characters: the text and its offsets are exactly v2.
  expect(await text(page).evaluate(node => node.textContent)).toBe(s.text);

  // The removed-text marker is the next tab stop after the text; its tooltip names the v1 wording.
  await text(page).focus();
  await page.keyboard.press("Tab");
  await expect(marker(page)).toBeFocused();
  const tip = page.getByRole("tooltip");
  await expect(tip).toBeVisible();
  await expect(tip).toContainText("In v1:");
  await expect(tip.locator("del")).toContainText(["Krampfanfälle"]);
  // Axe (WCAG 2.x A/AA) on the editor with the marks and the tooltip shown.
  const wcag = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];
  const axe = await new AxeBuilder({ page }).include("main").include(".change-tip").withTags(wcag).analyze();
  expect(axe.violations.flatMap(v => v.nodes.map(n => `${v.id} ${n.target.join(" ")}: ${n.failureSummary ?? ""}`))).toEqual([]);
  await page.keyboard.press("Escape");
  await expect(tip).toHaveCount(0);

  await page.getByRole("button", { name: "Next ›" }).click();
  await expect(page.getByRole("status").filter({ hasText: /passage changed/ })).toHaveText("1 passage changed · 1 of 1");
  await expect(passage(page)).toHaveAttribute("data-current", "");

  // Re-create the carried finding inside the changed passage while the marks are shown.
  await page.locator('.sidebar [data-list-key^="input:"]').click();
  await page.getByRole("region", { name: "Carried finding", exact: true }).getByRole("button", { name: "Mark in text", exact: true }).click();
  await selectText(page, s.recreate_span.start, s.recreate_span.end);
  await page.getByRole("button", { name: "Save re-created finding", exact: true }).click();
  const recreated = page.locator('.sidebar [data-list-key^="annotation:"]').filter({ hasText: "Seizure" });
  await expect(recreated).toHaveCount(1);
  // The finding's mark covers exactly the selected v2 offsets (the change marks may split it into several runs).
  const expected = { start: s.recreate_span.start, text: s.text.slice(s.recreate_span.start, s.recreate_span.end) };
  await expect.poll(() => marked(page)).toEqual(expected);
  await expect(passage(page)).toHaveCount(1);

  // Off again: the finding keeps its place.
  await toggle.uncheck();
  await expect(passage(page)).toHaveCount(0);
  await expect.poll(() => marked(page)).toEqual(expected);
  expect(await text(page).evaluate(node => node.textContent)).toBe(s.text);
  expect(errors).toEqual([]);
});

test("lead: the annotation carried to v2 shows the same switch in the text view", async ({ page }) => {
  const errors = consoleErrors(page);
  const s = await scenario(page, "corrected_done");
  await loginExisting(page, s.lead_username!);
  const show = encodeURIComponent(`submission:${s.submissions.round2}`);
  await page.goto(`/#/projects/${encodeURIComponent(s.project)}/cases/${encodeURIComponent(s.case_id)}?variant=${encodeURIComponent(s.documents[1])}&show=${show}`);
  const toggle = page.getByRole("checkbox", { name: "Show changes since v1" });
  await expect(toggle).toBeVisible();
  await expect(toggle).not.toBeChecked();
  await toggle.check();
  await expect(passage(page)).toContainText("epileptische Anfälle");
  await marker(page).hover();
  await expect(page.getByRole("tooltip")).toContainText("Krampfanfälle");
  expect(await text(page).evaluate(node => node.textContent)).toBe(s.text);
  // The first round on v1 was not carried: no switch there.
  await page.goto(`/#/projects/${encodeURIComponent(s.project)}/cases/${encodeURIComponent(s.case_id)}?variant=${encodeURIComponent(s.documents[0])}&show=${encodeURIComponent(`submission:${s.submissions.round1}`)}`);
  await expect(text(page)).toContainText("Krampfanfälle");
  await expect(page.getByRole("checkbox", { name: /Show changes since/ })).toHaveCount(0);
  expect(errors).toEqual([]);
});
