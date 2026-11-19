import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api, ApiError, type CurrentUser, type OAuthAuthorization, type OAuthConnection } from "../src/api/client";
import { parseRoute, routeHref } from "../src/app/router";
import { ConnectionsSection, connectionState } from "../src/me/ConnectionsSection";
import { OAuthConsentPage } from "../src/me/OAuthConsentPage";

const user = { username: "lena", display_name: "Lena Lead", pseudonym: "lena", is_system_admin: false, csrf_token: "c" } as CurrentUser;
const params = {
  response_type: "code", client_id: "otc_1", redirect_uri: "https://claude.ai/api/mcp/auth_callback",
  code_challenge: "x".repeat(43), code_challenge_method: "S256", scope: "read export project-admin",
  resource: "https://ontotator.example.org/mcp", state: "s",
};
const request = (change: Partial<OAuthAuthorization> = {}): OAuthAuthorization => ({
  client_name: "Claude", client_id: "otc_1", redirect_uri: params.redirect_uri, redirect_host: "claude.ai",
  resource: params.resource, requested_scopes: ["read", "export", "project-admin"], allowed_scopes: ["read", "export"],
  params, ...change,
});
const connection = (change: Partial<OAuthConnection> = {}): OAuthConnection => ({
  id: 4, client_name: "Claude", redirect_host: "claude.ai", scopes: ["read"], resource: params.resource,
  created_at: "2026-11-01T10:00:00Z", expires_at: "2099-01-30T10:00:00Z", last_used_at: null,
  revoked_at: null, revoked_reason: null, ...change,
});

let assign: ReturnType<typeof vi.fn>;
beforeEach(() => {
  assign = vi.fn();
  Object.defineProperty(window, "location", { configurable: true, value: { ...window.location, assign, hash: "" } });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe("OAuth consent route", () => {
  it("parses and writes the consent address with its parameters", () => {
    const route = parseRoute(`#/oauth/authorize?${new URLSearchParams(params).toString()}`);
    expect(route).toEqual({ name: "oauthAuthorize", params });
    expect(parseRoute(routeHref(route))).toEqual(route);
  });
});

describe("OAuth consent page", () => {
  it("names the app, the user and the return host, and offers only the allowed scopes", async () => {
    vi.spyOn(api, "getOAuthAuthorization").mockResolvedValue(request());
    render(<OAuthConsentPage params={params} user={user} onNavigate={() => {}} />);
    expect(await screen.findByRole("heading", { name: "Connect Claude to Ontotator?" })).toBeDefined();
    expect(screen.getAllByText("claude.ai").length).toBeGreaterThan(0);
    expect(screen.getByText(/cannot check the name an app gives itself/)).toBeDefined();
    expect((screen.getByLabelText(/^Read/) as HTMLInputElement).checked).toBe(true);
    expect((screen.getByLabelText(/^Export/) as HTMLInputElement).checked).toBe(true);
    const admin = screen.getByLabelText(/^Project administration/) as HTMLInputElement;
    expect(admin.disabled).toBe(true);
    expect(admin.checked).toBe(false);
  });

  it("sends the ticked scopes and follows the redirect back to the app", async () => {
    vi.spyOn(api, "getOAuthAuthorization").mockResolvedValue(request());
    const decide = vi.spyOn(api, "decideOAuthAuthorization").mockResolvedValue({ redirect_to: "https://claude.ai/api/mcp/auth_callback?code=otk_1&state=s" });
    render(<OAuthConsentPage params={params} user={user} onNavigate={() => {}} />);
    fireEvent.click(await screen.findByLabelText(/^Export/));
    fireEvent.click(screen.getByRole("button", { name: "Connect" }));
    await waitFor(() => expect(assign).toHaveBeenCalledWith("https://claude.ai/api/mcp/auth_callback?code=otk_1&state=s"));
    expect(decide).toHaveBeenCalledWith(params, true, ["read"]);
    expect(screen.getByText("Returning you to claude.ai…")).toBeDefined();
  });

  it("declines with Cancel", async () => {
    vi.spyOn(api, "getOAuthAuthorization").mockResolvedValue(request());
    const decide = vi.spyOn(api, "decideOAuthAuthorization").mockResolvedValue({ redirect_to: "https://claude.ai/cb?error=access_denied" });
    render(<OAuthConsentPage params={params} user={user} onNavigate={() => {}} />);
    fireEvent.click(await screen.findByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(assign).toHaveBeenCalled());
    expect(decide).toHaveBeenCalledWith(params, false, []);
  });

  it("cannot connect without any scope ticked", async () => {
    vi.spyOn(api, "getOAuthAuthorization").mockResolvedValue(request({ requested_scopes: ["read"], allowed_scopes: ["read"] }));
    render(<OAuthConsentPage params={params} user={user} onNavigate={() => {}} />);
    fireEvent.click(await screen.findByLabelText(/^Read/));
    expect((screen.getByRole("button", { name: "Connect" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("says when the request cannot be used, without redirecting", async () => {
    vi.spyOn(api, "getOAuthAuthorization").mockRejectedValue(new ApiError(422, "OAUTH_REQUEST_INVALID", "The app asked to send you back to an address it did not register."));
    render(<OAuthConsentPage params={params} user={user} onNavigate={() => {}} />);
    expect(await screen.findByRole("heading", { name: "This connection request cannot be used" })).toBeDefined();
    expect(assign).not.toHaveBeenCalled();
  });
});

describe("Connected apps", () => {
  it("is hidden when the server has no remote MCP server", async () => {
    const list = vi.spyOn(api, "listConnections").mockResolvedValue({ enabled: false, mcp_url: null, connections: [] });
    const { container } = render(<ConnectionsSection />);
    await waitFor(() => expect(list).toHaveBeenCalled());
    await waitFor(() => expect(container.querySelector("section")).toBeNull());
  });

  it("lists connections with the connector address and disconnects one", async () => {
    vi.spyOn(api, "listConnections").mockResolvedValue({ enabled: true, mcp_url: params.resource, connections: [connection()] });
    const revoke = vi.spyOn(api, "revokeConnection").mockResolvedValue(connection({ revoked_at: "2026-11-02T10:00:00Z", revoked_reason: "revoked" }));
    render(<ConnectionsSection />);
    const table = await screen.findByRole("table", { name: "Connected apps" });
    expect(within(table).getByText("Claude")).toBeDefined();
    expect(within(table).getByText("Active")).toBeDefined();
    expect(screen.getByText(params.resource)).toBeDefined();
    fireEvent.click(within(table).getByRole("button", { name: "Disconnect Claude" }));
    const dialog = await screen.findByRole("dialog", { name: "Disconnect Claude?" });
    fireEvent.click(within(dialog).getByRole("button", { name: "Disconnect" }));
    await waitFor(() => expect(within(table).getByText("Disconnected")).toBeDefined());
    expect(revoke).toHaveBeenCalledWith(4);
  });

  it("names why a connection ended by itself", () => {
    expect(connectionState(connection({ revoked_at: "2026-11-02T10:00:00Z", revoked_reason: "refresh_reused" }))).toBe("Disconnected");
    expect(connectionState(connection({ expires_at: "2020-01-01T00:00:00Z" }))).toBe("Expired");
  });
});
