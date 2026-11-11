import { useId, useRef, useState, type FormEvent } from "react";
import { api, type SingleTermBatch, type SingleTermBatchRequest, type SingleTermLanguageCounts } from "../api/client";
import { ErrorNotice } from "../admin/ErrorNotice";
import { Button, Checkbox, Dialog, Select, TextInput } from "../ui";
import { languageLabel, newRequestId } from "./labels";

export interface BatchDialogProps {
  open: boolean;
  projectKey: string;
  languages: readonly SingleTermLanguageCounts[];
  /** Usernames that may review: every project member. */
  reviewers: readonly string[];
  onCreated: (batch: SingleTermBatch) => void;
  onClose: () => void;
}

/**
 * New review batch (mockup "New review batch"): the open and stale groups of one language (or all) for one
 * reviewer, optionally capped, optionally with a blind second review of a fixed sample. The server freezes
 * the group ids.
 */
export function BatchDialog({ open, projectKey, languages, reviewers, onCreated, onClose }: BatchDialogProps): JSX.Element {
  const id = useId().replace(/:/g, "");
  const [language, setLanguage] = useState("");
  const [limit, setLimit] = useState("");
  const [reviewer, setReviewer] = useState(reviewers[0] ?? "");
  const [second, setSecond] = useState(false);
  const [secondReviewer, setSecondReviewer] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>();
  const [fieldError, setFieldError] = useState<string | null>(null);
  const requestId = useRef(newRequestId());
  const first = useRef<HTMLSelectElement>(null);

  const counts = languages.find(item => item.language === language);
  // Without a language: the sum over all languages, as the batch takes them.
  const openCount = (counts ? [counts] : languages).reduce((sum, item) => sum + item.available, 0);
  const secondChoices = reviewers.filter(name => name !== reviewer);
  const chosenSecond = secondChoices.includes(secondReviewer) ? secondReviewer : secondChoices[0] ?? "";

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (busy) return;
    setFieldError(null); setError(undefined);
    if (second && !chosenSecond) { setFieldError("The second review needs another reviewer."); return; }
    const limitValue = limit.trim() ? Number(limit) : null;
    if (limitValue !== null && !(Number.isInteger(limitValue) && limitValue >= 1)) { setFieldError("The limit is a whole number of groups."); return; }
    const body: SingleTermBatchRequest = {
      request_id: requestId.current,
      reviewer,
      language: language || null,
      limit: limitValue,
      second_review: second ? { reviewer: chosenSecond } : null,
    };
    setBusy(true);
    try {
      const batch = await api.createSingleTermBatch(projectKey, body);
      requestId.current = newRequestId();
      onCreated(batch);
    } catch (failure: unknown) {
      setError(failure);
    } finally { setBusy(false); }
  };

  const formId = `${id}-form`;
  return <Dialog open={open} title="New review batch" onClose={busy ? undefined : onClose} initialFocus={first} size="md"
    footer={<>
      <Button onClick={onClose} disabled={busy}>Cancel</Button>
      <Button type="submit" variant="primary" form={formId} loading={busy} disabled={!reviewer}>Create batch</Button>
    </>}>
    <form id={formId} className="st-page" style={{ gap: "var(--space-3)" }} onSubmit={event => void submit(event)} onChange={() => { requestId.current = newRequestId(); }}>
      <Select ref={first} id={`${id}-reviewer`} label="Reviewer" value={reviewer} required onChange={event => setReviewer(event.target.value)}
        hint="Any project member. If the reviewer annotated or consolidated any of these texts, their decisions are marked “reviewer not independent”.">
        {reviewers.map(name => <option key={name} value={name}>{name}</option>)}
      </Select>
      <div className="st-grid" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))" }}>
        <Select id={`${id}-language`} label="Language" value={language} onChange={event => setLanguage(event.target.value)}
          hint={openCount === 0 ? "No open group left: all are decided or in an open batch." : `${openCount} open ${openCount === 1 ? "group" : "groups"}, stale ones included.`}>
          <option value="">All languages</option>
          {languages.map(item => <option key={item.language} value={item.language}>{languageLabel(item.language)}</option>)}
        </Select>
        <TextInput id={`${id}-limit`} label="At most this many groups (optional)" type="number" min={1} step={1} value={limit} onChange={event => setLimit(event.target.value)} />
      </div>
      <p className="st-small st-muted" style={{ margin: 0 }}>Groups already in another open batch are left out.</p>
      <fieldset className="st-options"><legend>Second blind review</legend>
        <Checkbox id={`${id}-second`} label="Draw a sample for a second reviewer" hint="20 % of the groups per language, at least 50 (all if fewer). The sample follows from the group IDs, so it is repeatable."
          checked={second} disabled={secondChoices.length === 0} onChange={event => setSecond(event.target.checked)} />
        {second && <Select id={`${id}-second-reviewer`} label="Second reviewer" value={chosenSecond} onChange={event => setSecondReviewer(event.target.value)}>
          {secondChoices.map(name => <option key={name} value={name}>{name}</option>)}
        </Select>}
      </fieldset>
      {fieldError && <p className="field-hint field-hint-error" role="alert">{fieldError}</p>}
      {error !== undefined && <ErrorNotice error={error} />}
    </form>
  </Dialog>;
}
