import { useEffect, useRef, useState, type MouseEvent, type ReactNode } from "react";
import { api, ApiError, type SingleTermBatch, type SingleTermSummary } from "../api/client";
import { ErrorNotice } from "../admin/ErrorNotice";
import { routeHref, type Route } from "../app/router";
import { Button, ConfirmDialog, EmptyState, InlineMessage, StatusBadge, type StatusTone } from "../ui";
import { HelpLink } from "../help/HelpLink";
import { BatchDialog } from "./BatchDialog";
import { batchScope, blockedLabels, exclusionLabels, kappa, label, languageLabel, newRequestId, percent } from "./labels";
import "./singleterms.css";

export interface SingleTermsPageProps {
  projectKey: string;
  /** A lead (or administrator) of the project: summary, basis and batch management. */
  canManage: boolean;
  onNavigate: (route: Route) => void;
}

const basisDate = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "UTC" });
const stateTones: Record<SingleTermBatch["state"], StatusTone> = { open: "warning", submitted: "success", abandoned: "neutral" };

function RouteLink({ route, onNavigate, children, label: ariaLabel }: { route: Route; onNavigate: (route: Route) => void; children: ReactNode; label?: string }): JSX.Element {
  return <a href={routeHref(route)} aria-label={ariaLabel} onClick={(event: MouseEvent<HTMLAnchorElement>) => {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault(); onNavigate(route);
  }}>{children}</a>;
}

type Loaded = { summary: SingleTermSummary | null; batches: SingleTermBatch[]; reviewers: string[]; layers: { id: string; label: string }[] };

/**
 * "Single terms" (mockup Overview): the review basis and its refresh, counts per language, the batches and
 * the findings the derivation left out. A reviewer who is no lead sees only their own batches.
 */
export function SingleTermsPage(props: SingleTermsPageProps): JSX.Element {
  return <SingleTermsContent key={props.projectKey} {...props} />;
}

