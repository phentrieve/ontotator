import { useEffect, useRef, useState } from "react";
import { api, type OAuthConnection, type OAuthConnections } from "../api/client";
import { ErrorNotice } from "../admin/ErrorNotice";
import { formatDateTime } from "../app/labels";
import { Button, ConfirmDialog, DataTable, EmptyState, EmptyValue, InlineMessage, StatusBadge, type Column, type StatusTone } from "../ui";
import { SCOPE_LABELS } from "./TokensSection";

type ConnectionState = "Active" | "Expired" | "Disconnected";
const STATE_TONES: Record<ConnectionState, StatusTone> = { Active: "success", Expired: "neutral", Disconnected: "danger" };
/** Why a connection ended without the user's Disconnect. */
const END_REASONS: Readonly<Record<string, string>> = {
  client_revoked: "by the app",
  code_reused: "a sign-in code was used twice",
  refresh_reused: "a renewal was replayed",
  password_set: "password changed",
  reset_code: "new sign-in code issued",
  recovered: "password recovered",
  "user.active": "account deactivated",
  "user.anonymise": "personal data erased",
};

export function connectionState(connection: OAuthConnection, now = Date.now()): ConnectionState {
  if (connection.revoked_at) return "Disconnected";
  return new Date(connection.expires_at).getTime() <= now ? "Expired" : "Active";
}

/**
 * Profile › Connected apps (issue 388): apps the user connected with OAuth, such as a
 * claude.ai connector. Shown only when the server has a remote MCP server configured.
 */
export function ConnectionsSection(): JSX.Element | null {
  const [data, setData] = useState<OAuthConnections | null>(null);
  const [loadError, setLoadError] = useState<unknown>();
  const [retry, setRetry] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>();
  const [ending, setEnding] = useState<OAuthConnection | null>(null);
  const alive = useRef(true);

  useEffect(() => {
    alive.current = true;
    let active = true;
    setLoadError(undefined);
    api.listConnections().then(value => { if (active) setData(value); }, failure => { if (active) setLoadError(failure); });
    return () => { active = false; alive.current = false; };
  }, [retry]);

  const disconnect = async (connection: OAuthConnection) => {
    setBusy(true); setError(undefined);
    try {
      const result = await api.revokeConnection(connection.id);
      if (!alive.current) return;
      setData(current => current && { ...current, connections: current.connections.map(item => item.id === result.id ? result : item) });
      setEnding(null);
    } catch (failure) { if (alive.current) setError(failure); } finally { if (alive.current) setBusy(false); }
  };

  if (data && !data.enabled) return null;
  const columns: Column<OAuthConnection>[] = [
    { id: "app", header: "App", cell: item => item.client_name, rowHeader: true },
    { id: "host", header: "Returns to", cell: item => <code className="oauth-host">{item.redirect_host}</code> },
    { id: "scopes", header: "Scopes", cell: item => item.scopes.map(scope => SCOPE_LABELS[scope]).join(", ") },
    { id: "since", header: "Connected", cell: item => <time dateTime={item.created_at}>{formatDateTime(item.created_at)}</time> },
    { id: "used", header: "Last used", cell: item => item.last_used_at ? <time dateTime={item.last_used_at}>{formatDateTime(item.last_used_at)}</time> : <EmptyValue /> },
    { id: "state", header: "Status", cell: item => { const state = connectionState(item); const reason = state === "Disconnected" && item.revoked_reason && item.revoked_reason !== "revoked" ? END_REASONS[item.revoked_reason] ?? "automatically" : null;
      return <><StatusBadge tone={STATE_TONES[state]}>{state}</StatusBadge>{reason && <span className="field-hint"> {reason}</span>}</>; } },
    { id: "actions", header: <span className="visually-hidden">Actions</span>, cell: item => connectionState(item) === "Active"
      ? <Button size="sm" disabled={busy} aria-label={`Disconnect ${item.client_name}`} onClick={() => { setError(undefined); setEnding(item); }}>Disconnect…</Button> : null },
  ];
  return <section aria-label="Connected apps" className="detail-section">
    <h2>Connected apps</h2>
    <p>Apps you allowed to use Ontotator as you through the Ontotator MCP server, for example a claude.ai connector. Each can do only what you allowed and what you may do yourself.</p>
    {data?.mcp_url && <p>To connect an app, add a custom connector with the address <code className="oauth-mcp-url">{data.mcp_url}</code> and log in here when it asks.</p>}
    {data === null && loadError === undefined && <InlineMessage tone="info">Loading connected apps…</InlineMessage>}
    {loadError !== undefined && <><ErrorNotice error={loadError} /><Button onClick={() => setRetry(value => value + 1)}>Try again</Button></>}
    {data !== null && (data.connections.length
      ? <DataTable label="Connected apps" columns={columns} rows={data.connections} rowKey={item => String(item.id)} />
      : <EmptyState title="No connected apps." />)}
    {error !== undefined && !ending && <ErrorNotice error={error} />}
    <ConfirmDialog open={ending !== null} tone="danger" busy={busy} title={ending ? `Disconnect ${ending.client_name}?` : ""} confirmLabel="Disconnect"
      message={<><p>The app loses access at once. To use it again, connect it again from the app.</p>{error !== undefined && <ErrorNotice error={error} />}</>}
      onCancel={() => { if (!busy) { setEnding(null); setError(undefined); } }}
      onConfirm={() => { if (ending) void disconnect(ending); }} />
  </section>;
}
