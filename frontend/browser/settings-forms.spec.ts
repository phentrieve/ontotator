/**
 * Project settings forms (issue 170): General, Annotation (Prefilled values, Values annotators can choose), the
 * Workflow cards, and the Remove… and revoke dialogs of People. Each form is saved, read back from the server and
 * shown again after a reload; Discard changes and the leave dialog bring the saved values back.
 *
 * Every test builds a fresh project through ``POST /__test_lead_workflow__`` (tests/browser_lead_workflow_scenarios.py):
 * DEFAULT_IMPORT is an empty project with its lead and three annotators; FR_OFF adds open translation reviews for Ana
 * and Ben, which a removal has to revoke.
 */
import { expect, test, type Page } from "@playwright/test";
import { authenticatedRequest, loginThroughForm } from "./helpers";
import { leadScenario, type LeadScenario, type LeadScenarioName } from "./leadWorkflowHelpers";

test.setTimeout(120_000);
test.use({ actionTimeout: 15_000 });

type Section = "general" | "annotation" | "workflow" | "people";

/** Console errors and page errors of the test; every test ends with none. */
function collectErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on("console", message => { if (message.type() === "error") errors.push(message.text()); });
  page.on("pageerror", error => errors.push(String(error)));
  return errors;
}

const settingsUrl = (s: LeadScenario, section: Section) => `/#/projects/${encodeURIComponent(s.project)}/settings/${section}`;
const form = (page: Page, name: "General" | "Annotation" | "Workflow") => page.getByRole("form", { name, exact: true });
const saveButton = (page: Page, name: "General" | "Annotation" | "Workflow") => form(page, name).getByRole("button", { name: "Save changes", exact: true });
const tab = (page: Page, name: string) => page.getByRole("navigation", { name: "Settings sections" }).getByRole("link", { name, exact: true });

/** A fresh project of ``scenario``, its lead logged in, on ``section`` of its settings. */
async function openSettings(page: Page, scenario: LeadScenarioName, section: Section): Promise<LeadScenario> {
  const s = await leadScenario(page, scenario);
  await loginThroughForm(page, s.users.lead, s.display_names.lead);
  await page.goto(settingsUrl(s, section));
  await expect(page.getByRole("heading", { level: 1, name: /· Settings$/ })).toBeVisible();
  return s;
}

/** The settings as the server has them. */
async function serverSettings(page: Page, s: LeadScenario): Promise<Record<string, unknown>> {
  const response = await authenticatedRequest(page, `/api/v1/projects/${encodeURIComponent(s.project)}/settings`);
  expect(response.ok(), await response.text()).toBeTruthy();
  return await response.json() as Record<string, unknown>;
}

/** Save the form and wait for the server's answer and the form's own confirmation. */
async function save(page: Page, name: "General" | "Annotation" | "Workflow") {
  const saved = page.waitForResponse(response => response.request().method() === "PATCH" && new URL(response.url()).pathname.endsWith("/settings"));
  await saveButton(page, name).click();
  expect((await saved).ok()).toBeTruthy();
  await expect(form(page, name).getByText(`${name} saved.`, { exact: true })).toBeVisible();
  await expect(saveButton(page, name)).toBeDisabled();
}

