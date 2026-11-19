/**
 * Moving a started project to a newer ontology release (issue 170): the check lists what the move does to open
 * drafts, Cancel moves nothing, and "Move to this release" rewrites exactly the listed draft terms. The handbook
 * walk (handbook-screenshots.spec.ts) only takes the picture of the check.
 *
 * Scenario S6 of ``POST /__test_overview__`` (tests/browser_overview_scenarios.py): Ana submitted, so the project is
 * locked to a release change; Tom's open draft gets the preset "tom_v2". ``/__test_ontology__?name=hp-newer.json``
 * adds release 2026-09-01 (tests/test_project_repin.py: ``newer_release``), in which
 *   HP:0011146 is replaced by HP:0001250 and HP:0002133 is merged into it (both rewritten),
 *   HP:0001252 and HP:0001284 are obsolete without a single successor, HP:0000365 is gone (all three stay).
 */
import { expect, test, type Locator, type Page } from "@playwright/test";
import { authenticatedRequest } from "./helpers";
import { loginOverviewUser, overviewAct, overviewScenario } from "./overviewHelpers";

test.setTimeout(120_000);
test.use({ actionTimeout: 15_000 });

const sorted = (values: string[]) => [...values].sort();
/** The cells of a report table by row, without relying on the order of its rows. */
async function rows(table: Locator): Promise<string[][]> {
  const lines: string[][] = [];
  for (const line of await table.locator("tbody tr").all()) lines.push((await line.getByRole("cell").allInnerTexts()).map(text => text.trim()));
  return lines;
}
/** The term ids of the findings in the open editor, sorted (the list's order is not part of this check). */
async function draftTerms(page: Page, count: number): Promise<string[]> {
  const findings = page.getByRole("complementary").getByRole("listitem").filter({ hasText: /HP:\d{7}/ });
  await expect(findings).toHaveCount(count);
  return sorted((await findings.allInnerTexts()).map(text => /HP:\d{7}/.exec(text)![0]));
}
async function pinnedRelease(page: Page, project: string): Promise<string> {
  const response = await authenticatedRequest(page, `/api/v1/projects/${encodeURIComponent(project)}/settings`);
  expect(response.ok(), await response.text()).toBeTruthy();
  const settings = await response.json() as { pins: { ontology_id: string; release: string }[] };
  expect(settings.pins).toHaveLength(1);
  return settings.pins[0].release;
}

test("Check changes lists the draft terms; Move to this release rewrites them in the open draft and leaves the others", async ({ page, browser }) => {
  const errors: string[] = [];
  page.on("console", message => { if (message.type() === "error") errors.push(message.text()); });
  page.on("pageerror", error => errors.push(String(error)));
  const s = await overviewScenario(page, "S6");
  await overviewAct(page, { project: s.project, case_id: "case-106", language: "de", actor: "tom", action: "draft_annotation", preset: "tom_v2" });
  const newer = await page.request.post("/__test_ontology__", { params: { name: "hp-newer.json" } });
  expect(newer.ok(), await newer.text()).toBeTruthy();

  // Tom's open draft before the move.
  const other = await browser.newContext({ baseURL: test.info().project.use.baseURL });
  const tom = await other.newPage();
  try {
    await loginOverviewUser(tom, s, "tom");
    await tom.locator(`a[href="#/tasks/${s.assignments.tom}"]`).click();
    expect(await draftTerms(tom, 6)).toEqual(["HP:0000365", "HP:0001250", "HP:0001252", "HP:0001284", "HP:0002133", "HP:0011146"]);
    await expect(tom.getByRole("button", { name: "Finish & submit text", exact: true })).toBeVisible();

    await loginOverviewUser(page, s, "lead");
    await page.goto(`/#/projects/${encodeURIComponent(s.project)}/settings/ontology`);
    const form = page.getByRole("form", { name: "Ontology release", exact: true });
    const check = form.getByRole("button", { name: "Check changes", exact: true });
    const ontologies = page.getByRole("list", { name: "Ontologies", exact: true });
    await expect(ontologies).toContainText("release 2026-06-23");
    await expect(check).toBeDisabled();
    const releases = form.getByLabel(/^hp release/i);
    await releases.selectOption((await releases.locator("option").filter({ hasText: "2026-09-01" }).first().getAttribute("value"))!);
    await check.click();

    const report = page.getByRole("region", { name: "Release change check", exact: true });
    await expect(report.getByRole("heading", { name: "Check before moving", exact: true })).toBeVisible();
    await expect(report.getByRole("list", { name: "Release changes", exact: true }).getByRole("listitem")).toHaveText(["hp: release 2026-06-23 → 2026-09-01"]);
    await expect(report).toContainText("2 draft term(s) will be rewritten to their successor.");
    await expect(report).toContainText("3 draft term(s) or open proposal(s) stay as they are and must be changed by their annotator before submitting.");
    // Text, Annotator, Term, Becomes, Why.
    const rewritten = await rows(report.getByRole("table", { name: "Rewritten draft terms", exact: true }));
    expect(sorted(rewritten.map(cells => cells.slice(2).join(" | ")))).toEqual(["HP:0002133 | HP:0001250 Seizure | merged", "HP:0011146 | HP:0001250 Seizure | replaced"]);
    // Text, Annotator, Term, Status, Suggestions.
    const flagged = await rows(report.getByRole("table", { name: "Draft terms to change by hand", exact: true }));
    expect(sorted(flagged.map(cells => cells.slice(2).join(" | ")))).toEqual([
      "HP:0000365 | not in the new release | —", "HP:0001252 | obsolete | HP:0001284", "HP:0001284 | obsolete | HP:0001250, HP:0000707",
    ]);
    // Every line names Tom's draft of this text, by pseudonym.
    for (const cells of [...rewritten, ...flagged]) expect(cells[0]).toMatch(/^case-106~de~/);
    expect(new Set([...rewritten, ...flagged].map(cells => cells[1])).size).toBe(1);
    await expect(report).toContainText("Submitted work stays as it was submitted, under its release: hp: 3 submitted finding(s), 0 with a successor, 2 obsolete, 0 not in the new release.");

    // Cancel: nothing moved, the draft is as it was.
    await report.getByRole("button", { name: "Cancel", exact: true }).click();
    await expect(report).toHaveCount(0);
    expect(await pinnedRelease(page, s.project)).toBe("2026-06-23");
    await tom.reload();
    expect(await draftTerms(tom, 6)).toEqual(["HP:0000365", "HP:0001250", "HP:0001252", "HP:0001284", "HP:0002133", "HP:0011146"]);

    // The check again, then the move.
    await check.click();
    await report.getByRole("button", { name: "Move to this release", exact: true }).click();
    await expect(form.getByText("Ontology release changed.", { exact: true })).toBeVisible();
    await expect(report).toHaveCount(0);
    await expect(ontologies).toContainText("release 2026-09-01");
    await expect(check).toBeDisabled();
    expect(await pinnedRelease(page, s.project)).toBe("2026-09-01");

    // Tom's draft: the two listed terms became HP:0001250; the three flagged terms stay and block the submit.
    await tom.reload();
    expect(await draftTerms(tom, 6)).toEqual(["HP:0000365", "HP:0001250", "HP:0001250", "HP:0001250", "HP:0001252", "HP:0001284"]);
    await expect(tom.getByRole("button", { name: "Finish & submit (3 open)", exact: true })).toBeVisible();
  } finally { await other.close(); }
  expect(errors).toEqual([]);
});
