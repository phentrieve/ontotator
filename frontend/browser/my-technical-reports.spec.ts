import { expect, test, type Page } from "@playwright/test";
import { authenticatedRequest, loginAs, loginExisting } from "./helpers";

// Issue 269: a user sees the technical reports they sent under Profile › My technical reports.

async function sendReport(page: Page, text: string): Promise<string> {
  await page.getByRole("button", { name: "Report a technical problem…" }).click();
  const dialog = page.getByRole("dialog", { name: "Report a technical problem" });
  await dialog.getByLabel("What happened?").fill(text);
  await dialog.getByRole("button", { name: "Send report" }).click();
  const receipt = dialog.getByText(/^Sent as TR-\d+\.$/);
  await expect(receipt).toBeVisible();
  return (await receipt.textContent())!.replace(/^Sent as (TR-\d+)\.$/, "$1");
}

test("the report dialog links to the own reports, which show Open and Done", async ({ page, browser }) => {
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  page.on("console", message => { if (message.type() === "error") errors.push(message.text()); });
  await loginAs(page, "my-reports-ann");

  const first = await sendReport(page, "Tree does not load");
  await page.getByRole("dialog", { name: "Report a technical problem" }).getByRole("button", { name: "Close", exact: true }).last().click();
  const second = await sendReport(page, "Export hangs at 90 %");
  await page.getByRole("link", { name: "See my reports" }).click();
  await expect(page.getByRole("dialog", { name: "Report a technical problem" })).toHaveCount(0);
  await expect(page).toHaveURL(/#\/me\?section=technical-reports$/);

  const table = page.getByRole("table", { name: "My technical reports" });
  await expect(table.getByRole("row")).toHaveCount(3);
  await expect(table.getByRole("row").nth(1)).toContainText(second);
  await expect(table.getByRole("row").nth(1)).toContainText("Export hangs at 90 %");
  await expect(table.getByRole("row").nth(1)).toContainText("Open");
  await expect(table.getByRole("row").nth(2)).toContainText(first);

  // An administrator marks the older one done; another user's list stays empty.
  const context = await browser.newContext({ baseURL: test.info().project.use.baseURL });
  try {
    const admin = await context.newPage();
    expect((await admin.request.post("/__test_user__?username=my-reports-root&pseudonym=my-reports-root&system_admin=true")).ok()).toBeTruthy();
    await loginExisting(admin, "my-reports-root");
    const done = await authenticatedRequest(admin, `/api/v1/admin/technical-reports/${first.slice(3)}/status`, "POST", { status: "done" });
    expect(done.ok()).toBeTruthy();
    const own = await authenticatedRequest(admin, "/api/v1/me/technical-reports");
    expect(await own.json()).toEqual([]);
  } finally {
    await context.close();
  }
  await page.reload();
  await expect(table.getByRole("row").nth(2)).toContainText("Done");

  // Before sending, "My reports" leads here too.
  await page.evaluate(() => { window.location.hash = "#/?status=all"; });
  await page.getByRole("button", { name: "Report a technical problem…" }).click();
  await page.getByRole("dialog", { name: "Report a technical problem" }).getByRole("link", { name: "My reports" }).click();
  await expect(page.getByRole("heading", { name: "My technical reports" })).toBeInViewport();
  expect(errors).toEqual([]);
});
