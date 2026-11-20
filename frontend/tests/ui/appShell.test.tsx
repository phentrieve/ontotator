import { fireEvent, render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { AppShell, initials } from "../../src/ui/AppShell";
import type { CurrentUser } from "../../src/api/client";
const user = { username: "alex", display_name: "Alex", pseudonym: "a1" } as CurrentUser;
it("shows_product_and_user_menu", () => {
  const logout = vi.fn(); render(<AppShell user={user} userMenu={[{ id: "logout", label: "Log out", onSelect: logout }]}>Content</AppShell>);
  expect(screen.getByText("Ontotator")).toBeTruthy();
  expect(screen.getByText("Clinical Curation Workbench")).toBeTruthy();
  expect(screen.getByTestId("current-user").textContent).toBe("Alex (a1)");
  expect(screen.getByTestId("current-user").title).toBe("");
  const button = screen.getByRole("button", { name: "User menu: Alex (a1)" });
  expect(button.contains(screen.getByTestId("current-user"))).toBe(true);
  // The initials stand in for the name where the header is narrow (CSS); they are not read out.
  expect(button.querySelector(".shell-user-initials")?.textContent).toBe("AL");
  fireEvent.click(button);
  fireEvent.click(screen.getByRole("menuitem", { name: "Log out" })); expect(logout).toHaveBeenCalledOnce();
});
it("no_user_menu_without_items", () => {
  render(<AppShell user={user}>Content</AppShell>);
  expect(screen.queryByRole("button", { name: /^User menu/ })).toBeNull();
  expect(screen.getByTestId("current-user").textContent).toBe("Alex (a1)");
});
it.each([["Maria Demo", "MD"], ["anna-lena von berg", "AB"], ["Čeněk", "ČE"], ["  ", "?"], ["x", "X"]])("initials of %j are %s", (name, expected) => {
  expect(initials(name)).toBe(expected);
});
it("header_actions_sit_between_handbook_and_the_user_menu", () => {
  render(<AppShell user={user} userMenu={[{ id: "a", label: "A", onSelect: vi.fn() }]} actions={<a href="#/admin/users">Gear</a>}>Content</AppShell>);
  const actions = document.querySelector(".shell-actions")!;
  expect([...actions.querySelectorAll("a, button")].map(element => element.textContent)).toEqual(["Handbook", "Gear", "Alex (a1)AL"]);
});
it("breadcrumb_marks_the_current_page", () => {
  const back = vi.fn(); render(<AppShell user={null} breadcrumb={[{ label: "Projects", href: "/projects" }, { label: "Project", onClick: back }, { label: "Case 1" }]}>Content</AppShell>);
  expect(screen.getByRole("navigation", { name: "Breadcrumb" })).toBeTruthy();
  expect(screen.getByText("Case 1").getAttribute("aria-current")).toBe("page");
  expect(screen.getByRole("link", { name: "Projects" }).getAttribute("href")).toBe("/projects");
  screen.getByRole("button", { name: "Project" }).click(); expect(back).toHaveBeenCalledOnce();
});
it("side_nav_only_when_given", () => {
  const { rerender } = render(<AppShell user={null}>Content</AppShell>);
  expect(screen.queryByRole("navigation", { name: "Sections" })).toBeNull();
  rerender(<AppShell user={null} nav={<a href="/tasks">Tasks</a>}>Content</AppShell>);
  expect(screen.getByRole("navigation", { name: "Sections" })).toBeTruthy();
  rerender(<AppShell user={null} nav={<span>Admin</span>} navLabel="Administration">Content</AppShell>);
  expect(screen.getByRole("navigation", { name: "Administration" })).toBeTruthy();
});
it("skip_link_targets_main", () => { render(<AppShell user={null}>Content</AppShell>); expect(screen.getByRole("link", { name: "Skip to content" }).getAttribute("href")).toBe(`#${screen.getByRole("main").id}`); });
it("density_class_on_main", () => {
  const { rerender } = render(<AppShell user={null}>Content</AppShell>); expect(screen.getByRole("main").classList.contains("density-compact")).toBe(true);
  rerender(<AppShell user={null} density="reading">Content</AppShell>); expect(screen.getByRole("main").classList.contains("density-reading")).toBe(true);
});
it("shows the role as a muted second line under the identity", () => {
  render(<AppShell user={user} role="Project lead">Content</AppShell>);
  const identity = screen.getByTestId("current-user");
  expect(identity.querySelector(".current-user-name")?.textContent).toBe("Alex (a1)");
  expect(identity.querySelector(".cell-secondary")?.textContent).toBe("Project lead");
});
it("passes a crumb title through", () => {
  render(<AppShell user={null} breadcrumb={[{ label: "My tasks", onClick: vi.fn() }, { label: "doc, Annotation (de)", title: "Assignment 17" }]}>Content</AppShell>);
  expect(screen.getByText("doc, Annotation (de)").getAttribute("title")).toBe("Assignment 17");
  expect(screen.getByRole("button", { name: "My tasks" }).getAttribute("title")).toBeNull();
});
