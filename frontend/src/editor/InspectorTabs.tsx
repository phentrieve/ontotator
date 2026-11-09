import { useLayoutEffect, useReducer, useRef, useState, type KeyboardEvent, type RefObject } from "react";
import { flushSync } from "react-dom";
import { IconButton, IconClose } from "../ui";

/**
 * The editor's inspector column with the project guidelines in it (from 1060 px, where the editor has
 * three columns): two tabs, "Details" (the selected finding, as without guidelines) and "Guidelines vN",
 * so the guidelines take the inspector's place instead of a page drawer that would narrow the text.
 *
 * Rules (documented in docs/handbook/annotator.md):
 * - Every request to show the guidelines (More › Guidelines, the notice's "Read guidelines vN") selects
 *   the Guidelines tab and moves focus to its panel; closing them (✕, Close, Escape) returns to Details
 *   and focus to the control that opened them.
 * - Selecting a finding or proposal (list, text, J/K, N) keeps the Guidelines tab; the decision keys
 *   (1, 2, 0) act on the selected proposal from there.
 * - Work that needs a field of the inspector shows Details: a new finding (marked text or without a
 *   span), the attach mode, the term search (/), the values (V) and a required reviewer note (4, Unresolved).
 */
export type InspectorTab = "details" | "guidelines";

export interface InspectorTabsState {
  tab: InspectorTab;
  /** The inspector shows the guidelines tabs (guidelines open, three columns, the draft in view). */
  hosted: boolean;
  /** The last guidelines request seen (`GuidelinesPanel.request`). */
  request: number;
  /** Grows when the guidelines panel should take focus; `focusAlways` says whether it may take it from elsewhere. */
  focus: number;
  focusAlways: boolean;
}

export type InspectorTabsAction =
  | { type: "sync"; hosted: boolean; request: number }
  | { type: "select"; tab: InspectorTab }
  | { type: "details" };

export function initialInspectorTabs(hosted: boolean, request: number): InspectorTabsState {
  return { tab: hosted ? "guidelines" : "details", hosted, request, focus: 0, focusAlways: false };
}

export function inspectorTabsReducer(state: InspectorTabsState, action: InspectorTabsAction): InspectorTabsState {
  switch (action.type) {
    case "sync": {
      const requested = action.request !== state.request;
      if (!action.hosted) {
        if (!state.hosted && !requested) return state;
        return { ...state, tab: "details", hosted: false, request: action.request };
      }
      // A new request, or the guidelines arriving in the inspector (a wider window, back to the draft).
      if (requested || !state.hosted) {
        return { tab: "guidelines", hosted: true, request: action.request, focus: state.focus + 1, focusAlways: requested };
      }
      return state;
    }
    case "select":
      return state.hosted && state.tab !== action.tab ? { ...state, tab: action.tab } : state;
    case "details":
      return state.tab === "details" ? state : { ...state, tab: "details" };
  }
}

/** Tab a key moves to in the two-tab list (arrows wrap, Home, End), or null for other keys. */
export function tabForKey(current: InspectorTab, key: string): InspectorTab | null {
  if (key === "ArrowLeft" || key === "ArrowRight") return current === "details" ? "guidelines" : "details";
  if (key === "Home") return "details";
  if (key === "End") return "guidelines";
  return null;
}

/** A signature of what needs a field of the inspector; a change to an `active` one shows Details. */
export interface DetailsDemand {
  key: string;
  active: boolean;
}

export interface InspectorTabsOptions {
  hosted: boolean;
  /** Whether the guidelines are open at all (closing them returns focus to `returnFocus`). */
  open: boolean;
  request: number;
  returnFocus: RefObject<HTMLElement> | undefined;
  /** The inspector's scrolling element: each tab keeps its own position. */
  scroller: RefObject<HTMLElement>;
  panel: RefObject<HTMLElement>;
  demand: DetailsDemand;
}

export interface InspectorTabsControl {
  tab: InspectorTab;
  hosted: boolean;
  select: (tab: InspectorTab) => void;
  /** Shows Details at once (inside an event handler, before focusing a field of the inspector). */
  showDetailsNow: () => void;
  /** The inspector shows another finding: Details starts at its top, also while Guidelines is in front. */
  resetDetailsScroll: () => void;
}

