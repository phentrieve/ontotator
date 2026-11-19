/**
 * Administration › Users (issue 170): Edit, the administrator role, Reset code, Deactivate… / Activate, History (what
 * its Details say, issues 467 and 472, also on a phone) and Anonymise…. Creating a user and the setup-code handover are in admin.spec.ts.
 *
 * Every test has its own administrator and its own target account (``POST /__test_user__``, no project, no
 * assignments), found on the page through "Filter users": the table holds the accounts of every other spec too.
 */
import { randomUUID } from "node:crypto";
import { expect, test, type Locator, type Page, type Request } from "@playwright/test";
import { authenticatedRequest, loginThroughForm, openTasksHome, TEST_PASSWORD } from "./helpers";
import { leadScenario } from "./leadWorkflowHelpers";

test.setTimeout(120_000);
test.use({ actionTimeout: 15_000 });

interface Accounts { admin: string; target: string; pseudonym: string }
const DISPLAY_NAME = "Tara Target";

/** Console errors and page errors of the test. */
function collectErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on("console", message => { if (message.type() === "error") errors.push(message.text()); });
  page.on("pageerror", error => errors.push(String(error)));
  return errors;
}

/** A fresh administrator, logged in on Users with the table filtered to a fresh ordinary account. */
async function openUsers(page: Page): Promise<Accounts> {
  const suffix = randomUUID().slice(0, 8);
  const accounts = { admin: `users-admin-${suffix}`, target: `users-target-${suffix}`, pseudonym: `ann-users-${suffix}` };
  const admin = await page.request.post("/__test_user__", { params: { username: accounts.admin, pseudonym: accounts.admin, system_admin: "true", assign: "none" } });
  expect(admin.ok(), await admin.text()).toBeTruthy();
  const target = await page.request.post("/__test_user__", { params: { username: accounts.target, pseudonym: accounts.pseudonym, display_name: DISPLAY_NAME, assign: "none" } });
  expect(target.ok(), await target.text()).toBeTruthy();
  await loginThroughForm(page, accounts.admin, accounts.admin);
  await page.goto("/#/admin/users");
  await expect(page.getByRole("heading", { level: 1, name: "Users", exact: true })).toBeVisible();
  await page.getByLabel("Filter users", { exact: true }).fill(suffix);
  await expect(row(page, accounts.target)).toHaveCount(1);
  return accounts;
}

