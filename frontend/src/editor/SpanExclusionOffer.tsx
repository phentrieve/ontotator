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
 * through, and the span after. Accept edits the finding's mention; Keep span changes nothing.
 */
export function SpanExclusionOffer({ finding, modifier, text, offer, onAccept, onDismiss }: SpanExclusionOfferProps): JSX.Element {
  const words = quoteOf(text, offer.removed);
  return <div className="mod-exclude" data-span-exclusion>
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
        <Button size="sm" variant="primary" onClick={onAccept}>{exclusionCopy.accept}</Button>
        <Button size="sm" onClick={onDismiss}>{exclusionCopy.dismiss}</Button>
      </div>
    </InlineMessage>
  </div>;
}
