/**
 * DOM ranges for text offsets in a reading pane whose rendered characters are a known text: the editor's mirror,
 * a TextView, a DiffView without its deleted words, or one side of the segment pairs. The find bar draws over
 * these ranges, so the text itself never changes its DOM for them (from the prototype of issue 533).
 */

/** Parts of a pane whose characters are not the text: deleted words, notes such as "Not in the translation", screen reader notes. */
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

/**
 * The index of one side of the segment pairs: every cell of that side (`data-side`) holds the passage of the text
 * that starts at its `data-start`. A cell being edited (a text box) has no text nodes and is left out.
 */
export function indexCells(root: Element, side: string): TextIndex {
  const nodes: Text[] = [], starts: number[] = [];
  let length = 0;
  for (const cell of root.querySelectorAll<HTMLElement>(`[data-side="${side}"]`)) {
    const at = Number(cell.dataset.start), part = indexText(cell);
    if (!Number.isInteger(at)) continue;
    part.nodes.forEach((node, i) => { nodes.push(node); starts.push(at + part.starts[i]); });
    length = Math.max(length, at + part.length);
  }
  return { nodes, starts, length };
}
