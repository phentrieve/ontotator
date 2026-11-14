import { useEffect, useId, useRef, useState } from "react";
import { api, type ApiTokenScope, type CurrentUser, type OAuthAuthorization } from "../api/client";
import { ErrorNotice } from "../admin/ErrorNotice";
import type { Route } from "../app/router";
import { Button, Checkbox, InlineMessage } from "../ui";
import { SCOPE_LABELS } from "./TokensSection";

/** What each scope lets a connected app do, in the words of the consent page. */
const CONSENT_HINTS: Record<ApiTokenScope, string> = {
  read: "See your projects, texts, results and progress.",
  import: "Upload and import texts into projects you lead.",
  export: "Start exports and download them.",
  "project-admin": "Change settings, members and assignments of projects you lead.",
  admin: "",
};

/**
 * The OAuth consent page (issue 388): an app such as a claude.ai connector asks to
 * use Ontotator as the logged-in user through the remote MCP server. The server has
 * checked the request already (`/oauth/authorize`); this page shows who asks, for what
 * and where the browser goes back to, and sends the decision. Approving returns a
 * single-use code to the app; declining returns `access_denied`.
 */
export function OAuthConsentPage({ params, user, onNavigate }: { params: Record<string, string>; user: CurrentUser; onNavigate: (route: Route) => void }): JSX.Element {
  const id = useId();
  const [request, setRequest] = useState<OAuthAuthorization | null>(null);
  const [loadError, setLoadError] = useState<unknown>();
  const [scopes, setScopes] = useState<ApiTokenScope[]>([]);
  const [busy, setBusy] = useState<"approve" | "decline" | null>(null);
  const [error, setError] = useState<unknown>();
  const [leaving, setLeaving] = useState<string | null>(null);
  const alive = useRef(true);
  const key = JSON.stringify(params);

  useEffect(() => {
    alive.current = true;
    let active = true;
    setRequest(null); setLoadError(undefined);
    api.getOAuthAuthorization(params).then(found => {
      if (!active) return;
      setRequest(found);
      setScopes(found.allowed_scopes);
    }, failure => { if (active) setLoadError(failure); });
    return () => { active = false; alive.current = false; };
    // params is identified by its serialised form.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  const decide = async (approve: boolean) => {
    if (!request) return;
    setBusy(approve ? "approve" : "decline"); setError(undefined);
    try {
      const { redirect_to } = await api.decideOAuthAuthorization(request.params, approve, approve ? scopes : []);
      if (!alive.current) return;
      setLeaving(request.redirect_host);
      window.location.assign(redirect_to);
    } catch (failure) {
      if (alive.current) { setError(failure); setBusy(null); }
    }
  };

  if (loadError !== undefined) return <section className="detail-section oauth-consent" aria-label="Connect an app">
    <h1>This connection request cannot be used</h1>
    <ErrorNotice error={loadError} />
    <p>Close this page and start the connection again from your app. Nothing was shared with it.</p>
    <Button onClick={() => onNavigate({ name: "tasks", status: "all" })}>Go to My tasks</Button>
  </section>;
  if (!request) return <InlineMessage tone="info">Loading the connection request…</InlineMessage>;

  const refused = request.requested_scopes.filter(scope => !request.allowed_scopes.includes(scope));
  return <section className="detail-section oauth-consent" aria-label="Connect an app">
    <h1>Connect {request.client_name} to Ontotator?</h1>
    <p><strong>{request.client_name}</strong> asks to use Ontotator as you, <strong>{user.display_name}</strong> ({user.username}), through the Ontotator MCP server.</p>
    <dl className="oauth-consent-facts">
      <dt>After connecting, you return to</dt><dd><code>{request.redirect_host}</code></dd>
      <dt>MCP server</dt><dd><code>{request.resource}</code></dd>
    </dl>
    <InlineMessage tone="warning" live={false}>Ontotator cannot check the name an app gives itself. Connect only if you started this yourself, from <strong>{request.redirect_host}</strong>.</InlineMessage>
    <form aria-label="Connect an app" onSubmit={event => { event.preventDefault(); void decide(true); }}>
      <fieldset disabled={busy !== null || leaving !== null}>
        <legend className="settings-subheading">Allow it to</legend>
        {request.requested_scopes.map(scope => {
          const allowed = request.allowed_scopes.includes(scope);
          return <Checkbox key={scope} id={`${id}-${scope}`} label={SCOPE_LABELS[scope]}
            hint={allowed ? CONSENT_HINTS[scope] : "Not available: your roles do not allow it."}
            checked={scopes.includes(scope)} disabled={!allowed}
            onChange={event => setScopes(event.target.checked ? request.allowed_scopes.filter(item => item === scope || scopes.includes(item)) : scopes.filter(item => item !== scope))} />;
        })}
        {refused.length > 0 && <p className="field-hint">The app asked for more than your roles allow; it gets only what you tick here.</p>}
        <p>It can never do more than you may do yourself, and never annotation, review or translation review work. You can disconnect it at any time under <strong>Profile</strong> › <strong>Connected apps</strong>.</p>
        {error !== undefined && <ErrorNotice error={error} />}
        {leaving !== null && <InlineMessage tone="info">Returning you to {leaving}…</InlineMessage>}
        <div className="settings-section-actions">
          <Button type="submit" variant="primary" loading={busy === "approve"} disabled={!scopes.length}>Connect</Button>
          <Button loading={busy === "decline"} onClick={() => { void decide(false); }}>Cancel</Button>
        </div>
      </fieldset>
    </form>
  </section>;
}
