/**
 * Shared span editor: paint, render, hover-link and read back character offsets.
 *
 * Adapted from hpo-span-annotator / opti-data annot_gold.
 */

import { resizeSegment, stepOffset, wordBoundary } from "../spans/resize";

/** Delay before a keyboard resize is reported, so several steps become one edit. */
const KEY_RESIZE_COMMIT_MS = 400;

const NBSP = " ";

/**
 * Sort and merge a mention's own spans so it never double-counts a character.
 */
export function normaliseSpans(spans) {
  const sorted = (spans || [])
    .map((s) => ({ start: s.char_start | 0, end: s.char_end | 0 }))
    .filter((s) => s.end > s.start)
    .sort((a, b) => a.start - b.start || a.end - b.end);
  const merged = [];
  for (const span of sorted) {
    const last = merged[merged.length - 1];
    if (last && span.start <= last.end) {
      last.end = Math.max(last.end, span.end);
    } else {
      merged.push({ ...span });
    }
  }
  return merged;
}

/**
 * Cut `text` at every span boundary and tag each piece with its mentions.
 */
export function decomposeRuns(textLength, mentions, extraCuts = []) {
  const cuts = new Set([0, textLength]);
  for (const cut of extraCuts) {
    if (cut > 0 && cut < textLength) cuts.add(cut);
  }
  const owned = new Map();
  for (const mention of mentions || []) {
    const spans = normaliseSpans(mention.spans || []);
    owned.set(mention.mention_id, spans);
    for (const span of spans) {
      if (span.start > 0 && span.start < textLength) cuts.add(span.start);
      if (span.end > 0 && span.end < textLength) cuts.add(span.end);
    }
  }
  const edges = [...cuts].sort((a, b) => a - b);
  const runs = [];
  for (let i = 0; i < edges.length - 1; i += 1) {
    const start = edges[i];
    const end = edges[i + 1];
    const ids = [];
    for (const [id, spans] of owned) {
      if (spans.some((s) => s.start < end && start < s.end)) ids.push(id);
    }
    runs.push({ start, end, mentionIds: ids });
  }
  return runs;
}

/** At most this many bands of colour in one run; from the fourth colour on, the top band is striped. */
export const MAX_BANDS = 3;

/**
 * The colour classes of a run (issue 524). One colour: `run--color-N`, the fill of slot N. A run that belongs
 * to marks of several colours gets one band per colour, stacked in the highlight from the bottom up:
 * `run--bands-K` (K = 2 or 3) and `run--band-I-N` (band I has slot N). The bands follow the marks' start in
 * the text, then their id, so a mark keeps its place among the others in every piece it shares. Marks of one
 * slot share a band. With more than three colours the run gets `run--bands-more`: two bands and a striped
 * third band of the third and fourth colour; a fifth colour has no band of its own.
 * `run--color-N` (the first colour) stays on a banded run, for anything that reads the run's main fill.
 */
export function bandClasses(runMentions, mentionStarts = new Map()) {
  const coloured = runMentions
    .filter((m) => typeof m.colorIndex === "number")
    .sort((a, b) => (mentionStarts.get(a.mention_id) ?? 0) - (mentionStarts.get(b.mention_id) ?? 0)
      || (a.mention_id < b.mention_id ? -1 : a.mention_id > b.mention_id ? 1 : 0));
  const slots = [...new Set(coloured.map((m) => m.colorIndex))];
  if (!slots.length) return [];
  const classes = [`run--color-${slots[0]}`];
  if (slots.length === 1) return classes;
  classes.push(slots.length > MAX_BANDS ? "run--bands-more" : `run--bands-${slots.length}`);
  slots.slice(0, MAX_BANDS + 1).forEach((slot, band) => classes.push(`run--band-${band}-${slot}`));
  return classes;
}

/** Trim a raw drag-selection down to its visible characters. */
export function trimToVisible(text, start, end) {
  let a = Math.max(0, Math.min(start, end));
  let b = Math.min(text.length, Math.max(start, end));
  while (a < b && !text[a].trim()) a += 1;
  while (b > a && !text[b - 1].trim()) b -= 1;
  return b > a ? { start: a, end: b } : null;
}

