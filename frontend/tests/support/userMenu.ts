import { fireEvent, screen, within } from "@testing-library/react";

/** The user menu at the top right of the shell (issue 510), opened; an open one is kept. */
export function openUserMenu(): HTMLElement {
  const open = screen.queryByRole("menu", { name: /^User menu/ });
  if (open) return open;
  fireEvent.click(screen.getByRole("button", { name: /^User menu/ }));
  return screen.getByRole("menu", { name: /^User menu/ });
}

/** Choose "Profile", "My technical reports", "Technical problem…" or "Log out" in the user menu. */
export function chooseUserMenu(name: string): void {
  fireEvent.click(within(openUserMenu()).getByRole("menuitem", { name }));
}

/** The gear at the top right: only a system administrator has it. */
export const administrationGear = (): HTMLElement | null => screen.queryByRole("link", { name: /^Administration/ });
