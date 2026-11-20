/**
 * DOM ranges for text offsets in a reading pane whose rendered characters are a known text: the editor's mirror,
 * a TextView, or a DiffView without its deleted words. Sentence marks and the find bar draw over these ranges,
 * so the text itself never changes its DOM for them.
 */

/** Parts of a pane whose characters are not the text: deleted words, the sentence gutter, screen reader notes. */
const SKIP = "del, [data-gutter], .review-sr-only";

export interface TextIndex {
  nodes: Text[];
  /** UTF-16 offset of each node's first character in the text. */
  starts: number[];
  length: number;
}

export function indexText(root: Element): TextIndex {
  const nodes: Text[] = [], starts: number[] = [];
  let length = 0;
  const walker = root.ownerDocument.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode: node => node.parentElement?.closest(SKIP) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT,
  });
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const text = node as Text;
    if (!text.data) continue;
    nodes.push(text); starts.push(length); length += text.data.length;
  }
  return { nodes, starts, length };
}

/** The node holding `offset`; at a node boundary the later node, unless `end` asks for the earlier one. */
function locate(index: TextIndex, offset: number, end: boolean): [Text, number] | null {
  if (!index.nodes.length || offset < 0 || offset > index.length) return null;
  let low = 0, high = index.nodes.length - 1;
  while (low < high) {
    const middle = (low + high + 1) >> 1;
    if (index.starts[middle] < offset || (!end && index.starts[middle] === offset)) low = middle; else high = middle - 1;
  }
  const node = index.nodes[low];
  return [node, Math.min(offset - index.starts[low], node.data.length)];
}

/** A range over the text from `start` to `end`, or null when the pane does not hold that text. */
export function rangeAt(index: TextIndex, start: number, end: number): Range | null {
  const from = locate(index, start, false), to = locate(index, end, true);
  if (!from || !to) return null;
  const range = from[0].ownerDocument.createRange();
  range.setStart(from[0], from[1]); range.setEnd(to[0], to[1]);
  return range;
}

/** Where a range's first line box stands, relative to `origin`; null where layout gives no boxes (jsdom). */
export function firstLine(range: Range, origin: Element): { top: number; left: number; height: number } | null {
  const rects = typeof range.getClientRects === "function" ? Array.from(range.getClientRects()).filter(rect => rect.width > 0 || rect.height > 0) : [];
  if (!rects.length) return null;
  const box = origin.getBoundingClientRect(), first = rects[0];
  return { top: first.top - box.top, left: first.left - box.left, height: first.height };
}

/** Where a range's last line box stands, relative to `origin`, with its width; null where layout gives no boxes. */
export function lastLine(range: Range, origin: Element): { top: number; left: number; width: number } | null {
  const rects = typeof range.getClientRects === "function" ? Array.from(range.getClientRects()).filter(rect => rect.width > 0 || rect.height > 0) : [];
  if (!rects.length) return null;
  const box = origin.getBoundingClientRect(), last = rects[rects.length - 1];
  return { top: last.top - box.top, left: last.left - box.left, width: last.width };
}
