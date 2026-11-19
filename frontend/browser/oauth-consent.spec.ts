/**
 * OAuth for the remote MCP server (issue 388): an app registers, sends the browser to
 * /oauth/authorize, the user logs in, consents on "Connect an app" and is sent back with a
 * code; Profile › Connected apps lists the connection and disconnects it.
 *
 * Screenshots for the visual check go to OAUTH_SHOTS when it is set.
 */
import { createHash, randomBytes } from "node:crypto";
import AxeBuilder from "@axe-core/playwright";
import { expect, request as http, test, type Page } from "@playwright/test";
import { TEST_PASSWORD, usernameFor } from "./helpers";

const PROJECT = "browser-fixture-oauth-consent";
const REDIRECT = "https://claude.ai/api/mcp/auth_callback";
const SHOTS = process.env.OAUTH_SHOTS;

async function shot(page: Page, name: string) {
  if (!SHOTS) return;
  await page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: true });
}

function pkce() {
  const verifier = randomBytes(48).toString("base64url");
  return { verifier, challenge: createHash("sha256").update(verifier).digest("base64url") };
}

async function register(page: Page): Promise<string> {
  const response = await page.request.post("/oauth/register", { data: {
    client_name: "Claude", redirect_uris: [REDIRECT], token_endpoint_auth_method: "none",
    grant_types: ["authorization_code", "refresh_token"], response_types: ["code"],
  } });
  expect(response.status()).toBe(201);
  return (await response.json() as { client_id: string }).client_id;
}

