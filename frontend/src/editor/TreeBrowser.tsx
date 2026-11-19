import { IconButton } from "../ui/IconButton";
import { IconClose } from "../ui/icons";
import { InlineMessage } from "../ui/InlineMessage";
import { Button } from "../ui/Button";
import { viewLabel } from "./termLinks";
import React, { useEffect, useMemo, useRef, useState } from "react";
import { api, type TreeTermDetail } from "../api/client";
import type { WorkspaceKey } from "./searchState";
import { TermTree } from "./TermTree";
import {
  emptyTree,
  keysAlong,
  parentKeyOf,
  termOfKey,
  visibleRows,
  withLevels,
  withRoots,
  type TreeData,
} from "./treeState";
import { LanguageFlag } from "../ui/LanguageTag";
import { MODIFIER_IN_CHANGE } from "./SearchPanel";
import { takeEffect, treeModeNote, type TreeMode } from "./treeMode";

/**
 * Whether the details under the tree show more than the name and id. Kept per user in this
 * browser, as the widths of the editor's columns are (sidebarWidth.ts).
 */
export const treeDetailsKey = (username: string) => `ontotator.editor.treeDetails.v1:${username}`;
const detailsStartOpen = (username: string | undefined): boolean => {
  if (!username) return true;
  try { return window.localStorage.getItem(treeDetailsKey(username)) !== "closed"; } catch { return true; }
};
const rememberDetails = (username: string | undefined, open: boolean) => {
  if (!username) return;
  try { window.localStorage.setItem(treeDetailsKey(username), open ? "open" : "closed"); } catch { /* Blocked storage: not remembered. */ }
};

export interface TreeBrowserProps {
  /** Out of sight and out of reach for now; the walk and its state are kept. */
  collapsed?: boolean;
  workspaceKey: WorkspaceKey;
  /** The annotation this walk belongs to. */
  annotationId: string;
  layerId: string;
  /** The term the walk starts at. */
  startTermId: string;
  /** The term that annotation carries right now. */
  currentTermId: string | null;
  /** False while nothing can be changed from this walk: the tree only shows terms. */
  canAssign: boolean;
  /**
   * How a term is taken (issue 523): "assign" at once with "Use this term"; "proposal" and "new" only after a
   * confirmation that says what happens; "look" not at all.
   */
  mode?: TreeMode;
  /** The hint beside the button while the term that is current is selected. */
  currentHint?: string;
  /** Move the keyboard focus into the tree once it has loaded. */
  focusOnOpen: boolean;
  onClose: () => void;
  /** Assign the term. The walk's id binds the selection to what was shown. */
  onUseTerm: (termId: string, browseId: string, label?: string) => Promise<void>;
  /** The active search languages: only their translated names are shown (F14). */
  languages?: readonly string[];
  /** Whose choice of "Hide details" this is; without it the choice lasts for this walk only. */
  username?: string;
}

const messageOf = (error: unknown): string => (error instanceof Error ? error.message : String(error));

const START_NOTICE: Record<string, string> = {
  obsolete: "is obsolete",
  unknown: "is not part of this ontology",
};

/**
 * One walk through the ontology tree, as a panel docked into the case layout. It
 * opens once, when the component mounts; the parent starts another walk by giving
 * the component a new key.
 */
