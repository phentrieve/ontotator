import { useEffect, useRef, useState } from "react";
import { IconButton } from "../ui/IconButton";
import { IconCheck, IconCopy, IconWarning } from "../ui/icons";

const LABELS = { idle: "Copy text", copied: "Copied", failed: "Copy failed" } as const;
const TITLE = "Copy this text to the clipboard, for example to look it up";

/**
 * "Copy text": an icon button that puts a passage on the clipboard (to look it up elsewhere). For a moment its
 * name says "Copied" (a check) or "Copy failed" (a warning); `onAnnounce` tells screen readers. An icon keeps
 * the row it sits in short, at every width. Line breaks and runs of whitespace in `text` are copied as one
 * space, as `passageText` does for Ctrl+C.
 */
export function CopyTextButton({ text, onAnnounce }: { text: string; onAnnounce?: (message: string) => void }): JSX.Element {
  const [state, setState] = useState<"copied" | "failed" | null>(null);
  const timer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(timer.current), []);
  // Another passage (a new mark, another finding) has not been copied yet.
  useEffect(() => { window.clearTimeout(timer.current); setState(null); }, [text]);
  const copy = async () => {
    let next: "copied" | "failed" = "copied";
    try {
      if (!navigator.clipboard?.writeText) throw new Error("Clipboard unavailable");
      await navigator.clipboard.writeText(text.replace(/\s+/gu, " ").trim());
    } catch { next = "failed"; }
    setState(next);
    onAnnounce?.(next === "copied" ? "Copied the text." : "Could not copy the text.");
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setState(null), 2000);
  };
  const icon = state === "copied" ? <IconCheck /> : state === "failed" ? <IconWarning /> : <IconCopy />;
  return <IconButton type="button" variant="secondary" size="sm" label={LABELS[state ?? "idle"]}
    title={state ? LABELS[state] : TITLE} icon={icon} onClick={() => { void copy(); }} />;
}
