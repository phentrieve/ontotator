import React, { useCallback, useId, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  mountSpanEditor,
  type MentionDisplay,
  type SelectionPayload,
  type SpanEditorHandle,
} from "../spans/adapter";

import { paragraphStarts } from "../variants/paragraphs";
import type { ChangePassage, TextChanges } from "../translation/textDiff";
import { Button } from "../ui/Button";
import "./textChanges.css";

export interface TextPaneProps {
  /** Case controls belong to the reading pane, outside the text scrollport. */
  header?: React.ReactNode;
  /** Actual text scrollport, released on replacement/unmount. */
  onTextElement?: (element: HTMLDivElement | null) => void;
  readOnly?: boolean;
  /** Temporary display-only context; never evidence or resizable work. */
  contextSegments?: ReadonlyArray<{ start: number; end: number }>;
  /** Display-only change marks against another version of this text (Show changes); never findings or evidence. */
  changes?: TextChanges | null;
  /**
   * Display-only changed passages against an earlier version (Show changes since vN, issue 421): a dashed frame per
   * passage and a focusable "−" marker where text was removed, its older wording in a tooltip. Never part of the text.
   */
  passages?: readonly ChangePassage[] | null;
  /** The earlier version the passages compare with ("v1"), named in the removed-text marker and its tooltip. */
  passagesSince?: string;
  /** Index of the passage Previous / Next moved to (a solid frame); none when unset or -1. */
  currentPassage?: number;
  text: string;
  mentions: MentionDisplay[];
  selectedEvidenceId: string | null;
  selectionIntent: "new_mention" | "extend_mention";
  onSelection: (payload: SelectionPayload) => void;
  onPick: (evidenceId: string) => void;
  onChangeIntent: (intent: "new_mention" | "extend_mention") => void;
  /** True while "Add mention" waits for a text selection. */
  isAttachingMention?: boolean;
  attachMessage?: React.ReactNode;
  /** One line explaining the current marking mode ("Adding a segment to mention 1 of …"); nothing is shown when unset. */
  intentMessage?: string | null;
  onCancelAttach?: () => void;
  /** Mentions whose segment edges can be dragged. */
  resizableEvidenceIds?: string[];
  onResizeMention?: (evidenceId: string, segments: Array<{ start: number; end: number }>) => void;
  /** Handle names per evidence id (default "Start of mention" / "End of mention"). */
  resizableLabels?: Record<string, { start: string; end: string }>;
  /** Receives a function that reports a keyboard resize still waiting for its pause. */
  flushResizeRef?: React.MutableRefObject<(() => void) | null>;
  /** Change this to force the text back to the given mentions (after a failed save). */
  resyncToken?: number;
  /** Scrolls the text to the mark of `evidenceId`; a new `nonce` repeats the request. */
  scrollRequest?: { evidenceId: string; nonce: number; ifNeeded?: boolean } | null;
  /** Evidence ids whose marks are framed (hover, focus, selected finding). */
  framedIds?: readonly string[];
  /** The mention ids under the pointer; [] when it leaves a mark. */
  onHoverMentions?: (evidenceIds: string[]) => void;
}

const mentionsSignature = (mentions: MentionDisplay[]): string =>
  JSON.stringify(mentions.map((m) => [m.evidence_id, m.kind ?? "", m.colorIndex ?? 0, m.negated ?? false, m.label ?? "", m.segments.map((s) => [s.start, s.end])]));

/** The older wording of a passage as one line (marker name and tooltip). */
const beforeWording = (passage: ChangePassage): string => passage.before.map((part) => part.text).join("").replace(/\s+/g, " ").trim();
const removedLabel = (passage: ChangePassage, since: string | undefined): string =>
  `Changed text. ${since ? `In ${since}` : "Before"}: ${beforeWording(passage)}`;

