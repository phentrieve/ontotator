import { useEffect, useRef, useState, type ReactNode } from "react";
import { IconButton } from "../ui/IconButton";
import { IconClose } from "../ui/icons";

/**
 * Hints that can be hidden once read (issue 540): a line of help that is useful the first few times and then only
 * takes room in the right column. Hidden hints are kept in this browser; "Show hints again" in the case's "More"
 * menu brings them all back.
 */
export const HINTS_READ_KEY = "ontotator.editor.hintsRead.v1";
const HINTS_CHANGED = "ontotator:hints-changed";

export function readHints(): string[] {
  try {
    const parsed: unknown = JSON.parse(window.localStorage.getItem(HINTS_READ_KEY) ?? "[]");
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : [];
  } catch {
    return [];
  }
}

function writeHints(ids: string[]): void {
  try {
    if (ids.length) window.localStorage.setItem(HINTS_READ_KEY, JSON.stringify(ids));
    else window.localStorage.removeItem(HINTS_READ_KEY);
  } catch { /* Blocked storage: the hint is hidden until the page is reloaded. */ }
  window.dispatchEvent(new Event(HINTS_CHANGED));
}

/** The hidden hints, following changes made elsewhere on the page. */
export function useHintsRead(): string[] {
  const [ids, setIds] = useState(readHints);
  useEffect(() => {
    const update = () => setIds(readHints());
    window.addEventListener(HINTS_CHANGED, update);
    return () => window.removeEventListener(HINTS_CHANGED, update);
  }, []);
  return ids;
}

export const hideHint = (id: string) => writeHints([...new Set([...readHints(), id])]);
export const showHintsAgain = () => writeHints([]);

export function DismissibleHint({ id, children, className = "form-hint" }: { id: string; children: ReactNode; className?: string }) {
  const hidden = useHintsRead().includes(id);
  const ref = useRef<HTMLParagraphElement>(null);
  if (hidden) return null;
  return <p ref={ref} className={`${className} dismissible-hint`} data-hint={id}>
    <span>{children}</span>
    <IconButton size="sm" variant="quiet" className="dismissible-hint__hide" label="Hide this hint" icon={<IconClose />}
      title="Hide this hint. More › Show hints again brings it back."
      onClick={() => {
        // The button goes with the hint: the focus stays in the section it was in, not on the page.
        const section = ref.current?.parentElement;
        if (section && document.activeElement && ref.current?.contains(document.activeElement)) {
          if (!section.hasAttribute("tabindex")) section.setAttribute("tabindex", "-1");
          section.focus({ preventScroll: true });
        }
        hideHint(id);
      }} />
  </p>;
}
