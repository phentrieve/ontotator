import { useEffect, useId, useRef, useState } from "react";
import { api, ApiError, type Member, type SingleTermReviewer } from "../api/client";
import { ErrorNotice } from "../admin/ErrorNotice";
import { SettingsHint } from "../admin/SettingsCard";
import { personLabel } from "../app/identity";
import { Checkbox, InlineMessage } from "../ui";
import { notifySingleTermsChanged } from "./useSingleTermAccess";

type Loaded = { reviewers: SingleTermReviewer[]; members: Member[] };

/**
 * Settings › People › Single-term reviewers (issue 381): the capability a lead grants to members; leads
 * review without it. Shown only while the project's single-term review is on. Each change saves at once.
 */
export function SingleTermReviewersCard({ projectKey }: { projectKey: string }): JSX.Element | null {
  const id = useId().replace(/:/g, "");
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [hidden, setHidden] = useState(false);
  const [loadError, setLoadError] = useState<unknown>();
  const [error, setError] = useState<unknown>();
  const [busy, setBusy] = useState<string | null>(null);
  const [confirmation, setConfirmation] = useState("");
  const active = useRef(true);
  useEffect(() => { active.current = true; return () => { active.current = false; }; }, []);
  useEffect(() => {
    let current = true;
    setLoaded(null); setLoadError(undefined); setHidden(false);
    void Promise.all([api.listSingleTermReviewers(projectKey), api.listMembers(projectKey)]).then(([reviewers, members]) => {
      if (current) setLoaded({ reviewers: Array.isArray(reviewers) ? reviewers : [], members: Array.isArray(members) ? members : [] });
    }, (failure: unknown) => {
      if (!current) return;
      // Off, not a lead, or no server answer: the card stays out of the way.
      if (failure instanceof ApiError && ![401, 403, 404, 409].includes(failure.status)) setLoadError(failure);
      else setHidden(true);
    });
    return () => { current = false; };
  }, [projectKey]);
  if (hidden) return null;
  if (loadError !== undefined) return <section className="settings-card" aria-label="Single-term reviewers"><h2 className="settings-card-title">Single-term reviewers</h2><ErrorNotice error={loadError} /></section>;
  if (!loaded) return null;

  const granted = new Set(loaded.reviewers.map(item => item.username));
  const toggle = async (member: Member, on: boolean) => {
    if (busy) return;
    setBusy(member.username); setError(undefined); setConfirmation("");
    try {
      const reviewers = on ? await api.grantSingleTermReviewer(projectKey, member.username) : await api.revokeSingleTermReviewer(projectKey, member.username);
      if (!active.current) return;
      setLoaded(current => current && { ...current, reviewers });
      const name = member.display_name?.trim() || member.username;
      setConfirmation(on ? `${name} can now review single terms.` : `${name} no longer reviews single terms.`);
      notifySingleTermsChanged();
    } catch (failure: unknown) { if (active.current) setError(failure); }
    finally { if (active.current) setBusy(null); }
  };
  const members = loaded.members.filter(member => member.roles.length > 0);
  return <section className="settings-card" aria-label="Single-term reviewers">
    <h2 className="settings-card-title">Single-term reviewers</h2>
    <SettingsHint why={<p>Single-term reviewers judge the phrases of the final results alone, then in context, in the batches a lead assigns. They see the batch's contexts only, never who annotated them. Leads may review without this.</p>}>Changes save immediately.</SettingsHint>
    {members.length ? <ul className="settings-radio-group" style={{ listStyle: "none", margin: 0, padding: 0 }}>
      {members.map(member => {
        const lead = member.roles.includes("lead");
        return <li key={member.username}>
          <Checkbox id={`${id}-${member.username}`} label={<>{personLabel(member)} <span className="field-hint">({member.username}){lead ? " · lead, reviews without a grant" : ""}</span></>}
            checked={lead || granted.has(member.username)} disabled={lead || busy !== null || member.account === "anonymised"}
            aria-label={`${member.username}: single-term reviewer`} onChange={event => void toggle(member, event.target.checked)} />
        </li>;
      })}
    </ul> : <InlineMessage tone="info">No project members yet.</InlineMessage>}
    <p role="status" className="settings-confirmation">{confirmation}</p>
    {error !== undefined && <ErrorNotice error={error} />}
  </section>;
}