test("an app connects through the consent page and is disconnected on Profile", async ({ page, baseURL }) => {
  test.setTimeout(90_000);
  const errors: string[] = [];
  page.on("console", message => { if (message.type() === "error") errors.push(message.text()); });
  page.on("pageerror", error => errors.push(error.message));
  await page.setViewportSize({ width: 1440, height: 900 });

  const pseudonym = "OAuth Lead";
  const username = usernameFor(pseudonym);
  const created = await page.request.post(`/__test_user__?${new URLSearchParams({ username, pseudonym, projects: PROJECT })}`);
  expect(created.ok()).toBeTruthy();
  const clientId = await register(page);
  const { verifier, challenge } = pkce();
  const resource = `${baseURL}/mcp`;
  const params = new URLSearchParams({
    response_type: "code", client_id: clientId, redirect_uri: REDIRECT, code_challenge: challenge,
    code_challenge_method: "S256", scope: "read import export project-admin", resource, state: "state-1",
  });

  // The app sends the browser here; nobody is logged in yet.
  let returned = "";
  await page.route("https://claude.ai/**", async route => { returned = route.request().url(); await route.fulfill({ body: "back at the app" }); });
  await page.goto(`/oauth/authorize?${params}`);
  await expect(page).toHaveURL(/#\/oauth\/authorize\?/);
  const form = page.getByRole("form", { name: "Log in to Ontotator" });
  await expect(form).toBeVisible();
  await shot(page, "388-consent-login-after");
  await form.getByLabel("Username").fill(username);
  await form.getByLabel("Password").fill(TEST_PASSWORD);
  await form.getByRole("button", { name: "Log in", exact: true }).click();

  const consent = page.getByRole("region", { name: "Connect an app" });
  await expect(consent.getByRole("heading", { name: "Connect Claude to Ontotator?" })).toBeVisible();
  await expect(consent).toContainText("claude.ai");
  await expect(consent).toContainText("cannot check the name an app gives itself");
  // A lead may grant every requested scope; each starts ticked.
  for (const label of ["Read", "Import", "Export", "Project administration"]) {
    await expect(consent.getByLabel(new RegExp(`^${label}`))).toBeChecked();
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(1440);
  const axe = await new AxeBuilder({ page }).include(".oauth-consent").analyze();
  expect(axe.violations.map(violation => violation.id)).toEqual([]);
  await shot(page, "388-consent-after");
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  await shot(page, "388-consent-after-phone");
  await page.setViewportSize({ width: 1440, height: 900 });

  await consent.getByLabel(/^Import/).uncheck();
  await consent.getByRole("button", { name: "Connect" }).click();
  await expect.poll(() => returned).toContain(REDIRECT);
  const query = new URL(returned).searchParams;
  expect(query.get("state")).toBe("state-1");
  expect(query.get("iss")).toBe(baseURL);

  // The app exchanges the code; the token carries the scopes left ticked.
  const tokens = await page.request.post("/oauth/token", { form: {
    grant_type: "authorization_code", code: query.get("code")!, redirect_uri: REDIRECT,
    code_verifier: verifier, client_id: clientId, resource,
  } });
  expect(tokens.ok()).toBeTruthy();
  const body = await tokens.json() as { access_token: string; scope: string };
  expect(body.scope).toBe("read export project-admin");

  // Profile › Connected apps.
  await page.goto("/#/me");
  const section = page.getByRole("region", { name: "Connected apps" });
  await expect(section.getByRole("table", { name: "Connected apps" })).toContainText("Claude");
  await expect(section).toContainText(resource);
  await section.scrollIntoViewIfNeeded();
  await shot(page, "388-connected-apps-after");
  await page.setViewportSize({ width: 390, height: 844 });
  await section.scrollIntoViewIfNeeded();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  await shot(page, "388-connected-apps-after-phone");
  await page.setViewportSize({ width: 1440, height: 900 });

  await section.getByRole("button", { name: "Disconnect Claude" }).click();
  const dialog = page.getByRole("dialog", { name: "Disconnect Claude?" });
  await dialog.getByRole("button", { name: "Disconnect" }).click();
  await expect(section.getByRole("table", { name: "Connected apps" })).toContainText("Disconnected");
  await shot(page, "388-connected-apps-disconnected-after");
  // Without the browser's session cookie, as the MCP server sends it.
  const bare = await http.newContext({ baseURL });
  const after = await bare.get("/api/v1/me/token", { headers: { Authorization: `Bearer ${body.access_token}` } });
  expect(after.status()).toBe(401);
  await bare.dispose();
  expect(errors).toEqual([]);
});

test("a link with an unregistered return address shows an error page and goes nowhere", async ({ page }) => {
  const clientId = await register(page);
  const { challenge } = pkce();
  const response = await page.goto(`/oauth/authorize?${new URLSearchParams({
    response_type: "code", client_id: clientId, redirect_uri: "https://evil.example/cb", code_challenge: challenge, code_challenge_method: "S256",
  })}`);
  expect(response?.status()).toBe(400);
  await expect(page.getByRole("heading", { name: "This connection link is not valid" })).toBeVisible();
  expect(new URL(page.url()).host).not.toBe("evil.example");
  await shot(page, "388-invalid-link-after");
});

test("someone who leads no project may grant read only", async ({ page, baseURL }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const pseudonym = "OAuth Reader";
  const username = usernameFor(pseudonym);
  expect((await page.request.post(`/__test_user__?${new URLSearchParams({ username, pseudonym })}`)).ok()).toBeTruthy();
  const clientId = await register(page);
  const { challenge } = pkce();
  await page.goto(`/oauth/authorize?${new URLSearchParams({
    response_type: "code", client_id: clientId, redirect_uri: REDIRECT, code_challenge: challenge,
    code_challenge_method: "S256", scope: "read export project-admin", resource: `${baseURL}/mcp`, state: "s",
  })}`);
  const form = page.getByRole("form", { name: "Log in to Ontotator" });
  await form.getByLabel("Username").fill(username);
  await form.getByLabel("Password").fill(TEST_PASSWORD);
  await form.getByRole("button", { name: "Log in", exact: true }).click();
  const consent = page.getByRole("region", { name: "Connect an app" });
  await expect(consent.getByLabel(/^Read/)).toBeChecked();
  for (const label of ["Export", "Project administration"]) {
    await expect(consent.getByLabel(new RegExp(`^${label}`))).toBeDisabled();
    await expect(consent.getByLabel(new RegExp(`^${label}`))).not.toBeChecked();
  }
  await expect(consent).toContainText("it gets only what you tick here");
  await shot(page, "388-consent-read-only-after");
});
