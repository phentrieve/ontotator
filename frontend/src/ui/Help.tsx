/**
 * Explanations on demand (issue 556, rule "Panels and actions" in docs/design.md): a visible (?) button next to a
 * field or action that shows a short explanation in place, and the reason of a greyed action that shows when the
 * action is pointed at, focused or pressed. Both work by touch and keyboard; neither is a tooltip only.
 */
import { forwardRef, useCallback, useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode, type RefObject } from "react";
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

/** The explanation of a (?) button: hidden until the button opens it. */
export function HelpText({ help, children }: { help: HelpState; children: ReactNode }): JSX.Element {
  return <div id={help.id} className="ui-help-text" hidden={!help.open} onKeyDown={closeOnEscape(help)}>{children}</div>;
}

export interface ReasonButtonProps extends ButtonProps {
  /** Why the action cannot be taken now; null when it can. The button is greyed (`aria-disabled`) and stays focusable. */
  reason: string | null;
}

/**
 * A button that can be greyed with a reason (rule 4). The reason is its accessible description and its `title`
 * (the tooltip a greyed control has everywhere, as in `InlineConfirm`); it also shows next to the button while the
 * button is pointed at or focused, and after a press, so a touch or keyboard user sees it too.
 * A press still calls `onClick`, so the dialog can show what is missing in place.
 */
export const ReasonButton = forwardRef<HTMLButtonElement, ReasonButtonProps>(function ReasonButton(
  { reason, onClick, onFocus, onBlur, ...props }, ref,
) {
  const id = useId();
  const [focused, setFocused] = useState(false);
  const [pressed, setPressed] = useState(false);
  // A new reason (or none) is not the one that was pressed.
  useEffect(() => { setPressed(false); }, [reason]);
  const describedBy = [props["aria-describedby"], reason ? `${id}-reason` : null].filter(Boolean).join(" ") || undefined;
  return <span className="ui-reason-anchor">
    <Button {...props} ref={ref} aria-disabled={reason ? true : props["aria-disabled"]} aria-describedby={describedBy}
      title={reason ?? props.title}
      onFocus={event => { setFocused(true); onFocus?.(event); }} onBlur={event => { setFocused(false); setPressed(false); onBlur?.(event); }}
      onClick={event => { if (reason) setPressed(true); onClick?.(event); }} />
    {reason && <span id={`${id}-reason`} className="ui-reason-tip" data-shown={focused || pressed ? "true" : undefined}>{reason}</span>}
  </span>;
});