/** Tooltip of a removed-text marker: the passage's older wording, its removed words struck through. */
const TIP_GAP = 10, TIP_GUTTER = 8, TIP_MIN_HEIGHT = 48;
function RemovedTip({ passage, index, since, anchor, onEnter, onLeave }: {
  passage: ChangePassage; index: number; since: string | undefined; anchor: DOMRect; onEnter: () => void; onLeave: () => void;
}): JSX.Element {
  const ref = useRef<HTMLDivElement | null>(null);
  const [place, setPlace] = useState<{ left: number; top: number; maxHeight: number }>({ left: anchor.left, top: anchor.bottom + TIP_GAP, maxHeight: 0 });
  // Kept inside the viewport (8 px gutter) once its size is known: below the marker, above it when there is more
  // room there, and never taller than that room (a long earlier wording scrolls inside the tooltip).
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    const width = element.offsetWidth;
    // The full height of the wording, whatever the current height limit.
    const height = element.scrollHeight + (element.offsetHeight - element.clientHeight);
    const below = window.innerHeight - TIP_GUTTER - (anchor.bottom + TIP_GAP);
    const above = anchor.top - TIP_GAP - TIP_GUTTER;
    const under = height <= below || below >= above;
    const maxHeight = Math.max(TIP_MIN_HEIGHT, under ? below : above);
    const shown = Math.min(height, maxHeight);
    const top = under ? anchor.bottom + TIP_GAP : anchor.top - TIP_GAP - shown;
    setPlace({
      left: Math.max(TIP_GUTTER, Math.min(anchor.left, window.innerWidth - TIP_GUTTER - width)),
      top: Math.max(TIP_GUTTER, Math.min(top, window.innerHeight - TIP_GUTTER - shown)),
      maxHeight,
    });
  }, [anchor, passage]);
  return createPortal(<div ref={ref} role="tooltip" className="change-tip" data-passage={index}
    style={{ top: place.top, left: place.left, maxHeight: place.maxHeight || undefined }}
    onMouseEnter={onEnter} onMouseLeave={onLeave}>
    <span className="change-tip__label">{since ? `In ${since}:` : "Before:"}</span>{" "}
    {passage.before.map((part, index) => part.removed ? <del key={index}>{part.text}</del> : <span key={index}>{part.text}</span>)}
  </div>, document.body);
}

/** A display-only redraw must not finish or discard a native selection in progress. */
function retainOwnedSelection(container: HTMLDivElement) {
  const selection = container.ownerDocument.defaultView?.getSelection();
  if (!selection || selection.rangeCount !== 1 || !selection.anchorNode || !selection.focusNode
    || !container.contains(selection.anchorNode) || !container.contains(selection.focusNode)) return;
  const offsetOf = (node: Node, offset: number): number => {
    let end = 0;
    for (const run of container.querySelectorAll<HTMLElement>('.run')) {
      end = Number(run.dataset.start) + (run.textContent?.length ?? 0);
      const range = container.ownerDocument.createRange();
      range.selectNodeContents(run);
      const side = range.comparePoint(node, offset);
      if (side < 0) return Number(run.dataset.start);
      if (side === 0) {
        range.setEnd(node, offset);
        return Number(run.dataset.start) + range.toString().length;
      }
    }
    return end;
  };
  // Native DOM offsets are UTF16; never convert or normalize the selected text.
  const anchor = offsetOf(selection.anchorNode, selection.anchorOffset);
  const focus = offsetOf(selection.focusNode, selection.focusOffset);
  return () => {
    const pointAt = (offset: number): [Node, number] | null => {
      for (const run of container.querySelectorAll<HTMLElement>('.run')) {
        const node = run.firstChild;
        const start = Number(run.dataset.start);
        if (node?.nodeType === Node.TEXT_NODE && start <= offset && offset <= start + (node.textContent?.length ?? 0)) {
          return [node, offset - start];
        }
      }
      return offset === 0 ? [container, 0] : null;
    };
    const from = pointAt(anchor), to = pointAt(focus);
    if (from && to) selection.setBaseAndExtent(...from, ...to);
  };
}

