import { useEffect, useState, type MouseEvent, type ReactNode } from "react";
import { api, ApiError, type TranslationReviewListPage, type TranslationReviewListRow } from "../api/client";
import { personLabel, textLabel } from "../app/identity";
import { routeHref, type Route, type TranslationReviewsQuery } from "../app/router";
import { Time } from "../app/Time";
import { categoryLabels, decisionLabels } from "../translation/labels";
import { Button, EmptyState, EmptyValue, InlineMessage, Select, Toolbar } from "../ui";
import { ErrorNotice } from "./ErrorNotice";

export interface TranslationReviewsPageProps { projectKey: string; query: TranslationReviewsQuery; onNavigate: (route: Route) => void }

type Decision = TranslationReviewListRow["decision"];
/** Decisions in the order of the filter; "Open" is an assigned review that is not submitted. */
export const REVIEW_LIST_DECISIONS: readonly [Decision, string][] = [
  ["accepted_unchanged", decisionLabels.accepted_unchanged], ["accepted_corrected", decisionLabels.accepted_corrected],
  ["query", decisionLabels.query], ["rejected", decisionLabels.rejected], ["open", "Open"],
];
const decisionLabel = (decision: Decision) => REVIEW_LIST_DECISIONS.find(([code]) => code === decision)?.[1] ?? decision;
const isDecision = (value: string | undefined): value is Decision => REVIEW_LIST_DECISIONS.some(([code]) => code === value);
export const REVIEW_LIST_PAGE = 25;

function RouteLink({ route, onNavigate, className, label, disabled, children }: { route: Route; onNavigate: (route: Route) => void; className?: string; label?: string; disabled?: boolean; children: ReactNode }): JSX.Element {
  return <a className={className} aria-label={label} aria-disabled={disabled || undefined} href={disabled ? undefined : routeHref(route)} role={disabled ? "link" : undefined} tabIndex={disabled ? 0 : undefined}
    onClick={(event: MouseEvent<HTMLAnchorElement>) => {
      if (disabled) { event.preventDefault(); return; }
      if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      event.preventDefault(); onNavigate(route);
    }}>{children}</a>;
}

/** "3 passages", "1 passage", "None"; a dash while a review is open or the texts differ too much to count. */
function passages(row: TranslationReviewListRow): JSX.Element | string {
  if (row.decision === "open") return <EmptyValue />;
  if (row.changed_passages == null) return <span title="The texts differ too much to count the changes.">Not counted</span>;
  return row.changed_passages === 0 ? "None" : `${row.changed_passages} ${row.changed_passages === 1 ? "passage" : "passages"}`;
}

/**
 * Every submitted and open translation review of the project (issue 483): who decided what, with the clinical flag,
 * the categories, the rationale (also of an accepting review) and the number of changed passages. Leads and system
 * admins only; the server refuses everyone else. Filters, order and page live in the address, so the list is where the
 * lead left it after reading a text. The server filters, sorts and pages.
 */
