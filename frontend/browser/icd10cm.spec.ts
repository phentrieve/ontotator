import { expect, test } from "@playwright/test";
import { importPackage, openCase, selectText } from "./helpers";

// The ICD-10-CM fixture project (tests/browser_server.py, tests/fixtures/icd10cm.md). Its text starts
// "Type 2 diabetes with a foot ulcer of the left heel.": "foot ulcer" is 23-33.
const PROJECT = "browser-fixture-icd10cm";

test("a typed ICD-10-CM code goes straight to its term; words still search by name", async ({ page }) => {
  await importPackage(page, "", PROJECT, "icd-search-ana");
  await openCase(page, { task: "annotate" });
  await selectText(page, 23, 33);
  const search = page.getByLabel("Search term", { exact: true });
  const hits = page.locator(".candidate-card");

  for (const code of ["E11.621", "ICD10CM:E11.621", "e11.621"]) {
    await search.fill(code);
    await expect(hits).toHaveCount(1);
    await expect(hits.first().locator(".candidate-label")).toHaveText("Type 2 diabetes mellitus with foot ulcer");
    await expect(hits.first().locator(".candidate-id")).toHaveText("ICD10CM:E11.621");
  }

  await search.fill("T36.0X1A");
  await expect(hits).toHaveCount(1);
  await expect(hits.first().locator(".candidate-id")).toHaveText("ICD10CM:T36.0X1A");

  await search.fill("foot ulcer");
  await expect(hits.filter({ hasText: "ICD10CM:E11.621" })).toHaveCount(1);
  await expect.poll(() => hits.count()).toBeGreaterThan(1);

  await hits.filter({ hasText: "ICD10CM:E11.621" }).click();
  await expect(page.locator(".status-badge")).toHaveAttribute("title", "Revision 1");
});
