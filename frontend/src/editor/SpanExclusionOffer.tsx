import { useEffect, useRef } from "react";
import { Button } from "../ui/Button";
import { InlineMessage } from "../ui/InlineMessage";
import { quoteOf } from "./modifiers";
import { previewParts, type SpanExclusion } from "./spanExclusion";
import "./spanExclusion.css";

export interface SpanExclusionOfferProps {
  /** The finding's term label, e.g. "Seizure". */
  finding: string;
  /** The modifier's term label, e.g. "Severe". */
  modifier: string;
  text: string;
  offer: SpanExclusion;
  onAccept: () => void;
  onDismiss: () => void;
  /** Opened from the modifier's row (its menu or "In span · Exclude"): focus goes to Exclude from span. */
  autoFocus?: boolean;
}

/** Copy of the offer in one place. */
export const exclusionCopy = {
  question: (words: string, finding: string) => `Exclude “${words}” from the text span of ${finding}?`,
  accept: "Exclude from span",
  dismiss: "Keep span",
  done: (words: string, finding: string) => `Excluded “${words}” from the text span of ${finding}.`,
};

/**
 * Shown under Modifiers once a modifier's text lies inside its finding's span: the span now, its words that go struck
 * through, and the span after. Accept edits the finding's mention; Keep span changes nothing. It opens after the modifier's
 * span is saved, or from the modifier's row ("Exclude from finding's span" in its menu, "In span · Exclude").
 */
export function SpanExclusionOffer({ finding, modifier, text, offer, onAccept, onDismiss, autoFocus = false }: SpanExclusionOfferProps): JSX.Element {
  const words = quoteOf(text, offer.removed);
  const accept = useRef<HTMLButtonElement>(null);
  const box = useRef<HTMLDivElement>(null);
  // The box opens under Modifiers, often below the fold of the right column (a laptop window): bring it into view, only as
  // far as needed. The rows above it still settle after it mounts (the new modifier row), so it follows for a moment.
  useEffect(() => {
    const element = box.current;
    if (!element) return;
    const behavior: ScrollBehavior = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth";
    const reveal = () => element.scrollIntoView?.({ block: "nearest", behavior });
    reveal();
    if (typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(([entry]) => { if (entry.intersectionRatio < 1) reveal(); }, { threshold: 1 });
    observer.observe(element);
    const stop = window.setTimeout(() => observer.disconnect(), 1000);
    return () => { observer.disconnect(); window.clearTimeout(stop); };
  }, [offer.evidenceId]);
  // From the modifier's row (its menu or "In span · Exclude"): the focus goes to Exclude from span.
  useEffect(() => { if (autoFocus) accept.current?.focus({ preventScroll: true }); }, [autoFocus, offer.evidenceId]);
  return <div ref={box} className="mod-exclude" data-span-exclusion>
    <InlineMessage tone="info" aria-label={`Exclude ${modifier} from the span`}>
      <p className="mod-exclude-question">{exclusionCopy.question(words, finding)}</p>
      <dl className="mod-exclude-preview">
        <dt>Now</dt>
        <dd data-exclusion-before>{previewParts(text, offer).map((part, index) => part.removed
          ? <del key={index}>{part.text}</del> : <span key={index}>{part.text}</span>)}</dd>
        <dt>After</dt>
        <dd data-exclusion-after>{quoteOf(text, offer.after)}</dd>
      </dl>
      <div className="mod-exclude-actions">
        <Button ref={accept} size="sm" variant="primary" onClick={onAccept}>{exclusionCopy.accept}</Button>
        <Button size="sm" onClick={onDismiss}>{exclusionCopy.dismiss}</Button>
      </div>
    </InlineMessage>
  </div>;
}
