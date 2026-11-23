/**
 * Issue 629: "Correct it myself" on a rejected translation in a language missing from the lead's profile. The panel
 * shows "Correct despite missing de in your profile" before the first attempt (the preview names the missing
 * languages), so Open translation review never meets a 409 from POST …/lead-correction.
 */
import { expect, test } from "@playwright/test";
import { documentsReady, rowAction, textNamePattern } from "./documentsHelpers";
import { authenticatedRequest, loginThroughForm } from "./helpers";
import { leadScenario } from "./leadWorkflowHelpers";

test.setTimeout(180_000);
test.use({ actionTimeout: 15_000 });

test("the missing-language confirmation shows before the first lead-correction attempt", async ({ page }) => {
  const s = await leadScenario(page, "REJECTED_TRANSLATION_FOR_LEAD");
  const caseId = s.cases!.rejected;
  await loginThroughForm(page, s.users.lead, s.display_names.lead, { lastProject: s.project });
  await documentsReady(page);
  // The lead no longer lists de (the text's language) in the profile.
  const profile = await authenticatedRequest(page, "/api/v1/me/profile", "PATCH", { languages: ["en", "fr", "es"] });
  expect(profile.ok(), await profile.text()).toBeTruthy();
  await page.reload();
  await documentsReady(page);

  const starts: number[] = [];
  page.on("response", response => {
    if (response.request().method() === "POST" && /\/lead-correction$/.test(new URL(response.url()).pathname)) starts.push(response.status());
  });
  await rowAction(page, "Resolve…", caseId, "de").click();
  const dialog = page.getByRole("dialog", { name: textNamePattern("Resolve rejected translation, ", caseId, "de") });
  await dialog.getByRole("button", { name: "Correct it myself (counts as accepted)…", exact: true }).click();
  const panel = dialog.getByRole("group", { name: textNamePattern("Correct it myself (counts as accepted), ", caseId, "de") });
  const confirm = panel.getByRole("checkbox", { name: "Correct despite missing de in your profile" });
  await expect(confirm).toBeVisible();
  const open = panel.getByRole("button", { name: "Open translation review", exact: true });
  await expect(open).toHaveAttribute("aria-disabled", "true");
  // A click on the greyed button (forced: Playwright waits for an enabled one) sends nothing.
  await open.click({ force: true });
  await expect(panel.getByText("Confirm the missing languages.", { exact: true })).toBeVisible();
  expect(starts).toEqual([]);

  await confirm.check();
  await open.click();
  await expect(page).toHaveURL(/#\/tasks\/\d+$/);
  await expect(page.getByText("You are correcting this translation as project lead.", { exact: true })).toBeVisible({ timeout: 30_000 });
  expect(starts).toEqual([200]);
});