export class SpanEditor {
  constructor(container, handlers = {}) {
    this.container = container;
    this.handlers = handlers;
    this.text = "";
    this.mentions = [];
    this.suggestions = [];
    this.markers = [];
    this.passages = [];
    this.paragraphStarts = [];
    this.activeIds = new Set();
    this.framedIds = new Set();
    this.readOnly = false;
    this.resizableIds = new Set();
    this.resizableLabels = {};
    this._pendingKeyResize = null;
    this._keyResizeTimer = null;
    this._onFocusOutBound = (e) => this._onFocusOut(e);
    container.addEventListener("focusout", this._onFocusOutBound);
    this._drag = null;
    this._onPointerDownBound = (e) => this._onPointerDown(e);
    this._onPointerMoveBound = (e) => this._onPointerMove(e);
    this._onPointerUpBound = (e) => this._endDrag(e, true);
    this._onPointerCancelBound = (e) => this._endDrag(e, false);
    this._onDragKeyBound = (e) => this._onDragKey(e);
    container.addEventListener("pointerdown", this._onPointerDownBound);
    container.addEventListener("pointermove", this._onPointerMoveBound);
    container.addEventListener("pointerup", this._onPointerUpBound);
    container.addEventListener("pointercancel", this._onPointerCancelBound);

    this._onMouseUpBound = (e) => this._onMouseUp(e);
    this._onMouseOverBound = (e) => this._onHover(e, true);
    this._onMouseOutBound = (e) => this._onHover(e, false);
    this._onClickBound = (e) => this._onClick(e);
    this._keySelecting = false;
    this._caret = 0;
    this._onKeyDownBound = (e) => this._onKeyDown(e);
    this._onKeyUpBound = (e) => this._onKeyUp(e);

    container.addEventListener("mouseup", this._onMouseUpBound);
    container.addEventListener("keydown", this._onKeyDownBound);
    container.addEventListener("keyup", this._onKeyUpBound);
    container.addEventListener("mouseover", this._onMouseOverBound);
    container.addEventListener("mouseout", this._onMouseOutBound);
    container.addEventListener("click", this._onClickBound);
  }

  destroy() {
    this.container.removeEventListener("mouseup", this._onMouseUpBound);
    this.container.removeEventListener("keydown", this._onKeyDownBound);
    this.container.removeEventListener("keyup", this._onKeyUpBound);
    this.container.removeEventListener("mouseover", this._onMouseOverBound);
    this.container.removeEventListener("mouseout", this._onMouseOutBound);
    this.container.removeEventListener("click", this._onClickBound);
    this.container.removeEventListener("focusout", this._onFocusOutBound);
    clearTimeout(this._keyResizeTimer);
    this.container.removeEventListener("pointerdown", this._onPointerDownBound);
    this.container.removeEventListener("pointermove", this._onPointerMoveBound);
    this.container.removeEventListener("pointerup", this._onPointerUpBound);
    this.container.removeEventListener("pointercancel", this._onPointerCancelBound);
    window.removeEventListener("keydown", this._onDragKeyBound, true);
  }

  setReadOnly(readOnly) {
    this.readOnly = Boolean(readOnly);
    this.container.classList.toggle("readonly", this.readOnly);
  }

  setBlock(text) {
    this.text = text ?? "";
    this.render();
  }

  setMentions(mentions) {
    this.mentions = mentions || [];
    // An update that leaves the dragged mention as it was when the drag began is
    // the echo of an earlier save, not a change from outside: the drag goes on.
    const drag = this._drag;
    if (drag) {
      const incoming = this._spansOf(drag.mentionId);
      if (incoming && JSON.stringify(incoming) === JSON.stringify(drag.original)) {
        this._applySpans(drag.mentionId, drag.current || drag.original);
        return;
      }
      this._stopDrag();
    }
    // A keyboard change that is still waiting to be reported stays on top of the
    // update when the update is the save of the step before it (the mention comes
    // back exactly as that step left it), so no key press is lost. Anything else is
    // a change from outside - including a save that moved the selected annotation
    // to a copy of shared evidence - and the pending change is dropped with it.
    const pending = this._pendingKeyResize;
    const incoming = pending ? this._spansOf(pending.mentionId) : null;
    if (pending && incoming && JSON.stringify(incoming) === JSON.stringify(pending.saved)) {
      this._applySpans(pending.mentionId, pending.spans);
      return;
    }
    this._clearKeyResize();
    this.render();
  }

