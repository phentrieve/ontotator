/**
 * Three findings of a review of the administrator's and the project owner's screens, each at 1440 and 390 px:
 *
 * - A: Users › More… › Reset code says that it logs the person out and revokes their API tokens (it does, at once).
 * - B: a system administrator who takes the project's last lead away is told that the project will have no lead;
 *   a lead who is no administrator is still refused.
 * - C: the dialog that shows a new API token once cannot be left before "I have stored the token" is ticked, and
 *   the tokens cards point to the handbook for the Ontotator MCP server.
 *
 * Every test has its own accounts (``POST /__test_user__``) and, for B and C, its own project
 * (``POST /__test_lead_workflow__``, DEFAULT_IMPORT: an empty project with one lead).
 * REVIEW_SHOTS names a folder for screenshots of the dialogs; without it none are written.
 */
import { randomUUID } from "node:crypto";
import path from "node:path";
import { expect, test, type Locator, type Page } from "@playwright/test";
import { authenticatedRequest, loginThroughForm, TEST_PASSWORD } from "./helpers";

test.setTimeout(120_000);
test.use({ actionTimeout: 15_000, permissions: ["clipboard-read", "clipboard-write"] });

const SIZES = [{ name: "1440", width: 1440, height: 900 }, { name: "390", width: 390, height: 844 }] as const;

/** Console errors and page errors of the test. */
function collectErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on("console", message => { if (message.type() === "error") errors.push(message.text()); });
  page.on("pageerror", error => errors.push(String(error)));
  return errors;
}
async function shot(page: Page, name: string) {
  const folder = process.env.REVIEW_SHOTS;
  if (folder) await page.screenshot({ path: path.join(folder, `${name}.png`) });
}
/** The page itself never scrolls sideways. */
async function expectNoSidewaysScroll(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
}
/** The dialog lies inside the window. */
async function expectInsideWindow(page: Page, dialog: Locator) {
  const box = (await dialog.boundingBox())!;
  const width = page.viewportSize()!.width;
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(width);
}
async function createUser(page: Page, params: Record<string, string>) {
  const response = await page.request.post("/__test_user__", { params: { assign: "none", ...params } });
  expect(response.ok(), await response.text()).toBeTruthy();
  return await response.json() as Record<string, string>;
}
async function more(page: Page, username: string, item: string) {
  await page.getByRole("button", { name: `More actions for ${username}`, exact: true }).click();
  await page.getByRole("menu", { name: `More actions for ${username}`, exact: true }).getByRole("menuitem", { name: item, exact: true }).click();
}

for (const size of SIZES) {
  test.describe(`${size.name} px`, () => {
    test.use({ viewport: { width: size.width, height: size.height } });

    test("A: Reset code says that it logs the person out and revokes their API tokens, and does so at once", async ({ page, browser }) => {
      const errors = collectErrors(page);
      const suffix = randomUUID().slice(0, 8);
      const admin = `reset-admin-${suffix}`, target = `reset-target-${suffix}`, pending = `reset-pending-${suffix}`;
      await createUser(page, { username: admin, pseudonym: admin, system_admin: "true" });
      await createUser(page, { username: target, pseudonym: `ann-reset-${suffix}`, display_name: "Tara Target" });
      await createUser(page, { username: pending, pseudonym: `ann-pending-${suffix}`, display_name: "Pia Pending", setup: "true" });

      // The person is logged in on another device and has a personal API token.
      const other = await browser.newContext({ baseURL: test.info().project.use.baseURL });
      const device = await other.newPage();
      try {
        await loginThroughForm(device, target, "Tara Target");
        const created = await authenticatedRequest(device, "/api/v1/me/tokens", "POST", { name: "nightly export", scopes: ["read"], expires_in_days: 30 });
        expect(created.ok(), await created.text()).toBeTruthy();
        const tokenId = (await created.json() as { token: { id: number } }).token.id;

        await loginThroughForm(page, admin, admin);
        await page.goto("/#/admin/users");
        await page.getByLabel("Filter users", { exact: true }).fill(suffix);
        await more(page, target, "Reset code");
        const confirm = page.getByRole("dialog", { name: "Issue a new reset code for Tara Target?", exact: true });
        await expect(confirm).toBeVisible();
        await shot(page, `A-reset-confirm-${size.name}`);
        await expect(confirm).toContainText("Any unused code stops working. This logs the person out everywhere and revokes their API tokens. The current password keeps working until the new code is used.");
        await expectInsideWindow(page, confirm);
        await expectNoSidewaysScroll(page);
        await confirm.getByRole("button", { name: "Reset code", exact: true }).click();
        const handover = page.getByRole("dialog", { name: `Reset code for ${target}`, exact: true });
        await handover.getByLabel("I have handed over or stored the code").check();
        await handover.locator(".modal-actions").getByRole("button", { name: "Close", exact: true }).click();
        await expect(handover).toHaveCount(0);

        // What the dialog said: the other device is logged out, the token is revoked, the password still logs in.
        await device.reload();
        const login = device.getByRole("form", { name: "Log in to Ontotator" });
        await expect(login).toBeVisible();
        const tokens = await authenticatedRequest(page, "/api/v1/admin/tokens");
        expect((await tokens.json() as { id: number; revoked_reason: string | null }[]).find(token => token.id === tokenId)?.revoked_reason).toBe("reset_code");
        await login.getByLabel("Username", { exact: true }).fill(target);
        await login.getByLabel("Password", { exact: true }).fill(TEST_PASSWORD);
        await login.getByRole("button", { name: "Log in", exact: true }).click();
        await expect(device.getByTestId("current-user")).toContainText("Tara Target");
      } finally { await other.close(); }

      // A person who never set a password has no session to lose.
      await more(page, pending, "New setup code");
      const setup = page.getByRole("dialog", { name: "Issue a new setup code for Pia Pending?", exact: true });
      await expect(setup).toBeVisible();
      await shot(page, `A-setup-confirm-${size.name}`);
      await expect(setup).toContainText("The current setup code stops working. Any API tokens of the person are revoked.");
      await expect(setup).not.toContainText("logs the person out");
      await setup.getByRole("button", { name: "Cancel", exact: true }).click();
      expect(errors).toEqual([]);
    });
  });
}
