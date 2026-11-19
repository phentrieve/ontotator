/**
 * Dark theme (issue 492). The setting "Theme" on Profile: System follows the emulated colour scheme, Light and
 * Dark win over it, the choice survives a reload and is applied by /theme.js before the app starts. Then the main
 * screens in dark at 1440 px and 390 px: the page reports the dark colour scheme, no element is left on a light
 * background (`lightLeft`), and axe finds no text below AA contrast. Every other spec, the screenshots and the
 * handbook images stay light: Playwright emulates the light scheme unless a test asks for dark.
 *
 * Each test builds its own project through a scenario route of tests/browser_server.py. The screens are also saved
 * to build/dark-theme/evidence for human review (never baselines).
 */
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { documentsReady, documentsScenario, openFilters, openTextCard } from "./documentsHelpers";
import { guidelineScenario, loginGuidelineUser } from "./guidelineHelpers";
import { loginExisting, openTasksHome } from "./helpers";
import { loginScenarioUser as loginProposalUser, proposalCheckScenario } from "./proposalCheckHelpers";
import { loginScenarioUser, reviewFlowScenario } from "./reviewFlowHelpers";

test.setTimeout(240_000);
test.use({ actionTimeout: 15_000, viewport: { width: 1440, height: 900 } });

const WIDE = { width: 1440, height: 900 };
const PHONE = { width: 390, height: 844 };
const THEME_KEY = "ontotator.theme.v1";

/** The computed value of a colour token, as the browser writes colours ("rgb(27, 24, 21)"). */
const tokenColour = (page: Page, name: string) => page.evaluate((token) => {
  const probe = document.createElement("span");
  probe.style.color = `var(${token})`;
  document.body.append(probe);
  const colour = getComputedStyle(probe).color;
  probe.remove();
  return colour;
}, name);
const bodyBackground = (page: Page) => page.evaluate(() => getComputedStyle(document.body).backgroundColor);
const rootTheme = (page: Page) => page.evaluate(() => document.documentElement.getAttribute("data-theme"));
const rootScheme = (page: Page) => page.evaluate(() => getComputedStyle(document.documentElement).colorScheme);

/** The page surface of the light and of the dark theme (styles/tokens.css). */
const LIGHT_SURFACE = "rgb(247, 244, 238)";
const DARK_SURFACE = "rgb(27, 24, 21)";

/**
 * Elements still on a light background. In dark only small inverted controls are light (a primary button, a chosen
 * value, a toast), and their text is dark: so a light background fails when it has a light-theme surface colour,
 * when it is large, or when its own text is light too.
 */
