/**
 * What the ontology tree may do for the selection it shows (issue 523).
 *
 * - "assign": an own finding that can be edited. "Use this term" gives it the term at once, as before.
 * - "proposal": an undecided proposal. The term is taken only after a confirmation; it then records the
 *   decision Changed with that term, the same way Edit & Replace and a new term do.
 * - "new": a new finding whose term is being searched. The term is taken only after a confirmation; it
 *   then becomes the finding's term, as a search hit would.
 * - "look": nothing can change here (a reference, other people's findings, a submitted or read-only finding,
 *   a decided proposal). The tree only shows terms.
 */
export type TreeMode = "assign" | "proposal" | "new" | "look";

/** The selection the tree can show, as the case screen has it. */
export type TreeSelection =
  | { kind: "annotation"; annotationId: string; layerId: string; termId: string | null; editable: boolean }
  | { kind: "pending"; annotationId: string; layerId: string; editable: boolean }
  | {
      kind: "proposal"; key: string; layerId: string | null; termId: string | null;
      /** No decision yet, and this person may decide it here. */
      open: boolean;
      /** The Edit & Replace copy that already exists for it, if any. */
      copyId: string | null;
    }
  | { kind: "reference"; key: string; layerId: string; termId: string | null };

/** The tree for the current selection: where it starts and what it may do. */
export interface TreeContext {
  /** The walk follows this key: a new key starts a new walk, the same key keeps it. */
  key: string;
  layerId: string;
  /** Where a walk for this selection starts; null for a new finding (the walk starts at a search hit). */
  termId: string | null;
  mode: TreeMode;
  /**
   * The annotation a walk is logged for, so a term taken from it passes the server's check (the event names the
   * annotation the term is set on). Undefined when nothing can be taken: the walk then gets an id of its own,
   * so no id of somebody else's finding is sent.
   */
  annotationId?: string;
}

export const annotationKey = (annotationId: string) => `annotation:${annotationId}`;

export function treeContextOf(selection: TreeSelection | null): TreeContext | null {
  if (!selection) return null;
  switch (selection.kind) {
    case "annotation":
      return {
        key: annotationKey(selection.annotationId), layerId: selection.layerId, termId: selection.termId,
        mode: selection.editable ? "assign" : "look", annotationId: selection.annotationId,
      };
    case "pending":
      // Same key as the finding it becomes: once its term is chosen, the walk stays and can assign directly.
      return {
        key: annotationKey(selection.annotationId), layerId: selection.layerId, termId: null,
        mode: selection.editable ? "new" : "look", annotationId: selection.annotationId,
      };
    case "proposal":
      if (!selection.layerId) return null;
      return {
        key: `target:${selection.key}`, layerId: selection.layerId, termId: selection.termId,
        mode: selection.open ? "proposal" : "look",
        ...(selection.open && selection.copyId ? { annotationId: selection.copyId } : {}),
      };
    case "reference":
      return { key: `source:${selection.key}`, layerId: selection.layerId, termId: selection.termId, mode: "look" };
  }
}

/** What an open tree does when the selection changes. */
export type TreeFollow = "keep" | "close" | "restart";

/**
 * `steppedAside`: the walk was out of sight for the search of a new finding until now. Given up with nothing
 * selected, the search leaves the tree as it was.
 */
export function treeFollow(walkKey: string | null, context: TreeContext | null, pending: boolean, steppedAside = false): TreeFollow {
  if (walkKey === null) return "keep";
  // While a new finding's term is searched, a walk of another selection only steps aside.
  if (pending) return "keep";
  if (context && context.key === walkKey) return "keep";
  if (steppedAside && !context) return "keep";
  // A selection without a term, or one the tree cannot show at all, closes it.
  if (!context || !context.termId) return "close";
  return "restart";
}

/** The mode of the walk that is open: the context's while it still shows that selection, else looking only. */
export const walkMode = (walkKey: string, context: TreeContext | null): TreeMode =>
  context && context.key === walkKey ? context.mode : "look";

/** The note at the top of a tree that cannot assign directly; none where "Use this term" assigns. */
export const treeModeNote = (mode: TreeMode): string | null =>
  mode === "assign" ? null
    : mode === "look" ? "Only looking: nothing can be changed from here."
      : "Only looking: nothing changes until you choose a term and confirm.";

/** What the confirmation says will happen. */
export const takeEffect = (mode: "proposal" | "new", label: string, termId: string): string =>
  mode === "proposal" ? `Proposal: decide as Changed with ${label} (${termId})` : `New finding: choose ${label} (${termId})`;
