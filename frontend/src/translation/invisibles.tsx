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
/** The key shown on the screen while the marks are on (issue 472): each mark with what it stands for. */
export const INVISIBLES_KEY: readonly (readonly [string, string])[] = [
  ["\u00B7", "space"], ["\u00B0", "non-breaking space"], ["\u2192", "tab"], ["\u00B6", "line end"], ["\u00AC", "soft hyphen"], ["|", "zero-width character"],
];

export function InvisiblesKey(): JSX.Element {
  return <p className="invisibles-key">Marks:{INVISIBLES_KEY.map(([mark, name], index) => <span key={name}>{index > 0 && ","} <span className="invisibles-key-mark" aria-hidden="true">{mark}</span> {name}</span>)}</p>;
}

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