export const TextPane: React.FC<TextPaneProps> = ({
  header,
  text,
  readOnly = false,
  mentions,
  selectedEvidenceId,
  selectionIntent,
  onSelection,
  onPick,
  onChangeIntent,
  isAttachingMention = false,
  attachMessage,
  intentMessage,
  onCancelAttach,
  resizableEvidenceIds,
  onResizeMention,
  resizableLabels,
  flushResizeRef,
  resyncToken = 0,
  onTextElement,
  contextSegments,
  changes,
  passages,
  passagesSince,
  currentPassage = -1,
  scrollRequest,
  framedIds,
  onHoverMentions,
}) => {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const handleRef = useRef<SpanEditorHandle | null>(null);
  const attachTextElement = useCallback((element: HTMLDivElement | null) => {
    containerRef.current = element;
    onTextElement?.(element);
  }, [onTextElement]);
  const starts = useMemo(() => paragraphStarts(text), [text]);
  const [invalidMentionIds, setInvalidMentionIds] = useState<string[]>([]);
  const reportInvalid = useRef((ids: string[]) => {
    setInvalidMentionIds((prev) => (prev.join(" ") === ids.join(" ") ? prev : ids));
  });
  // Only push mentions into the span editor when their content actually changed.
  const contextId = `context:${useId()}`;
  const visibleMentions = useMemo<MentionDisplay[]>(() => contextSegments?.length
    ? [...mentions, { evidence_id: contextId, segments: [...contextSegments], kind: "context" }] : mentions, [mentions, contextSegments, contextId]);
  const signature = useMemo(() => mentionsSignature(visibleMentions), [visibleMentions]);
  const ordinarySignature = useMemo(() => mentionsSignature(mentions), [mentions]);
  const lastSync = useRef<{ handle: SpanEditorHandle; ordinarySignature: string; resyncToken: number }>();
  const latestMentions = useRef(visibleMentions);
  latestMentions.current = visibleMentions;
  const changesKey = changes ? JSON.stringify([changes.op, changes.ranges.map((range) => [range.start, range.end])]) : "";
  const latestChanges = useRef(changes);
  latestChanges.current = changes;
  const passageMarks = useMemo(() => (passages ?? []).map((passage, index) => ({ start: passage.start, end: passage.end,
    removedLabel: passage.hasRemoved ? removedLabel(passage, passagesSince) : null, current: index === currentPassage })),
  [passages, passagesSince, currentPassage]);
  const passagesKey = JSON.stringify(passageMarks);
  const latestPassages = useRef(passageMarks);
  latestPassages.current = passageMarks;
  const [tip, setTip] = useState<{ index: number; anchor: DOMRect } | null>(null);
  const hideTimer = useRef<number | undefined>();
  /** The passage whose tooltip was opened by a tap or click on its marker: it stays until it is dismissed. */
  const pinnedTip = useRef<number | null>(null);

  const callbacks = useRef({ onSelection, onPick, onResizeMention, onHoverMentions, readOnly });
  callbacks.current = { onSelection, onPick, onResizeMention, onHoverMentions, readOnly };
  const framedKey = (framedIds ?? []).join("\u001f");
  const latestFramed = useRef<string[]>([]);
  latestFramed.current = [...(framedIds ?? [])];
  const resizableKey = readOnly ? "readonly" : (resizableEvidenceIds ?? []).join("\u001f");
  const latestResizable = useRef<string[]>([]);
  latestResizable.current = readOnly ? [] : resizableEvidenceIds ?? [];
  const labelsKey = JSON.stringify(resizableLabels ?? {});
  const latestLabels = useRef(resizableLabels);
  latestLabels.current = resizableLabels;

  // Mount span editor once or when text changes
  useEffect(() => {
    if (!containerRef.current) return;

    const handle = mountSpanEditor(
      containerRef.current,
      text,
      latestMentions.current,
      (payload) => { if (!callbacks.current.readOnly) callbacks.current.onSelection(payload); },
      (evidenceId) => { if (evidenceId !== contextId) callbacks.current.onPick(evidenceId); },
      (ids) => reportInvalid.current(ids),
      (evidenceId, segments) => { if (!callbacks.current.readOnly) callbacks.current.onResizeMention?.(evidenceId, segments); },
      starts,
      (ids) => callbacks.current.onHoverMentions?.(ids.filter((id) => id !== contextId)),
    );
    handle.setResizable(latestResizable.current, latestLabels.current);
    handle.setFramed(latestFramed.current);
    if (latestChanges.current?.ranges.length) handle.setMarkers(latestChanges.current.ranges);
    if (latestPassages.current.length) handle.setPassages(latestPassages.current);
    handleRef.current = handle;

    return () => {
      handle.destroy();
      handleRef.current = null;
    };
  }, [text]);

  // Sync mentions
  useEffect(() => {
    if (handleRef.current) {
      const previous = lastSync.current;
      const contextOnly = previous?.handle === handleRef.current
        && previous.ordinarySignature === ordinarySignature && previous.resyncToken === resyncToken;
      const restore = contextOnly && containerRef.current ? retainOwnedSelection(containerRef.current) : undefined;
      handleRef.current.setMentions(latestMentions.current);
      // Re-apply selection highlight after a re-render of the runs.
      handleRef.current.setSelected(selectedEvidenceId);
      restore?.();
      lastSync.current = { handle: handleRef.current, ordinarySignature, resyncToken };
    }
  }, [signature, ordinarySignature, resyncToken]);

  // Sync which mentions show drag handles
  useEffect(() => {
    handleRef.current?.setResizable(latestResizable.current, latestLabels.current);
  }, [resizableKey, labelsKey]);

  // Lets the screen report a keyboard resize still waiting for its pause (before saving).
  useEffect(() => {
    if (!flushResizeRef) return;
    flushResizeRef.current = () => handleRef.current?.flushResize();
    return () => {
      flushResizeRef.current = null;
    };
  }, [flushResizeRef]);

  useEffect(() => {
    if (!isAttachingMention || !onCancelAttach) return;
    const onKey = (e: KeyboardEvent) => {
      // Escape inside a reading drawer or a dialog belongs to it (closes it); the attach stays pending.
      if (e.target instanceof Element && e.target.closest(".ui-drawer, [role='dialog']")) return;
      // An open removed-text tooltip takes this Esc (it closes; the attach stays pending).
      if (document.querySelector(".change-tip")) return;
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        onCancelAttach();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [isAttachingMention, onCancelAttach]);

  useEffect(() => {
    handleRef.current?.setFramed(latestFramed.current);
  }, [framedKey]);

  // Change marks redraw the runs only; the text, its paragraph markers and the scroll position stay.
  useEffect(() => {
    handleRef.current?.setMarkers(latestChanges.current?.ranges ?? []);
  }, [changesKey]);

  // Changed passages and their removed-text markers, as the change marks above.
  useEffect(() => {
    handleRef.current?.setPassages(latestPassages.current);
  }, [passagesKey]);

  // The removed-text tooltip opens on hover and on keyboard focus of its marker and follows it while anything scrolls;
  // Esc, blur or leaving it close it. A tap or click on the marker keeps it open (issue 468: on a touch screen the
  // pointer "leaves" right after the tap) until the marker is tapped again, something else is tapped, or Esc.
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const markerOf = (target: EventTarget | null) => target instanceof Element ? target.closest<HTMLElement>(".change-removed") : null;
    const show = (event: Event) => {
      const marker = markerOf(event.target);
      if (!marker) return;
      window.clearTimeout(hideTimer.current);
      setTip({ index: Number(marker.dataset.passage), anchor: marker.getBoundingClientRect() });
    };
    const hideSoon = (event: Event) => {
      if (!markerOf(event.target) || pinnedTip.current !== null) return;
      window.clearTimeout(hideTimer.current);
      hideTimer.current = window.setTimeout(() => setTip(null), 200);
    };
    const close = () => { pinnedTip.current = null; window.clearTimeout(hideTimer.current); setTip(null); };
    // Focus moving on closes it; a kept tooltip stays while the focus only drops (a tap inside the tooltip).
    const hideNow = (event: FocusEvent) => { if (pinnedTip.current === null || event.relatedTarget) close(); };
    const follow = () => setTip((open) => {
      const marker = open ? container.querySelector<HTMLElement>(`.change-removed[data-passage="${open.index}"]`) : null;
      if (open && !marker) pinnedTip.current = null;
      return open && marker ? { ...open, anchor: marker.getBoundingClientRect() } : null;
    });
    // A tap or click: on the marker it opens and keeps the tooltip, or closes the one it keeps; anywhere else
    // (but not inside the tooltip, which may scroll) it closes a kept tooltip.
    const onClick = (event: MouseEvent) => {
      const marker = markerOf(event.target);
      if (marker && container.contains(marker)) {
        const index = Number(marker.dataset.passage);
        if (pinnedTip.current === index) { close(); return; }
        pinnedTip.current = index;
        window.clearTimeout(hideTimer.current);
        setTip({ index, anchor: marker.getBoundingClientRect() });
        return;
      }
      if (pinnedTip.current !== null && !(event.target instanceof Element && event.target.closest(".change-tip"))) close();
    };
    // On the focused marker the arrow keys scroll a long earlier wording inside the tooltip.
    const onKey = (event: KeyboardEvent) => {
      if (!markerOf(event.target) || (event.key !== "ArrowDown" && event.key !== "ArrowUp") || event.shiftKey) return;
      const open = document.querySelector<HTMLElement>(".change-tip");
      if (!open || open.scrollHeight <= open.clientHeight) return;
      event.preventDefault();
      open.scrollBy({ top: event.key === "ArrowDown" ? 40 : -40 });
    };
    container.addEventListener("mouseover", show);
    container.addEventListener("focusin", show);
    container.addEventListener("mouseout", hideSoon);
    container.addEventListener("focusout", hideNow);
    container.addEventListener("keydown", onKey);
    document.addEventListener("click", onClick, true);
    window.addEventListener("scroll", follow, true);
    return () => {
      window.clearTimeout(hideTimer.current);
      pinnedTip.current = null;
      document.removeEventListener("click", onClick, true);
      container.removeEventListener("mouseover", show);
      container.removeEventListener("focusin", show);
      container.removeEventListener("mouseout", hideSoon);
      container.removeEventListener("focusout", hideNow);
      container.removeEventListener("keydown", onKey);
      window.removeEventListener("scroll", follow, true);
    };
  }, [text]);

  // While the tooltip is open, Esc closes it wherever the focus is (also when it was opened by hover), and only it.
  const tipOpen = tip !== null;
  useEffect(() => {
    if (!tipOpen) return;
    const onEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopImmediatePropagation();
      window.clearTimeout(hideTimer.current);
      pinnedTip.current = null;
      setTip(null);
    };
    window.addEventListener("keydown", onEscape, true);
    return () => window.removeEventListener("keydown", onEscape, true);
  }, [tipOpen]);

  // Sync selected evidence
  useEffect(() => {
    if (handleRef.current) {
      handleRef.current.setSelected(selectedEvidenceId);
    }
  }, [selectedEvidenceId]);

  // Scroll to a requested mark after the mentions above are in place.
  useEffect(() => {
    if (scrollRequest) handleRef.current?.scrollToEvidence(scrollRequest.evidenceId, scrollRequest.ifNeeded);
  }, [scrollRequest]);

  // Sync selection intent
  useEffect(() => {
    if (handleRef.current) {
      handleRef.current.setSelectionIntent(
        selectionIntent,
        selectedEvidenceId ?? undefined
      );
    }
  }, [selectionIntent, selectedEvidenceId]);

  return (
    <div className="center-pane">
      {header}
      {isAttachingMention ? (
        <div role="status" className="attach-mention-banner">
          {/* One line over the text (it never moves the text); the full message stays in the title. */}
          <span title={typeof (attachMessage ?? intentMessage) === "string" ? (attachMessage ?? intentMessage) as string : undefined}>
            {attachMessage ?? intentMessage ?? <><strong>Adding a mention:</strong> select text to attach it to the selected finding.</>}
          </span>
          {onCancelAttach && (
            <Button size="sm" onClick={onCancelAttach}>
              Cancel (Esc)
            </Button>
          )}
        </div>
      ) : intentMessage ? (
        // Shown only while a mode waits for marked text (e.g. adding a segment); hidden otherwise.
        <div role="status" className="pane-intent">
          <span className="pane-intent__message" title={intentMessage ?? undefined}>{intentMessage}</span>
          {!readOnly && selectionIntent === "extend_mention" && (
            <Button size="sm" onClick={() => onChangeIntent("new_mention")}>
              Cancel
            </Button>
          )}
        </div>
      ) : null}
      {invalidMentionIds.length > 0 && (
        <div role="alert" className="text-pane-alert">
          {invalidMentionIds.length === 1 ? "1 mention has" : `${invalidMentionIds.length} mentions have`} offsets outside this text and are not highlighted.
        </div>
      )}
      <div ref={attachTextElement} className="text-container density-reading" tabIndex={0} data-changes={changes ? changes.op : undefined} />
      {tip && passages?.[tip.index] && <RemovedTip passage={passages[tip.index]} index={tip.index} since={passagesSince} anchor={tip.anchor}
        onEnter={() => window.clearTimeout(hideTimer.current)}
        // Leaving the tooltip closes it, unless it is kept open (tap or click) or its marker still has the keyboard focus.
        onLeave={() => { if (pinnedTip.current === null && !(document.activeElement instanceof HTMLElement && document.activeElement.matches(`.change-removed[data-passage="${tip.index}"]`))) setTip(null); }} />}
    </div>
  );
};
