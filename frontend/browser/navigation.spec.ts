/**
 * Navigation (issue 510): the user menu at the top right, Administration as its own area behind the gear, New
 * project on the Projects page, and a work sidebar that holds only work. At 1440 px and at 390 px, and in the
 * editor, where the sidebar folds into Sections.
 *
 * Every test builds its own project through the guideline scenario route of tests/browser_server.py (a lead, the
 * annotator "ana" with an open task) and its own administrator. Dark screenshots of the header, the menus and the
 * Administration sidebar are saved to build/navigation/evidence for human review (never baselines).
 */
import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Locator, type Page } from "@playwright/test";
import { guidelineScenario, loginGuidelineUser, type GuidelineScenario } from "./guidelineHelpers";
import { administrationGear, authenticatedRequest, chooseUserMenu, clickLogOut, loginExisting, moreAction, openAdministration, openUserMenu, userMenuButton } from "./helpers";

test.setTimeout(180_000);
test.use({ actionTimeout: 15_000 });

const WIDE = { name: "1440", width: 1440, height: 900 };
const PHONE = { name: "390", width: 390, height: 844 };
const SIZES = [WIDE, PHONE];

const evidenceDir = () => resolve(test.info().config.rootDir, "../../build/navigation/evidence");
async function evidence(page: Page, name: string, part?: Locator) {
  mkdirSync(evidenceDir(), { recursive: true });
  const path = resolve(evidenceDir(), `${name}.png`);
  if (part) await part.screenshot({ path }); else await page.screenshot({ path });
}

/** A fresh system administrator without any project role, logged in on My tasks. */
async function loginAdministrator(page: Page): Promise<string> {
  const username = `nav-admin-${randomUUID().slice(0, 8)}`;
  const created = await page.request.post("/__test_user__", { params: { username, pseudonym: username, system_admin: "true", assign: "none" } });
  expect(created.ok(), await created.text()).toBeTruthy();
  await loginExisting(page, username);
  return username;
}

/** The address of one text of the project in the editor (the reading shell), as a lead or administrator opens it. */
async function caseAddress(page: Page, project: string): Promise<string> {
  const response = await authenticatedRequest(page, `/api/v1/projects/${encodeURIComponent(project)}/documents`);
  expect(response.ok(), await response.text()).toBeTruthy();
  const [text] = await response.json() as Array<{ document_id: string; case_id: string }>;
  expect(text?.case_id).toBeTruthy();
  return `/#/projects/${encodeURIComponent(project)}/cases/${encodeURIComponent(text.case_id)}?variant=${encodeURIComponent(text.document_id)}`;
}

const workSidebar = (page: Page) => page.getByRole("navigation", { name: "Sections", exact: true });
const adminSidebar = (page: Page) => page.getByRole("navigation", { name: "Administration", exact: true });
/** The link texts of a sidebar, with the count after My tasks removed. */
const entries = async (nav: Locator) => (await nav.getByRole("link").allTextContents()).map(text => text.trim().replace(/ \(\d+\)$/, ""));
const menuEntries = async (page: Page) => (await openUserMenu(page)).locator("[role^=menuitem]").allTextContents();
const MENU = ["Profile", "My technical reports", "Technical problem…", "System", "Light", "Dark", "Log out"];

/** Serious accessibility findings of the header and an open menu. */
async function axe(page: Page, ...include: string[]): Promise<string[]> {
  let builder = new AxeBuilder({ page });
  for (const selector of include) builder = builder.include(selector);
  const results = await builder.analyze();
  return results.violations.map(violation => `${violation.id}: ${violation.nodes.map(node => node.target.join(" ")).join("; ")}`);
}

/** Nothing sticks out of the window: no horizontal scrolling. */
const fitsWindow = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);