export const TreeBrowser: React.FC<TreeBrowserProps> = ({
  collapsed = false,
  workspaceKey,
  annotationId,
  layerId,
  startTermId,
  currentTermId,
  canAssign,
  mode = "assign",
  currentHint = "This is the annotation's current term.",
  focusOnOpen,
  onClose,
  onUseTerm,
  languages = [],
  username,
}) => {
  const [data, setData] = useState<TreeData>(emptyTree);
  // Closed, the details keep the name and id only and the tree gets the room.
  const [detailsOpen, setDetailsOpen] = useState(() => detailsStartOpen(username));
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const [focusedKey, setFocusedKey] = useState<string | null>(null);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [details, setDetails] = useState<Record<string, TreeTermDetail>>({});
  const [browseId, setBrowseId] = useState<string | null>(null);
  const [startStatus, setStartStatus] = useState<string | null>(null);
  const [loadingKeys, setLoadingKeys] = useState<Set<string>>(() => new Set());
  const [reveal, setReveal] = useState<{ key: string; focus: boolean } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  // The confirmation of "Use this term instead…" is open for this term.
  const [confirming, setConfirming] = useState<string | null>(null);
  const takeButton = useRef<HTMLButtonElement | null>(null);
  const confirmButton = useRef<HTMLButtonElement | null>(null);

  const sectionRef = useRef<HTMLElement | null>(null);
  const opened = useRef(false);

  // Collapsed, nothing in here keeps the keyboard focus.
  useEffect(() => {
    const active = document.activeElement;
    if (collapsed && active instanceof HTMLElement && sectionRef.current?.contains(active)) active.blur();
  }, [collapsed]);

  // One walk per mount. The guard keeps React's development double-run of
  // effects from logging a second walk; nothing is cancelled on cleanup for
  // the same reason.
  useEffect(() => {
    if (opened.current) return;
    opened.current = true;
    api
      .openTree({ workspace_key: workspaceKey, annotation_id: annotationId, layer_id: layerId, term_id: startTermId })
      .then((walk) => {
        const keys = keysAlong(walk.path);
        const startKey = keys.length > 0 ? keys[keys.length - 1] : null;
        const firstKey = startKey ?? walk.roots[0]?.term_id ?? null;
        setData(withLevels(withRoots(emptyTree(), walk.roots), walk.levels));
        setExpanded(new Set(keys));
        setBrowseId(walk.browse_id);
        setStartStatus(walk.start_status);
        if (walk.detail) setDetails({ [walk.detail.term_id]: walk.detail });
        setSelectedKey(startKey);
        setFocusedKey(firstKey);
        if (firstKey) setReveal({ key: firstKey, focus: focusOnOpen });
      })
      .catch((reason) => setError(messageOf(reason)));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- open the tree once on mount
  }, []);

  const loadNode = async (key: string, options: { expand?: boolean; viaParentId?: string }) => {
    if (!browseId) return null;
    setError(null);
    setLoadingKeys((current) => new Set(current).add(key));
    try {
      const node = await api.loadTreeNode({
        workspace_key: workspaceKey,
        annotation_id: annotationId,
        layer_id: layerId,
        browse_id: browseId,
        term_id: termOfKey(key),
        expand: options.expand ?? false,
        via_parent_id: options.viaParentId ?? null,
      });
      setDetails((current) => ({ ...current, [node.detail.term_id]: node.detail }));
      return node;
    } catch (reason) {
      setError(messageOf(reason));
      return null;
    } finally {
      setLoadingKeys((current) => {
        const next = new Set(current);
        next.delete(key);
        return next;
      });
    }
  };

  const select = (key: string) => {
    // The confirmation names one term: another one closes it.
    if (key !== selectedKey) setConfirming(null);
    setSelectedKey(key);
    setFocusedKey(key);
    if (!details[termOfKey(key)]) void loadNode(key, {});
  };

  const expand = async (key: string) => {
    const termId = termOfKey(key);
    if (data.children[termId] === undefined) {
      const node = await loadNode(key, { expand: true });
      if (!node) return;
      setData((current) => withLevels(current, [{ term_id: termId, children: node.children }]));
    }
    setExpanded((current) => new Set(current).add(key));
  };

  const collapse = (key: string) => {
    setExpanded((current) => {
      const next = new Set(current);
      next.delete(key);
      return next;
    });
    // The focused row may be inside the branch that just closed.
    if (focusedKey && focusedKey.startsWith(`${key}/`)) setFocusedKey(key);
  };

  /** "Also under": open the path through another parent of the selected term and go there. */
  const showUnder = async (parentId: string) => {
    if (!selectedKey) return;
    const node = await loadNode(selectedKey, { viaParentId: parentId });
    if (!node || node.path.length === 0) return;
    const keys = keysAlong(node.path);
    const target = keys[keys.length - 1];
    setData((current) => withLevels(current, node.levels));
    setExpanded((current) => new Set([...current, ...keys.slice(0, -1)]));
    setSelectedKey(target);
    setFocusedKey(target);
    setReveal({ key: target, focus: true });
  };

  const rows = useMemo(() => visibleRows(data, expanded), [data, expanded]);
  const selectedTermId = selectedKey ? termOfKey(selectedKey) : null;
  const detail = selectedTermId ? details[selectedTermId] ?? null : null;
  const selectedParentKey = selectedKey ? parentKeyOf(selectedKey) : null;
  const pathParentId = selectedParentKey ? termOfKey(selectedParentKey) : null;
  const otherParents = (detail?.parents ?? []).filter((parent) => parent.term_id !== pathParentId);
  const isCurrent = selectedTermId !== null && selectedTermId === currentTermId;
  const isModifier = (termId: string) => {
    const role = data.nodes[termId]?.role;
    return role === "modifier" || role === "cohort";
  };
  const selectedIsModifier = selectedTermId !== null && isModifier(selectedTermId);
  const treeMode: TreeMode = canAssign ? mode : "look";
  const takeMode = treeMode === "proposal" || treeMode === "new" ? treeMode : null;
  const modeNote = treeModeNote(treeMode);
  // The confirmation names the term: it waits for the term's details.
  const canUse = treeMode !== "look" && browseId !== null && selectedTermId !== null && !isCurrent && !saving
    && (!takeMode || detail !== null);

  // Back from the confirmation, the focus returns to the button that opened it (once that is rendered again).
  const [takeFocus, setTakeFocus] = useState(0);
  const focusTake = () => setTakeFocus((count) => count + 1);
  useEffect(() => {
    if (takeFocus) takeButton.current?.focus();
  }, [takeFocus]);
  useEffect(() => {
    if (confirming) confirmButton.current?.focus();
  }, [confirming]);
  // The walk can no longer take a term (a decision came in meanwhile): an open confirmation goes.
  useEffect(() => {
    if (!takeMode) setConfirming(null);
  }, [takeMode]);

  const assignTerm = async () => {
    if (!canUse || !selectedTermId || !browseId) return;
    const confirmed = confirming === selectedTermId;
    setSaving(true);
    setError(null);
    try {
      if (takeMode) await onUseTerm(selectedTermId, browseId, detail?.label);
      else await onUseTerm(selectedTermId, browseId);
      setConfirming(null);
      // The confirmation is gone: the focus goes back into the tree, on the term just taken.
      if (confirmed && selectedKey) setReveal({ key: selectedKey, focus: true });
    } catch (reason) {
      setError(messageOf(reason));
      if (confirmed) { setConfirming(null); focusTake(); }
    } finally {
      setSaving(false);
    }
  };

  const cancelConfirm = () => {
    setConfirming(null);
    focusTake();
  };

  const hint = isCurrent
    ? currentHint
    : selectedIsModifier
      ? MODIFIER_IN_CHANGE
      : null;

  return (
    <div className="tree-host" id="ontology-tree" hidden={collapsed}>
      <section ref={sectionRef} className="tree-browser" role="region" aria-label="Ontology tree"
        aria-describedby={modeNote ? "tree-mode-note" : undefined}>
        <header className="tree-browser__header">
          <h2>Ontology tree</h2>
          <IconButton label="Close tree" icon={<IconClose />} size="sm" onClick={onClose} />
        </header>

        {/* Read out as the tree opens in this state, and with the region's name when the focus enters it. */}
        {modeNote && <p id="tree-mode-note" className="tree-mode-note" role="status" data-tree-mode={treeMode}>{modeNote}</p>}
        {startStatus && START_NOTICE[startStatus] && (
          <div className="tree-notice" role="status">
            {`${startTermId} ${START_NOTICE[startStatus]}. The tree starts at the top.`}
          </div>
        )}
        {error && (
          <InlineMessage tone="error">
            {error}
          </InlineMessage>
        )}

        <div className="tree-browser__body">
          <div className="tree-browser__tree">
            {browseId === null ? (
              !error && <div className="tree-loading">Loading tree…</div>
            ) : (
              <TermTree
                rows={rows}
                focusedKey={focusedKey}
                selectedKey={selectedKey}
                currentTermId={currentTermId}
                loadingKeys={loadingKeys}
                reveal={reveal}
                label="Terms"
                onFocusKey={setFocusedKey}
                onExpand={(key) => {
                  void expand(key);
                }}
                onCollapse={collapse}
                onSelect={select}
                onClose={onClose}
              />
            )}
          </div>

          <div className={detailsOpen ? "tree-detail" : "tree-detail tree-detail--compact"}>
            <div className="tree-detail__body">
              {detail ? (
                <>
                  {/* The switch sits by the name, not in the action row: there it took the room of the hint beside "Use this term". */}
                  <div className="tree-detail__head">
                    <h3 className="tree-detail__name">{detail.label}</h3>
                    <Button type="button" size="sm" variant="quiet" className="tree-detail__toggle" aria-expanded={detailsOpen}
                      aria-controls="tree-detail-more"
                      onClick={() => { setDetailsOpen(!detailsOpen); rememberDetails(username, !detailsOpen); }}>
                      {detailsOpen ? "Hide details" : "Show details"}
                    </Button>
                  </div>
                  <div className="tree-detail__ids">
                    <div className="tree-detail__id">{detail.term_id}</div>
                    {detail.external_url && (
                      <a
                        className="tree-external"
                        href={detail.external_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        aria-label={viewLabel(detail.term_id, detail.external_url)}
                        title={viewLabel(detail.term_id, detail.external_url)}
                      >
                        ↗
                      </a>
                    )}
                  </div>
                  {/* Always there for aria-controls; empty while hidden. */}
                  <div id="tree-detail-more">{detailsOpen && (<>
                  {detail.definition && <p className="tree-detail__definition">{detail.definition}</p>}
                  {detail.synonyms.length > 0 && (
                    <div className="tree-detail__group">
                      <h4>Synonyms</h4>
                      <ul>
                        {detail.synonyms.map((synonym) => (
                          <li key={synonym}>{synonym}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                  {Object.keys(detail.translations).some((language) => languages.includes(language)) && (
                    <div className="tree-detail__group">
                      <h4>Translated names</h4>
                      <dl>
                        {Object.entries(detail.translations)
                          .filter(([language]) => languages.includes(language))
                          .sort(([a], [b]) => a.localeCompare(b))
                          .map(([language, names]) => (
                          <React.Fragment key={language}>
                            <dt><LanguageFlag code={language} />{language}</dt>
                            <dd>{names.join("; ")}</dd>
                          </React.Fragment>
                        ))}
                      </dl>
                    </div>
                  )}
                  {otherParents.length > 0 && (
                    <div className="tree-detail__group">
                      <h4>Also under</h4>
                      <ul>
                        {otherParents.map((parent) => (
                          <li key={parent.term_id}>
                            <Button
                              size="sm"
                              onClick={() => {
                                void showUnder(parent.term_id);
                              }}
                            >
                              {parent.label}
                            </Button>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                  </>)}</div>
                </>
              ) : (
                <p className="tree-detail__empty">
                  {selectedKey ? "Loading…" : "Select a term in the tree to see its details."}
                </p>
              )}
            </div>
            {/* Looking only: nothing to take, no button. */}
            {treeMode !== "look" && (takeMode && confirming && confirming === selectedTermId && detail ? (
              <div className="tree-detail__actions tree-detail__actions--confirm" role="group" aria-labelledby="tree-take-effect"
                onKeyDown={(event) => {
                  if (event.key !== "Escape") return;
                  event.preventDefault();
                  event.stopPropagation();
                  cancelConfirm();
                }}>
                <p id="tree-take-effect" className="tree-detail__effect">{takeEffect(takeMode, detail.label, detail.term_id)}</p>
                <Button ref={confirmButton} type="button" variant="primary" disabled={saving} onClick={() => { void assignTerm(); }}>
                  Confirm
                </Button>
                <Button type="button" disabled={saving} onClick={cancelConfirm}>Cancel</Button>
              </div>
            ) : (
              <div className="tree-detail__actions">
                <Button
                  ref={takeButton}
                  type="button"
                  variant="primary"
                  disabled={!canUse}
                  aria-describedby={hint ? "tree-use-hint" : undefined}
                  onClick={() => {
                    if (!takeMode) { void assignTerm(); return; }
                    if (canUse && selectedTermId) setConfirming(selectedTermId);
                  }}
                >
                  {takeMode ? "Use this term instead…" : "Use this term"}
                </Button>
                {hint && <span id="tree-use-hint" className="tree-detail__hint">{hint}</span>}
              </div>
            ))}
          </div>
        </div>
      </section>
    </div>
  );
};