const lightLeft = (page: Page) => page.evaluate(() => {
  const parse = (colour: string) => {
    const parts = colour.match(/[\d.]+/g)?.map(Number);
    return parts && parts.length >= 3 ? { rgb: parts.slice(0, 3), alpha: parts[3] ?? 1 } : null;
  };
  const luminance = (rgb: number[]) => {
    const [r, g, b] = rgb.map((value) => { const c = value / 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; });
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  const lightSurfaces = new Set(["rgb(247, 244, 238)", "rgb(255, 253, 248)", "rgb(239, 235, 227)", "rgb(255, 255, 255)"]);
  const found: string[] = [];
  for (const element of document.querySelectorAll<HTMLElement>("body, body *")) {
    const box = element.getBoundingClientRect();
    if (box.width < 4 || box.height < 4) continue;
    const style = getComputedStyle(element);
    if (style.display === "none" || style.visibility === "hidden") continue;
    const background = parse(style.backgroundColor);
    if (!background || background.alpha < 0.2) continue;
    const light = luminance(background.rgb);
    if (light <= 0.3) continue;
    if (background.alpha < 0.5) {
      // A translucent layer (the scrim behind a dialog) must darken the page, not wash it out.
      if (box.width * box.height > 60_000) found.push(`${element.tagName.toLowerCase()}.${String(element.className).replace(/\s+/g, ".")}: ${style.backgroundColor} (a light wash)`);
      continue;
    }
    // Only an element with text of its own is judged by its text colour (a status dot has none).
    const ownText = [...element.childNodes].some((node) => node.nodeType === Node.TEXT_NODE && (node.textContent ?? "").trim() !== "");
    const text = parse(style.color);
    const dark = text ? luminance(text.rgb) : 0;
    const ratio = (Math.max(light, dark) + 0.05) / (Math.min(light, dark) + 0.05);
    const why = lightSurfaces.has(style.backgroundColor) ? "a light-theme surface"
      : box.width * box.height > 60_000 ? "a large light area" : ownText && ratio < 3 ? "light text on a light background" : "";
    if (why) found.push(`${element.tagName.toLowerCase()}.${String(element.className).replace(/\s+/g, ".")}: ${style.backgroundColor} (${why})`);
  }
  return [...new Set(found)];
});

/** Text below WCAG AA contrast, as axe measures it on the rendered page. */
async function lowContrast(page: Page): Promise<string[]> {
  const results = await new AxeBuilder({ page }).withRules(["color-contrast"]).analyze();
  return results.violations.flatMap((violation) => violation.nodes.map((node) => `${node.target.join(" ")}: ${node.any.map((check) => check.message).join(" ")}`));
}

/** The screen as it is now, at 1440 px and at 390 px: dark, nothing left light, contrast kept. Saved as evidence. */
async function expectDark(page: Page, name: string, sizes: Array<{ width: number; height: number }> = [WIDE, PHONE]): Promise<void> {
  const folder = resolve(test.info().config.rootDir, "../../build/dark-theme/evidence");
  mkdirSync(folder, { recursive: true });
  for (const size of sizes) {
    await page.setViewportSize(size);
    await page.mouse.move(0, 0);
    await expect.poll(() => rootScheme(page)).toBe("dark");
    expect(await bodyBackground(page)).toBe(DARK_SURFACE);
    await page.screenshot({ path: resolve(folder, `${name}-${size.width}.png`), animations: "disabled" });
    expect.soft(await lightLeft(page), `${name} at ${size.width} px: light backgrounds`).toEqual([]);
    expect.soft(await lowContrast(page), `${name} at ${size.width} px: contrast`).toEqual([]);
  }
  if (sizes.length > 1) await page.setViewportSize(WIDE);
}

test.describe("the setting", () => {
  test.use({ colorScheme: "light" });

  test("System follows the system; Light and Dark win over it and survive a reload", async ({ page }) => {
    const created = await page.request.post("/__test_user__", { params: { username: "theme.user", pseudonym: "theme.user", assign: "none" } });
    expect(created.ok(), await created.text()).toBeTruthy();
    await loginExisting(page, "theme.user");
    await page.goto("/#/me");
    const theme = page.getByRole("combobox", { name: "Theme", exact: true });
    await expect(theme).toHaveValue("system");
    await expect(page.getByRole("heading", { name: "Appearance", level: 2, exact: true })).toBeVisible();

    // System: the page follows the emulated scheme, with nothing stored and no attribute.
    expect(await rootTheme(page)).toBeNull();
    expect(await bodyBackground(page)).toBe(LIGHT_SURFACE);
    await page.emulateMedia({ colorScheme: "dark" });
    await expect.poll(() => bodyBackground(page)).toBe(DARK_SURFACE);
    expect(await rootScheme(page)).toBe("dark");
    expect(await tokenColour(page, "--text")).toBe("rgb(236, 230, 218)");
    await page.emulateMedia({ colorScheme: "light" });
    await expect.poll(() => bodyBackground(page)).toBe(LIGHT_SURFACE);

    // Dark on a light system: at once, and after a reload.
    await theme.selectOption({ label: "Dark" });
    await expect.poll(() => bodyBackground(page)).toBe(DARK_SURFACE);
    expect(await rootTheme(page)).toBe("dark");
    expect(await page.evaluate((key) => window.localStorage.getItem(key), THEME_KEY)).toBe("dark");
    await page.reload();
    await expect(theme).toHaveValue("dark");
    expect(await bodyBackground(page)).toBe(DARK_SURFACE);
    expect(await rootScheme(page)).toBe("dark");
    // A printed page stays light: dark text on white paper.
    await page.emulateMedia({ media: "print" });
    expect(await bodyBackground(page)).toBe(LIGHT_SURFACE);
    expect(await tokenColour(page, "--text")).toBe("rgb(31, 26, 20)");
    await page.emulateMedia({ media: null });

    // Light on a dark system.
    await page.emulateMedia({ colorScheme: "dark" });
    await theme.selectOption({ label: "Light" });
    await expect.poll(() => bodyBackground(page)).toBe(LIGHT_SURFACE);
    await page.reload();
    await expect(theme).toHaveValue("light");
    expect(await bodyBackground(page)).toBe(LIGHT_SURFACE);
    expect(await rootScheme(page)).toBe("light");

    // Back to System: the stored choice is gone, the dark system shows again, also after a reload.
    await theme.selectOption({ label: "System" });
    await expect.poll(() => bodyBackground(page)).toBe(DARK_SURFACE);
    expect(await rootTheme(page)).toBeNull();
    expect(await page.evaluate((key) => window.localStorage.getItem(key), THEME_KEY)).toBeNull();
    await page.reload();
    await expect(theme).toHaveValue("system");
    expect(await bodyBackground(page)).toBe(DARK_SURFACE);
  });

  test("the chosen theme is applied before the app starts, and the login page follows it", async ({ page }) => {
    const errors: string[] = [];
    page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
    await page.goto("/");
    await page.evaluate((key) => window.localStorage.setItem(key, "dark"), THEME_KEY);
    // Without the application bundle only /theme.js runs: the page is dark all the same.
    await page.route("**/assets/*.js", (route) => route.abort());
    await page.reload();
    expect(await rootTheme(page)).toBe("dark");
    expect(await bodyBackground(page)).toBe(DARK_SURFACE);
    await page.unroute("**/assets/*.js");
    errors.length = 0;

    await page.reload();
    await expect(page.getByRole("form", { name: "Log in to Ontotator" })).toBeVisible();
    expect(await bodyBackground(page)).toBe(DARK_SURFACE);
    // The Content-Security-Policy refused nothing (an inline script would be refused).
    expect(errors).toEqual([]);
  });
});

test.describe("the main screens in dark", () => {
  test.use({ colorScheme: "dark" });

  test("log in, set a password", async ({ page }) => {
    await openTasksHome(page);
    const form = page.getByRole("form", { name: "Log in to Ontotator" });
    await expect(form).toBeVisible();
    await form.getByLabel("Username", { exact: true }).fill("nobody");
    await form.getByLabel("Password", { exact: true }).fill("not the password");
    await form.getByRole("button", { name: "Log in", exact: true }).click();
    await expect(form.getByRole("alert")).toBeVisible();
    await expectDark(page, "login-refused");
    await page.getByRole("button", { name: "I have a setup or reset code" }).click();
    await expect(page.getByRole("form", { name: "Set your password" })).toBeVisible();
    await expectDark(page, "set-password");
  });

  test("My tasks, Profile, the handbook", async ({ page }) => {
    const s = await reviewFlowScenario(page, "REVIEW_FLOW");
    await loginScenarioUser(page, s, "ana");
    await expect(page.getByRole("heading", { name: "My tasks", level: 1 })).toBeVisible();
    await expect(page.locator(".data-table tbody tr, .task-card").first()).toBeVisible();
    await expectDark(page, "my-tasks");

    await page.goto("/#/me");
    await expect(page.getByRole("combobox", { name: "Theme", exact: true })).toHaveValue("system");
    await expect(page.getByRole("form", { name: "Search preferences" })).toBeVisible();
    await page.getByRole("combobox", { name: "Theme", exact: true }).scrollIntoViewIfNeeded();
    await expectDark(page, "profile");

    await page.goto("/#/help");
    await expect(page.getByRole("navigation", { name: "Handbook chapters" })).toBeVisible();
    await expectDark(page, "handbook");
  });

  test("the editor: proposals, a replaced proposal marked absent, the selected mark, the submit dialog", async ({ page }) => {
    const s = await proposalCheckScenario(page, "ONE_ASSIGNED");
    await loginProposalUser(page, s, "tom");
    await page.goto(`/#/tasks/${s.assignments.tom}`);
    await expect(page.locator(".text-container")).toBeVisible();
    await expect(page.locator(".sidebar-header").filter({ hasText: /^Review Proposals/ })).toBeVisible();
    await page.locator("body").press("j");
    await expect(page.locator('.sidebar [data-list-key^="target:"]').first()).toHaveClass(/\bselected\b/);
    await expectDark(page, "editor-proposal-selected");

    await page.getByRole("button", { name: /^Edit & Replace\b/ }).first().click();
    const changed = page.waitForResponse((r) => r.url().endsWith("/commands") && r.request().postDataJSON()?.payload?.command === "set_axes");
    await page.locator('[data-axis-field="assertion"] input[type="radio"][value="absent"]').check();
    expect((await changed).ok()).toBeTruthy();
    await expect(page.locator(".status-badge.status-saved")).toHaveText("Saved");
    // The marks of the text: a proposal (dashed), the user's own negated copy (hatched), the selected one (framed).
    await expect(page.locator(".text-container .run--marked").first()).toBeVisible();
    await expectDark(page, "editor-own-negated-finding");
    // On a phone the text is its own pane.
    await page.setViewportSize(PHONE);
    await page.getByRole("navigation", { name: "Select view" }).getByRole("button", { name: "Document", exact: true }).click();
    await expect(page.locator(".text-container .run--marked").first()).toBeVisible();
    await expectDark(page, "editor-text-pane", [PHONE]);
    await page.setViewportSize(WIDE);

    await page.getByRole("button", { name: /^Finish & submit/ }).click();
    await expect(page.getByRole("dialog", { name: "Submit text", exact: true })).toBeVisible();
    await expectDark(page, "editor-submit-dialog");
  });

  test("the editor: Show changes marks added and removed text", async ({ page }) => {
    const response = await page.request.post("/__test_carry_forward__", { params: { scenario: "corrected" }, timeout: 120_000 });
    expect(response.ok(), await response.text()).toBeTruthy();
    const s = await response.json() as { username: string; assignment_id: number };
    await loginExisting(page, s.username);
    await page.goto(`/#/tasks/${s.assignment_id}`);
    const text = page.locator(".text-container").first();
    await expect(text).toBeVisible();
    await page.getByRole("checkbox", { name: "Show changes since v1" }).check();
    await expect(text.locator(".change-passage")).toHaveCount(1);
    await text.locator(".change-removed").first().focus();
    await expect(page.getByRole("tooltip").first()).toBeVisible();
    await expectDark(page, "editor-show-changes");
  });

  test("consolidation: person lanes, an open group with conflicts, kept findings", async ({ page }) => {
    const response = await page.request.post("/__test_consolidation__", { params: { started: "true", people: "3" }, timeout: 120_000 });
    expect(response.ok(), await response.text()).toBeTruthy();
    const s = await response.json() as { users: Record<string, string>; assignment_id: number };
    await loginExisting(page, s.users.lead);
    await page.goto(`/#/tasks/${s.assignment_id}`);
    await expect(page.getByRole("heading", { level: 1, name: /^Consolidate / })).toBeVisible({ timeout: 30_000 });
    const group = page.locator(".cons-group").filter({ has: page.locator(".cons-group-title", { hasText: "muscular hypotonia" }) });
    const toggle = group.locator(".cons-group-toggle");
    if ((await toggle.getAttribute("aria-expanded")) !== "true") await toggle.click();
    await group.locator("table.cons-compare").getByRole("button", { name: /^Take Hypotonia from .* for Term$/ }).first().click();
    await expect(group.locator(".cons-result")).toContainText("Result:");
    await expect(page.locator(".cons-mark[data-lanes]").first()).toBeVisible();
    await expectDark(page, "consolidation");
  });

  test("Documents: the table, the filters, the text card", async ({ page }) => {
    const s = await documentsScenario(page, "S336");
    await loginExisting(page, s.users.lead);
    await page.goto(`/#/projects/${encodeURIComponent(s.project)}/documents`);
    await documentsReady(page);
    await expectDark(page, "documents");
    const filters = await openFilters(page);
    await expect(filters).toBeVisible();
    await expectDark(page, "documents-filters");
    await page.keyboard.press("Escape");
    const card = await openTextCard(page, "EN100022", "en");
    await expect(card).toBeVisible();
    await expectDark(page, "documents-text-card");
  });

  test("the text view with Compare", async ({ page }) => {
    const s = await proposalCheckScenario(page, "CHECKED");
    await loginProposalUser(page, s, "lead");
    await page.goto(`/#/projects/${encodeURIComponent(s.project)}/cases/EN100024?variant=${encodeURIComponent(s.cases.EN100024)}&show=proposals`);
    await expect(page.getByRole("combobox", { name: "Show", exact: true }).first()).toBeVisible({ timeout: 30_000 });
    await expect(page.getByRole("region", { name: "Findings", exact: true }).getByRole("listitem").first()).toBeVisible();
    await page.getByRole("button", { name: "Compare", exact: true }).click();
    await expect(page.getByRole("combobox", { name: "Show", exact: true })).toHaveCount(2);
    await expectDark(page, "text-view-compare");
  });

  test("the guideline reader", async ({ page }) => {
    const s = await guidelineScenario(page, "PUBLISHED");
    await loginGuidelineUser(page, s, "ana");
    await page.goto(`/#/projects/${encodeURIComponent(s.project)}/guidelines/v1`);
    await expect(page.getByRole("heading", { name: "Guidelines v1", level: 2 })).toBeVisible();
    await expect(page.getByText("Loading guidelines…")).toHaveCount(0);
    await expect(page.locator(".guideline-document").first()).toBeVisible();
    await expectDark(page, "guideline-reader");
  });

  test("translation review with Show changes", async ({ page }) => {
    const s = await reviewFlowScenario(page, "REVIEW_FLOW");
    await loginScenarioUser(page, s, "ana");
    await page.goto(`/#/tasks/${s.assignments["failed-translation"]}`);
    const translation = page.getByRole("textbox", { name: "Translation (de)", exact: true });
    await expect(translation).toHaveValue(s.texts["failed-translation"]);
    await page.getByRole("radio", { name: "Accepted with corrections", exact: true }).check();
    await translation.focus();
    await page.keyboard.press("Control+Home");
    await page.keyboard.type("Neu: ");
    await page.locator(":focus").blur();
    await expect(page.locator(".translation-save-status")).toHaveText("Saved");
    await page.getByRole("checkbox", { name: "Show changes", exact: true }).check();
    await expect(page.locator(".translation-diff ins").first()).toBeVisible();
    await expectDark(page, "translation-review-show-changes");
  });
});
