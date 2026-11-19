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
import { authenticatedRequest, clickLogOut, loginThroughForm, TEST_PASSWORD } from "./helpers";
import { leadScenario } from "./leadWorkflowHelpers";

test.setTimeout(120_000);
test.use({ actionTimeout: 15_000, permissions: ["clipboard-read", "clipboard-write"] });

const SIZES = [{ name: "1440", width: 1440, height: 900 }, { name: "390", width: 390, height: 844 }] as const;
const UNAUTHENTICATED = "Failed to load resource: the server responded with a status of 401 (Unauthorized)";
const REFUSED = "Failed to load resource: the server responded with a status of 409 (Conflict)";

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

    test("B: an administrator who takes the last lead away is told that the project will have no lead; a lead is refused", async ({ page }) => {
      const errors = collectErrors(page);
      const s = await leadScenario(page, "DEFAULT_IMPORT");
      const suffix = randomUUID().slice(0, 8);
      const admin = `lead-admin-${suffix}`;
      await createUser(page, { username: admin, pseudonym: admin, display_name: "Rita Admin", system_admin: "true" });
      const people = `/#/projects/${encodeURIComponent(s.project)}/settings/people`;
      const members = page.getByRole("region", { name: "Members", exact: true });
      const status = members.locator("p.settings-confirmation");
      const leads = async () => {
        const response = await authenticatedRequest(page, `/api/v1/projects/${encodeURIComponent(s.project)}/members`);
        expect(response.ok(), await response.text()).toBeTruthy();
        return (await response.json() as { username: string; roles: string[] }[]).filter(member => member.roles.includes("lead")).map(member => member.username);
      };

      // The project's only lead, who is no administrator: refused at once, before any confirmation (review 2, F7 d).
      await loginThroughForm(page, s.users.lead, s.display_names.lead);
      await page.goto(people);
      await members.getByRole("checkbox", { name: `${s.users.lead}: Lead`, exact: true }).click();
      await expect(members.getByRole("alert")).toContainText("Add another project lead before removing the last lead.");
      await expect(page.getByRole("dialog")).toHaveCount(0);
      await expect(members.getByRole("checkbox", { name: `${s.users.lead}: Lead`, exact: true })).toBeChecked();
      await shot(page, `B-lead-refused-${size.name}`);
      expect(await leads()).toEqual([s.users.lead]);
      await clickLogOut(page);
      await expect(page.getByRole("form", { name: "Log in to Ontotator" })).toBeVisible();

      // The administrator becomes the second lead, removes the first and then unticks their own Lead box.
      await loginThroughForm(page, admin, "Rita Admin");
      await page.goto(people);
      await members.getByRole("button", { name: "Add member…", exact: true }).click();
      const add = members.getByRole("form", { name: "Add member", exact: true });
      await add.getByRole("combobox", { name: /^Username/ }).fill(admin);
      await add.getByRole("checkbox", { name: "New member: Lead", exact: true }).check();
      await add.getByRole("button", { name: "Add member", exact: true }).click();
      await expect(status).toHaveText("Rita Admin is now Lead.");
      await add.getByRole("button", { name: "Close", exact: true }).click();

      // With a second lead in the project nothing warns; the other person may lose access.
      await members.getByRole("button", { name: "Remove Project Lead from the project", exact: true }).click();
      const otherRemoval = page.getByRole("dialog", { name: "Remove Project Lead from the project?", exact: true });
      await expect(otherRemoval).toContainText("Project Lead loses access to this project.");
      await expect(otherRemoval).not.toContainText("will have no lead");
      await otherRemoval.getByRole("button", { name: "Remove from project", exact: true }).click();
      await expect(status).toHaveText("Project Lead is no longer a member of this project.");

      await members.getByRole("checkbox", { name: `${admin}: Lead`, exact: true }).click();
      const lastLead = page.getByRole("dialog", { name: "Remove Rita Admin from the project?", exact: true });
      await expect(lastLead).toBeVisible();
      await shot(page, `B-last-lead-dialog-${size.name}`);
      await expect(lastLead.locator(".ui-dialog-body")).toHaveText("This project will have no lead. You can still manage it as system administrator. This logs Rita Admin out of Ontotator on all devices; they can log in again right away.");
      await expectInsideWindow(page, lastLead);
      await expectNoSidewaysScroll(page);
      await lastLead.getByRole("button", { name: "Remove from project", exact: true }).click();
      await expect(status).toHaveText("Rita Admin is no longer a member of this project.");
      // Up to here the only errors are the lead's refusal and the 401 of the log-out in between.
      expect(errors.filter(error => error !== REFUSED && error !== UNAUTHENTICATED)).toEqual([]);

      // As the dialog said: logged out, and after a new log-in the project without a lead is still theirs to manage.
      await loginThroughForm(page, admin, "Rita Admin");
      expect(await leads()).toEqual([]);
      await page.goto(people);
      await expect(members.getByRole("button", { name: "Add member…", exact: true })).toBeVisible();
      await shot(page, `B-no-lead-people-${size.name}`);
      await expectNoSidewaysScroll(page);
    });

    test("C: the new token cannot be left before it is stored; the tokens card points to the handbook for the MCP server", async ({ page }) => {
      const errors = collectErrors(page);
      const s = await leadScenario(page, "DEFAULT_IMPORT");
      await loginThroughForm(page, s.users.lead, s.display_names.lead);
      await page.goto(`/#/projects/${encodeURIComponent(s.project)}/settings/people`);

      /** New token… › Create token, then every way out of the dialog; returns once it is closed. */
      const createAndStore = async (card: Locator, name: string, label: string) => {
        await card.getByRole("button", { name: "New token…", exact: true }).click();
        await card.getByLabel(/^Token name/).fill(name);
        await card.getByRole("button", { name: "Create token", exact: true }).click();
        const dialog = page.getByRole("dialog", { name: `New token “${name}”`, exact: true });
        await expect(dialog).toBeVisible();
        await shot(page, `C-${label}-token-dialog-${size.name}`);
        const secret = await dialog.locator("code").first().innerText();
        expect(secret.length).toBeGreaterThan(20);
        const close = dialog.locator(".modal-actions").getByRole("button", { name: "Close", exact: true });
        const copy = dialog.getByRole("button", { name: "Copy token", exact: true });
        await expect(close).toBeDisabled();
        await expect(close).not.toHaveClass(/btn-primary/);
        await expect(copy).toHaveClass(/btn-primary/);
        await expect(dialog.locator(".ui-dialog-close")).toHaveCount(0);
        // Escape and a click outside leave the token on the screen.
        await page.keyboard.press("Escape");
        await page.mouse.click(4, 4);
        await page.keyboard.press("Escape");
        await expect(dialog.locator("code").first()).toHaveText(secret);
        await expectInsideWindow(page, dialog);
        await expectNoSidewaysScroll(page);
        await copy.click();
        await expect(dialog.getByRole("button", { name: "Copied", exact: true })).toBeVisible();
        expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(secret);
        // Copying alone does not open the way out: the box does.
        await expect(close).toBeDisabled();
        await dialog.getByLabel("I have stored the token").check();
        await shot(page, `C-${label}-token-stored-${size.name}`);
        await close.click();
        await expect(dialog).toHaveCount(0);
        await expect(page.getByText(secret)).toHaveCount(0);
        await expect(card.getByRole("table").getByRole("rowheader", { name, exact: true })).toBeVisible();
      };

      const project = page.getByRole("region", { name: "Project API tokens", exact: true });
      await createAndStore(project, "Progress report script", "project");
      const hint = project.getByText("Also for the Ontotator MCP server (AI assistant): see the handbook.", { exact: true });
      await expect(hint).toBeVisible();
      await hint.scrollIntoViewIfNeeded();
      await shot(page, `C-project-tokens-card-${size.name}`);
      await expectNoSidewaysScroll(page);
      const projectHelp = await hint.getByRole("link", { name: "see the handbook", exact: true }).getAttribute("href");

      // Profile › API tokens is the same dialog.
      await page.goto("/#/me");
      const personal = page.getByRole("region", { name: "API tokens", exact: true });
      await createAndStore(personal, "Laptop script", "personal");
      const personalHelp = await personal.getByRole("link", { name: "see the handbook", exact: true }).getAttribute("href");
      await expectNoSidewaysScroll(page);

      // Both links open the handbook section that names the MCP server.
      await page.goto(`/${projectHelp}`);
      await expect(page.getByRole("heading", { name: "Give a script access to the project", exact: true })).toBeInViewport();
      await expect(page.getByText("A project token is also the safest kind for the Ontotator MCP server")).toBeVisible();
      await page.goto(`/${personalHelp}`);
      await expect(page.getByRole("heading", { name: "Create an API token", exact: true })).toBeInViewport();
      expect(errors).toEqual([]);
    });
  });
}