export function TranslationReviewsPage({ projectKey, query, onNavigate }: TranslationReviewsPageProps): JSX.Element {
  const [page, setPage] = useState<{ key: string; value: TranslationReviewListPage } | null>(null);
  const [error, setError] = useState<unknown>();
  const [loading, setLoading] = useState(true);
  const [revision, setRevision] = useState(0);
  const decision = isDecision(query.decision) ? query.decision : undefined;
  const oldest = query.sort === "oldest";
  const requested = Number(query.page ?? "1");
  const pageNumber = Number.isSafeInteger(requested) && requested >= 1 ? requested : 1;
  const { reviewer, language } = query;
  useEffect(() => {
    let active = true;
    setLoading(true); setError(undefined);
    void api.listTranslationReviewList(projectKey, {
      reviewer, decision: decision ? [decision] : undefined, language: language ? [language] : undefined,
      sort: oldest ? "submitted" : "-submitted", limit: REVIEW_LIST_PAGE, offset: (pageNumber - 1) * REVIEW_LIST_PAGE,
    }).then(value => { if (active) { setPage({ key: projectKey, value }); setLoading(false); } },
      failure => { if (active) { setPage(null); setError(failure); setLoading(false); } });
    return () => { active = false; };
  }, [projectKey, reviewer, decision, language, oldest, pageNumber, revision]);

  const route = (change: TranslationReviewsQuery): Route => {
    const next: TranslationReviewsQuery = { reviewer, decision, language, sort: oldest ? "oldest" : undefined, page: undefined, ...change };
    return { name: "projectTranslationReviews", key: projectKey, ...Object.fromEntries(Object.entries(next).filter(([, value]) => value !== undefined && value !== "")) };
  };
  const shown = page?.key === projectKey ? page.value : null;
  const denied = error instanceof ApiError && [403, 404].includes(error.status);
  const filtered = reviewer !== undefined || decision !== undefined || language !== undefined;
  const pages = shown ? Math.max(Math.ceil(shown.total / REVIEW_LIST_PAGE), 1) : 1;
  // A chosen person or language that the project no longer offers stays in the select, so the filter is visible.
  const people = shown?.reviewers ?? [];
  const languages = shown?.languages ?? [];
  const textName = (row: TranslationReviewListRow) => textLabel(row, { withVersion: true });
  const target = (row: TranslationReviewListRow): { route: Route; text: string } => {
    const base = { name: "projectCase" as const, key: projectKey, caseId: row.case_id, variant: row.document_id };
    return row.decision === "accepted_corrected" && row.created_variant_id
      ? { route: { ...base, compare: row.created_variant_id }, text: "Compare versions" }
      : { route: base, text: "Open text" };
  };

  return <section className="translation-reviews-page">
    <h1>Translation reviews</h1>
    <p className="translation-reviews-lede">Every submitted and open translation review of this project. Read the rationale of accepted reviews too: a reviewer may note a problem there that does not change the translation.</p>
    {denied && <InlineMessage tone="error">You do not have access to this page.</InlineMessage>}
    {error !== undefined && !denied && <div className="progress-error"><ErrorNotice error={error} /><Button onClick={() => setRevision(value => value + 1)}>Retry</Button></div>}
    {!denied && <Toolbar label="Filter translation reviews" className="filter-bar">
      <Select id="translation-reviews-person" label="Person" value={reviewer ?? ""} onChange={event => onNavigate(route({ reviewer: event.target.value || undefined }))}>
        <option value="">All people</option>
        {reviewer !== undefined && !people.some(person => person.pseudonym === reviewer) && <option value={reviewer}>{reviewer}</option>}
        {people.map(person => <option key={person.pseudonym} value={person.pseudonym}>{personLabel(person)}</option>)}
      </Select>
      <Select id="translation-reviews-decision" label="Decision" value={decision ?? ""} onChange={event => onNavigate(route({ decision: event.target.value || undefined }))}>
        <option value="">All decisions</option>
        {REVIEW_LIST_DECISIONS.map(([code, label]) => <option key={code} value={code}>{label}</option>)}
      </Select>
      <Select id="translation-reviews-language" label="Language" value={language ?? ""} onChange={event => onNavigate(route({ language: event.target.value || undefined }))}>
        <option value="">All languages</option>
        {language !== undefined && !languages.includes(language) && <option value={language}>{language}</option>}
        {languages.map(code => <option key={code} value={code}>{code}</option>)}
      </Select>
      <Select id="translation-reviews-order" label="Order" value={oldest ? "oldest" : ""} onChange={event => onNavigate(route({ sort: event.target.value || undefined }))}>
        <option value="">Newest first</option>
        <option value="oldest">Oldest first</option>
      </Select>
    </Toolbar>}
    {loading && !shown && <p role="status" className="cell-secondary">Loading translation reviews…</p>}
    {shown && <>
      <p className="translation-reviews-count" role="status">
        {shown.total === 1 ? "1 review" : `${shown.total} reviews`}{filtered ? (shown.total === 1 ? " matches the filters" : " match the filters") : ""}{pages > 1 ? `, page ${Math.min(pageNumber, pages)} of ${pages}` : ""}.
        {" "}Open reviews come last.
      </p>
      {shown.total === 0 && (filtered
        ? <EmptyState title="No review matches the filters" action={<RouteLink route={{ name: "projectTranslationReviews", key: projectKey }} className="btn btn-secondary" onNavigate={onNavigate}>Show all reviews</RouteLink>} />
        : <EmptyState title="No translation reviews yet">Reviews appear here when a translation review is assigned.</EmptyState>)}
      {shown.total > 0 && shown.reviews.length === 0 && <EmptyState title="No reviews on this page"
        action={<RouteLink route={route({})} className="btn btn-secondary" onNavigate={onNavigate}>Go to the first page</RouteLink>} />}
      {shown.reviews.length > 0 && <div className="data-table-scroll">
        <table className="data-table translation-reviews-table" aria-busy={loading || undefined}>
          <caption className="visually-hidden">Translation reviews</caption>
          <thead><tr>
            <th scope="col">Text</th><th scope="col">Reviewer</th><th scope="col">Decision</th><th scope="col">Clinically relevant</th>
            <th scope="col">Categories</th><th scope="col">Rationale</th><th scope="col">Changes</th><th scope="col">Submitted</th>
            <th scope="col"><span className="visually-hidden">Action</span></th>
          </tr></thead>
          <tbody>{shown.reviews.map(row => {
            const { route: destination, text } = target(row);
            const name = textName(row);
            return <tr key={row.review_id === null ? `open-${row.assignment_id}` : `review-${row.review_id}`} aria-label={`${name}, ${decisionLabel(row.decision)}`}>
              <th scope="row">{name}</th>
              <td data-label="Reviewer">{personLabel(row.reviewer)}</td>
              <td data-label="Decision">{decisionLabel(row.decision)}</td>
              <td data-label="Clinically relevant">{row.clinical_change == null ? <EmptyValue /> : row.clinical_change ? "Yes" : "No"}</td>
              <td data-label="Categories">{row.categories.length ? row.categories.map(category => categoryLabels[category] ?? category).join(", ") : <EmptyValue />}</td>
              <td data-label="Rationale" className="translation-reviews-rationale">{row.rationale?.trim() ? row.rationale : <EmptyValue />}</td>
              <td data-label="Changes">{passages(row)}</td>
              <td data-label="Submitted">{row.submitted_at ? <Time iso={row.submitted_at} /> : <span className="cell-secondary">Not submitted</span>}</td>
              <td className="translation-reviews-action"><RouteLink route={destination} onNavigate={onNavigate} label={`${text}: ${name}, ${personLabel(row.reviewer)}`}>{text}</RouteLink></td>
            </tr>;
          })}</tbody>
        </table>
      </div>}
      {pages > 1 && <nav className="translation-reviews-paging" aria-label="Pages of translation reviews">
        <RouteLink route={route({ page: pageNumber - 1 > 1 ? String(pageNumber - 1) : undefined })} disabled={pageNumber <= 1} className="btn btn-secondary btn-sm" onNavigate={onNavigate}>Previous</RouteLink>
        <RouteLink route={route({ page: String(pageNumber + 1) })} disabled={pageNumber >= pages} className="btn btn-secondary btn-sm" onNavigate={onNavigate}>Next</RouteLink>
      </nav>}
      <p className="muted translation-reviews-note">The Changes column counts the passages the reviewer changed in the text. <strong>Compare versions</strong> opens the reviewed text beside the corrected one; tick <strong>Show changes</strong> there to see the passages. A query or a rejection creates no version, so its row opens the reviewed text.</p>
    </>}
  </section>;
}
