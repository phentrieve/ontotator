import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { Button } from "./Button";
import { IconButton } from "./IconButton";
import { IconCheck, IconClose, IconUndo } from "./icons";
import { useShortcut } from "./shortcuts";

export interface ToastMessage {
  id: number;
  message: string;
  actionLabel?: string;
  onAction?: () => void;
  /** The action reverts the reported change: it shows the undo icon and runs on Ctrl+Z / Meta+Z. */
  undo?: boolean;
  /** The action is an offer in plain text, without the check icon (e.g. "Select the 2 texts with withdrawn tasks"). */
  plain?: boolean;
  note?: string;
  /** Stays until dismissed or replaced (an offer the user may need after the next action, e.g. skipped cases). */
  persist?: boolean;
}

/** Controls that sit at the viewport bottom and must stay visible: the floating selection bar and dialog footers. */
const BOTTOM_OBSTACLES = ".selection-bar, .ui-dialog > .modal-actions";
/** An obstacle counts when its bottom edge is this close to the viewport bottom. */
const BOTTOM_ZONE = 48;

/** Height the toast must clear above the viewport bottom (0 without an obstacle there). */
function bottomOffset(): number {
  const height = window.innerHeight;
  let offset = 0;
  for (const element of document.querySelectorAll<HTMLElement>(BOTTOM_OBSTACLES)) {
    const box = element.getBoundingClientRect();
    if (box.height <= 0 || box.top >= height || box.bottom < height - BOTTOM_ZONE) continue;
    offset = Math.max(offset, Math.ceil(height - box.top));
  }
  return offset;
}

/** Modal dialogs on the page now (`Dialog` and every other `aria-modal` dialog). */
const openDialogs = (): Element[] => Array.from(document.querySelectorAll('[role="dialog"][aria-modal="true"]'));

let nextId = 1;

/** One toast at a time: `show` replaces the current one. */
export function useToast(): { toast: ToastMessage | null; show: (t: Omit<ToastMessage, "id">) => void; dismiss: () => void } {
  const [toast, setToast] = useState<ToastMessage | null>(null);
  const show = useCallback((t: Omit<ToastMessage, "id">) => setToast({ ...t, id: nextId++ }), []);
  const dismiss = useCallback(() => setToast(null), []);
  return { toast, show, dismiss };
}

/**
 * Polite toast for reversible saved changes. The region is always rendered so screen readers pick up new
 * messages; the toast never takes focus, closes after `durationMs` (paused while hovered or focused; never with `persist`) and its
 * Undo action also runs on Ctrl+Z / Meta+Z outside text fields. It sits above the floating selection bar or a
 * dialog footer at the viewport bottom (`--toast-offset`).
 *
 * A toast of an earlier action never covers a dialog opened after it (issue 439): while such a dialog is open the
 * toast is not shown (`data-behind-dialog`) and its time does not run; when the dialog closes it is back, with its
 * action and the full time. A toast shown while a dialog is open reports that dialog's own action and stays visible.
 */
export function Toast({ toast, onDismiss, durationMs = 10_000, undoDescription = "Undo the last plan change", undoGroup = "Selection" }: {
  toast: ToastMessage | null; onDismiss: () => void; durationMs?: number;
  /** The Ctrl+Z line of the shortcut help ("Undo the last decision" in the consolidation view). */
  undoDescription?: string; undoGroup?: string;
}): JSX.Element {
  const [paused, setPaused] = useState({ hover: false, focus: false });
  const dismissRef = useRef(onDismiss);
  dismissRef.current = onDismiss;
  const region = useRef<HTMLDivElement>(null);
  /** The dialogs that were open when this toast appeared: only a dialog opened later hides it. */
  const dialogsAtShow = useRef<{ id: number; dialogs: Set<Element> } | null>(null);
  const [behindDialog, setBehindDialog] = useState(false);
  const holding = paused.hover || paused.focus || behindDialog;

  useLayoutEffect(() => {
    const element = region.current;
    if (!element) return;
    if (!toast) { element.style.setProperty("--toast-offset", "0px"); dialogsAtShow.current = null; setBehindDialog(false); return; }
    if (dialogsAtShow.current?.id !== toast.id) dialogsAtShow.current = { id: toast.id, dialogs: new Set(openDialogs()) };
    const known = dialogsAtShow.current.dialogs;
    let frame = 0;
    const behind = () => { setBehindDialog(openDialogs().some(dialog => !known.has(dialog))); };
    const measure = () => { element.style.setProperty("--toast-offset", `${bottomOffset()}px`); };
    const schedule = () => { cancelAnimationFrame(frame); frame = requestAnimationFrame(measure); };
    measure();
    behind();
    // A dialog or the selection bar can appear while the toast is visible. The dialog check runs at once, before
    // the next paint, so the toast is never drawn over the new dialog; the measurement waits for the layout.
    const observer = new MutationObserver(() => { behind(); schedule(); });
    observer.observe(document.body, { childList: true, subtree: true });
    window.addEventListener("resize", schedule);
    window.addEventListener("scroll", schedule, { capture: true, passive: true });
    // The selection bar slides in (8 px): measured mid-animation, the toast would cover its top edge.
    document.addEventListener("animationend", schedule, true);
    return () => {
      observer.disconnect();
      cancelAnimationFrame(frame);
      window.removeEventListener("resize", schedule);
      window.removeEventListener("scroll", schedule, { capture: true });
      document.removeEventListener("animationend", schedule, true);
    };
  }, [toast]);

  useEffect(() => { setPaused({ hover: false, focus: false }); }, [toast?.id]);
  useEffect(() => {
    if (!toast || holding || toast.persist) return;
    const timer = window.setTimeout(() => dismissRef.current(), durationMs);
    return () => window.clearTimeout(timer);
  }, [toast, holding, durationMs]);

  const runAction = () => {
    if (!toast?.onAction) return;
    const action = toast.onAction;
    onDismiss();
    action();
  };
  // Checkboxes and radios are not typing targets, so this also works from a focused case checkbox.
  useShortcut(["Ctrl+z", "Meta+z"], runAction, { scope: "screen", description: undoDescription, group: undoGroup, enabled: !!toast?.onAction && !!toast.undo && !behindDialog });

  return (
    <div ref={region} role="status" aria-live="polite" className="ui-toast-region" data-behind-dialog={toast && behindDialog ? "" : undefined}>
      {toast && (
        <div
          key={toast.id}
          className="ui-toast"
          onMouseEnter={() => setPaused((p) => ({ ...p, hover: true }))}
          onMouseLeave={() => setPaused((p) => ({ ...p, hover: false }))}
          onFocus={() => setPaused((p) => ({ ...p, focus: true }))}
          onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setPaused((p) => ({ ...p, focus: false })); }}
        >
          <span className="ui-toast-message" title={toast.message}>{toast.message}</span>
          {toast.note && <span className="ui-toast-note">{toast.note}</span>}
          {toast.onAction && <Button size="sm" className="ui-toast-action" icon={toast.undo ? <IconUndo className="ui-toast-undo-icon" /> : toast.plain ? undefined : <IconCheck />} onClick={runAction}>{toast.actionLabel ?? "Undo"}</Button>}
          <IconButton size="sm" variant="quiet" className="ui-toast-close" label="Dismiss" icon={<IconClose />} onClick={onDismiss} />
        </div>
      )}
    </div>
  );
}
