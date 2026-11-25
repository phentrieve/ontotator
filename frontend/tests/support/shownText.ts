/**
 * The text a node shows, including generated text (`.generated-text`, drawn by CSS from `data-text`).
 * jsdom does not render `::after` content, so `textContent` leaves out deleted words of a change view (issue 533).
 */
export function shownText(node: Node): string {
  if (node instanceof Element && node.classList.contains("generated-text")) return node.getAttribute("data-text") ?? "";
  if (node.nodeType === Node.TEXT_NODE) return node.textContent ?? "";
  return Array.from(node.childNodes, shownText).join("");
}
