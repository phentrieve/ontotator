/**
 * Explanations on demand (issue 556, rule "Panels and actions" in docs/design.md): a visible (?) button next to a
 * field or action that shows a short explanation in place, and the reason of a greyed action that shows when the
 * action is pointed at, focused or pressed. Both work by touch and keyboard; neither is a tooltip only.
 */
import { forwardRef, useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent, type ReactNode, type RefObject } from "react";
import { Button, type ButtonProps } from "./Button";

export interface HelpState {
  /** The id of the explanation; the button's `aria-controls`. */
  id: string;
  open: boolean;
  toggle: () => void;
  /** Closes the explanation and gives the focus back to its button. */
  close: () => void;
  button: RefObject<HTMLButtonElement>;
}

/** The state of one (?) button and its explanation, which may stand apart (the button in a heading, the text below it). */
export function useHelp(): HelpState {
  const id = useId();
  const [open, setOpen] = useState(false);
  const button = useRef<HTMLButtonElement>(null);
  const toggle = useCallback(() => setOpen(value => !value), []);
  const close = useCallback(() => { setOpen(false); button.current?.focus(); }, []);
  return { id: `${id}-help`, open, toggle, close, button };
}

/** Escape closes an open explanation without closing the dialog around it. */
function closeOnEscape(help: HelpState) {
  return (event: KeyboardEvent) => {
    if (event.key !== "Escape" || !help.open) return;
    event.preventDefault(); event.stopPropagation();
    help.close();
  };
}

export interface HelpButtonProps {
  help: HelpState;
  /** What the explanation is about, e.g. "What did you fix?"; the accessible name is "Help: What did you fix?". */
  topic: string;
}

/** The (?) button: a disclosure (`aria-expanded`) for the explanation rendered by `HelpText` with the same state. */
export function HelpButton({ help, topic }: HelpButtonProps): JSX.Element {
  return <button ref={help.button} type="button" className="ui-help-button" aria-label={`Help: ${topic}`} aria-expanded={help.open}
    aria-controls={help.id} onClick={help.toggle} onKeyDown={closeOnEscape(help)}><span aria-hidden="true">?</span></button>;
}

/**
 * The explanation of a (?) button: hidden until the button opens it. Opened near the edge of a scrolling box (a
 * dialog's body), the box scrolls just enough to show it (issue 621); the button stays where it is when it fits.
 */
export function HelpText({ help, children }: { help: HelpState; children: ReactNode }): JSX.Element {
  const text = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (help.open) text.current?.scrollIntoView?.({ block: "nearest" });
  }, [help.open]);
  return <div ref={text} id={help.id} className="ui-help-text" hidden={!help.open} onKeyDown={closeOnEscape(help)}>{children}</div>;
}

const CLIPS = /auto|scroll|hidden|clip/;
type PlacementStyle = Pick<CSSStyleDeclaration, "overflowX" | "overflowY" | "position">;

/**
 * Where a greyed button's reason shows (issue 618). "above" floats over what is above the button, as in a dialog's
 * footer. Inside a box that clips its overflow (a dialog's scrolling body) a floating tip is cut at the box's edge
 * and covers the controls above it, so there it is "below": in the flow under the button, moving what follows down.
 * The walk stops at a fixed element (a dialog's overlay), which no box outside it clips.
 */
export function reasonTipPlacement(element: Element, styleOf: (element: Element) => PlacementStyle = getComputedStyle): "above" | "below" {
  for (let node = element.parentElement; node && node !== document.body && node !== document.documentElement; node = node.parentElement) {
    const style = styleOf(node);
    if (CLIPS.test(style.overflowX) || CLIPS.test(style.overflowY)) return "below";
    if (style.position === "fixed") return "above";
  }
  return "above";
}

export interface ReasonButtonProps extends ButtonProps {
  /** Why the action cannot be taken now; null when it can. The button is greyed (`aria-disabled`) and stays focusable. */
  reason: string | null;
}

/**
 * A button that can be greyed with a reason (rule 4). The reason is its accessible description and its `title`
 * (the tooltip a greyed control has everywhere, as in `InlineConfirm`); it also shows next to the button while the
 * button is pointed at or focused, and after a press, so a touch or keyboard user sees it too: above the button, or
 * under it inside a scrolling box (`reasonTipPlacement`).
 * A press still calls `onClick`, so the dialog can show what is missing in place.
 */
export const ReasonButton = forwardRef<HTMLButtonElement, ReasonButtonProps>(function ReasonButton(
  { reason, onClick, onFocus, onBlur, ...props }, ref,
) {
  const id = useId();
  const [focused, setFocused] = useState(false);
  const [pressed, setPressed] = useState(false);
  const [placement, setPlacement] = useState<"above" | "below">("above");
  const anchor = useRef<HTMLSpanElement>(null);
  useLayoutEffect(() => { if (reason && anchor.current) setPlacement(reasonTipPlacement(anchor.current)); }, [reason]);
  // A new reason (or none) is not the one that was pressed.
  useEffect(() => { setPressed(false); }, [reason]);
  // Under the button, the reason may start below the scrolling box's edge: scroll it into view as it shows.
  const shown = Boolean(reason) && (focused || pressed);
  useEffect(() => {
    if (shown && placement === "below") anchor.current?.querySelector(".ui-reason-tip")?.scrollIntoView?.({ block: "nearest" });
  }, [shown, placement]);
  const describedBy = [props["aria-describedby"], reason ? `${id}-reason` : null].filter(Boolean).join(" ") || undefined;
  return <span ref={anchor} className="ui-reason-anchor" data-tip={reason ? placement : undefined}>
    <Button {...props} ref={ref} aria-disabled={reason ? true : props["aria-disabled"]} aria-describedby={describedBy}
      title={reason ?? props.title}
      onFocus={event => { setFocused(true); onFocus?.(event); }} onBlur={event => { setFocused(false); setPressed(false); onBlur?.(event); }}
      onClick={event => { if (reason) setPressed(true); onClick?.(event); }} />
    {reason && <span id={`${id}-reason`} className="ui-reason-tip" data-shown={shown ? "true" : undefined}>{reason}</span>}
  </span>;
});
