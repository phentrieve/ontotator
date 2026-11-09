import { useId, useRef, useState, type FormEvent } from "react";
import { api, type SingleTermBatch, type SingleTermBatchRequest, type SingleTermLanguageCounts } from "../api/client";
import { ErrorNotice } from "../admin/ErrorNotice";
import { Button, Checkbox, Dialog, Select, Textarea, TextInput } from "../ui";
import { languageLabel, newRequestId } from "./labels";

type GroupChoice = "all" | "texts" | "stale";

export interface BatchDialogProps {
  open: boolean;
  projectKey: string;
  languages: readonly SingleTermLanguageCounts[];
  /** Usernames that may review: granted single-term reviewers and leads. */
  reviewers: readonly string[];
  /** Layers of the task profile, for the layer filter. */
  layers?: readonly { id: string; label: string }[];
  onCreated: (batch: SingleTermBatch) => void;
  onClose: () => void;
}

/** "abc, def\nghi" → ["abc", "def", "ghi"]. */
export const parseTextIds = (value: string): string[] => [...new Set(value.split(/[\s,;]+/).map(item => item.trim()).filter(Boolean))];

/**
 * New review batch (mockup "New review batch"): a subset of the open and stale groups for one reviewer,
 * optionally with a blind second review of a share of them. The server freezes the group ids.
 */
export function BatchDialog({ open, projectKey, languages, reviewers, layers = [], onCreated, onClose }: BatchDialogProps): JSX.Element {
  const id = useId().replace(/:/g, "");
  const [language, setLanguage] = useState(languages[0]?.language ?? "");
  const [layer, setLayer] = useState("");
  const [choice, setChoice] = useState<GroupChoice>("all");
  const [texts, setTexts] = useState("");
  const [limit, setLimit] = useState("");
  const [reviewer, setReviewer] = useState(reviewers[0] ?? "");
  const [second, setSecond] = useState(false);
  const [share, setShare] = useState("20");
  const [secondReviewer, setSecondReviewer] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>();
  const [fieldError, setFieldError] = useState<string | null>(null);
  const requestId = useRef(newRequestId());
  const first = useRef<HTMLSelectElement>(null);

  const counts = languages.find(item => item.language === language);
  const openCount = counts ? counts.open + counts.blocked + counts.stale : null;
  const secondChoices = reviewers.filter(name => name !== reviewer);
  const chosenSecond = secondChoices.includes(secondReviewer) ? secondReviewer : secondChoices[0] ?? "";

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (busy) return;
    setFieldError(null); setError(undefined);
    const ids = parseTextIds(texts);
    if (choice === "texts" && !ids.length) { setFieldError("Name at least one text ID."); return; }
    const shareValue = Number(share);
    if (second && !(shareValue > 0 && shareValue <= 100)) { setFieldError("The share is a percentage from 1 to 100."); return; }
    if (second && !chosenSecond) { setFieldError("The second review needs another reviewer."); return; }
    const limitValue = limit.trim() ? Number(limit) : null;
    if (limitValue !== null && !(Number.isInteger(limitValue) && limitValue >= 1)) { setFieldError("The limit is a whole number of groups."); return; }
    const body: SingleTermBatchRequest = {
      request_id: requestId.current,
      reviewer,
      language: language || null,
      layer_id: layer || null,
      document_ids: choice === "texts" ? ids : null,
      stale_only: choice === "stale",
      limit: limitValue,
      second_review: second ? { reviewer: chosenSecond, share: shareValue / 100 } : null,
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
      <div className="st-grid" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))" }}>
        <Select ref={first} id={`${id}-language`} label="Language" value={language} onChange={event => setLanguage(event.target.value)}>
          {languages.map(item => <option key={item.language} value={item.language}>{languageLabel(item.language)}</option>)}
          <option value="">All languages</option>
        </Select>
        <Select id={`${id}-layer`} label="Layer" value={layer} onChange={event => setLayer(event.target.value)}>
          <option value="">All HPO layers</option>
          {layers.map(item => <option key={item.id} value={item.id}>{item.label}</option>)}
        </Select>
      </div>
      <fieldset className="st-options"><legend>Groups</legend>
        <label className="st-option"><input type="radio" name={`${id}-groups`} checked={choice === "all"} onChange={() => setChoice("all")} /> <span>All open and stale groups{openCount !== null && <span className="st-muted"> (up to {openCount})</span>}</span></label>
        <label className="st-option"><input type="radio" name={`${id}-groups`} checked={choice === "texts"} onChange={() => setChoice("texts")} /> <span>Groups with occurrences in chosen texts</span></label>
        {choice === "texts" && <Textarea id={`${id}-texts`} label="Text IDs" hint="One per line or separated by commas." rows={3} value={texts} onChange={event => setTexts(event.target.value)} />}
        <label className="st-option"><input type="radio" name={`${id}-groups`} checked={choice === "stale"} onChange={() => setChoice("stale")} /> <span>Stale decisions only{counts && <span className="st-muted"> ({counts.stale})</span>}</span></label>
        <TextInput id={`${id}-limit`} label="At most this many groups (optional)" type="number" min={1} step={1} value={limit} onChange={event => setLimit(event.target.value)} />
        <p className="st-small st-muted">Groups already in another open batch are left out.</p>
      </fieldset>
      <Select id={`${id}-reviewer`} label="Reviewer (single-term reviewers)" value={reviewer} required onChange={event => setReviewer(event.target.value)}
        hint={reviewers.length ? "If the reviewer annotated or consolidated any of these texts, their decisions are marked “reviewer not independent”." : "Grant the single-term reviewer capability under Settings › People first."}>
        {reviewers.map(name => <option key={name} value={name}>{name}</option>)}
      </Select>
      <fieldset className="st-options"><legend>Second blind review</legend>
        <Checkbox id={`${id}-second`} label="Draw a sample for a second reviewer" hint="At least 50 groups per language, or all if fewer. The sample follows from the group IDs, so it is repeatable."
          checked={second} disabled={secondChoices.length === 0} onChange={event => setSecond(event.target.checked)} />
        {second && <div className="st-grid" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))" }}>
          <TextInput id={`${id}-share`} label="Share (%)" type="number" min={1} max={100} step={1} value={share} onChange={event => setShare(event.target.value)} />
          <Select id={`${id}-second-reviewer`} label="Second reviewer" value={chosenSecond} onChange={event => setSecondReviewer(event.target.value)}>
            {secondChoices.map(name => <option key={name} value={name}>{name}</option>)}
          </Select>
        </div>}
      </fieldset>
      {fieldError && <p className="field-hint field-hint-error" role="alert">{fieldError}</p>}
      {error !== undefined && <ErrorNotice error={error} />}
    </form>
  </Dialog>;
}
