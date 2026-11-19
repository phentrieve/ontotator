const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const two = (n: number) => String(n).padStart(2, "0");

/**
 * The day of something that happened, as the card rows and My tasks say it: "today 10:40", "yesterday", "Mon"
 * (within 7 days), else "14 Oct". One rule for "assigned …" and "Submitted …" (issue 472).
 */
export function relativeDay(at: Date, now: Date): string {
  const day = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  // Rounded: a daylight-saving day is 23 or 25 hours long.
  const days = Math.round((day(now) - day(at)) / 86_400_000);
  if (days <= 0) return `today ${two(at.getHours())}:${two(at.getMinutes())}`;
  if (days === 1) return "yesterday";
  if (days < 7) return WEEKDAYS[at.getDay()];
  return `${at.getDate()} ${MONTHS[at.getMonth()]}`;
}

/** "assigned today 10:40", "assigned yesterday", "assigned Mon" (within 7 days), else "assigned 14 Oct". */
export function assignedText(at: Date, now: Date): string {
  return `assigned ${relativeDay(at, now)}`;
}

/** Hover text: "Assigned 21 Oct 2026, 16:44 by Project lead". */
export function assignedTitle(at: Date, by: string | null): string {
  const base = `Assigned ${at.getDate()} ${MONTHS[at.getMonth()]} ${at.getFullYear()}, ${two(at.getHours())}:${two(at.getMinutes())}`;
  return by ? `${base} by ${by}` : base;
}
