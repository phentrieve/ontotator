import { useId, useMemo, useState, type ReactNode } from "react";
import type { RoundSourceText } from "../api/client";
import { changePassages, changeRanges, diffTextBounded, type ChangePassage, type TextChanges } from "../translation/textDiff";
import { Button, Checkbox } from "../ui";

/** The earlier version carried work came from: the version number and its exact text. */
export type ChangesSource = Pick<RoundSourceText, "version" | "text">;

export interface ChangesSinceView {
  /** The switch, and while it is on the passage count with Previous / Next; goes over the text. */
  bar: ReactNode;
  /** Added text (TextPane `changes`), null while the switch is off. */
  changes: TextChanges | null;
  /** Changed passages (TextPane `passages`), null while the switch is off. */
  passages: ChangePassage[] | null;
  /** "v1", for TextPane `passagesSince`. */
  since: string;
  /** The passage Previous / Next moved to (TextPane `currentPassage`); -1 before the first step. */
  current: number;
}

/** Shown instead of marks when the bounded word diff gives up (`diffTextBounded`). */
export const TOO_DIFFERENT = "The texts differ too much to show the changes.";
export const changesSinceLabel = (version: number): string => `Show changes since v${version}`;

/** "1 passage changed", "3 passages changed · 2 of 3", "No text changes since v1". */
export function passageCountText(count: number, current: number, version: number): string {
  if (count === 0) return `No text changes since v${version}`;
  const total = `${count} ${count === 1 ? "passage" : "passages"} changed`;
  return current >= 0 ? `${total} · ${current + 1} of ${count}` : total;
}

/**
 * Show changes since vN (issue 421) for a round carried from an earlier version: off by default, a pure overlay on
 * the text (marking stays possible; the text stays exactly this version). Null without such a source.
 */
export function useChangesSince(source: ChangesSource | null | undefined, text: string, textElement: HTMLElement | null): ChangesSinceView | null {
  const id = useId();
  const [on, setOn] = useState(false);
  const [current, setCurrent] = useState(-1);
  const sourceText = source?.text;
  const diff = useMemo(() => {
    if (!on || sourceText === undefined) return null;
    // Bounded as every Show changes: two texts that differ too much get a line instead of marks.
    const parts = diffTextBounded(sourceText, text);
    const added = changeRanges(sourceText, text, parts)?.added, passages = changePassages(sourceText, text, parts);
    return added && passages ? { added, passages } : "too-different" as const;
  }, [on, sourceText, text]);
  if (!source) return null;
  const tooDifferent = diff === "too-different";
  const shown = diff && diff !== "too-different" ? diff : null;
  const count = shown?.passages.length ?? 0;
  const goTo = (index: number) => {
    const passage = textElement?.querySelector<HTMLElement>(`.change-passage[data-passage="${index}"]`);
    if (!passage) return;
    // Focus stays on Previous / Next (the status line names the step; both wrap around, so neither ever disables
    // itself under focus); the passage gets a solid frame.
    passage.scrollIntoView?.({ block: "center" });
    setCurrent(index);
  };
  const bar = <div className="changes-since" role="group" aria-label="Text changes">
    <Checkbox id={`${id}-show`} label={changesSinceLabel(source.version)} checked={on}
      onChange={event => { setOn(event.target.checked); setCurrent(-1); }} />
    {tooDifferent && <p className="changes-since__nav"><span role="status">{TOO_DIFFERENT}</span></p>}
    {shown && <p className="changes-since__nav">
      <span role="status">{passageCountText(count, current, source.version)}</span>
      {count > 0 && <>
        <Button size="sm" variant="quiet" onClick={() => goTo(current <= 0 ? count - 1 : current - 1)}>‹ Previous</Button>
        <Button size="sm" variant="quiet" onClick={() => goTo((current + 1) % count)}>Next ›</Button>
      </>}
    </p>}
  </div>;
  return {
    bar,
    changes: shown ? { op: "insert", ranges: shown.added } : null,
    passages: shown?.passages ?? null,
    since: `v${source.version}`,
    current,
  };
}