for (const size of SIZES) {
  test.describe(`${size.name} px`, () => {
    test.use({ viewport: { width: size.width, height: size.height } });

    test("a member sees two sidebar entries, the project switcher and the user menu; the menu leads to the right pages", async ({ page }) => {
      const s = await guidelineScenario(page, "PUBLISHED");
      await loginGuidelineUser(page, s, "ana");
      const nav = workSidebar(page);
      await expect(nav.getByRole("link", { name: /^My tasks \(\d+\)$/ })).toBeVisible();
      expect(await entries(nav)).toEqual(["My tasks", "Projects"]);
      await expect(nav.locator(".project-switcher")).toBeVisible();
      await expect(nav.getByRole("button")).toHaveCount(1);
      await expect(administrationGear(page)).toHaveCount(0);

      // Menu button pattern: closed at first, ArrowDown opens at the first item, Escape closes, focus returns.
      const button = userMenuButton(page);
      await expect(button).toHaveAccessibleName(`User menu: ${s.display_names.ana} (${s.pseudonyms.ana}), Annotator`);
      await expect(button).toHaveAttribute("aria-haspopup", "menu");
      await expect(button).toHaveAttribute("aria-expanded", "false");
      await button.focus();
      await page.keyboard.press("ArrowDown");
      const menu = page.getByRole("menu", { name: /^User menu/ });
      await expect(menu.getByRole("menuitem", { name: "Profile", exact: true })).toBeFocused();
      await expect(button).toHaveAttribute("aria-expanded", "true");
      expect(await menuEntries(page)).toEqual(MENU);
      const box = (await menu.boundingBox())!;
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width).toBeLessThanOrEqual(size.width);
      expect(await axe(page, ".shell-header", ".ui-menu")).toEqual([]);
      await page.keyboard.press("ArrowUp");
      await expect(menu.getByRole("menuitem", { name: "Log out", exact: true })).toBeFocused();
      await page.keyboard.press("Escape");
      await expect(menu).toHaveCount(0);
      await expect(button).toBeFocused();

      // Profile and Log out are in this one menu; the items lead to the right pages.
      await chooseUserMenu(page, "Profile");
      await expect(page).toHaveURL(/#\/me$/);
      await expect(page.getByRole("heading", { name: "Profile", level: 1 })).toBeVisible();
      await chooseUserMenu(page, "My technical reports");
      await expect(page).toHaveURL(/#\/me\?section=technical-reports$/);
      await expect(page.getByRole("heading", { name: "My technical reports" })).toBeInViewport();
      // Already on Profile, scrolled away: the entry scrolls the section back into view.
      await page.getByRole("heading", { name: "Profile", level: 1 }).scrollIntoViewIfNeeded();
      await page.locator(".shell-header").scrollIntoViewIfNeeded();
      await chooseUserMenu(page, "My technical reports");
      await expect(page.getByRole("heading", { name: "My technical reports" })).toBeInViewport();
      await chooseUserMenu(page, "Technical problem…");
      const dialog = page.getByRole("dialog", { name: "Report a technical problem" });
      await expect(dialog).toBeVisible();
      await dialog.getByRole("button", { name: "Cancel" }).click();
      await expect(dialog).toHaveCount(0);

      // The theme: chosen in the menu, applied at once, the menu stays open; Profile › Appearance shows the same.
      const open = await openUserMenu(page);
      await expect(open.getByRole("group", { name: "Theme" }).getByRole("menuitemradio", { name: "System" })).toHaveAttribute("aria-checked", "true");
      await open.getByRole("menuitemradio", { name: "Dark" }).click();
      await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
      await expect(open.getByRole("menuitemradio", { name: "Dark" })).toHaveAttribute("aria-checked", "true");
      await expect(page.locator("#theme-choice")).toHaveValue("dark");
      await open.getByRole("menuitemradio", { name: "System" }).click();
      await expect(page.locator("html")).not.toHaveAttribute("data-theme", /.*/);
      await page.keyboard.press("Escape");
      expect(await fitsWindow(page)).toBe(true);

      // An administration address opened by a member: an explanation, the work sidebar, no gear.
      await page.goto("/#/admin/ontologies");
      await expect(page.getByRole("main")).toContainText("system administrator");
      await expect(adminSidebar(page)).toHaveCount(0);
      expect(await entries(workSidebar(page))).toEqual(["My tasks", "Projects"]);
      await page.goto("/#/projects");
      await expect(page.getByRole("heading", { name: "Projects", level: 1 })).toBeVisible();
      await expect(page.getByRole("link", { name: "New project", exact: true })).toHaveCount(0);

      await clickLogOut(page);
      await expect(page.getByRole("form", { name: "Log in to Ontotator" })).toBeVisible();
    });

    test("a lead sees the pages of the current project under the two entries, and no gear", async ({ page }) => {
      const s = await guidelineScenario(page, "PUBLISHED");
      await loginGuidelineUser(page, s, "lead");
      await page.goto(`/#/projects/${encodeURIComponent(s.project)}/progress`);
      const nav = workSidebar(page);
      await expect(nav.getByRole("link", { name: "Progress", exact: true })).toHaveAttribute("aria-current", "page");
      expect((await entries(nav)).map(text => text.replace(/ \(\d+\)$/, ""))).toEqual(["My tasks", "Projects", "Documents", "Progress", "Settings", "Export"]);
      await expect(administrationGear(page)).toHaveCount(0);
      expect(await menuEntries(page)).toEqual(MENU);
      await page.keyboard.press("Escape");
      await page.goto("/#/projects");
      await expect(page.getByRole("heading", { name: "Projects", level: 1 })).toBeVisible();
      await expect(page.getByRole("link", { name: "New project", exact: true })).toHaveCount(0);
      expect(await fitsWindow(page)).toBe(true);
    });

    test("an administrator reaches every administration page from the gear; old addresses work; New project is on Projects", async ({ page }) => {
      await loginAdministrator(page);
      // No administration entry is left in the work sidebar.
      expect(await entries(workSidebar(page))).toEqual(["My tasks", "Projects"]);
      await expect(page.getByRole("region", { name: "Administration" })).toHaveCount(0);
      expect(await menuEntries(page)).toEqual(MENU);
      await page.keyboard.press("Escape");

      const gear = administrationGear(page);
      await expect(gear).toHaveAttribute("href", "#/admin/users");
      await openAdministration(page);
      await expect(page).toHaveURL(/#\/admin\/users$/);
      await expect(gear).toHaveAttribute("aria-current", "location");
      await expect(workSidebar(page)).toHaveCount(0);
      const nav = adminSidebar(page);
      expect(await entries(nav)).toEqual(["Back to Projects", "Users", "Ontologies", "Technical reports", "Server settings"]);
      await expect(nav.getByRole("button")).toHaveCount(0);
      expect(await axe(page, ".shell-header", ".app-nav")).toEqual([]);
      const pages: Array<[string, RegExp, string]> = [
        ["Ontologies", /#\/admin\/ontologies$/, "Ontologies"],
        ["Technical reports", /#\/admin\/reports$/, "Technical reports"],
        ["Server settings", /#\/admin\/settings$/, "Server settings"],
        ["Users", /#\/admin\/users$/, "Users"],
      ];
      for (const [link, url, heading] of pages) {
        await nav.getByRole("link", { name: new RegExp(`^${link}`) }).click();
        await expect(page).toHaveURL(url);
        await expect(page.getByRole("heading", { name: heading, level: 1 })).toBeVisible();
        await expect(nav.getByRole("link", { name: new RegExp(`^${link}`) })).toHaveAttribute("aria-current", "page");
        expect(await fitsWindow(page)).toBe(true);
      }
      // The user menu is the same in this area.
      await chooseUserMenu(page, "Profile");
      await expect(page).toHaveURL(/#\/me$/);
      await expect(adminSidebar(page)).toHaveCount(0);

      // The old addresses of the administration pages open the same pages, in the area.
      for (const [hash, heading] of [["#/admin/users", "Users"], ["#/admin/ontologies", "Ontologies"], ["#/admin/reports", "Technical reports"], ["#/admin/settings", "Server settings"]]) {
        await page.goto("about:blank");
        await page.goto(`/${hash}`);
        await expect(page.getByRole("heading", { name: heading, level: 1 })).toBeVisible();
        await expect(adminSidebar(page).locator("[aria-current=page]")).toHaveText(new RegExp(`^${heading}`));
      }

      // Back to Projects; New project is a button there and opens the old address of the form.
      await adminSidebar(page).getByRole("link", { name: "Back to Projects", exact: true }).click();
      await expect(page).toHaveURL(/#\/projects$/);
      await expect(page.getByRole("heading", { name: "Projects", level: 1 })).toBeVisible();
      await expect(page.getByRole("heading", { name: "Project archives" })).toBeVisible();
      await expect(workSidebar(page).getByRole("link", { name: "Projects", exact: true })).toHaveAttribute("aria-current", "page");
      expect(await fitsWindow(page)).toBe(true);
      await page.getByRole("link", { name: "New project", exact: true }).click();
      await expect(page).toHaveURL(/#\/projects\/new$/);
      await expect(page.getByLabel(/^Project key/)).toBeVisible();
      await page.goto("about:blank");
      await page.goto("/#/projects/new");
      await expect(page.getByLabel(/^Project key/)).toBeVisible();
    });

    test("the header keeps its layout when the counts arrive", async ({ page }) => {
      await loginAdministrator(page);
      const gear = administrationGear(page);
      const button = userMenuButton(page);
      await expect(workSidebar(page).getByRole("link", { name: /^My tasks \(\d+\)$/ })).toBeVisible();
      const before = [await gear.boundingBox(), await button.boundingBox(), await page.locator(".shell-header").boundingBox()];
      // A report arrives: the gear carries the count of open reports.
      const sent = await authenticatedRequest(page, "/api/v1/technical-reports", "POST", { request_id: randomUUID(), description: "Navigation spec: an invented report." });
      expect(sent.ok(), await sent.text()).toBeTruthy();
      await page.evaluate(() => window.dispatchEvent(new Event("focus")));
      await expect(gear).toHaveAccessibleName(/^Administration, \d+ open technical reports$/);
      await expect(gear.locator(".shell-admin-count")).toBeVisible();
      expect([await gear.boundingBox(), await button.boundingBox(), await page.locator(".shell-header").boundingBox()]).toEqual(before);
      await openAdministration(page);
      await expect(adminSidebar(page).getByRole("link", { name: /^Technical reports, \d+ open$/ })).toBeVisible();
    });

    test("in the editor the user menu, More and Sections are reachable", async ({ page }) => {
      const s = await guidelineScenario(page, "PUBLISHED");
      await loginGuidelineUser(page, s, "ana");
      await page.goto(`/#/tasks/${s.assignments["annotate-1"]}`);
      await expect(page.locator(".case-toolbar [role=status]")).toBeVisible();
      const header = page.locator(".shell-header");
      const button = userMenuButton(page);
      await expect(button).toBeInViewport();
      if (size === PHONE) await expect(button.locator(".shell-user-initials")).toBeVisible();
      else await expect(button.getByTestId("current-user")).toBeVisible();
      expect((await header.boundingBox())!.height).toBeLessThanOrEqual(80);
      expect(await menuEntries(page)).toEqual(MENU);
      expect(await axe(page, ".shell-header", ".ui-menu")).toEqual([]);
      await page.keyboard.press("Escape");
      await expect(button).toBeFocused();

      // The sidebar is folded into Sections: the work entries only.
      await header.locator(".shell-reading-navigation > summary").click();
      const nav = workSidebar(page);
      await expect(nav).toBeVisible();
      expect((await entries(nav)).filter(text => text !== "Handbook")).toEqual(["My tasks", "Projects"]);
      await expect(nav.locator(".project-switcher")).toBeVisible();
      await page.keyboard.press("Escape");

      // Technical problem… stays one click away in More.
      await moreAction(page, "Report a technical problem…");
      const dialog = page.getByRole("dialog", { name: "Report a technical problem" });
      await expect(dialog).toBeVisible();
      await dialog.getByRole("button", { name: "Cancel" }).click();
      // And in the user menu; My technical reports leaves the editor for Profile.
      await chooseUserMenu(page, "Technical problem…");
      await expect(dialog).toBeVisible();
      await dialog.getByRole("button", { name: "Cancel" }).click();
      await chooseUserMenu(page, "My technical reports");
      await expect(page).toHaveURL(/#\/me\?section=technical-reports$/);
    });

    test("an administrator has the gear in the editor too", async ({ page }) => {
      const s = await guidelineScenario(page, "PUBLISHED");
      const admin = await loginAdministrator(page);
      expect(admin).toBeTruthy();
      await page.goto(await caseAddress(page, s.project));
      await expect(page.locator(".shell.shell-reading")).toBeVisible();
      const gear = administrationGear(page);
      await expect(gear).toBeInViewport();
      await expect(userMenuButton(page)).toBeInViewport();
      // One row: the gear and the user menu line up.
      const [a, b] = [await gear.boundingBox(), await userMenuButton(page).boundingBox()];
      expect(Math.abs((a!.y + a!.height / 2) - (b!.y + b!.height / 2))).toBeLessThan(8);
      expect(await fitsWindow(page)).toBe(true);
      await openAdministration(page);
      await expect(page).toHaveURL(/#\/admin\/users$/);
    });
  });
}

test.describe("dark, emulated", () => {
  test.use({ colorScheme: "dark" });

  async function shots(page: Page, s: GuidelineScenario, name: string) {
    await evidence(page, `header-${name}`, page.locator(".shell-header"));
    const menu = await openUserMenu(page);
    expect(await axe(page, ".shell-header", ".ui-menu")).toEqual([]);
    await evidence(page, `user-menu-${name}`);
    await menu.getByRole("menuitemradio", { name: "Light" }).hover();
    await page.keyboard.press("Escape");
    await openAdministration(page);
    await expect(page.getByRole("heading", { name: "Users", level: 1 })).toBeVisible();
    expect(await axe(page, ".shell-header", ".app-nav")).toEqual([]);
    await evidence(page, `administration-${name}`);
    await page.getByRole("link", { name: "Back to Projects", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Projects", level: 1 })).toBeVisible();
    await evidence(page, `projects-${name}`);
    // The editor: header with Sections, the gear and the user menu.
    await page.goto(await caseAddress(page, s.project));
    await expect(page.locator(".shell.shell-reading")).toBeVisible();
    await openUserMenu(page);
    await evidence(page, `editor-user-menu-${name}`);
    await page.keyboard.press("Escape");
    await page.locator(".shell-reading-navigation > summary").click();
    await expect(workSidebar(page)).toBeVisible();
    await evidence(page, `editor-sections-${name}`);
  }

  for (const size of SIZES) {
    test(`header, user menu and Administration at ${size.name} px`, async ({ page }) => {
      await page.setViewportSize({ width: size.width, height: size.height });
      const s = await guidelineScenario(page, "PUBLISHED");
      await loginAdministrator(page);
      await expect(page.locator("html")).not.toHaveAttribute("data-theme", /.*/);
      expect(await page.evaluate(() => getComputedStyle(document.documentElement).colorScheme)).toContain("dark");
      await shots(page, s, size.name);
    });
  }
});

// Issue 550, U5-04: the browser's Back closes the user menu, as a click elsewhere does.
for (const size of SIZES) {
  test(`${size.name} px: the user menu closes on the browser's Back and stays closed on Forward`, async ({ page }) => {
    await page.setViewportSize({ width: size.width, height: size.height });
    await loginAdministrator(page);
    await page.goto("/#/projects");
    await expect(page.getByRole("heading", { name: "Projects", level: 1 })).toBeVisible();
    await page.goto("/#/me");
    await expect(page.getByRole("heading", { name: "Profile", level: 1 })).toBeVisible();
    const menu = await openUserMenu(page);
    await page.goBack();
    await expect(page).toHaveURL(/#\/projects$/);
    await expect(menu).toHaveCount(0);
    await expect(userMenuButton(page)).toHaveAttribute("aria-expanded", "false");
    await page.goForward();
    await expect(page).toHaveURL(/#\/me$/);
    await expect(menu).toHaveCount(0);
  });
}

// Issue 547, U2-09: the Translation reviews list belongs to Progress: Progress stays marked, and the header leads back.
for (const size of SIZES) {
  test(`${size.name} px: Translation reviews marks Progress and leads back to it`, async ({ page }) => {
    await page.setViewportSize({ width: size.width, height: size.height });
    const s = await guidelineScenario(page, "PUBLISHED");
    await loginGuidelineUser(page, s, "lead");
    await page.goto(`/#/projects/${encodeURIComponent(s.project)}/progress`);
    await page.getByRole("link", { name: "Translation reviews", exact: true }).click();
    await expect(page).toHaveURL(/\/translation-reviews$/);
    await expect(workSidebar(page).getByRole("link", { name: "Progress", exact: true })).toHaveAttribute("aria-current", "location");
    const crumbs = page.getByRole("navigation", { name: "Breadcrumb", exact: true });
    await expect(crumbs).toContainText("Translation reviews");
    expect(await fitsWindow(page)).toBe(true);
    if (size === PHONE) await evidence(page, "translation-reviews-progress-phone");
    else await evidence(page, "translation-reviews-progress-wide");
    await crumbs.getByRole("button", { name: "Progress", exact: true }).click();
    await expect(page).toHaveURL(/\/progress$/);
    await expect(workSidebar(page).getByRole("link", { name: "Progress", exact: true })).toHaveAttribute("aria-current", "page");
  });
}

// Issue 550, U5-03 (WCAG 2.5.5): on a phone every control of the header and of the navigation is at least 44 × 44 px.
test.describe("touch targets at 390 px", () => {
  test.use({ viewport: { width: PHONE.width, height: PHONE.height } });

  const small = async (controls: Locator) => {
    const out: string[] = [];
    for (const control of await controls.all()) {
      if (!await control.isVisible()) continue;
      const box = (await control.boundingBox())!;
      if (box.width < 44 - 0.5 || box.height < 44 - 0.5) out.push(`${(await control.innerText()).trim() || await control.getAttribute("aria-label")}: ${Math.round(box.width)}×${Math.round(box.height)}`);
    }
    return out;
  };

  test("the gear, the user menu, Handbook and the Administration sidebar; a lead's project pages; Sections in the editor", async ({ page }) => {
    const s = await guidelineScenario(page, "PUBLISHED");
    await loginAdministrator(page);
    await openAdministration(page);
    const header = page.locator(".shell-header");
    expect(await small(header.locator("a, button"))).toEqual([]);
    expect(await small(adminSidebar(page).getByRole("link"))).toEqual([]);
    expect(await fitsWindow(page)).toBe(true);
    await evidence(page, "touch-admin-phone");
    await clickLogOut(page);
    await loginGuidelineUser(page, s, "lead");
    await page.goto(`/#/projects/${encodeURIComponent(s.project)}/progress`);
    expect(await small(header.locator("a, button"))).toEqual([]);
    expect(await small(workSidebar(page).getByRole("link"))).toEqual([]);
    expect(await fitsWindow(page)).toBe(true);
    // Issue 574 F3: the breadcrumb "Progress" of Translation reviews.
    await page.getByRole("link", { name: "Translation reviews", exact: true }).click();
    await expect(header.getByRole("navigation", { name: "Breadcrumb", exact: true }).getByRole("button", { name: "Progress", exact: true })).toBeVisible();
    expect(await small(header.locator("a, button"))).toEqual([]);
    expect(await fitsWindow(page)).toBe(true);
    // The editor's one header row: Sections and the user menu.
    await page.goto(await caseAddress(page, s.project));
    await expect(page.locator(".shell.shell-reading")).toBeVisible();
    expect(await small(page.locator(".shell-header").locator("summary, a, button"))).toEqual([]);
    expect(await fitsWindow(page)).toBe(true);
  });
});