  /** Whether a run starts / ends a segment of a highlighted mention. */
  _hotEdges(start, end) {
    let atStart = false;
    let atEnd = false;
    for (const mention of this.mentions) {
      if (!this.activeIds.has(mention.mention_id)) continue;
      for (const span of normaliseSpans(mention.spans || [])) {
        if (span.start === start) atStart = true;
        if (span.end === end) atEnd = true;
      }
    }
    return { atStart, atEnd };
  }

  setSuggestions(suggestions) {
    this.suggestions = suggestions || [];
    this.render();
  }

  /** UTF-16 paragraph boundaries, separate from highlighted span markers. */
  setParagraphStarts(starts) {
    this.paragraphStarts = starts;
    this.render();
  }

  setMarkers(markers) {
    this.markers = markers || [];
    this.render();
  }

  /**
   * Display-only changed passages ({ start, end, removedLabel, current }, UTF-16): their runs
   * are wrapped in one `.change-passage` (data-passage = index, data-current) for a frame around
   * the whole passage, and a passage with removed text starts with a focusable `.change-removed`
   * marker named `removedLabel`. The marker has no text of its own (its glyph is CSS),
   * so the text, its offsets and selections stay exactly those of `this.text`.
   */
  setPassages(passages) {
    this.passages = (passages || [])
      .map((p, index) => ({ start: p.start | 0, end: p.end | 0, removedLabel: p.removedLabel || null, current: Boolean(p.current), index }))
      .filter((p) => p.end >= p.start)
      .sort((a, b) => a.start - b.start || a.end - b.end);
    this.render();
  }

  _passageNode(passage) {
    const node = document.createElement("span");
    node.className = "change-passage";
    node.dataset.passage = String(passage.index);
    if (passage.current) node.dataset.current = "";
    if (passage.removedLabel) {
      const marker = document.createElement("button");
      marker.type = "button";
      marker.className = "change-removed";
      marker.dataset.offset = String(passage.start);
      marker.dataset.passage = String(passage.index);
      marker.setAttribute("aria-label", passage.removedLabel);
      node.appendChild(marker);
    }
    return node;
  }

  /**
   * Mentions whose segments get draggable start/end handles. `labels` optionally
   * names the handles per mention: { [mentionId]: { start, end } }.
   */
  setResizable(mentionIds, labels) {
    this.resizableIds = new Set(mentionIds || []);
    this.resizableLabels = labels || {};
    // The selection moved on while a keyboard change was still waiting: report it
    // now, before its handles disappear.
    const pending = this._pendingKeyResize;
    if (pending && !this.resizableIds.has(pending.mentionId)) this._flushKeyResize();
    this.render();
  }

  /** Reports a keyboard resize that still waits for its pause (before a term is chosen). */
  flushResize() {
    this._flushKeyResize();
  }

  _clearKeyResize() {
    clearTimeout(this._keyResizeTimer);
    this._keyResizeTimer = null;
    this._pendingKeyResize = null;
  }

  _handlesByOffset() {
    const starts = new Map();
    const ends = new Map();
    for (const mention of this.mentions) {
      // A modifier segment is never resizable.
      if (!this.resizableIds.has(mention.mention_id) || mention.kind === "modifier") continue;
      normaliseSpans(mention.spans || []).forEach((span, index) => {
        // A short segment gets thin handles, so they do not cover its few characters.
        const base = { mentionId: mention.mention_id, index, text: this.text.slice(span.start, span.end), short: span.end - span.start <= 3 };
        starts.set(span.start, [...(starts.get(span.start) || []), { ...base, edge: "start", offset: span.start }]);
        ends.set(span.end, [...(ends.get(span.end) || []), { ...base, edge: "end", offset: span.end }]);
      });
    }
    // An end handle and a start handle (almost) on the same spot share the grab
    // area: the end handle gets the lower half, the start handle the upper half.
    for (const [offset, startHandles] of starts) {
      for (const endOffset of [offset, offset - 1, offset - 2]) {
        const endHandles = ends.get(endOffset);
        if (!endHandles) continue;
        for (const handle of [...startHandles, ...endHandles]) handle.crowded = true;
      }
    }
    return { starts, ends };
  }

