import { useEffect, useId, useRef, useState, type MouseEvent, type ReactNode } from "react";
import type { NotificationView } from "../api/client";
import { routeHref, type Route } from "../app/router";
import { Time } from "../app/Time";
import { notifyQuestionsChanged } from "../questions/questionsEvents";
import { Button } from "../ui/Button";
import { ReasonButton } from "../ui/Help";
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

/** The person's pseudonym (`ann-0003`) is not broken at its hyphen on a narrow screen (issue 620). */
function keepTogether(text: string, pseudonym: string | undefined): ReactNode {
  const at = pseudonym ? text.indexOf(pseudonym) : -1;
  if (!pseudonym || at < 0) return text;
  return <>{text.slice(0, at)}<span className="notification-nowrap">{pseudonym}</span>{text.slice(at + pseudonym.length)}</>;
}

function Entry({ item, onOpen, onMarkRead }: { item: NotificationView; onOpen: (item: NotificationView, event: MouseEvent<HTMLAnchorElement>) => void; onMarkRead: (id: number) => void }): JSX.Element {
  const route = notificationRoute(item);
  return <li className={`notification-entry${item.read ? "" : " notification-unread"}`}>
    <a className="notification-link" href={routeHref(route)} onClick={event => onOpen(item, event)}>
      <span className="notification-dot" aria-hidden="true" />
      <span className="notification-body">
        {!item.read && <span className="visually-hidden">Unread: </span>}
        <span className="notification-text">{keepTogether(notificationText(item), item.actor?.pseudonym)}</span>
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
  const markAllButton = useRef<HTMLButtonElement>(null);
  /** Until the first list after opening is shown: only then is "Mark all as read" a focus that was not chosen. */
  const arriving = useRef(false);
  // The list arrives after the popover opened and took focus (onto the dialog, or "Mark all as read", the only control
  // while it loads), or the focused "Mark as read" is gone: focus moves on to the newest entry.
  useEffect(() => {
    if (!open || !items?.length) return;
    const first = arriving.current;
    arriving.current = false;
    const panel = document.getElementById(panelId);
    const dialog = panel?.closest('[role="dialog"]');
    const active = document.activeElement;
    if (panel && (active === dialog || active === document.body || (first && active === markAllButton.current))) panel.querySelector<HTMLElement>("a")?.focus();
  }, [open, items, panelId]);
  const toggle = () => {
    if (!open) { load(); arriving.current = true; }
    setOpen(!open);
  };
  const close = () => setOpen(false);
  const openEntry = (item: NotificationView, event: MouseEvent<HTMLAnchorElement>) => {
    if (!item.read) markRead(item.id);
    if (event.defaultPrevented || event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    close();
    onNavigate(notificationRoute(item));
    // Issue 619: a new question; the Questions page (if open) and "Questions (n)" load it.
    if (item.kind === "question_received") notifyQuestionsChanged();
  };
  const anyUnread = !!items?.some(item => !item.read);
  // After it, focus goes to the list, where the person goes on reading.
  const markAll = () => {
    if (!anyUnread) return;
    markAllRead();
    document.getElementById(panelId)?.querySelector<HTMLElement>("a")?.focus();
  };
  const count = badge(unread);
  // Rule 4: the greyed button says why (issue 620).
  const markAllReason = anyUnread ? null : items !== null ? "Everything is read." : error ? "The notifications could not be loaded." : "Loading…";
  return <>
    <button ref={anchor} type="button" className="btn btn-quiet btn-sm shell-notifications" aria-label={bellLabel(unread)}
      title="Notifications" aria-haspopup="dialog" aria-expanded={open} aria-controls={open ? panelId : undefined} onClick={toggle}>
      <IconBell />{count && <span className="shell-admin-count" aria-hidden="true">{count}</span>}
    </button>
    <Popover open={open} anchorRef={anchor} label="Notifications" onClose={close} width={380}
      footer={<ReasonButton ref={markAllButton} variant="secondary" size="sm" className="notification-mark-all" reason={markAllReason} onClick={markAll}>Mark all as read</ReasonButton>}>
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
