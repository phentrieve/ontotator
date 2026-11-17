import { cleanup, render, screen } from "@testing-library/react";
import { useLayoutEffect } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { App } from "../src/App";
import { api } from "../src/api/client";
import { testUser } from "./session";

beforeEach(() => {
  window.localStorage.clear();
  window.history.replaceState(null, "", "#/?status=all");
  vi.spyOn(api, "listMyTasks").mockResolvedValue([]);
  vi.spyOn(api, "listProjects").mockResolvedValue([]);
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); window.localStorage.clear(); window.history.replaceState(null, "", "#/"); });

/** Changes the address after the first render and before the app's mount effect (layout effects run first). */
function AddressChange({ to }: { to: string }): null {
  useLayoutEffect(() => { window.history.replaceState(window.history.state, "", to); }, [to]);
  return null;
}

it("follows an address set between the first render and the mount effect (issue 380)", async () => {
  render(<><AddressChange to="#/help" /><App user={testUser("annotator", { username: "anna" })} /></>);
  // Before the fix the mount effect wrote the rendered address back: the page stayed on My tasks.
  expect(window.location.hash).toBe("#/help");
  expect(await screen.findByRole("heading", { level: 1, name: /help|handbook/i })).toBeDefined();
  expect(screen.queryByRole("heading", { name: "My tasks" })).toBeNull();
  expect(typeof window.history.state?.ontotatorRouteIndex).toBe("number");
});

it("keeps the rendered address when nothing changed it", async () => {
  render(<App user={testUser("annotator", { username: "anna" })} />);
  expect(await screen.findByRole("heading", { name: "My tasks" })).toBeDefined();
  expect(window.location.hash).toBe("#/?status=all");
});