const table = (page: Page) => page.getByRole("table", { name: "Users", exact: true });
/** The row of ``username``: its first cell (Username) is exactly that. */
const row = (page: Page, username: string) => table(page).locator("tbody tr").filter({ has: page.locator("td:first-child").getByText(username, { exact: true }) });
/** The cell of ``column`` in the row of ``username`` (by the header's position, not a fixed index). */
async function cell(page: Page, username: string, column: string): Promise<Locator> {
  const headers = await table(page).getByRole("columnheader").allInnerTexts();
  const index = headers.findIndex(header => header.trim() === column);
  expect(index, `column ${column}`).toBeGreaterThanOrEqual(0);
  return row(page, username).getByRole("cell").nth(index);
}
async function more(page: Page, username: string, item: string) {
  await page.getByRole("button", { name: `More actions for ${username}`, exact: true }).click();
  await page.getByRole("menu", { name: `More actions for ${username}`, exact: true }).getByRole("menuitem", { name: item, exact: true }).click();
}
async function moreItems(page: Page, username: string): Promise<string[]> {
  await page.getByRole("button", { name: `More actions for ${username}`, exact: true }).click();
  const menu = page.getByRole("menu", { name: `More actions for ${username}`, exact: true });
  await expect(menu).toBeVisible();
  // An item can carry a description under its label: the first line is the label.
  const items = (await menu.getByRole("menuitem").allInnerTexts()).map(text => text.split("\n")[0].trim());
  await page.keyboard.press("Escape");
  await expect(menu).toHaveCount(0);
  return items;
}
/** The "What" entries of the account's history, as the History dialog lists them (newest first). */
async function historyOf(page: Page, username: string, open: () => Promise<void>): Promise<string[]> {
  await open();
  const dialog = page.getByRole("dialog", { name: `History of ${username}`, exact: true });
  const history = dialog.getByRole("table", { name: "History", exact: true });
  await expect(history).toBeVisible();
  const headers = await history.getByRole("columnheader").allInnerTexts();
  const what = headers.findIndex(header => header.trim() === "What"), details = headers.findIndex(header => header.trim() === "Details");
  const entries: string[] = [];
  for (const line of await history.locator("tbody tr").all()) {
    const cells = await line.getByRole("cell").allInnerTexts();
    entries.push(`${cells[what].trim()}: ${cells[details].trim()}`);
  }
  await dialog.getByRole("button", { name: "Close", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  return entries;
}
/** The account as the server lists it for administrators. */
async function serverUser(page: Page, username: string): Promise<Record<string, unknown> | undefined> {
  const response = await authenticatedRequest(page, "/api/v1/admin/users/");
  expect(response.ok(), await response.text()).toBeTruthy();
  return (await response.json() as Record<string, unknown>[]).find(user => user.username === username);
}
/** The API requests of the page that have no answer yet (call before the page makes them). */
function openRequests(page: Page): Set<Request> {
  const open = new Set<Request>();
  page.on("request", request => { if (new URL(request.url()).pathname.startsWith("/api/")) open.add(request); });
  page.on("requestfinished", request => open.delete(request));
  page.on("requestfailed", request => open.delete(request));
  return open;
}
/**
 * Logs out once every request of the page has its answer. Right after a log-in the home page still reads the tasks;
 * logging out while that request is on its way lets the server answer it with 401, which the browser reports as a
 * console error. (``waitForLoadState("networkidle")`` does not wait here: the app never navigates.)
 */
async function logout(page: Page, open: Set<Request>) {
  await expect.poll(() => open.size).toBe(0);
  await page.getByRole("button", { name: "Log out", exact: true }).click();
  await expect(page.getByRole("form", { name: "Log in to Ontotator" })).toBeVisible();
}

test("Edit: name, e-mail, qualification and languages are saved; the administrator role asks first", async ({ page }) => {
  const errors = collectErrors(page);
  const { admin, target } = await openUsers(page);
  await page.getByRole("button", { name: `Edit ${target}`, exact: true }).click();
  const dialog = page.getByRole("dialog", { name: `Edit ${target}`, exact: true });
  const edit = dialog.getByRole("form", { name: "Edit user", exact: true });
  await expect(edit.getByLabel(/^Display name/)).toHaveValue(DISPLAY_NAME);
  await edit.getByLabel(/^Display name/).fill("Tara Renamed");
  await edit.getByLabel("E-mail", { exact: true }).fill("tara@example.org");
  await edit.getByLabel("Qualification", { exact: true }).fill("Physician");
  const languages = edit.getByRole("combobox", { name: "Languages", exact: true });
  await languages.fill("de");
  await languages.press("Enter");
  await edit.getByRole("button", { name: "Save changes", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(await cell(page, target, "Display name")).toHaveText("Tara Renamed");
  await expect(await cell(page, target, "Languages")).toHaveText("de");
  expect(await serverUser(page, target)).toMatchObject({ display_name: "Tara Renamed", email: "tara@example.org", qualification: "Physician", languages: ["de"], is_system_admin: false });

  // A second change of the languages, for the history below: French for German.
  expect((await authenticatedRequest(page, `/api/v1/admin/users/${target}`, "PATCH", { languages: ["fr"] })).ok()).toBeTruthy();

  // Cancel keeps the saved values.
  await page.getByRole("button", { name: `Edit ${target}`, exact: true }).click();
  await edit.getByLabel(/^Display name/).fill("Not kept");
  await edit.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(await cell(page, target, "Display name")).toHaveText("Tara Renamed");

  // The administrator role: a confirmation says what it does; Cancel there saves nothing.
  await page.getByRole("button", { name: `Edit ${target}`, exact: true }).click();
  await edit.getByRole("checkbox", { name: "System administrator", exact: true }).check();
  await edit.getByRole("button", { name: "Save changes", exact: true }).click();
  const confirm = page.getByRole("dialog", { name: "Change administrator role", exact: true });
  await expect(confirm).toContainText("This logs the user out everywhere. Their API tokens keep working.");
  await confirm.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(confirm).toHaveCount(0);
  expect((await serverUser(page, target))?.is_system_admin).toBe(false);
  await edit.getByRole("button", { name: "Save changes", exact: true }).click();
  await confirm.getByRole("button", { name: "Save changes", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(await cell(page, target, "Admin")).toHaveText("Admin");
  expect((await serverUser(page, target))?.is_system_admin).toBe(true);

  // An administrator cannot take the role from their own account.
  await page.getByLabel("Filter users", { exact: true }).fill(admin);
  await page.getByRole("button", { name: `Edit ${admin}`, exact: true }).click();
  await expect(page.getByRole("dialog", { name: `Edit ${admin}`, exact: true }).getByRole("checkbox", { name: "System administrator", exact: true })).toBeDisabled();
  await page.getByRole("dialog", { name: `Edit ${admin}`, exact: true }).getByRole("button", { name: "Cancel", exact: true }).click();
  expect(await moreItems(page, admin)).not.toContain("Deactivate…");

  // History names each change, newest first.
  await page.getByLabel("Filter users", { exact: true }).fill(target);
  const history = await historyOf(page, target, () => more(page, target, "History"));
  expect(history[0]).toBe("Administrator role changed: Granted");
  // A language change says which languages were added and removed (#467).
  expect(history).toContain("Languages changed: Added: de.");
  expect(history).toContain("Languages changed: Added: fr. Removed: de.");
  expect(history.some(entry => entry.startsWith("Profile changed: "))).toBe(true);
  expect(history[history.length - 1]).toMatch(/^Account created: /);
  expect(errors).toEqual([]);
});

for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 844 }]) {
  test(`History at ${viewport.width} px: a settings change has the names of the settings page and the values; Details is wide enough to read`, async ({ page }) => {
    const errors = collectErrors(page);
    await page.setViewportSize(viewport);
    // A fresh project (never another spec's), whose settings the administrator changes.
    const s = await leadScenario(page, "DEFAULT_IMPORT");
    const { admin } = await openUsers(page);
    const changed = await authenticatedRequest(page, `/api/v1/projects/${encodeURIComponent(s.project)}/settings`, "PATCH", { blind_consolidation: true, annotations_per_text: 2 });
    expect(changed.ok(), await changed.text()).toBeTruthy();

    await more(page, admin, "History");
    const dialog = page.getByRole("dialog", { name: `History of ${admin}`, exact: true });
    const line = dialog.getByRole("table", { name: "History", exact: true }).locator("tbody tr").filter({ hasText: "Project settings changed" });
    await expect(line).toHaveCount(1);
    const details = line.locator(".audit-details");
    await expect(details).toHaveText("Annotators per text: 1 → 2; Hide annotator names during consolidation: off → on");

    // Details keeps a readable width (it was about 80 px on a phone, #472), no word is broken, and the page does not scroll sideways.
    await details.scrollIntoViewIfNeeded();
    const layout = await details.evaluate(element => {
      const text = element.firstChild as Text, broken: string[] = [];
      for (const word of text.data.matchAll(/\S+/g)) {
        const range = document.createRange();
        range.setStart(text, word.index); range.setEnd(text, word.index + word[0].length);
        if (range.getClientRects().length > 1) broken.push(word[0]);
      }
      const box = element.getBoundingClientRect();
      return { width: box.width, left: box.left, right: box.right, broken, pageScroll: document.documentElement.scrollWidth - document.documentElement.clientWidth };
    });
    expect(layout.width).toBeGreaterThanOrEqual(220);
    expect(layout.broken).toEqual([]);
    expect(layout.pageScroll).toBeLessThanOrEqual(0);
    // After scrolling the table, the whole cell is on the screen.
    expect(layout.left).toBeGreaterThanOrEqual(0);
    expect(layout.right).toBeLessThanOrEqual(viewport.width);
    expect(errors).toEqual([]);
  });
}

test("Deactivate… logs the person out and refuses their log-in; Activate lets them in again", async ({ page, browser }) => {
  const errors = collectErrors(page);
  const { target } = await openUsers(page);
  // The target is logged in on another device.
  const other = await browser.newContext({ baseURL: test.info().project.use.baseURL });
  const device = await other.newPage();
  try {
    await loginThroughForm(device, target, DISPLAY_NAME);
    expect(await moreItems(page, target)).toEqual(["Reset code", "Deactivate…", "History"]);

    await more(page, target, "Deactivate…");
    const confirm = page.getByRole("dialog", { name: `Deactivate ${target}`, exact: true });
    await expect(confirm).toContainText("This logs the user out everywhere and revokes their API tokens.");
    await confirm.getByRole("button", { name: "Cancel", exact: true }).click();
    await expect(confirm).toHaveCount(0);
    expect((await serverUser(page, target))?.active).toBe(true);

    await more(page, target, "Deactivate…");
    await confirm.getByRole("button", { name: "Deactivate", exact: true }).click();
    await expect(page.getByText(`${target} is deactivated.`, { exact: true })).toBeVisible();
    await expect(await cell(page, target, "Active")).toHaveText("No");
    expect((await serverUser(page, target))?.active).toBe(false);
    // A deactivated account gets no code; it can be activated or anonymised.
    expect(await moreItems(page, target)).toEqual(["Activate", "History", "Anonymise…"]);

    // The other device: the session is gone, and the password no longer logs in.
    await device.reload();
    const login = device.getByRole("form", { name: "Log in to Ontotator" });
    await expect(login).toBeVisible();
    await login.getByLabel("Username", { exact: true }).fill(target);
    await login.getByLabel("Password", { exact: true }).fill(TEST_PASSWORD);
    await login.getByRole("button", { name: "Log in", exact: true }).click();
    await expect(device.getByRole("alert")).toBeVisible();
    await expect(device.getByTestId("current-user")).toHaveCount(0);

    await more(page, target, "Activate");
    await expect(page.getByText(`${target} is active again.`, { exact: true })).toBeVisible();
    await expect(await cell(page, target, "Active")).toHaveText("Yes");
    await login.getByRole("button", { name: "Log in", exact: true }).click();
    await expect(device.getByTestId("current-user")).toContainText(DISPLAY_NAME);

    const history = await historyOf(page, target, () => more(page, target, "History"));
    expect(history.slice(0, 2)).toEqual(["Activation changed: Activated", "Activation changed: Deactivated"]);
  } finally { await other.close(); }
  expect(errors).toEqual([]);
});

test("Reset code: the code is shown once and sets a new password; the old one stops working", async ({ page }) => {
  const errors = collectErrors(page);
  const open = openRequests(page);
  const { target } = await openUsers(page);
  await more(page, target, "Reset code");
  const confirm = page.getByRole("dialog", { name: `Issue a new reset code for ${DISPLAY_NAME}?`, exact: true });
  await expect(confirm).toContainText("Any unused code stops working. This logs the person out everywhere and revokes their API tokens. The current password keeps working until the new code is used.");
  await confirm.getByRole("button", { name: "Reset code", exact: true }).click();
  const handover = page.getByRole("dialog", { name: `Reset code for ${target}`, exact: true });
  const code = await handover.locator("code").innerText();
  expect(code.length).toBeGreaterThan(0);
  // The dialog closes only after the acknowledgement.
  const close = handover.locator(".modal-actions").getByRole("button", { name: "Close", exact: true });
  await expect(close).toBeDisabled();
  await handover.getByLabel("I have handed over or stored the code").check();
  await close.click();
  await expect(handover).toHaveCount(0);
  const history = await historyOf(page, target, () => more(page, target, "History"));
  expect(history[0]).toMatch(/^New sign-in code issued: /);
  await logout(page, open);

  // The person redeems the code with a new password.
  const password = "another browser test passphrase";
  await openTasksHome(page);
  await page.getByRole("button", { name: "I have a setup or reset code" }).click();
  const setup = page.getByRole("form", { name: "Set your password" });
  await setup.getByLabel("Username", { exact: true }).fill(target);
  await setup.getByLabel("Setup or reset code").fill(code);
  await setup.getByLabel("New password", { exact: true }).fill(password);
  await setup.getByLabel("Repeat the new password").fill(password);
  await setup.getByRole("button", { name: "Set password and log in" }).click();
  await expect(page.getByTestId("current-user")).toContainText(DISPLAY_NAME);
  await logout(page, open);
  expect(errors).toEqual([]);

  // The old password is refused, the new one logs in.
  const login = page.getByRole("form", { name: "Log in to Ontotator" });
  await login.getByLabel("Username", { exact: true }).fill(target);
  await login.getByLabel("Password", { exact: true }).fill(TEST_PASSWORD);
  await login.getByRole("button", { name: "Log in", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("Username or password is wrong");
  await login.getByLabel("Password", { exact: true }).fill(password);
  await login.getByRole("button", { name: "Log in", exact: true }).click();
  await expect(page.getByTestId("current-user")).toContainText(DISPLAY_NAME);
});

test("Anonymise…: only for a deactivated account, after typing its username; name and username are erased, the history stays", async ({ page }) => {
  const errors = collectErrors(page);
  const { target, pseudonym } = await openUsers(page);
  const before = await serverUser(page, target) as { id: number; pseudonym: string };
  expect(before.pseudonym).toBe(pseudonym);
  // An active account cannot be anonymised.
  expect(await moreItems(page, target)).not.toContain("Anonymise…");
  await more(page, target, "Deactivate…");
  await page.getByRole("dialog", { name: `Deactivate ${target}`, exact: true }).getByRole("button", { name: "Deactivate", exact: true }).click();
  await expect(page.getByText(`${target} is deactivated.`, { exact: true })).toBeVisible();

  await more(page, target, "Anonymise…");
  const dialog = page.getByRole("dialog", { name: `Anonymise ${target}`, exact: true });
  await expect(dialog).toContainText("It cannot be undone.");
  const confirm = dialog.getByRole("button", { name: "Anonymise permanently", exact: true });
  await expect(confirm).toBeDisabled();
  await dialog.getByLabel(`Type ${target} to confirm`, { exact: true }).fill(`${target}-x`);
  await expect(confirm).toBeDisabled();
  await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  expect((await serverUser(page, target))?.anonymised).toBe(false);

  await more(page, target, "Anonymise…");
  await dialog.getByLabel(`Type ${target} to confirm`, { exact: true }).fill(target);
  await confirm.click();
  await expect(dialog).toHaveCount(0);
  const after = (await authenticatedRequest(page, "/api/v1/admin/users/").then(response => response.json()) as Record<string, unknown>[]).find(user => user.id === before.id)!;
  const anonymous = after.username as string;
  expect(anonymous).not.toBe(target);
  expect(after).toMatchObject({ anonymised: true, active: false, pseudonym: before.pseudonym, email: null, qualification: null, languages: [] });
  expect(JSON.stringify(after)).not.toContain(DISPLAY_NAME);
  await expect(page.getByText(`${target} is now ${anonymous}.`, { exact: true })).toBeVisible();

  // The row carries the anonymous username now: no name, "Anonymised", and History as its only action.
  await page.getByLabel("Filter users", { exact: true }).fill(anonymous);
  await expect(row(page, anonymous)).toHaveCount(1);
  await expect(row(page, target)).toHaveCount(0);
  await expect(await cell(page, anonymous, "Active")).toHaveText("Anonymised");
  await expect(await cell(page, anonymous, "Pseudonym")).toHaveText(pseudonym);
  await expect(row(page, anonymous)).not.toContainText(DISPLAY_NAME);
  await expect(row(page, anonymous).getByRole("button")).toHaveText(["History"]);
  const history = await historyOf(page, anonymous, () => page.getByRole("button", { name: `History of ${anonymous}`, exact: true }).click());
  expect(history[0]).toMatch(/^Personal data erased: /);
  expect(history.join("\n")).not.toContain(target);
  expect(errors).toEqual([]);
});

test("with 1,500 more accounts the table shows the first 100, New user opens and Show all lists every account", async ({ page }) => {
  // At the end of the browser suite the fixture server holds about 2,000 accounts. The rendered table grew with
  // them until clicking New user… took longer than the action timeout (CI, handbook-screenshots.spec.ts).
  const extra = 1_500;
  await page.route("**/api/v1/admin/users/", async route => {
    const response = await route.fetch();
    const users = await response.json() as Record<string, unknown>[];
    const added = Array.from({ length: extra }, (_, index) => ({ ...users[0], id: 9_000_000 + index, username: `bulk-${index}`,
      display_name: `Bulk ${index}`, pseudonym: `bulk-${index}`, is_system_admin: false, anonymised: false, active: true,
      projects: [{ project_key: "bulk-project", project_name: "Bulk project", roles: ["lead", "annotator"] }] }));
    await route.fulfill({ response, json: [...users, ...added] });
  });
  const errors = collectErrors(page);
  const suffix = randomUUID().slice(0, 8);
  const admin = `users-many-${suffix}`;
  expect((await page.request.post("/__test_user__", { params: { username: admin, pseudonym: admin, system_admin: "true", assign: "none" } })).ok()).toBeTruthy();
  await loginThroughForm(page, admin, admin);
  await page.goto("/#/admin/users");
  const total = (await (await authenticatedRequest(page, "/api/v1/admin/users/")).json() as unknown[]).length + extra;
  await expect(table(page)).toContainText(`The first 100 of ${total} users are shown.`);
  await expect(table(page).locator("tbody tr.users-row")).toHaveCount(100);
  // What the page costs stays bounded: before, every account was a row (about 37 elements each).
  expect(await page.evaluate(() => document.getElementsByTagName("*").length)).toBeLessThan(10_000);
  await page.getByRole("button", { name: "New user…", exact: true }).click();
  const create = page.getByRole("form", { name: "New user" });
  await create.getByLabel(/^Username/).fill(`lena-${suffix}`);
  await expect(create.getByLabel(/^Username/)).toHaveValue(`lena-${suffix}`);
  await create.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(create).toHaveCount(0);
  // Filter users searches every account, also those after the first 100.
  await page.getByLabel("Filter users", { exact: true }).fill("bulk-1499");
  await expect(table(page).locator("tbody tr.users-row")).toHaveCount(1);
  await page.getByLabel("Filter users", { exact: true }).fill("");
  await page.getByRole("button", { name: `Show all ${total}`, exact: true }).click();
  await expect(table(page).locator("tbody tr.users-row")).toHaveCount(total);
  expect(errors).toEqual([]);
});