  _handleNode(handle) {
    const node = document.createElement("span");
    node.className = `resize-handle resize-handle--${handle.edge}`;
    node.dataset.mention = handle.mentionId;
    node.dataset.segment = String(handle.index);
    node.dataset.edge = handle.edge;
    node.dataset.offset = String(handle.offset);
    node.tabIndex = 0;
    node.setAttribute("role", "separator");
    const label = this.resizableLabels?.[handle.mentionId]?.[handle.edge];
    node.setAttribute("aria-label", label || (handle.edge === "start" ? "Start of mention" : "End of mention"));
    // The tooltip names what the label names: "End of marked text" -> "the end of the marked text".
    const subject = /^(?:Start|End) of (.+)$/.exec(label || "")?.[1];
    node.title = `Drag to move the ${handle.edge} of ${subject ? `the ${subject}` : "this mention"} (or focus it and use the arrow keys)`;
    // The segment the handle edges, for screen readers ("“No fever”").
    node.setAttribute("aria-valuetext", `“${handle.text}”`);
    if (handle.crowded) node.classList.add("resize-handle--crowded");
    if (handle.short) node.classList.add("resize-handle--short");
    return node;
  }

  _spansOf(mentionId) {
    const mention = this.mentions.find((m) => m.mention_id === mentionId);
    return mention ? normaliseSpans(mention.spans || []) : null;
  }

  /** Replace a mention's spans in the editor's own copy and redraw. */
  _applySpans(mentionId, spans) {
    this.mentions = this.mentions.map((m) => (m.mention_id === mentionId
      ? { ...m, spans: spans.map((s) => ({ char_start: s.start, char_end: s.end })) }
      : m));
    this.render();
  }

  _findHandle(mentionId, edge, offset) {
    return Array.from(this.container.querySelectorAll(".resize-handle")).find((node) =>
      node.dataset.mention === mentionId && node.dataset.edge === edge && Number(node.dataset.offset) === offset);
  }

  _flushKeyResize() {
    clearTimeout(this._keyResizeTimer);
    this._keyResizeTimer = null;
    const pending = this._pendingKeyResize;
    this._pendingKeyResize = null;
    if (pending) this.handlers.onResize?.(pending.mentionId, pending.spans);
  }

  _onHandleKey(event, handle) {
    const direction = event.key === "ArrowLeft" ? -1 : 1;
    const mentionId = handle.dataset.mention;
    const edge = handle.dataset.edge;
    const index = Number(handle.dataset.segment);
    const from = Number(handle.dataset.offset);
    const spans = this._spansOf(mentionId);
    if (!spans) return;
    const byWord = event.ctrlKey || event.metaKey;
    // A step that only crosses whitespace is trimmed away again, so keep going
    // outwards until the edge really moves (or the text ends).
    const outwards = (edge === "start") === (direction === -1);
    let to = from;
    let next = null;
    while (!next) {
      const previous = to;
      to = byWord ? wordBoundary(this.text, to, direction) : stepOffset(this.text, to, direction);
      if (to === previous) return;
      // Inwards by word never jumps over the other edge (that would leave one character).
      if (!outwards && byWord && (edge === "start" ? to >= spans[index].end : to <= spans[index].start)) return;
      next = resizeSegment(this.text, spans, index, edge, to);
      if (!outwards) break;
    }
    if (!next) return;
    // The keyboard stops at a neighbouring segment; only a drag (which Escape can
    // cancel) merges two segments.
    if (next.length < spans.length) return;
    // The moved edge of the (possibly merged) segment that now contains the old one.
    const anchor = edge === "start" ? spans[index].end - 1 : spans[index].start;
    const segment = next.find((s) => s.start <= anchor && anchor < s.end) || next[0];
    this._refocusing = true;
    this._applySpans(mentionId, next);
    this._findHandle(mentionId, edge, edge === "start" ? segment.start : segment.end)?.focus();
    this._refocusing = false;
    // `saved` is what Escape goes back to: the spans before the first unreported step.
    this._pendingKeyResize = { mentionId, spans: next, saved: this._pendingKeyResize?.saved || spans };
    clearTimeout(this._keyResizeTimer);
    this._keyResizeTimer = setTimeout(() => this._flushKeyResize(), KEY_RESIZE_COMMIT_MS);
  }

