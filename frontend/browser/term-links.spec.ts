import { expect, test, type Page } from "@playwright/test";
import { importPackage, openCase, selectText } from "./helpers";

// Settings › Annotation › Term codes: a lead's code link for an ontology (issue 497), on the ICD-10-CM fixture
// project's own copy (tests/browser_server.py). Its text starts "Type 2 diabetes with a foot ulcer": "foot ulcer" is 23-33.
const PROJECT = "browser-fixture-icd10cm-links";
const ICD10DATA = "https://www.icd10data.com/search?s={code}";

test.setTimeout(120_000);

const codeLink = (page: Page) => page.getByLabel("Code link for ICD-10-CM", { exact: true });
const save = (page: Page) => page.getByRole("form", { name: "Annotation", exact: true }).getByRole("button", { name: "Save changes", exact: true });

/** On the open Annotation settings: save ``value`` as the ICD-10-CM code link. */
async function setCodeLink(page: Page, value: string) {
  await codeLink(page).fill(value);
  const saved = page.waitForResponse(response => response.request().method() === "PATCH" && new URL(response.url()).pathname.endsWith("/settings"));
  await save(page).click();
  expect((await saved).ok()).toBeTruthy();
  await expect(page.getByText("Annotation saved.", { exact: true })).toBeVisible();
}

async function treeLink(page: Page) {
  await page.goto(`/#/?project=${PROJECT}`);
  await openCase(page, { task: "annotate", projectKey: PROJECT });
  if (!await page.locator(".sidebar .doc-item").filter({ hasText: "ICD10CM:E11.621" }).count()) {
    await selectText(page, 23, 33);
    await page.getByLabel("Search term", { exact: true }).fill("E11.621");
    await page.locator(".candidate-card").filter({ hasText: "ICD10CM:E11.621" }).click();
  } else {
    await page.locator(".sidebar .doc-item").filter({ hasText: "ICD10CM:E11.621" }).first().click();
  }
  await page.getByRole("button", { name: /^Show in tree/ }).first().click();
  return page.locator(".tree-detail").getByRole("link", { name: /^View ICD10CM:E11\.621 on / });
}

test("a lead's code link replaces the default link in the tree; emptied, the default is back", async ({ page }) => {
  await importPackage(page, "", PROJECT, "links-lead");

  // Refused before it is sent: http, and no placeholder.
  await page.goto(`/#/projects/${PROJECT}/settings/annotation`);
  await codeLink(page).fill("http://www.icd10data.com/search?s={code}");
  await expect(page.getByText("Use an https:// address.", { exact: true })).toBeVisible();
  await codeLink(page).fill("https://www.icd10data.com/search");
  await expect(page.getByText("Put {code} or {id} where the code goes.", { exact: true })).toBeVisible();

  await setCodeLink(page, ICD10DATA);
  const link = await treeLink(page);
  await expect(link).toHaveAttribute("href", "https://www.icd10data.com/search?s=E11.621");
  await expect(link).toHaveAccessibleName("View ICD10CM:E11.621 on www.icd10data.com");

  await page.goto(`/#/projects/${PROJECT}/settings/annotation`);
  await expect(codeLink(page)).toHaveValue(ICD10DATA);
  await setCodeLink(page, "");
  await expect(await treeLink(page)).toHaveAttribute("href", "https://www.ebi.ac.uk/ols4/search?q=ICD10CM%3AE11.621");
});