test("General: name, description and languages are saved; Discard changes and the leave dialog restore them", async ({ page }) => {
  const errors = collectErrors(page);
  const s = await openSettings(page, "DEFAULT_IMPORT", "general");
  const general = form(page, "General");
  const name = general.getByLabel(/^Name/);
  const description = general.getByLabel("Description", { exact: true });
  await expect(saveButton(page, "General")).toBeDisabled();

  await name.fill("Renamed project");
  await description.fill("Synthetic texts for the settings spec.");
  const languages = general.getByLabel("Languages of the texts", { exact: true });
  await languages.fill("de");
  await languages.press("Enter");
  await expect(general.getByText("Unsaved changes.", { exact: true })).toBeVisible();
  await save(page, "General");
  await expect(page.getByRole("heading", { level: 1, name: "Renamed project · Settings", exact: true })).toBeVisible();
  expect(await serverSettings(page, s)).toMatchObject({ name: "Renamed project", description: "Synthetic texts for the settings spec.", languages: ["de"] });

  await page.reload();
  await expect(page.getByRole("heading", { level: 1, name: "Renamed project · Settings", exact: true })).toBeVisible();
  await expect(name).toHaveValue("Renamed project");
  await expect(description).toHaveValue("Synthetic texts for the settings spec.");

  // Discard changes: the saved name comes back and nothing is sent.
  await name.fill("Not kept");
  await general.getByRole("button", { name: "Discard changes", exact: true }).click();
  await expect(name).toHaveValue("Renamed project");
  await expect(saveButton(page, "General")).toBeDisabled();

  // Leaving with an unsaved edit asks first: Cancel stays, Discard changes leaves without saving.
  await name.fill("Still not kept");
  await tab(page, "Workflow").click();
  const leave = page.getByRole("dialog", { name: "Unsaved changes in General", exact: true });
  await leave.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(leave).toHaveCount(0);
  await expect(name).toHaveValue("Still not kept");
  await tab(page, "Workflow").click();
  await leave.getByRole("button", { name: "Discard changes", exact: true }).click();
  await expect(form(page, "Workflow")).toBeVisible();
  await tab(page, "General").click();
  await expect(name).toHaveValue("Renamed project");
  expect((await serverSettings(page, s)).name).toBe("Renamed project");

  // A name is required: the browser refuses the form and nothing is saved.
  await name.fill("");
  await saveButton(page, "General").click();
  expect(await name.evaluate((input: HTMLInputElement) => input.validity.valueMissing)).toBe(true);
  expect((await serverSettings(page, s)).name).toBe("Renamed project");
  expect(errors).toEqual([]);
});

test("Annotation: a prefilled value and a hidden value are saved together and shown again after a reload", async ({ page }) => {
  const errors = collectErrors(page);
  const s = await openSettings(page, "DEFAULT_IMPORT", "annotation");
  const annotation = form(page, "Annotation");
  const assertion = annotation.getByRole("combobox", { name: "Assertion", exact: true });
  await expect(assertion).toHaveValue("");

  // Prefilled values: new findings start as "Absent".
  await assertion.selectOption({ label: "Absent" });
  const prefill = await assertion.inputValue();

  // Values annotators can choose: collapsed at first; the default value cannot be hidden.
  const values = annotation.getByRole("region", { name: "Values annotators can choose", exact: true });
  const summary = values.locator("summary").first();
  await expect(summary).toHaveText("Values annotators can choose");
  await summary.click();
  const assertionRow = values.getByRole("group", { name: "Assertion", exact: true });
  await expect(assertionRow.getByRole("button", { name: "Present", exact: true })).toBeDisabled();
  const uncertain = assertionRow.getByRole("button", { name: "Uncertain", exact: true });
  await expect(uncertain).toHaveAttribute("aria-pressed", "true");
  await uncertain.click();
  await expect(uncertain).toHaveAttribute("aria-pressed", "false");
  await expect(summary).toHaveText("Values annotators can choose (1 hidden)");
  // A hidden value is no longer offered as a prefill.
  await expect(assertion.locator("option")).toHaveText(["No prefill", "Present", "Absent"]);

  await save(page, "Annotation");
  const stored = await serverSettings(page, s) as { creation_defaults: Record<string, Record<string, Record<string, string>>>; hidden_axis_values: Record<string, Record<string, string[]>> };
  expect(Object.values(stored.creation_defaults).flatMap(types => Object.values(types)).map(axes => axes.assertion)).toEqual([prefill]);
  expect(Object.values(stored.hidden_axis_values).flatMap(axes => Object.values(axes)).flat()).toHaveLength(1);

  await page.reload();
  await expect(assertion).toHaveValue(prefill);
  await expect(summary).toHaveText("Values annotators can choose (1 hidden)");
  await summary.click();
  await expect(uncertain).toHaveAttribute("aria-pressed", "false");

  // Hiding the prefilled value itself keeps it in the list, marked as hidden; Discard changes shows it again.
  const absent = assertionRow.getByRole("button", { name: "Absent", exact: true });
  await absent.click();
  await expect(summary).toHaveText("Values annotators can choose (2 hidden)");
  await expect(assertion.locator("option:checked")).toHaveText("Absent (hidden)");
  await annotation.getByRole("button", { name: "Discard changes", exact: true }).click();
  await expect(absent).toHaveAttribute("aria-pressed", "true");
  await expect(assertion.locator("option:checked")).toHaveText("Absent");

  // Showing the value again and removing the prefill returns the project to where it started.
  await uncertain.click();
  await assertion.selectOption({ label: "No prefill" });
  await save(page, "Annotation");
  const cleared = await serverSettings(page, s) as { creation_defaults: Record<string, unknown>; hidden_axis_values: Record<string, Record<string, string[]>> };
  expect(cleared.creation_defaults).toEqual({});
  expect(Object.values(cleared.hidden_axis_values).flatMap(axes => Object.values(axes)).flat()).toEqual([]);
  await expect(summary).toHaveText("Values annotators can choose");
  expect(errors).toEqual([]);
});