  _onFocusOut(event) {
    if (this._refocusing || !this._pendingKeyResize) return;
    if (event.relatedTarget?.classList?.contains("resize-handle")
      && event.relatedTarget.dataset.mention === this._pendingKeyResize.mentionId) return;
    this._flushKeyResize();
  }

  /** Text offset under a viewport point, or null outside the text. */
  _offsetAtPoint(x, y) {
    let node = null;
    let offset = 0;
    if (document.caretPositionFromPoint) {
      const position = document.caretPositionFromPoint(x, y);
      if (position) { node = position.offsetNode; offset = position.offset; }
    } else if (document.caretRangeFromPoint) {
      const range = document.caretRangeFromPoint(x, y);
      if (range) { node = range.startContainer; offset = range.startOffset; }
    }
    if (!node || !this.container.contains(node)) return null;
    // In the empty part of the pane the browser answers with the nearest caret
    // (usually the end of the text). Only a point on a text line counts.
    const caret = document.createRange();
    caret.setStart(node, offset);
    caret.collapse(true);
    const line = caret.getBoundingClientRect?.();
    if (line && line.height > 0 && (y < line.top - line.height / 2 || y > line.bottom + line.height / 2)) {
      return null;
    }
    return this._offsetOf(node, offset);
  }

  _onPointerDown(event) {
    this._suppressClick = false;
    const handle = event.target?.closest?.(".resize-handle");
    if (this._drag) {
      // One drag at a time: a second finger or pointer does not take it over.
      if (handle) event.preventDefault();
      return;
    }
    if (!handle || this.readOnly || event.button > 0) return;
    const mentionId = handle.dataset.mention;
    const original = this._spansOf(mentionId);
    if (!original) return;
    // No text selection, no compatibility mouse events (and so no paint) for this gesture.
    event.preventDefault();
    // The click that ends the gesture must not pick whatever mention lies under the pointer.
    this._suppressClick = true;
    this._flushKeyResize();
    this._drag = {
      mentionId,
      index: Number(handle.dataset.segment),
      edge: handle.dataset.edge,
      original,
      current: null,
      pointerId: event.pointerId,
    };
    this.container.classList.add("resizing");
    this.container.setPointerCapture?.(event.pointerId);
    window.addEventListener("keydown", this._onDragKeyBound, true);
  }

  _onPointerMove(event) {
    const drag = this._drag;
    if (!drag || event.pointerId !== drag.pointerId) return;
    // The button was released where we could not see it: give the drag up.
    if (event.pointerType === "mouse" && event.buttons === 0) {
      this._endDrag(event, false);
      return;
    }
    const offset = this._offsetAtPoint(event.clientX, event.clientY);
    if (offset === null) return; // outside the text: keep the last valid edge
    const next = resizeSegment(this.text, drag.original, drag.index, drag.edge, offset);
    const shown = drag.current || drag.original;
    const target = next || drag.original;
    if (JSON.stringify(shown) === JSON.stringify(target)) return;
    drag.current = next;
    this._applySpans(drag.mentionId, target);
  }

  _stopDrag() {
    const drag = this._drag;
    this._drag = null;
    this.container.classList.remove("resizing");
    window.removeEventListener("keydown", this._onDragKeyBound, true);
    if (drag) {
      try { this.container.releasePointerCapture?.(drag.pointerId); } catch { /* already released */ }
    }
    return drag;
  }

