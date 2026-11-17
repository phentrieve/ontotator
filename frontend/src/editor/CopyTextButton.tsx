import { useEffect, useRef, useState } from "react";
import { Button } from "../ui/Button";
import { IconButton } from "../ui/IconButton";
import { IconCheck, IconCopy } from "../ui/icons";

const LABELS = { idle: "Copy text", copied: "Copied", failed: "Copy failed" } as const;
const TITLE = "Copy this text to the clipboard, for example to look it up";

/**
 * "Copy text": puts a passage on the clipboard (to look it up elsewhere); the label says "Copied" for a moment,
 * `onAnnounce` tells screen readers. `compact` shows only an icon (a check once copied).
 */
export function CopyTextButton({ text, onAnnounce, compact = false }: { text: string; onAnnounce?: (message: string) => void; compact?: boolean }): JSX.Element {
  const [state, setState] = useState<"copied" | "failed" | null>(null);
  const timer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(timer.current), []);
  // Another passage (a new mark, another finding) has not been copied yet.
  useEffect(() => { window.clearTimeout(timer.current); setState(null); }, [text]);
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
  const shown = state ?? "idle";
  if (compact) {
    return <IconButton variant="secondary" size="sm" label={LABELS.idle} title={TITLE}
      icon={shown === "copied" ? <IconCheck /> : <IconCopy />} onClick={() => { void copy(); }} />;
  }
  // Every label sits in the same grid cell, only the current one visible: the width never changes, nothing beside it moves.
  return <Button type="button" variant="secondary" size="sm" title={TITLE} onClick={() => { void copy(); }}>
    <span className="copy-text__labels">
      {(Object.keys(LABELS) as Array<keyof typeof LABELS>).map(key =>
        <span key={key} className={key === shown ? undefined : "copy-text__label--off"} aria-hidden={key === shown ? undefined : true}>{LABELS[key]}</span>)}
    </span>
  </Button>;
}
