import { useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { Button } from "./Button";

export interface MenuItem {
  id: string;
  label: string;
  onSelect: () => void;
  /** One line under the label on what the item does (the item's accessible description). */
  description?: string;
  /** Not available now: stays in the menu and focusable (`aria-disabled`), choosing it does nothing. */
  disabled?: boolean;
  /** One choice of a named group (`group`), e.g. the theme: a `menuitemradio`; choosing it keeps the menu open. */
  checked?: boolean;
  /** Neighbouring items with the same group name form one labelled group (`role="group"`), set off by a line. */
  group?: string;
}
export interface MenuButtonProps {
  /** Accessible name of the button and the menu, e.g. "2 more actions for case-107 de". */
  label: string;
  items: MenuItem[];
  /** Visible button text, e.g. "More". */
  buttonLabel: string;
  /** Icon before the text, e.g. `<IconMore />` for a "More" menu. */
  icon?: ReactNode;
  /** Visible button content instead of `buttonLabel` (e.g. a person chip). */
  content?: ReactNode;
  className?: string;
  /** Button size; "md" beside full-size buttons (default "sm"). */
  size?: "sm" | "md";
}

type Box = { width: number; height: number };
/**
 * Where a fixed menu opens: below the trigger, right edges aligned; above it when it does not fit below
 * and there is more room above; always clamped into the viewport.
 */
export function menuPosition(trigger: { top: number; bottom: number; right: number }, menu: Box, viewport: Box, gap = 4): { top: number; left: number } {
  const below = trigger.bottom + gap;
  const above = trigger.top - gap - menu.height;
  const top = below + menu.height <= viewport.height || viewport.height - below >= trigger.top - gap ? below : above;
  const clamp = (value: number, max: number) => Math.max(gap, Math.min(value, max - gap));
  return { top: clamp(top, viewport.height - menu.height), left: clamp(trigger.right - menu.width, viewport.width - menu.width) };
}

/**
 * Menu button pattern: Enter, Space, click or ArrowDown open the menu at the first item, ArrowUp at the last;
 * arrows (wrapping), Home and End move; Enter, Space or click choose; Escape closes; focus returns to the button.
 * Tab, a pointer down outside and a navigation (the browser's Back) close the menu without moving focus.
 */
export function MenuButton({ label, items, buttonLabel, icon, content, className, size = "sm" }: MenuButtonProps): JSX.Element {
  const [open, setOpen] = useState<null | "first" | "last">(null);
  const button = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const menuId = useId();
  const [position, setPosition] = useState<{ top: number; left: number }>({ top: 0, left: 0 });
  const menuItems = () => [...(menu.current?.querySelectorAll<HTMLButtonElement>("[role^=menuitem]") ?? [])];

  useLayoutEffect(() => {
    if (!open) return;
    // Fixed position: the menu is not clipped by a scrolling table wrapper.
    const place = () => {
      const rect = button.current?.getBoundingClientRect();
      const size = menu.current?.getBoundingClientRect();
      if (rect && size) setPosition(menuPosition(rect, size, { width: window.innerWidth, height: window.innerHeight }));
    };
    place();
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => { window.removeEventListener("resize", place); window.removeEventListener("scroll", place, true); };
  }, [open]);
  useLayoutEffect(() => {
    if (!open) return;
    const elements = menuItems();
    (open === "first" ? elements[0] : elements.at(-1))?.focus();
  }, [open]);
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!menu.current?.contains(target) && !button.current?.contains(target)) setOpen(null);
    };
    // The browser's Back and Forward change the page under the menu: it closes, as on a click elsewhere (issue 550, U5-04).
    const onNavigation = () => setOpen(null);
    document.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("hashchange", onNavigation);
    window.addEventListener("popstate", onNavigation);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("hashchange", onNavigation);
      window.removeEventListener("popstate", onNavigation);
    };
  }, [open]);

  const close = () => { setOpen(null); button.current?.focus(); };
  const choose = (item: MenuItem) => {
    if (item.disabled) return;
    // A radio choice shows its effect at once; the menu stays open at it.
    if (item.checked === undefined) close();
    item.onSelect();
  };
  const entry = (item: MenuItem) => <button key={item.id} type="button" role={item.checked === undefined ? "menuitem" : "menuitemradio"} tabIndex={-1}
    className="ui-menu-item" onClick={() => choose(item)} aria-checked={item.checked}
    aria-disabled={item.disabled ? true : undefined}
    aria-label={item.description ? item.label : undefined} aria-describedby={item.description ? `${menuId}-${item.id}` : undefined}>
    {item.label}{item.description && <span id={`${menuId}-${item.id}`} className="ui-menu-item-description">{item.description}</span>}
  </button>;
  // Runs of items with the same group name.
  const runs: { group?: string; items: MenuItem[] }[] = [];
  for (const item of items) {
    const last = runs.at(-1);
    if (last && last.group === item.group) last.items.push(item);
    else runs.push({ group: item.group, items: [item] });
  }
  const onButtonKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
    event.preventDefault();
    setOpen(event.key === "ArrowDown" ? "first" : "last");
  };
  const onMenuKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const elements = menuItems();
    const index = elements.indexOf(document.activeElement as HTMLButtonElement);
    if (event.key === "Escape") {
      // Consumed here so page-level Escape shortcuts do not also run.
      event.preventDefault(); event.stopPropagation();
      close();
      return;
    }
    if (event.key === "Tab") { setOpen(null); return; }
    const target = event.key === "ArrowDown" ? (index + 1) % elements.length
      : event.key === "ArrowUp" ? (index - 1 + elements.length) % elements.length
        : event.key === "Home" ? 0 : event.key === "End" ? elements.length - 1 : null;
    if (target === null) return;
    event.preventDefault();
    elements[target]?.focus();
  };

  return <span className="ui-menu-button">
    <Button ref={button} size={size} className={className} aria-label={label} aria-haspopup="menu" aria-expanded={open !== null} aria-controls={open ? menuId : undefined}
      onClick={() => open ? setOpen(null) : setOpen("first")} onKeyDown={onButtonKeyDown}>{content ?? (icon ? <>{icon}<span>{buttonLabel}</span></> : buttonLabel)}</Button>
    {open && <div ref={menu} id={menuId} role="menu" aria-label={label} className="ui-menu" onKeyDown={onMenuKeyDown}
      style={{ position: "fixed", top: `${position.top}px`, left: `${position.left}px` }}>
      {runs.map((run, index) => run.group === undefined ? run.items.map(entry)
        : <div key={`group-${index}`} role="group" aria-label={run.group} className="ui-menu-group">
          <span className="ui-menu-group-label" aria-hidden="true">{run.group}</span>
          <div className="ui-menu-group-items">{run.items.map(entry)}</div>
        </div>)}
    </div>}
  </span>;
}