  _endDrag(event, commit) {
    if (this._drag && event?.pointerId !== undefined && event.pointerId !== this._drag.pointerId) return;
    const drag = this._stopDrag();
    if (!drag) return;
    if (commit && drag.current) {
      // Leave keyboard focus on the dropped edge, so arrow keys can fine-tune it.
      const origin = drag.original[drag.index];
      const anchor = drag.edge === "start" ? origin.end - 1 : origin.start;
      const segment = drag.current.find((s) => s.start <= anchor && anchor < s.end) || drag.current[0];
      this._findHandle(drag.mentionId, drag.edge, drag.edge === "start" ? segment.start : segment.end)
        ?.focus({ preventScroll: true });
      this.handlers.onResize?.(drag.mentionId, drag.current);
    } else if (drag.current) {
      this._applySpans(drag.mentionId, drag.original);
    }
  }

  _onDragKey(event) {
    if (event.key !== "Escape" || !this._drag) return;
    // Captured on window, so the case screen's own Escape (deselect) never sees it.
    event.preventDefault();
    event.stopImmediatePropagation();
    this._endDrag(event, false);
  }

  highlight(mentionIds) {
    this.activeIds = new Set(mentionIds || []);
    for (const node of this.container.querySelectorAll(".run")) {
      const ids = (node.dataset.mentions || "").split(",").filter(Boolean);
      const isHot = ids.some((id) => this.activeIds.has(id));
      node.classList.toggle("run--hot", isHot);
      const start = Number(node.dataset.start);
      const edges = isHot ? this._hotEdges(start, start + node.textContent.length) : null;
      node.classList.toggle("run--hot-start", Boolean(edges?.atStart));
      node.classList.toggle("run--hot-end", Boolean(edges?.atEnd));
      // The colours and bands of a run do not change with the selection (issue 524): the frame shows it.
    }
  }

  /** Runs containing any of these mentions get the `run--framed` frame. */
  setFramed(mentionIds) {
    this.framedIds = new Set(mentionIds || []);
    for (const node of this.container.querySelectorAll(".run")) {
      const ids = (node.dataset.mentions || "").split(",").filter(Boolean);
      node.classList.toggle("run--framed", ids.some((id) => this.framedIds.has(id)));
    }
  }

