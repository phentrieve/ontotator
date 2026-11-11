import { useEffect, useRef, useState } from "react";
import { Button } from "../ui/Button";

/** "Copy text": puts a passage on the clipboard (to look it up elsewhere); the label says "Copied" for a moment, `onAnnounce` tells screen readers. */
export function CopyTextButton({ text, onAnnounce }: { text: string; onAnnounce?: (message: string) => void }): JSX.Element {
  const [state, setState] = useState<"copied" | "failed" | null>(null);
  const timer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(timer.current), []);
  const copy = async () => {
    let next: "copied" | "failed" = "copied";
    try {
      if (!navigator.clipboard?.writeText) throw new Error("Clipboard unavailable");
      await navigator.clipboard.writeText(text);
    } catch { next = "failed"; }
    setState(next);
    onAnnounce?.(next === "copied" ? "Copied the text." : "Could not copy the text.");
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setState(null), 2000);
  };
  return <Button type="button" variant="secondary" size="sm" title="Copy this text to the clipboard, for example to look it up"
    onClick={() => { void copy(); }}>{state === "copied" ? "Copied" : state === "failed" ? "Copy failed" : "Copy text"}</Button>;
}
