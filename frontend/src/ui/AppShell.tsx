import { useEffect, useRef, type ReactNode } from "react";
import type { CurrentUser } from "../api/client";
import { personLabel } from "../app/identity";
import { Button } from "./Button";
import { IconSortDown } from "./icons";
import { MenuButton, type MenuItem } from "./MenuButton";
import { ShortcutHelpHost } from "./ShortcutHelp";
import { onSpaceActivate } from "./spaceActivates";

/** The handbook bundled with the app (route `#/help`): it matches this version and needs no internet. */
export const HANDBOOK_HREF = "#/help";

export interface Crumb {
  label: string; onClick?: () => void; href?: string;
  /** Extra detail on hover, e.g. the assignment number behind a named task. */
  title?: string;
}
export interface AppShellProps {
  user: CurrentUser | null;
  /** The items of the user menu at the top right (Profile … Log out); without them the name is plain text. */
  userMenu?: MenuItem[];
  breadcrumb?: Crumb[];
  /** Header controls between Handbook and the user menu, e.g. the gear to Administration. */
  actions?: ReactNode;
  nav?: ReactNode;
  navLabel?: string;
  density?: "reading" | "compact";
  /** Muted second line under the user's identity, e.g. "Lead". */
  role?: string;
  /** The product name links to the user's start page (R-1); `onHome` handles plain clicks in the app. */
  homeHref?: string;
  onHome?: () => void;
  children: ReactNode;
}

/** "Maria Demo" gives "MD", one word its first two letters; shown where the header has no room for the name. */
export function initials(name: string): string {
  const words = name.trim().split(/[\s._-]+/u).filter(Boolean);
  const letters = words.length > 1 ? [words[0], words[words.length - 1]].map(word => [...word][0]) : [...(words[0] ?? "")].slice(0, 2);
  return letters.join("").toLocaleUpperCase() || "?";
}

export function AppShell({ user, userMenu, breadcrumb, actions, nav, navLabel = "Sections", density = "compact", role, homeHref, onHome, children }: AppShellProps): JSX.Element {
  const mainRef = useRef<HTMLElement>(null);
  const sectionsRef = useRef<HTMLDetailsElement>(null);
  const hasNav = nav != null && nav !== false;
  // The open Sections panel lies over the page: a press anywhere else closes it.
  useEffect(() => {
    const closeSections = (event: PointerEvent) => {
      const sections = sectionsRef.current;
      if (sections?.open && !sections.contains(event.target as Node)) sections.open = false;
    };
    document.addEventListener("pointerdown", closeSections);
    return () => document.removeEventListener("pointerdown", closeSections);
  }, []);
  // On phones the reading header has no room for Handbook; the Sections menu carries it there (CSS).
  const navigation = hasNav ? <nav className="app-nav" aria-label={navLabel}>{nav}
    {density === "reading" && <a className="shell-nav-link shell-nav-help" href={HANDBOOK_HREF}>Handbook</a>}</nav> : null;
  const name = personLabel(user);
  const identity = <span className="current-user" data-testid="current-user">
    <span className="current-user-name">{name}</span>
    {role && <span className="cell-secondary">{role}</span>}
  </span>;
  return <div className={`shell${density === "reading" ? " shell-reading" : ""}`}>
    <a className="skip-link" href="#main" onClick={(event) => {
      event.preventDefault();
      mainRef.current?.focus();
    }}>Skip to content</a>
    <header className="app-header shell-header">
      <div className="shell-heading">
        {density === "reading" && hasNav && <details ref={sectionsRef} className="shell-reading-navigation" onKeyDown={event => {
          if (event.key !== "Escape" || !event.currentTarget.open) return;
          event.preventDefault();
          event.currentTarget.open = false;
          event.currentTarget.querySelector("summary")?.focus();
        }}>
          <summary>{navLabel}</summary>
          {navigation}
        </details>}
        {homeHref
          ? <a className="shell-product" href={homeHref} onClick={event => {
            if (!onHome || event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
            event.preventDefault();
            onHome();
          }}>Ontotator</a>
          : <span className="shell-product">Ontotator</span>}
        <span className="shell-subtitle">Clinical Curation Workbench</span>
        {!!breadcrumb?.length && <nav aria-label="Breadcrumb"><ol className="shell-breadcrumb">
          {breadcrumb.map((crumb, index) => <li key={index}>
            {index === breadcrumb.length - 1 ? <span aria-current="page" title={crumb.title}>{crumb.label}</span>
              : crumb.onClick ? <Button variant="quiet" size="sm" title={crumb.title} onClick={crumb.onClick}>{crumb.label}</Button>
              : crumb.href ? <a href={crumb.href} title={crumb.title}>{crumb.label}</a> : <span title={crumb.title}>{crumb.label}</span>}
          </li>)}
        </ol></nav>}
      </div>
      <div className="shell-actions">
        <a className="btn btn-quiet btn-sm shell-help" href={HANDBOOK_HREF} onKeyDown={onSpaceActivate}>Handbook</a>
        {actions}
        {/* Identity (D1): "Display name (pseudonym)"; the username stays out of the shell. */}
        {user && !userMenu?.length && identity}
        {user && !!userMenu?.length && <MenuButton className="btn-quiet shell-user-menu" buttonLabel={name} items={userMenu}
          label={`User menu: ${[name, role].filter(Boolean).join(", ")}`}
          content={<>
            {identity}
            <span className="shell-user-initials" aria-hidden="true">{initials(user.display_name?.trim() || user.pseudonym)}</span>
            <IconSortDown />
          </>} />}
      </div>
    </header>
    <div className="shell-body">
      {density !== "reading" && navigation}
      <main ref={mainRef} id="main" tabIndex={-1} className={`shell-main density-${density}`}>
        {density === "reading" ? children : <div className="shell-page">{children}</div>}
      </main>
    </div>
    <ShortcutHelpHost />
  </div>;
}