  render() {
    const marks = normaliseSpans(this.markers);
    const runs = decomposeRuns(
      this.text.length,
      this.mentions,
      [...marks.flatMap((m) => [m.start, m.end]), ...this.passages.flatMap((p) => [p.start, p.end]), ...this.paragraphStarts],
    );
    const tints = normaliseSpans(this.suggestions);
    const fragment = document.createDocumentFragment();
    // Runs of a changed passage go into its wrapper; everything else into the fragment.
    let target = fragment;
    let openPassage = null;
    let nextPassage = 0;
    const openPassagesAt = (offset) => {
      while (nextPassage < this.passages.length && this.passages[nextPassage].start <= offset) {
        const passage = this.passages[nextPassage];
        nextPassage += 1;
        const wrapper = this._passageNode(passage);
        target.appendChild(wrapper);
        if (passage.end > passage.start && !openPassage) {
          target = wrapper;
          openPassage = passage;
        }
      }
    };

    const paragraphIndexes = new Map(this.paragraphStarts.map((start, index) => [start, index]));
    const appendParagraph = (offset) => {
      const index = paragraphIndexes.get(offset);
      if (index === undefined) return;
      const marker = document.createElement("span");
      marker.dataset.paragraph = String(index);
      marker.setAttribute("aria-hidden", "true");
      // Empty inline geometry at the line top, without a glyph or a line box of its own.
      Object.assign(marker.style, {
        display: "inline-block", width: "0", height: "0", verticalAlign: "top",
        padding: "0", margin: "0", border: "0", pointerEvents: "none", userSelect: "none",
      });
      target.appendChild(marker);
    };
    const { starts, ends } = this._handlesByOffset();
    const mentionStarts = new Map(this.mentions.map((m) => [m.mention_id, normaliseSpans(m.spans || [])[0]?.start ?? 0]));
    if (!runs.length) appendParagraph(0);
    for (const run of runs) {
      appendParagraph(run.start);
      if (!openPassage) openPassagesAt(run.start);
      const node = document.createElement("span");
      node.className = "run";
      node.dataset.start = String(run.start);
      node.dataset.mentions = run.mentionIds.join(",");
      if (run.mentionIds.length === 1) node.classList.add("run--marked");
      if (run.mentionIds.length > 1) node.classList.add("run--marked", "run--multi");
      if (tints.some((t) => t.start < run.end && run.start < t.end)) {
        node.classList.add("run--suggested");
      }
      if (marks.some((m) => m.start < run.end && run.start < m.end)) {
        node.classList.add("run--marker");
      }
      if (run.mentionIds.some((id) => this.activeIds.has(id))) {
        node.classList.add("run--hot");
        const edges = this._hotEdges(run.start, run.end);
        if (edges.atStart) node.classList.add("run--hot-start");
        if (edges.atEnd) node.classList.add("run--hot-end");
      }

      if (run.mentionIds.some((id) => this.framedIds.has(id))) node.classList.add("run--framed");

      if (run.mentionIds.length > 0) {
        const runMentions = run.mentionIds
          .map((id) => this.mentions.find((m) => m.mention_id === id))
          .filter(Boolean);
        for (const m of runMentions) {
          if (m.kind) node.classList.add(`run--${m.kind}`);
        }
        const titles = runMentions.map((m) => m.label).filter(Boolean);
        if (titles.length) node.title = titles.join("; ");
        if (runMentions.some((m) => m.negated)) node.classList.add("run--negated");
        for (const name of bandClasses(runMentions, mentionStarts)) node.classList.add(name);
      }

      node.appendChild(document.createTextNode(this.text.slice(run.start, run.end)));
      for (const handle of starts.get(run.start) || []) target.appendChild(this._handleNode(handle));
      target.appendChild(node);
      for (const handle of ends.get(run.end) || []) target.appendChild(this._handleNode(handle));
      if (openPassage && run.end >= openPassage.end) {
        target = fragment;
        openPassage = null;
      }
    }
    // Text removed at the very end of the text.
    if (runs.length) openPassagesAt(this.text.length);
    // Redrawing replaces the handles: keep keyboard focus on the edge that had it.
    const active = document.activeElement;
    const focusedEdge = active?.classList?.contains("resize-handle") && this.container.contains(active)
      ? { ...active.dataset }
      : null;
    const focusedChange = active?.classList?.contains("change-removed") && this.container.contains(active)
      ? `.change-removed[data-passage="${active.dataset.passage}"]` : null;
    const refocusing = this._refocusing;
    this._refocusing = true;
    this.container.replaceChildren(fragment);
    if (focusedEdge) {
      const candidates = Array.from(this.container.querySelectorAll(".resize-handle")).filter((node) =>
        node.dataset.mention === focusedEdge.mention && node.dataset.edge === focusedEdge.edge);
      (candidates.find((node) => node.dataset.offset === focusedEdge.offset)
        || candidates.find((node) => node.dataset.segment === focusedEdge.segment))?.focus();
    }
    if (focusedChange) this.container.querySelector(focusedChange)?.focus({ preventScroll: true });
    this._refocusing = refocusing;
    if (!this.text) {
      this.container.appendChild(document.createTextNode(NBSP));
    }
  }

  _offsetOf(node, offset) {
    let element = node.nodeType === Node.TEXT_NODE ? node.parentElement : node;
    if (element?.classList?.contains("resize-handle")) return Number(element.dataset.offset);
    // A removed-text marker stands at its offset; it has no characters of its own.
    if (element?.classList?.contains("change-removed")) return Number(element.dataset.offset);
    while (element && element !== this.container && !element.classList?.contains("run")) {
      element = element.parentElement;
    }
    if (!element || element === this.container) return null;
    return Number(element.dataset.start) + offset;
  }

