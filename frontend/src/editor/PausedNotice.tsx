import { useId, useState } from "react";
import { Button } from "../ui/Button";
import { InlineMessage } from "../ui/InlineMessage";

/**
 * Issue 232: the editor's paused banner, collapsed by default. "Task paused: {reason}" in up to two lines (three on a
 * phone, issue 611), cut at a word when it is longer; "Show more" opens the full reason and what stays available.
 */
export function PausedNotice({ reason, kept, title = "Task paused" }: { reason?: string | null; kept: string; /** "Paused by lead" when the lead paused the text (issue 464). */ title?: string }): JSX.Element {
  const [open, setOpen] = useState(false);
  const id = useId();
  return <InlineMessage tone="warning">
    <div className={open ? "paused-notice paused-notice--open" : "paused-notice"}>
      <div id={id} className="paused-notice__text">
        <span className="paused-notice__reason">{title}: {reason?.trim() || "A project problem needs attention."}</span>
        {open && <span className="paused-notice__kept">{kept}</span>}
      </div>
      <Button variant="quiet" size="sm" className="paused-notice__toggle" aria-expanded={open} aria-controls={id}
        onClick={() => setOpen(value => !value)}>{open ? "Show less" : "Show more"}</Button>
    </div>
  </InlineMessage>;
}
