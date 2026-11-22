import { useEffect, useId, useRef, useState, type MouseEvent } from "react";
import type { NotificationView } from "../api/client";
import { routeHref, type Route } from "../app/router";
import { Time } from "../app/Time";
import { Button } from "../ui/Button";
import { IconBell } from "../ui/icons";
import { Popover } from "../ui/Popover";
import { bellLabel, notificationRoute, notificationText } from "./notificationLabels";
import type { NotificationsState } from "./useNotifications";
import "./notifications.css";

export interface NotificationBellProps {
  state: NotificationsState;
  onNavigate: (route: Route) => void;
}

/** The count over the bell's corner; the header keeps its width when it arrives (as the gear's). */
function badge(unread: number | null): string | null {
  if (!unread) return null;
  return unread > 99 ? "99+" : String(unread);
}

function Entry({ item, onOpen, onMarkRead }: { item: NotificationView; onOpen: (item: NotificationView, event: MouseEvent<HTMLAnchorElement>) => void; onMarkRead: (id: number) => void }): JSX.Element {
  const route = notificationRoute(item);
  return <li className={`notification-entry${item.read ? "" : " notification-unread"}`}>
    <a className="notification-link" href={routeHref(route)} onClick={event => onOpen(item, event)}>
      <span className="notification-dot" aria-hidden="true" />
      <span className="notification-body">
        {!item.read && <span className="visually-hidden">Unread: </span>}
        <span className="notification-text">{notificationText(item)}</span>
        <span className="notification-meta">{item.project_name} · <Time iso={item.created_at} /></span>
      </span>
    </a>
    {!item.read && <Button variant="quiet" size="sm" className="notification-mark" onClick={() => onMarkRead(item.id)}
      aria-label={`Mark as read: ${notificationText(item)}`}>Mark as read</Button>}
  </li>;
}

/**
 * The header bell (issue 557): the unread count, and a list of the newest notifications in a popover (a sheet on
 * phones). Each entry opens its place and is marked read; "Mark all as read" clears the count.
 */
export function NotificationBell({ state, onNavigate }: NotificationBellProps): JSX.Element {
  const [open, setOpen] = useState(false);
  const anchor = useRef<HTMLButtonElement>(null);
  const panelId = useId();
  const { unread, items, error, load, markRead, markAllRead } = state;
  // The list arrives after the popover opened (and took focus): focus moves on to the newest entry.
  useEffect(() => {
    if (!open || !items?.length) return;
    const panel = document.getElementById(panelId);
    const dialog = panel?.closest('[role="dialog"]');
    if (panel && (document.activeElement === dialog || document.activeElement === document.body)) panel.querySelector<HTMLElement>("a")?.focus();
  }, [open, items, panelId]);
  const toggle = () => {
    if (!open) load();
    setOpen(!open);
  };
  const close = () => setOpen(false);
  const openEntry = (item: NotificationView, event: MouseEvent<HTMLAnchorElement>) => {
    if (!item.read) markRead(item.id);
    if (event.defaultPrevented || event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    close();
    onNavigate(notificationRoute(item));
  };
  // The button turns disabled: focus stays in the list instead of falling back to the page.
  const markAll = () => {
    markAllRead();
    document.getElementById(panelId)?.querySelector<HTMLElement>("a")?.focus();
  };
  const count = badge(unread);
  const anyUnread = !!items?.some(item => !item.read);
  return <>
    <button ref={anchor} type="button" className="btn btn-quiet btn-sm shell-notifications" aria-label={bellLabel(unread)}
      title="Notifications" aria-haspopup="dialog" aria-expanded={open} aria-controls={open ? panelId : undefined} onClick={toggle}>
      <IconBell />{count && <span className="shell-admin-count" aria-hidden="true">{count}</span>}
    </button>
    <Popover open={open} anchorRef={anchor} label="Notifications" onClose={close} width={380}
      footer={<Button variant="secondary" size="sm" disabled={!anyUnread} onClick={markAll}>Mark all as read</Button>}>
      <div id={panelId} className="notification-panel">
        {error && items === null && <p className="notification-empty" role="alert">The notifications could not be loaded. Try again later.</p>}
        {!error && items === null && <p className="notification-empty" aria-live="polite">Loading…</p>}
        {items !== null && items.length === 0 && <p className="notification-empty">No notifications. New tasks, released tasks and questions show here.</p>}
        {items !== null && items.length > 0 && <ul className="notification-list" aria-label="Newest notifications">
          {items.map(item => <Entry key={item.id} item={item} onOpen={openEntry} onMarkRead={markRead} />)}
        </ul>}
      </div>
    </Popover>
  </>;
}
