import type { ReactNode } from "react";

/** What "Show invisible characters" marks. The typography rules themselves stay on the server (issue 454). */
export type InvisibleKind = "space" | "tab" | "nbsp" | "zero-width" | "soft-hyphen" | "line-end";

const of = (kind: InvisibleKind, ...codes: number[]): [string, InvisibleKind][] => codes.map(code => [String.fromCodePoint(code), kind]);
/** Code points, so this file holds no invisible character itself. */
const KINDS = new Map<string, InvisibleKind>([
  ...of("space", 0x20),
  ...of("tab", 0x09),
  // No-break space, narrow no-break space, figure space.
  ...of("nbsp", 0xa0, 0x202f, 0x2007),
  // Zero width space, non-joiner, joiner, word joiner, byte order mark.
  ...of("zero-width", 0x200b, 0x200c, 0x200d, 0x2060, 0xfeff),
  ...of("soft-hyphen", 0xad),
]);
const PATTERN = new RegExp(`\\r\\n|\\r|\\n|[${[...KINDS.keys()].join("")}]`, "g");

/**
 * `text` as nodes whose characters are exactly `text`: every invisible character sits in a span of its own,
 * and CSS draws its mark over it. The marks are generated content, so they are never selected or copied,
 * and the spans add no width: the text wraps as it does without them.
 */
export function invisibleNodes(text: string, key: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  let position = 0, index = 0;
  for (const match of text.matchAll(PATTERN)) {
    const start = match.index ?? 0, found = match[0];
    if (start > position) nodes.push(text.slice(position, start));
    nodes.push(<span key={`${key}-${index++}`} className="invisible-char" data-invisible={KINDS.get(found) ?? "line-end"}>{found}</span>);
    position = start + found.length;
  }
  if (position < text.length) nodes.push(text.slice(position));
  return nodes;
}
