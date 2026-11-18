import type { DecisionBarView } from "../api/client";
import { routeHref, type ProjectDocumentsQuery, type Route } from "../app/router";
import { Button, EmptyState, Tabs } from "../ui";
import { activeTab, CAN_TAKE_ANNOTATOR, TABS, tabCount, tabRoute, type TabId } from "./filterModel";
import { onSpaceActivate } from "../ui/spaceActivates";
import { isPlainClick, RouteLink } from "./RowCells";

export interface DocumentsTabsProps {
  bar: DecisionBarView;
  query: ProjectDocumentsQuery;
  projectKey: string;
  /** ID of the `role="tabpanel"` wrapper of the table. */
  panelId: string;
  /** Push navigation to a Documents route (plain clicks and Enter/Space only). */
  onNavigate: (route: Route) => void;
  /** Time of the shown counts ("Updated 10:42"). */
  updatedAt?: Date | null;
  onRefresh?: () => void;
}

const updatedFormat = new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit" });

/**
 * Tabs "Needs your decision, To assign, In progress, Done, All" with counts (V4; counts ignore
 * facets and search), "Updated 10:42, Refresh" and "Export final results…" (when the project has a
 * final result, `bar.finals`). Without `segment` the page shows All (VD7). A tab change keeps the
 * facets, search and order and drops page, open rows and selection.
 */
export function DocumentsTabs({ bar, query, projectKey, panelId, onNavigate, updatedAt, onRefresh }: DocumentsTabsProps): JSX.Element {
  const active = activeTab(query);
  const tabs = TABS.map(([id, label]) => {
    const count = tabCount(bar, id);
    return { id, label, count, href: routeHref(tabRoute(projectKey, query, id)), emphasised: id === "decision" && count > 0 };
  });
  const exportRoute: Route = { name: "projectExport", key: projectKey };
  return <div className="documents-tabs">
    <Tabs label="Documents views" tabs={tabs} active={active} panelId={panelId} onSelect={id => onNavigate(tabRoute(projectKey, query, id as TabId))} />
    <p className="documents-tabs-meta">
      {updatedAt && <span>{`Updated ${updatedFormat.format(updatedAt)}`}</span>}
      {onRefresh && <Button size="sm" onClick={onRefresh}>Refresh</Button>}
      {(bar.finals ?? 0) > 0 && <a className="btn btn-secondary btn-sm" href={routeHref(exportRoute)} onKeyDown={onSpaceActivate} onClick={event => {
        if (!isPlainClick(event)) return;
        event.preventDefault(); onNavigate(exportRoute);
      }}>Export final results…</a>}
    </p>
  </div>;
}

const EMPTY_TITLES: Readonly<Record<Exclude<TabId, "all">, string>> = {
  decision: "Nothing needs your decision", assign: "No text waits for an assignment", progress: "Nothing in progress", done: "Nothing done yet",
};

/** Empty tab (spec "States and edge cases"); an empty All tab is an empty project. */
export function TabEmptyState({ tab, projectKey, onNavigate, onUpload }: { tab: TabId; projectKey: string; onNavigate: (route: Route) => void; onUpload?: (variant: "primary") => JSX.Element }): JSX.Element {
  if (tab === "all") return <EmptyState title="No texts yet" action={onUpload?.("primary")}>Upload texts to start.</EmptyState>;
  const all = <RouteLink route={{ name: "projectDocuments", key: projectKey }} className="btn btn-secondary" onNavigate={onNavigate}>Show all texts</RouteLink>;
  // "To assign" lists texts nobody works on. A text whose first annotator is at work is under In progress and may still
  // take another one (its Next step reads "Assign annotation…"): the empty tab says where those are (review 2, F4).
  if (tab === "assign") return <EmptyState title={EMPTY_TITLES.assign} action={<>
    <RouteLink route={{ name: "projectDocuments", key: projectKey, flags: "can_take_annotator" }} className="btn btn-secondary" onNavigate={onNavigate}>Show texts that can take another annotator</RouteLink>
    {all}
  </>}>A text that someone already works on can still take another annotator, up to the limit. Such texts are under In progress; Filter › Annotation › {CAN_TAKE_ANNOTATOR} lists them.</EmptyState>;
  return <EmptyState title={EMPTY_TITLES[tab]} action={all} />;
}
