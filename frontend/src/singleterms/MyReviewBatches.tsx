import { useEffect, useState, type MouseEvent } from "react";
import { api, type ProjectSummary, type SingleTermBatch } from "../api/client";
import { routeHref, type Route } from "../app/router";
import { DataTable, type Column } from "../ui";
import { onSpaceActivate } from "../ui/spaceActivates";
import { batchScope } from "./labels";

type Row = { project: ProjectSummary; batch: SingleTermBatch };

/**
 * My tasks: the user's open single-term review batches, one row per batch with a link into it. Projects
 * without the review (or without access) answer with an error and simply list nothing.
 */
export function MyReviewBatches({ projects, project, username, onNavigate }: {
  projects: readonly ProjectSummary[];
  /** The project filter of My tasks, if any. */
  project?: string;
  username: string;
  onNavigate: (route: Route) => void;
}): JSX.Element | null {
  const [rows, setRows] = useState<Row[]>([]);
  const identity = projects.map(item => item.project_key).join("\u0000");
  useEffect(() => {
    let active = true;
    void Promise.all(projects.map(item => new Promise<unknown>(resolve => resolve(api.listSingleTermBatches(item.project_key))).then(
      batches => Array.isArray(batches) ? (batches as SingleTermBatch[]).filter(batch => batch.state === "open" && batch.reviewer_username === username).map(batch => ({ project: item, batch })) : [],
      () => [] as Row[],
    ))).then(lists => { if (active) setRows(lists.flat()); });
    return () => { active = false; };
    // The project list is compared by its keys.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [identity, username]);
  const shown = rows.filter(row => project === undefined || row.project.project_key === project);
  if (!shown.length) return null;
  const columns: Column<Row>[] = [
    { id: "batch", header: "Batch", cell: ({ batch }) => <>#{batch.batch_id}{batch.role === "second" ? " · second review" : ""}</> },
    { id: "project", header: "Project", cell: ({ project: item }) => item.name === item.project_key ? item.name : `${item.name} (${item.project_key})` },
    { id: "groups", header: "Groups", cell: ({ batch }) => batchScope(batch) },
    { id: "progress", header: "Progress", cell: ({ batch }) => `${batch.decided} of ${batch.groups} decided` },
    { id: "open", header: "Action", cell: ({ project: item, batch }) => {
      const route: Route = { name: "projectSingleTermBatch", key: item.project_key, batchId: batch.batch_id };
      return <a className="btn btn-secondary" href={routeHref(route)} onKeyDown={onSpaceActivate} onClick={(event: MouseEvent<HTMLAnchorElement>) => {
        if (event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
        event.preventDefault(); onNavigate(route);
      }}>{batch.decided ? "Continue" : "Start"}</a>;
    } },
  ];
  return <section aria-labelledby="my-review-batches">
    <h2 id="my-review-batches">Single-term review</h2>
    <DataTable label="My single-term review batches" className="data-table--pin-end" rows={shown} columns={columns}
      rowKey={({ project: item, batch }) => `${item.project_key}:${batch.batch_id}`} />
  </section>;
}
