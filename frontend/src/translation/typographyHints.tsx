import { useId, useState } from "react";
import type { DraftTypographyHints } from "../api/client";
import { Button } from "../ui";
import { invisibleNodes } from "./invisibles";

/** Rule codes of the server (`ontotator.domain.typography`) in words; the rules themselves stay on the server. */
export const typographyRuleLabels: Readonly<Record<string, string>> = {
  DOUBLE_SPACE: "double space",
  SPACE_BEFORE_PUNCTUATION: "space before punctuation",
  MISSING_SPACE_AFTER_PUNCTUATION: "no space after punctuation",
  TRAILING_WHITESPACE_LINE: "space at the end of a line",
  TRAILING_WHITESPACE_TEXT: "space or empty lines at the end of the text",
  TAB: "tab",
  ZERO_WIDTH_CHARACTER: "zero-width character",
  SOFT_HYPHEN: "soft hyphen",
  CONTROL_CHARACTER: "control character",
  DOUBLE_FULL_STOP: "doubled full stop",
};

/** A rule this version of the page does not know is shown by its code in words. */
export function typographyRuleLabel(rule: string): string {
  return Object.hasOwn(typographyRuleLabels, rule) ? typographyRuleLabels[rule] : rule.replace(/_/g, " ").toLowerCase();
}

/** "3 typography hints", "1 typography hint". */
export function typographyHintCount(total: number): string {
  return `${total} typography ${total === 1 ? "hint" : "hints"}`;
}

/**
 * The line of the submit confirmation: "2 typography hints in your text: double space (2)." `own`: the reviewer
 * edited the text; otherwise the hints are those of the version as it is.
 */
export function typographyHintsSummary(total: number, counts: Readonly<Record<string, number>>, own: boolean): string {
  const rules = Object.entries(counts).map(([rule, count]) => (count > 1 ? `${typographyRuleLabel(rule)} (${count})` : typographyRuleLabel(rule)));
  return `${typographyHintCount(total)} in ${own ? "your text" : "this text"}: ${rules.join(", ")}.`;
}

/** Code points of context shown on each side of a hint; never across a line break. */
const CONTEXT = 24;
/** Hints listed under "Show them". */
export const HINTS_SHOWN = 20;

export interface HintExcerpt { rule: string; before: string; marked: string; after: string; cutBefore: boolean; cutAfter: boolean }

/** The place of each hint in `text`: the hint's characters with a little text around them. Positions count code points, as the server does. */
export function hintExcerpts(text: string, hints: readonly { rule: string; start: number; end: number }[]): HintExcerpt[] {
  const points = Array.from(text);
  return hints.filter(hint => hint.start >= 0 && hint.start <= hint.end && hint.end <= points.length).map(hint => {
    let from = hint.start, to = hint.end;
    while (from > 0 && hint.start - from < CONTEXT && !/[\r\n]/.test(points[from - 1])) from--;
    while (to < points.length && to - hint.end < CONTEXT && !/[\r\n]/.test(points[to])) to++;
    return {
      rule: hint.rule, before: points.slice(from, hint.start).join(""), marked: points.slice(hint.start, hint.end).join(""), after: points.slice(hint.end, to).join(""),
      cutBefore: from > 0 && !/[\r\n]/.test(points[from - 1]), cutAfter: to < points.length && !/[\r\n]/.test(points[to]),
    };
  });
}

/**
 * Typography hints of the text a review would save, in the confirmation of "Submit review…" (issue 484): one line
 * and, behind "Show them", the place of each hint with its invisible characters drawn. It blocks nothing.
 * Nothing is rendered without hints.
 */
export function TypographyHintsNote({ text, found, own }: { text: string; found: Pick<DraftTypographyHints, "total" | "counts" | "hints">; own: boolean }): JSX.Element | null {
  const id = useId();
  const [open, setOpen] = useState(false);
  if (found.total === 0) return null;
  const excerpts = open ? hintExcerpts(text, found.hints.slice(0, HINTS_SHOWN)) : [];
  const more = found.total - excerpts.length;
  return <div className="review-confirm-hints">
    <p>
      <span>{typographyHintsSummary(found.total, found.counts, own)}</span>{" "}
      <Button variant="quiet" size="sm" aria-expanded={open} aria-controls={`${id}-list`} onClick={() => setOpen(value => !value)}>{open ? "Hide them" : "Show them"}</Button>
    </p>
    <div id={`${id}-list`} hidden={!open}>
      {open && <>
        <ol className="review-confirm-hint-list" aria-label="Typography hints">
          {excerpts.map((excerpt, index) => <li key={index}>
            <span className="review-confirm-hint-rule">{typographyRuleLabel(excerpt.rule)}</span>
            <span className="review-confirm-hint-excerpt show-invisibles">
              {excerpt.cutBefore && "…"}{invisibleNodes(excerpt.before, `b${index}`)}<mark>{invisibleNodes(excerpt.marked, `m${index}`)}</mark>{invisibleNodes(excerpt.after, `a${index}`)}{excerpt.cutAfter && "…"}
            </span>
          </li>)}
        </ol>
        {more > 0 && <p className="review-confirm-hints-more">and {more} more</p>}
        <p className="review-confirm-hints-more">To change the text, choose Keep editing. Show invisible characters marks spaces in the text.</p>
      </>}
    </div>
  </div>;
}