test("Workflow: every card is saved with one Save and shown again after a reload", async ({ page }) => {
  const errors = collectErrors(page);
  const s = await openSettings(page, "DEFAULT_IMPORT", "workflow");
  const workflow = form(page, "Workflow");
  const imports = workflow.getByRole("radiogroup", { name: "New imports", exact: true });
  const tools = workflow.getByRole("radiogroup", { name: "Texts with tool proposals", exact: true });
  const perText = workflow.getByRole("spinbutton", { name: /^Annotators per text/ });
  const gate = workflow.getByRole("checkbox", { name: "Annotate only after the translation review is accepted", exact: true });
  const consolidator = workflow.getByRole("checkbox", { name: "Consolidator must not be one of the text's annotators", exact: true });
  const blind = workflow.getByRole("checkbox", { name: "Hide annotator names during consolidation", exact: true });
  const time = workflow.getByRole("checkbox", { name: "Record working time", exact: true });
  const before = await serverSettings(page, s);
  expect(before).toMatchObject({ import_plan: "review_and_annotate_translations", annotations_per_text: 1, annotate_accepted_translations_only: true });
  await expect(imports.getByRole("radio", { name: "Plan review and annotation for every translation", exact: true })).toBeChecked();

  await imports.getByRole("radio", { name: "Plan nothing; I plan texts on Documents", exact: true }).check();
  await tools.getByRole("radio", { name: "Annotators start from scratch", exact: true }).check();
  await perText.fill("3");
  await gate.uncheck();
  await consolidator.check();
  await blind.check();
  await time.check();
  await save(page, "Workflow");
  const after = await serverSettings(page, s);
  expect(after).toMatchObject({
    import_plan: "nothing", annotations_per_text: 3, annotate_accepted_translations_only: false,
    adjudicator_not_annotator: true, blind_consolidation: true, record_working_time: true,
  });
  expect(after.tool_proposal_mode).not.toBe(before.tool_proposal_mode);

  await page.reload();
  await expect(imports.getByRole("radio", { name: "Plan nothing; I plan texts on Documents", exact: true })).toBeChecked();
  await expect(tools.getByRole("radio", { name: "Annotators start from scratch", exact: true })).toBeChecked();
  await expect(perText).toHaveValue("3");
  await expect(gate).not.toBeChecked();
  await expect(consolidator).toBeChecked();
  await expect(blind).toBeChecked();
  await expect(time).toBeChecked();
  await expect(saveButton(page, "Workflow")).toBeDisabled();

  // A lower limit says what happens to the texts over it before it is saved (none here: the project is empty).
  await perText.fill("2");
  await expect(workflow.getByText("Nobody is removed.", { exact: true })).toBeVisible();
  // Below 1 the browser refuses the form. There is no built-in maximum (issue 457): 21 and 30 are values.
  await perText.fill("0");
  await saveButton(page, "Workflow").click();
  expect(await perText.evaluate((input: HTMLInputElement) => input.validity.rangeUnderflow)).toBe(true);
  for (const value of ["21", "30"]) {
    await perText.fill(value);
    expect(await perText.evaluate((input: HTMLInputElement) => input.validity.valid)).toBe(true);
  }
  await expect(workflow.getByText("Upper limit; fewer is fine.", { exact: true })).toBeVisible();
  expect((await serverSettings(page, s)).annotations_per_text).toBe(3);
  await workflow.getByRole("button", { name: "Discard changes", exact: true }).click();
  await expect(perText).toHaveValue("3");
  expect(errors).toEqual([]);
});

