import { useCallback, useEffect, useRef, useState } from "react";
import { api, onSessionRestored, type NotificationView } from "../api/client";
import { TASKS_CHANGED } from "../tasks/tasksEvents";
import { notifyNotificationsArrived, notifyNotificationsChanged } from "./notificationsEvents";

/** Background refresh of the bell's count, as the navigation counters do (no push channel). */
export const NOTIFICATIONS_REFRESH_MS = 60_000;

export interface NotificationsState {
  /** Null while unknown; a failed reload keeps the last value. */
  unread: number | null;
  /** Null until the list was loaded once (on opening the bell). */
  items: NotificationView[] | null;
  error: boolean;
  /** Loads the list (and the count with it). */
  load: () => void;
  markRead: (id: number) => void;
  markAllRead: () => void;
  /** Loads the count again (the shell calls it on every in-app navigation, issue 620). */
  refresh: () => void;
}

/**
 * The header bell (issue 557): the unread count is loaded once, on window focus, on a restored session, every 60 s,
 * on `tasks-changed` and on `refresh` (in-app navigation); the list only when the bell opens. Marking read updates
 * the list at once and takes the server's count back. A count that grows fires `notifications-arrived`, so a page
 * that shows the same tasks (My tasks) loads them again (issue 620). Any change of a known count fires
 * `notifications-changed`, so the Questions page loads its questions again (issue 629).
 */
export function useNotifications(username: string): NotificationsState {
  const [unread, setUnread] = useState<number | null>(null);
  const [items, setItems] = useState<NotificationView[] | null>(null);
  const [error, setError] = useState(false);
  const alive = useRef(true);
  const itemsRef = useRef(items);
  itemsRef.current = items;
  const countRef = useRef<() => void>(() => undefined);
  /** The last count from the server (null: none yet for this person); marking read lowers it too. */
  const known = useRef<number | null>(null);
  const take = useCallback((value: number) => { known.current = value; setUnread(value); }, []);
  // The last known count of this user; null after a user change, so the first count fires nothing.
  const shown = useRef<number | null>(null);
  useEffect(() => {
    if (unread === null) { shown.current = null; return; }
    const before = shown.current;
    shown.current = unread;
    if (before !== null && before !== unread) notifyNotificationsChanged();
  }, [unread]);
  useEffect(() => {
    alive.current = true;
    setUnread(null);
    setItems(null);
    let generation = 0;
    known.current = null;
    const count = () => {
      const request = ++generation;
      api.notificationSummary().then(summary => {
        if (!alive.current || request !== generation || !summary) return;
        if (known.current !== null && summary.unread > known.current) notifyNotificationsArrived();
        take(summary.unread);
      }, () => { /* The bell keeps its last count. */ });
    };
    countRef.current = count;
    count();
    window.addEventListener("focus", count);
    window.addEventListener(TASKS_CHANGED, count);
    const timer = window.setInterval(count, NOTIFICATIONS_REFRESH_MS);
    const stopRestored = onSessionRestored(count);
    return () => {
      alive.current = false;
      window.removeEventListener("focus", count);
      window.removeEventListener(TASKS_CHANGED, count);
      window.clearInterval(timer);
      stopRestored();
    };
  }, [username, take]);
  const load = useCallback(() => {
    api.listNotifications().then(list => {
      if (!alive.current || !list) return;
      setItems(list.items);
      take(list.unread);
      setError(false);
    }, () => { if (alive.current) setError(true); });
  }, [take]);
  const markRead = useCallback((id: number) => {
    setItems(current => current?.map(item => item.id === id ? { ...item, read: true } : item) ?? null);
    api.markNotificationRead(id).then(summary => { if (alive.current && summary) take(summary.unread); }, () => { /* The next load shows the truth. */ });
  }, [take]);
  const markAllRead = useCallback(() => {
    // Up to the newest entry shown: one that arrived since stays unread.
    const newest = itemsRef.current?.[0]?.id;
    setItems(current => current?.map(item => ({ ...item, read: true })) ?? null);
    api.markAllNotificationsRead(newest).then(summary => { if (alive.current && summary) take(summary.unread); }, () => { /* As above. */ });
  }, [take]);
  const refresh = useCallback(() => countRef.current(), []);
  return { unread, items, error, load, markRead, markAllRead, refresh };
}