function SingleTermsContent({ projectKey, canManage, onNavigate }: SingleTermsPageProps): JSX.Element {
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [error, setError] = useState<unknown>();
  const [revision, setRevision] = useState(0);
  const [busy, setBusy] = useState<string | null>(null);
  const [actionError, setActionError] = useState<unknown>();
  const [notice, setNotice] = useState<string | null>(null);
  const [dialog, setDialog] = useState(false);
  const [abandon, setAbandon] = useState<SingleTermBatch | null>(null);
  const requests = useRef(new Map<string, string>());
  const requestFor = (action: string) => {
    const existing = requests.current.get(action);
    if (existing) return existing;
    const created = newRequestId();
    requests.current.set(action, created);
    return created;
  };

  useEffect(() => {
    let active = true;
    setError(undefined);
    const load = async (): Promise<Loaded> => {
      const batches = await api.listSingleTermBatches(projectKey);
      if (!canManage) return { summary: null, batches, reviewers: [], layers: [] };
      const [summary, granted, members, settings] = await Promise.all([
        api.singleTermSummary(projectKey),
        api.listSingleTermReviewers(projectKey),
        api.listMembers(projectKey).catch(() => []),
        api.getProjectSettings(projectKey).catch(() => null),
      ]);
      const leads = members.filter(member => member.roles.includes("lead")).map(member => member.username);
      const reviewers = [...new Set([...granted.map(item => item.username), ...leads])];
      const layers = settings?.profile.layers.map(layer => ({ id: layer.layer_id, label: layer.label })) ?? [];
      return { summary, batches, reviewers, layers };
    };
    void load().then(value => { if (active) setLoaded(value); }, failure => { if (active) { setLoaded(null); setError(failure); } });
    return () => { active = false; };
  }, [projectKey, canManage, revision]);

  const run = async (key: string, work: (requestId: string) => Promise<string | null>) => {
    if (busy) return;
    setBusy(key); setActionError(undefined); setNotice(null);
    try {
      const message = await work(requestFor(key));
      requests.current.delete(key);
      if (message) setNotice(message);
      setRevision(value => value + 1);
    } catch (failure: unknown) { setActionError(failure); }
    finally { setBusy(null); }
  };
  const startBasis = () => void run("basis", async requestId => {
    const basis = await api.startSingleTermBasis(projectKey, requestId);
    return `Review basis ${basis.basis_id} frozen. Only new and stale groups open again.`;
  });
  const act = (batch: SingleTermBatch, action: "reopen" | "abandon") => void run(`${action}:${batch.batch_id}`, async requestId => {
    await api.singleTermBatchAction(projectKey, batch.batch_id, action, requestId);
    setAbandon(null);
    return action === "reopen" ? `Batch #${batch.batch_id} reopened.` : `Batch #${batch.batch_id} abandoned. Its decisions no longer count.`;
  });

  const off = error instanceof ApiError && error.code === "SINGLE_TERM_REVIEW_OFF";
  if (off) return <section className="st-page"><h1>Single terms</h1>
    <InlineMessage tone="info">The single-term review is off in this project.{canManage && <> Turn it on under <RouteLink route={{ name: "projectSettings", key: projectKey, section: "workflow" }} onNavigate={onNavigate}>Settings › Workflow</RouteLink>.</>}</InlineMessage>
  </section>;
  if (error !== undefined) return <section className="st-page"><h1>Single terms</h1><ErrorNotice error={error} onRetry={() => setRevision(value => value + 1)} /></section>;
  if (!loaded) return <section className="st-page"><h1>Single terms</h1><InlineMessage tone="info">Loading the single-term review…</InlineMessage></section>;

  const { summary, batches } = loaded;
  const basis = summary?.basis ?? null;
  const batchRoute = (batch: SingleTermBatch): Route => ({ name: "projectSingleTermBatch", key: projectKey, batchId: batch.batch_id });
  const batchTable = <div className="st-table-box"><table className="st-table">
    <caption className="visually-hidden">Review batches</caption>
    <thead><tr><th scope="col">Batch</th><th scope="col">Groups</th><th scope="col">Reviewer</th><th scope="col">Progress</th><th scope="col">State</th><th scope="col"><span className="visually-hidden">Actions</span></th></tr></thead>
    <tbody>{[...batches].reverse().map(batch => <tr key={batch.batch_id}>
      <td>#{batch.batch_id}{!batch.current_basis && <span className="st-muted st-small"> · earlier basis</span>}</td>
      <td>{batchScope(batch)}</td>
      <td>{batch.reviewer_username}{batch.role === "second" && <span className="st-muted"> · second{batch.parent_batch_id ? ` of #${batch.parent_batch_id}` : ""}</span>}</td>
      <td>{batch.decided} / {batch.groups}</td>
      <td><StatusBadge tone={stateTones[batch.state]}>{batch.state}</StatusBadge></td>
      <td><div className="st-row">
        {batch.state !== "abandoned" && <RouteLink route={batchRoute(batch)} onNavigate={onNavigate} label={`${batch.state === "open" ? "Continue" : "Open"} batch #${batch.batch_id}`}>{batch.state === "open" ? "Continue" : "Open"}</RouteLink>}
        {canManage && batch.state === "submitted" && <Button size="sm" loading={busy === `reopen:${batch.batch_id}`} onClick={() => act(batch, "reopen")} aria-label={`Reopen batch #${batch.batch_id}`}>Reopen</Button>}
        {canManage && batch.state !== "abandoned" && <Button size="sm" variant="danger" onClick={() => { setActionError(undefined); setAbandon(batch); }} aria-label={`Abandon batch #${batch.batch_id}`}>Abandon…</Button>}
      </div></td>
    </tr>)}</tbody>
  </table></div>;

  if (!canManage) return <section className="st-page">
    <h1>Single terms</h1>
    <p className="st-muted">Your review batches. Each group is a phrase and the term it was annotated with; you judge the phrase alone, then its contexts.</p>
    {batches.length ? <div className="st-card">{batchTable}</div> : <EmptyState title="No review batch yet.">A lead assigns review batches to you.</EmptyState>}
  </section>;

  const exclusionLanguages = summary?.languages.map(item => item.language) ?? [];
  return <section className="st-page">
    <div className="st-spread">
      <div>
        <h1>Single terms</h1>
        <p className="st-muted" style={{ margin: "var(--space-1) 0 0" }}>
          {basis ? `Review basis: final results of ${basisDate.format(new Date(basis.created_at))} UTC. Only accepted or adjusted cases are exported.`
            : "No review basis yet. Starting the review freezes the current final results; the phrase-term groups are derived from them."}
        </p>
      </div>
      <div className="st-row">
        <HelpLink screen="singleTerms" />
        <Button loading={busy === "basis"} onClick={startBasis} variant={basis ? "secondary" : "primary"}>{basis ? "Refresh review basis" : "Start single-term review"}</Button>
        {basis && <Button variant="primary" onClick={() => { setNotice(null); setDialog(true); }}>New review batch…</Button>}
      </div>
    </div>
    {notice && <InlineMessage tone="success" onDismiss={() => setNotice(null)}>{notice}</InlineMessage>}
    {actionError !== undefined && !abandon && <ErrorNotice error={actionError} />}
    {basis && summary && <>
      <div className="st-grid">
        {summary.languages.map(counts => {
          const share = counts.groups ? Math.round((counts.decided / counts.groups) * 100) : 0;
          // Still to do only: blocked groups that are decided need nothing more.
          const pending = [
            counts.conflicts > 0 && `${counts.conflicts} ${counts.conflicts === 1 ? "group" : "groups"} in phrase conflicts`,
            counts.blocked > 0 && `${counts.blocked} blocked ${counts.blocked === 1 ? "group" : "groups"} to re-cut or reject`,
          ].filter(Boolean);
          return <section key={counts.language} className="st-card" aria-labelledby={`st-lang-${counts.language}`}>
            <div className="st-spread"><h2 id={`st-lang-${counts.language}`}>{languageLabel(counts.language)}</h2><span className="st-muted st-small">{counts.occurrences} occurrences</span></div>
            <dl className="st-stats">
              <div><dt>groups</dt><dd>{counts.groups}</dd></div>
              <div><dt>decided</dt><dd style={{ color: "var(--success)" }}>{counts.decided}</dd></div>
              <div><dt>open{counts.stale ? ` · ${counts.stale} stale` : ""}</dt><dd style={{ color: "var(--warning)" }}>{counts.open}</dd></div>
              <div><dt>blocked</dt><dd>{counts.blocked}</dd></div>
            </dl>
            <div className="st-bar" aria-hidden="true"><span style={{ width: `${share}%` }} /></div>
            {pending.length > 0 && <p className="st-small" style={{ margin: 0, color: "var(--warning)" }}>{pending.join(" · ")}</p>}
          </section>;
        })}
        {!summary.languages.length && <EmptyState title="No single-term candidates.">The final results of this basis hold no finding that can stand alone as a phrase.</EmptyState>}
      </div>
      <p className="st-small st-muted" style={{ margin: 0 }}>
        {summary.agreement.pairs ? `Second blind review: ${summary.agreement.pairs} groups reviewed twice · agreement ${percent(summary.agreement.percent)} · κ ${kappa(summary.agreement.kappa)}`
          : "Second blind review: no group reviewed twice yet."}
      </p>
    </>}
    <section className="st-card" aria-labelledby="st-batches"><h2 id="st-batches">Review batches</h2>
      {batches.length ? batchTable : <p className="st-muted" style={{ margin: 0 }}>No review batch yet.</p>}
    </section>
    <div className="st-grid">
      {summary && exclusionLanguages.map(language => <section key={language} className="st-card" aria-labelledby={`st-excluded-${language}`}>
        <h2 id={`st-excluded-${language}`}>{languageLabel(language)} findings not offered</h2>
        <div>
          {Object.entries(summary.exclusions).map(([reason, per]) => <p key={reason} className="st-kv"><span>{label(exclusionLabels, reason)}</span><b>{per[language] ?? 0}</b></p>)}
          {Object.entries(summary.blocked).map(([reason, per]) => <p key={reason} className="st-kv st-kv--warning"><span>blocked: {label(blockedLabels, reason)}</span><b>{per[language] ?? 0}</b></p>)}
        </div>
      </section>)}
    </div>
    {dialog && summary && <BatchDialog open projectKey={projectKey} languages={summary.languages} reviewers={loaded.reviewers} layers={loaded.layers}
      onClose={() => setDialog(false)}
      onCreated={batch => {
        setDialog(false);
        const warning = batch.warnings?.find(item => item.code === "SINGLE_TERM_REVIEWER_NOT_INDEPENDENT");
        const secondWarning = batch.warnings?.find(item => item.code === "SINGLE_TERM_SECOND_REVIEWER_NOT_INDEPENDENT");
        setNotice(`Batch #${batch.batch_id} created with ${batch.groups} ${batch.groups === 1 ? "group" : "groups"} for ${batch.reviewer_username}.${batch.second_batch_ids.length ? ` Second review: batch #${batch.second_batch_ids.join(", #")}.` : ""}${warning ? ` ${batch.reviewer_username} annotated or consolidated texts of ${warning.groups} of these groups; their decisions are marked “reviewer not independent”.` : ""}${secondWarning ? ` The second reviewer annotated or consolidated texts of ${secondWarning.groups} of the sampled groups; their decisions are marked “reviewer not independent”.` : ""}`);
        setRevision(value => value + 1);
      }} />}
    <ConfirmDialog open={abandon !== null} tone="danger" title={abandon ? `Abandon batch #${abandon.batch_id}?` : ""} confirmLabel="Abandon batch"
      busy={busy !== null}
      message={<><p>Its decisions stop counting and its groups open again for a new batch. This cannot be undone.</p>{actionError !== undefined && <ErrorNotice error={actionError} />}</>}
      onCancel={() => { if (!busy) { setAbandon(null); setActionError(undefined); } }}
      onConfirm={() => { if (abandon) act(abandon, "abandon"); }} />
  </section>;
}
