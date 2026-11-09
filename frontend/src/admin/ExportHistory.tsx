import { useCallback, useEffect, useRef, useState } from "react";
import { api, ApiError, type ProjectJobView } from "../api/client";
import { saveDownload } from "../api/download";
import { personLabel } from "../app/identity";
import { Time } from "../app/Time";
import { fullTimestamp } from "../app/submissionLabels";
import { Button, EmptyValue, StatusBadge } from "../ui";
import { ErrorNotice } from "./ErrorNotice";

/** The export jobs the history lists, with their row title and the file suffix of the download. */
const exportKinds: Record<string, { title: string; suffix: string }> = {
  final_t1_export: { title: "Final results", suffix: "zip" },
  final_phenopacket_export: { title: "Phenopackets", suffix: "zip" },
  final_single_term_export: { title: "Single-term cases", suffix: "zip" },
  t1_export: { title: "Annotation results", suffix: "zip" },
  edit_log_export: { title: "Edit log", suffix: "jsonl" },
  work_time_export: { title: "Working time", suffix: "jsonl" },
  translation_review_export: { title: "Translation reviews", suffix: "jsonl" },
};
const stateLabels: Record<ProjectJobView["status"], string> = { queued: "Waiting", running: "Running", succeeded: "Ready", failed: "Failed" };
const PAGE = 20;
const hidden = (error: unknown) => error instanceof ApiError && [403, 404].includes(error.status);

/** "4 s", "1 min 12 s", "2 h 05 min": how long an export ran, never read as a clock. */
export function formatJobDuration(seconds: number): string {
  const total = Math.max(Math.round(seconds), 0);
  if (total < 60) return `${total} s`;
  const hours = Math.floor(total / 3600), minutes = Math.floor((total % 3600) / 60), rest = total % 60;
  if (hours > 0) return `${hours} h ${String(minutes).padStart(2, "0")} min`;
  return rest > 0 ? `${minutes} min ${rest} s` : `${minutes} min`;
}

/** The run time; the exact start and finish go into the title and, for screen readers, into hidden text. */
function duration(job: ProjectJobView): JSX.Element {
  const start = job.started_at ? Date.parse(job.started_at) : NaN;
  const end = job.finished_at ? Date.parse(job.finished_at) : NaN;
  if (Number.isNaN(start) || Number.isNaN(end)) {
    const unfinished = job.status === "queued" || job.status === "running";
    return <span className="empty-value"><span aria-hidden="true">–</span><span className="visually-hidden">{unfinished ? "not finished yet" : "not set"}</span></span>;
  }
  const exact = `Started ${fullTimestamp(job.started_at!)}, finished ${fullTimestamp(job.finished_at!)}`;
  const seconds = Math.max(Math.round((end - start) / 1000), 0);
  return <><time dateTime={`PT${seconds}S`} title={exact}>{formatJobDuration(seconds)}</time><span className="visually-hidden">. {exact}</span></>;
}

function requester(job: ProjectJobView): JSX.Element | string {
  if (job.requested_by) return personLabel(job.requested_by);
  if (job.requested_by_command_line) return "Command line";
  return <EmptyValue />;
}

/**
 * Every export of the project, newest first, also those started by others or with an API token (issue 355). Leads and
 * system admins only: anyone else is refused by the server, and the section stays away. People appear as the
 * server names them (person references, never logins). The section is a disclosure, closed at first: the list loads when
 * it is first opened. `revision` reloads the first page while it is open.
 */
export function ExportHistory({ projectKey, revision = 0 }: { projectKey: string; revision?: number }): JSX.Element | null {
  const [opened, setOpened] = useState(false);
  const [jobs, setJobs] = useState<ProjectJobView[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [refused, setRefused] = useState(false);
  const [error, setError] = useState<unknown>();
  const [reload, setReload] = useState(0);
  const [downloading, setDownloading] = useState<number | null>(null);
  const request = useRef(0);

  const load = useCallback(async (offset: number) => {
    const ticket = ++request.current;
    setLoading(true); setError(undefined);
    try {
      const page = await api.listProjectJobs(projectKey, { kind: Object.keys(exportKinds), limit: PAGE, offset });
      if (ticket !== request.current) return;
      setJobs(current => offset === 0 ? page.jobs : [...current, ...page.jobs.filter(job => !current.some(seen => seen.id === job.id))]);
      setTotal(page.total); setLoaded(true);
    } catch (err: unknown) {
      if (ticket !== request.current) return;
      if (hidden(err)) setRefused(true); else setError(err);
    } finally {
      if (ticket === request.current) setLoading(false);
    }
  }, [projectKey]);
  useEffect(() => {
    if (!opened) return;
    void load(0);
    const requests = request;
    // A late answer for an earlier project or revision is dropped.
    return () => { requests.current++; };
  }, [opened, load, revision, reload]);

  const download = async (job: ProjectJobView) => {
    if (downloading !== null) return;
    setDownloading(job.id); setError(undefined);
    try {
      // The list is no download authorization: the download route checks again on every click.
      const payload = await api.downloadJob(job.id);
      saveDownload(payload, `${projectKey}-${job.id}.${exportKinds[job.kind]?.suffix ?? "zip"}`);
    } catch (err: unknown) { setError(err); }
    finally { setDownloading(null); }
  };

  if (refused) return null;
  return <section className="export-history" aria-labelledby="export-history-heading">
    <details className="export-history-details" onToggle={event => { if (event.currentTarget.open) setOpened(true); }}>
      <summary id="export-history-heading">Export history</summary>
      <div className="export-history-head">
        <p className="export-research-lede">Every export of this project, newest first, also those started by others or with an API token.</p>
        <Button size="sm" variant="quiet" disabled={loading} onClick={() => setReload(value => value + 1)}>Refresh history</Button>
      </div>
      {loading && !loaded && <p className="cell-secondary" role="status">Loading export history…</p>}
      {error !== undefined && <ErrorNotice error={error} onRetry={loaded ? undefined : () => setReload(value => value + 1)} />}
      {loaded && jobs.length === 0 && <p className="cell-secondary">No exports yet.</p>}
      {jobs.length > 0 && <table className="data-table export-research-table export-history-table">
        <thead><tr>
          <th scope="col">Export</th><th scope="col">State</th><th scope="col">Requested by</th>
          <th scope="col">Started</th><th scope="col">Duration</th><th scope="col"><span className="visually-hidden">Action</span></th>
        </tr></thead>
        <tbody>{jobs.map(job => <tr key={job.id} aria-label={`${exportKinds[job.kind]?.title ?? job.kind} ${job.id}`}>
          <th scope="row">{exportKinds[job.kind]?.title ?? job.kind}</th>
          <td>
            <StatusBadge status={job.status}>{stateLabels[job.status]}</StatusBadge>
            {job.status === "failed" && (job.error_code || job.error) && <p className="export-row-status" title={job.error ?? undefined}>{job.error_code ?? job.error}</p>}
          </td>
          <td>{requester(job)}</td>
          <td>{job.started_at ? <Time iso={job.started_at} /> : <EmptyValue />}</td>
          <td>{duration(job)}</td>
          <td>{job.download_path && <Button size="sm" variant="secondary" loading={downloading === job.id} disabled={downloading !== null && downloading !== job.id} onClick={() => { void download(job); }}>Download</Button>}</td>
        </tr>)}</tbody>
      </table>}
      {jobs.length < total && <div><Button size="sm" variant="secondary" loading={loading} onClick={() => { void load(jobs.length); }}>Show older exports</Button></div>}
    </details>
  </section>;
}
