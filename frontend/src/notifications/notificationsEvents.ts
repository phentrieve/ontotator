/**
 * Window event fired when the bell's unread count changes after it was known (issue 629): a new notification (a
 * question asked, a report answered) or one marked read. Pages that show what a notification is about (the Questions
 * page, "Questions (n)" in the sidebar) reload on it, so a lead who is already there sees the new question.
 */
export const NOTIFICATIONS_CHANGED = "notifications-changed";

export function notifyNotificationsChanged(): void {
  window.dispatchEvent(new Event(NOTIFICATIONS_CHANGED));
}

/** Window event fired when the bell's unread count grows (issue 620): pages that show the same tasks load them again. */
export const NOTIFICATIONS_ARRIVED = "notifications-arrived";

export function notifyNotificationsArrived(): void {
  window.dispatchEvent(new Event(NOTIFICATIONS_ARRIVED));
}