export function useInspectorTabs({ hosted, open, request, returnFocus, scroller, panel, demand }: InspectorTabsOptions): InspectorTabsControl {
  const [state, dispatch] = useReducer(inspectorTabsReducer, undefined, () => initialInspectorTabs(hosted, request));
  // Render-phase sync (like derived state), so the commit that shows the guidelines already has the right tab.
  if (state.hosted !== hosted || state.request !== request) dispatch({ type: "sync", hosted, request });
  const [seenDemand, setSeenDemand] = useState(demand.key);
  if (seenDemand !== demand.key) {
    setSeenDemand(demand.key);
    if (demand.active) dispatch({ type: "details" });
  }
  const tabRef = useRef(state.tab);
  tabRef.current = state.tab;

  const scrollMemory = useRef<Record<InspectorTab, number>>({ details: 0, guidelines: 0 });
  const shownTab = useRef<InspectorTab>(state.tab);
  useLayoutEffect(() => {
    const element = scroller.current;
    if (!element) return;
    const remember = () => { scrollMemory.current[shownTab.current] = element.scrollTop; };
    element.addEventListener("scroll", remember, { passive: true });
    return () => element.removeEventListener("scroll", remember);
  }, [scroller]);
  useLayoutEffect(() => {
    if (shownTab.current === state.tab) return;
    shownTab.current = state.tab;
    if (scroller.current) scroller.current.scrollTop = scrollMemory.current[state.tab];
  }, [state.tab, scroller]);

  const focused = useRef(state.focus);
  useLayoutEffect(() => {
    if (focused.current === state.focus) return;
    focused.current = state.focus;
    const active = document.activeElement;
    if (state.focusAlways || !active || active === document.body) panel.current?.focus({ preventScroll: true });
  }, [state.focus, state.focusAlways, panel]);

  // Closed while shown in the inspector: back to the control that opened them, as the drawer does.
  const shownOpen = useRef(open && hosted);
  useLayoutEffect(() => {
    const wasShown = shownOpen.current;
    shownOpen.current = open && hosted;
    if (!wasShown || open) return;
    scrollMemory.current.guidelines = 0;
    const active = document.activeElement;
    const inside = !active || active === document.body || !!scroller.current?.contains(active);
    const target = returnFocus?.current;
    if (inside && target?.isConnected) target.focus();
  }, [open, hosted, returnFocus, scroller]);

  return {
    tab: state.tab,
    hosted: state.hosted,
    select: tab => dispatch({ type: "select", tab }),
    showDetailsNow: () => { if (tabRef.current !== "details") flushSync(() => dispatch({ type: "details" })); },
    resetDetailsScroll: () => {
      scrollMemory.current.details = 0;
      if (tabRef.current === "details" && scroller.current) scroller.current.scrollTop = 0;
    },
  };
}

export interface InspectorTabListProps {
  /** Prefix of the tab and panel IDs (see `inspectorTabIds`). */
  idBase: string;
  tab: InspectorTab;
  version: number;
  onSelect: (tab: InspectorTab) => void;
  onClose: () => void;
}

export const inspectorTabIds = (idBase: string) => ({
  detailsTab: `${idBase}-tab-details`, guidelinesTab: `${idBase}-tab-guidelines`,
  detailsPanel: `${idBase}-panel-details`, guidelinesPanel: `${idBase}-panel-guidelines`,
});

/** "Details | Guidelines vN" with automatic activation (arrows, Home, End) and ✕, which closes the guidelines. */
export function InspectorTabList({ idBase, tab, version, onSelect, onClose }: InspectorTabListProps): JSX.Element {
  const ids = inspectorTabIds(idBase);
  // Escape on a tab or on ✕ closes the guidelines, as in their panel.
  const onEscape = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== "Escape" || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
    event.preventDefault();
    event.stopPropagation();
    onClose();
  };
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
    const next = tabForKey(tab, event.key);
    if (next === null) return;
    event.preventDefault();
    // Arrow keys stay in the tablist (no text edge or other screen key reacts to them).
    event.stopPropagation();
    flushSync(() => onSelect(next));
    document.getElementById(next === "details" ? ids.detailsTab : ids.guidelinesTab)?.focus();
  };
  const tabButton = (id: InspectorTab, label: JSX.Element) => <button type="button" role="tab"
    id={id === "details" ? ids.detailsTab : ids.guidelinesTab} aria-controls={id === "details" ? ids.detailsPanel : ids.guidelinesPanel}
    aria-selected={tab === id} tabIndex={tab === id ? 0 : -1} className="ui-tab inspector-tab" onClick={() => onSelect(id)}>{label}</button>;
  return <div className="inspector-tabs" onKeyDown={onEscape}>
    <div role="tablist" aria-label="Inspector" className="inspector-tablist" onKeyDown={onKeyDown}>
      {tabButton("details", <>Details</>)}
      {tabButton("guidelines", <>Guidelines <span className="inspector-tab-badge">v{version}</span></>)}
    </div>
    <IconButton className="inspector-tabs-close" label="Close guidelines" icon={<IconClose />} variant="quiet" size="sm" onClick={onClose} />
  </div>;
}
