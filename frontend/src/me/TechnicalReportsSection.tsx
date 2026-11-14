import { useEffect, useRef, useState } from "react";
import { api, type OwnTechnicalReportView } from "../api/client";
import { ErrorNotice } from "../admin/ErrorNotice";
import { formatDateTime, formatShortDateTime } from "../app/labels";
import { TECHNICAL_REPORT_SENT } from "../reports/technicalReport";
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
  const [loadError, setLoadError] = useState<unknown>();
  const [retry, setRetry] = useState(0);
  const section = useRef<HTMLElement>(null);

  useEffect(() => {
    let active = true;
    // A reload keeps the shown list until the fresh one arrives.
    setLoadError(undefined);
    api.listMyTechnicalReports().then(value => { if (active) setReports(value); }, failure => { if (active) setLoadError(failure); });
    return () => { active = false; };
  }, [retry]);
  // A report sent from the navigation while this page is open shows up at once.
  useEffect(() => {
    const reload = () => setRetry(value => value + 1);
    window.addEventListener(TECHNICAL_REPORT_SENT, reload);
    return () => window.removeEventListener(TECHNICAL_REPORT_SENT, reload);
  }, []);
  const ready = reports !== null || loadError !== undefined;
  useEffect(() => {
    if (focus && ready) section.current?.scrollIntoView?.({ block: "start" });
  }, [focus, ready]);

  return <section ref={section} className="detail-section" id="technical-reports" aria-labelledby="technical-reports-heading">
    <h2 id="technical-reports-heading">My technical reports</h2>
    <p>The technical problems you reported. Only you and the system administrators see them. <em>Done</em> means an administrator handled the report.</p>
    {!ready && <InlineMessage tone="info">Loading reports…</InlineMessage>}
    {loadError !== undefined && <><ErrorNotice error={loadError} /><Button onClick={() => setRetry(value => value + 1)}>Try again</Button></>}
    {reports !== null && (reports.length
      ? <DataTable label="My technical reports" columns={COLUMNS} rows={reports} rowKey={report => String(report.id)} />
      : <EmptyState title="You have not reported a technical problem." />)}
  </section>;
}
