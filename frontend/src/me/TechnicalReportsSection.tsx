import { useEffect, useRef, useState } from "react";
import { api, TECHNICAL_REPORTS_PAGE, type OwnTechnicalReportView } from "../api/client";
import { ErrorNotice } from "../admin/ErrorNotice";
import { formatDateTime, formatShortDateTime } from "../app/labels";
import { SHOW_MY_TECHNICAL_REPORTS, TECHNICAL_REPORT_SENT } from "../reports/technicalReport";
import { Button, DataTable, EmptyState, InlineMessage, StatusBadge, type Column } from "../ui";
import "../reports/reports.css";

/** Longer texts fold behind their first line, so the table stays readable. */
const SHORT_TEXT = 160;

function WhatHappened({ text }: { text: string }): JSX.Element {
  const firstLine = text.split("\n", 1)[0];
  if (text.length <= SHORT_TEXT && firstLine === text) return <span className="own-technical-report-text">{text}</span>;
  const summary = firstLine.length > SHORT_TEXT ? `${firstLine.slice(0, SHORT_TEXT).trimEnd()}…` : firstLine;
  return <details className="own-technical-report-more">
    <summary>{summary}</summary>
    <p className="technical-report-description">{text}</p>
  </details>;
}

const COLUMNS: Column<OwnTechnicalReportView>[] = [
  { id: "reference", header: "Ref.", cell: report => <span className="own-technical-report-nowrap">{report.reference}</span>, rowHeader: true },
  { id: "sent", header: "Sent", cell: report => <time dateTime={report.created_at} title={formatDateTime(report.created_at)}>{formatShortDateTime(report.created_at)}</time> },
  { id: "what", header: "What happened", cell: report => <WhatHappened text={report.description} /> },
  { id: "status", header: "Status", cell: report => report.status === "done"
    ? <StatusBadge tone="success">Done</StatusBadge> : <StatusBadge tone="info">Open</StatusBadge> },
];

/**
 * Profile › My technical reports (issue 269): the reports the user sent, with their status. Only the user and the
 * system administrators see them; administrators do not answer here. `focus` scrolls here once the list loaded
 * (the report dialog links to this section).
 */
export function TechnicalReportsSection({ focus = false }: { focus?: boolean }): JSX.Element {
  const [reports, setReports] = useState<OwnTechnicalReportView[] | null>(null);
  // Whether the server may hold older reports than the shown ones: the last page came back full.
  const [more, setMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [loadError, setLoadError] = useState<unknown>();
  const [retry, setRetry] = useState(0);
  const section = useRef<HTMLElement>(null);
  const epoch = useRef(0);

  useEffect(() => {
    let active = true;
    epoch.current += 1;
    // A reload keeps the shown list until the fresh one arrives; it starts again at the newest page.
    setLoadError(undefined); setLoadingMore(false);
    api.listMyTechnicalReports().then(value => { if (active) { setReports(value); setMore(value.length >= TECHNICAL_REPORTS_PAGE); } },
      failure => { if (active) setLoadError(failure); });
    return () => { active = false; };
  }, [retry]);
  const showOlder = async () => {
    if (reports === null || loadingMore) return;
    const started = epoch.current;
    setLoadingMore(true); setLoadError(undefined);
    try {
      const older = await api.listMyTechnicalReports(reports.length);
      if (started !== epoch.current) return;
      // A report sent meanwhile shifts the pages: no row twice.
      setReports(current => { const seen = new Set((current ?? []).map(report => report.id)); return [...(current ?? []), ...older.filter(report => !seen.has(report.id))]; });
      setMore(older.length >= TECHNICAL_REPORTS_PAGE);
    } catch (failure) {
      if (started === epoch.current) setLoadError(failure);
    } finally {
      if (started === epoch.current) setLoadingMore(false);
    }
  };
  // A report sent from the navigation while this page is open shows up at once.
  useEffect(() => {
    const reload = () => setRetry(value => value + 1);
    // The dialog's link, clicked while this address is open already: no route change scrolls here.
    const show = () => section.current?.scrollIntoView?.({ block: "start" });
    window.addEventListener(TECHNICAL_REPORT_SENT, reload);
    window.addEventListener(SHOW_MY_TECHNICAL_REPORTS, show);
    return () => { window.removeEventListener(TECHNICAL_REPORT_SENT, reload); window.removeEventListener(SHOW_MY_TECHNICAL_REPORTS, show); };
  }, []);
  const ready = reports !== null || loadError !== undefined;
  useEffect(() => {
    if (focus && ready) section.current?.scrollIntoView?.({ block: "start" });
  }, [focus, ready]);

  return <section ref={section} className="detail-section" id="technical-reports" aria-labelledby="technical-reports-heading">
    <h2 id="technical-reports-heading">My technical reports</h2>
    <p>The technical problems you reported. Only you and the system administrators see them. <em>Done</em> means an administrator handled the report.</p>
    {!ready && <InlineMessage tone="info">Loading reports…</InlineMessage>}
    {reports !== null && (reports.length
      ? <DataTable label="My technical reports" columns={COLUMNS} rows={reports} rowKey={report => String(report.id)} />
      : <EmptyState title="You have not reported a technical problem." />)}
    {loadError !== undefined && <><ErrorNotice error={loadError} />{reports === null && <Button onClick={() => setRetry(value => value + 1)}>Try again</Button>}</>}
    {reports !== null && more && <p className="own-technical-report-older">
      {`Showing your newest ${reports.length} reports.`}{" "}
      <Button size="sm" loading={loadingMore} onClick={() => { void showOlder(); }}>Show older reports</Button>
    </p>}
  </section>;
}
