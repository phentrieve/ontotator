import { CopyTextButton } from "../editor/CopyTextButton";
import { KEEP_MINE, LOAD_SAVED, SYNC_FAILED, UNMERGED_TEXT, UNMERGED_TITLE, USE_WORDING, WORDING_KEPT_HINT, WORDING_KEPT_TITLE, wordingApplied, wordingKept, wordingReplaces } from "../questions/labels";
import { Button, InlineMessage } from "../ui";
import type { TakenWording } from "./wordingMerge";

/** What a merge of the saved draft told the reviewer (issue 610), one notice per taken wording. */
export interface WordingNotice {
  kind: "applied" | "kept";
  wording: TakenWording;
  /** Kept: the reviewer's version of the passage, which "Use the lead's wording" replaces; empty when unknown. */
  mine: string;
}

/** The saved draft could not be merged into the text on screen. */
export type MergeTrouble = { kind: "unmerged"; revision: number; text: string } | { kind: "failed" };

const once = (text: string, part: string) => part !== "" && text.split(part).length === 2;

/**
 * Issue 610: the notices of a merged lead's wording, and the choice when a change elsewhere cannot be merged.
 * The reviewer's text is never replaced without one of them.
 */
export function WordingNotices({ notices, trouble, text, busy, onUse, onDismiss, onKeepMine, onLoadSaved, onRetry }: {
  notices: readonly WordingNotice[];
  trouble: MergeTrouble | null;
  /** The text on screen: "Use the lead's wording" is offered while the reviewer's passage is in it exactly once. */
  text: string;
  busy: boolean;
  onUse: (notice: WordingNotice) => void;
  onDismiss: (notice: WordingNotice) => void;
  onKeepMine: () => void;
  onLoadSaved: () => void;
  onRetry: () => void;
}): JSX.Element | null {
  if (notices.length === 0 && !trouble) return null;
  return <div className="translation-wording-notices">
    {trouble?.kind === "unmerged" && <InlineMessage tone="error" title={UNMERGED_TITLE}>
      <p>{UNMERGED_TEXT}</p>
      <div className="toolbar">
        <Button size="sm" variant="primary" loading={busy} onClick={onKeepMine}>{KEEP_MINE}</Button>
        <Button size="sm" aria-disabled={busy || undefined} onClick={() => { if (!busy) onLoadSaved(); }}>{LOAD_SAVED}</Button>
      </div>
    </InlineMessage>}
    {trouble?.kind === "failed" && <InlineMessage tone="warning">
      <p>{SYNC_FAILED}</p>
      <div className="toolbar"><Button size="sm" onClick={onRetry}>Try again</Button></div>
    </InlineMessage>}
    {notices.map(notice => notice.kind === "applied"
      ? <InlineMessage key={notice.wording.report_id} tone="success" onDismiss={() => onDismiss(notice)}>
          <p>{wordingApplied(notice.wording.proposed_text)}</p>
        </InlineMessage>
      : <InlineMessage key={notice.wording.report_id} tone="warning" title={WORDING_KEPT_TITLE} onDismiss={() => onDismiss(notice)}>
          <p>{wordingKept(notice.wording.quote, notice.wording.proposed_text)}</p>
          {/* Issue 616: what the button replaces, so a rewrite of several words is seen before it goes. */}
          {once(text, notice.mine) && <p className="field-hint">{wordingReplaces(notice.mine)}</p>}
          <div className="toolbar">
            {once(text, notice.mine)
              ? <Button size="sm" onClick={() => onUse(notice)}>{USE_WORDING}</Button>
              : <span className="field-hint">{WORDING_KEPT_HINT}</span>}
            <CopyTextButton text={notice.wording.proposed_text} />
          </div>
        </InlineMessage>)}
  </div>;
}