  _onMouseUp(event) {
    const selection = window.getSelection();
    if (!selection || selection.isCollapsed || selection.rangeCount === 0) return;
    if (this.readOnly) {
      if (!this.container.contains(selection.anchorNode)) return;
      this.handlers.onPaintBlocked?.();
      return;
    }

    const spans = [];
    for (let i = 0; i < selection.rangeCount; i += 1) {
      const range = selection.getRangeAt(i);
      if (!this.container.contains(range.commonAncestorContainer)) continue;
      const from = this._offsetOf(range.startContainer, range.startOffset);
      const to = this._offsetOf(range.endContainer, range.endOffset);
      if (from === null || to === null) continue;
      const span = trimToVisible(this.text, from, to);
      // A double click just after a word selects the "." alone: punctuation only is no mark (#23).
      if (span && /[^\p{P}]/u.test(this.text.slice(span.start, span.end))) spans.push(span);
      this._caret = to;
    }
    selection.removeAllRanges();
    if (!spans.length || !this.handlers.onPaint) return;
    this.handlers.onPaint(spans, {
      additive: Boolean(event?.metaKey || event?.ctrlKey),
    });
  }

  // Keyboard selection (Shift + arrows/Home/End, or caret browsing): commit the
  // selection when Shift is released or Enter is pressed.
  _onKeyDown(event) {
    const handle = event.target?.closest?.(".resize-handle");
    if (handle && (event.key === "ArrowLeft" || event.key === "ArrowRight")
      && !event.altKey && !event.shiftKey) {
      event.preventDefault();
      event.stopPropagation();
      this._onHandleKey(event, handle);
      return;
    }
    // Escape takes back a keyboard change that has not been saved yet, as it does
    // for a drag, and is used up by that (the selection stays).
    if (handle && event.key === "Escape" && this._pendingKeyResize) {
      event.preventDefault();
      event.stopPropagation();
      const pending = this._pendingKeyResize;
      this._clearKeyResize();
      this._applySpans(pending.mentionId, pending.saved);
      return;
    }
    // Any other key on a handle (a shortcut) first reports the pending change,
    // while the selection it belongs to is still current.
    if (handle && !["Control", "Shift", "Alt", "Meta"].includes(event.key)) this._flushKeyResize();
    if (event.shiftKey && /^(Arrow|Home$|End$|PageUp$|PageDown$)/.test(event.key)) {
      this._keySelecting = true;
      if (!handle && event.key.startsWith("Arrow") && !event.altKey && !event.metaKey) this._startKeySelection(event);
    }
  }

  // Browsers only extend a selection that already has extent, so Shift + arrow with none
  // starts one at the caret (else the end of the last selection, else the text start).
  _startKeySelection(event) {
    const selection = window.getSelection();
    if (!selection?.modify) return;
    const inside = selection.rangeCount > 0 && this.container.contains(selection.anchorNode)
      && this.container.contains(selection.focusNode);
    if (inside && !selection.isCollapsed) return;
    if (!inside) {
      const run = Array.from(this.container.querySelectorAll(".run")).find((node) =>
        this._caret <= Number(node.dataset.start) + node.textContent.length);
      if (!run?.firstChild) return;
      selection.collapse(run.firstChild, Math.max(0, this._caret - Number(run.dataset.start)));
    }
    event.preventDefault();
    const vertical = event.key === "ArrowUp" || event.key === "ArrowDown";
    selection.modify("extend", event.key === "ArrowRight" || event.key === "ArrowDown" ? "forward" : "backward",
      vertical ? "line" : event.ctrlKey ? "word" : "character");
  }

  _onKeyUp(event) {
    if (!(event.key === "Shift" || event.key === "Enter")) return;
    if (event.key === "Shift" && !this._keySelecting) return;
    this._keySelecting = false;
    this._onMouseUp(event);
  }

  _runIds(target) {
    const run = target?.closest?.(".run");
    if (!run) return null;
    return (run.dataset.mentions || "").split(",").filter(Boolean);
  }

  _onHover(event, entering) {
    if (!this.handlers.onHoverMentions) return;
    const ids = this._runIds(event.target);
    if (ids === null) return;
    this.handlers.onHoverMentions(entering ? ids : []);
  }

  _onClick(event) {
    if (this._suppressClick) {
      this._suppressClick = false;
      return;
    }
    if (!window.getSelection()?.isCollapsed) return;
    const ids = this._runIds(event.target);
    if (ids && ids.length && this.handlers.onPick) {
      this.handlers.onPick(ids, event.target);
    }
  }
}