test("People: Remove… asks first, revokes open assignments only after a second confirmation, and roles change with a confirmation", async ({ page }) => {
  const errors = collectErrors(page);
  const s = await openSettings(page, "FR_OFF", "people");
  const members = page.getByRole("region", { name: "Members", exact: true });
  const table = members.getByRole("table", { name: "Project members", exact: true });
  const row = (person: "ana" | "annotator") => table.getByRole("row").filter({ hasText: s.users[person] });
  const status = members.locator("p.settings-confirmation");
  const memberNames = async () => {
    const response = await authenticatedRequest(page, `/api/v1/projects/${encodeURIComponent(s.project)}/members`);
    expect(response.ok(), await response.text()).toBeTruthy();
    return (await response.json() as { username: string }[]).map(member => member.username);
  };
  await expect(row("ana")).toHaveCount(1);

  // Remove…: Cancel changes nothing.
  await row("ana").getByRole("button", { name: "Remove Ana Weber from the project", exact: true }).click();
  const remove = page.getByRole("dialog", { name: "Remove Ana Weber from the project?", exact: true });
  await expect(remove).toContainText("Ana Weber loses access to this project.");
  await remove.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(remove).toHaveCount(0);
  expect(await memberNames()).toContain(s.users.ana);

  // Ana has an open translation review: the server refuses, and the second dialog names what would be revoked.
  await row("ana").getByRole("button", { name: "Remove Ana Weber from the project", exact: true }).click();
  await remove.getByRole("button", { name: "Remove from project", exact: true }).click();
  const revoke = page.getByRole("dialog", { name: "Revoke affected assignments?", exact: true });
  await expect(revoke).toContainText("Changing roles for Ana Weber affects these assignments:");
  await expect(revoke.getByRole("listitem")).not.toHaveCount(0);
  await expect(revoke.getByRole("listitem").first()).toContainText("Translation review");
  await revoke.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(revoke).toHaveCount(0);
  expect(await memberNames()).toContain(s.users.ana);
  await expect(row("ana")).toHaveCount(1);

  await row("ana").getByRole("button", { name: "Remove Ana Weber from the project", exact: true }).click();
  await remove.getByRole("button", { name: "Remove from project", exact: true }).click();
  await revoke.getByRole("button", { name: "Remove and revoke their open assignments", exact: true }).click();
  await expect(status).toHaveText("Ana Weber is no longer a member of this project.");
  await expect(revoke).toHaveCount(0);
  await expect(row("ana")).toHaveCount(0);
  expect(await memberNames()).not.toContain(s.users.ana);

  // A role is given with one click and taken away only after a confirmation.
  const consolidator = row("annotator").getByRole("checkbox", { name: `${s.users.annotator}: Consolidator`, exact: true });
  // The box follows the server's answer, so this is a click, not check() (which expects the change at once).
  await consolidator.click();
  await expect(status).toHaveText("Cy Annotator is now Consolidator.");
  await expect(consolidator).toBeChecked();
  await consolidator.click();
  const removeRole = page.getByRole("dialog", { name: "Remove the Consolidator role from Cy Annotator?", exact: true });
  await expect(removeRole).toContainText("Cy Annotator keeps the other roles in this project.");
  await removeRole.getByRole("button", { name: "Remove role", exact: true }).click();
  await expect(status).toHaveText("Cy Annotator is no longer Consolidator.");
  await expect(consolidator).not.toBeChecked();

  // Add member…: Ana comes back by her username, as an annotator.
  await members.getByRole("button", { name: "Add member…", exact: true }).click();
  const add = members.getByRole("form", { name: "Add member", exact: true });
  await add.getByRole("combobox", { name: /^Username/ }).fill(s.users.ana);
  await add.getByRole("checkbox", { name: "New member: Annotator", exact: true }).check();
  await add.getByRole("button", { name: "Add member", exact: true }).click();
  await expect(status).toHaveText("Ana Weber is now Annotator.");
  await expect(row("ana")).toHaveCount(1);
  expect(await memberNames()).toContain(s.users.ana);
  // The two refusals (409, the member has assignments) are the only errors the browser logged.
  const refused = "Failed to load resource: the server responded with a status of 409 (Conflict)";
  expect(errors).toEqual([refused, refused]);
});
