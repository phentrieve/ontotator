/**
 * "Editorial correction…" on the newest version row of a translation (issue 453): the lead fixes spacing,
 * typos or grammar without a translation review. Two steps in one dialog: the text in the translation
 * editor (changes against the current version are marked while typing) with the reason, then the changes
 * ("Show changes" marks) and what follows before it is saved. The new version is a correction of this
 * version with its status: an accepted text stays accepted. The server guards the content: the digits of
 * the text stay as they are and the change is small; its refusals are shown in words.
 */
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { api, ApiError, type DocumentRowView, type DocumentVersionView, type EditorialCorrectionPreview } from "../api/client";
import { textLabel } from "../app/identity";
import { ErrorNotice } from "../admin/ErrorNotice";
import { DiffView, TextView } from "../translation/DiffView";
import { TranslationEditor } from "../translation/TranslationEditor";
import { diffTextBounded } from "../translation/textDiff";
import { Button, Dialog, InlineMessage, Textarea } from "../ui";
import { correctionConsequences } from "./LeadCorrectionPanel";
import { statusBadgeText, versionName } from "./labels";

const plural = (count: number, noun: string) => `${count} ${noun}${count === 1 ? "" : "s"}`;

type Size = Pick<EditorialCorrectionPreview, "changed_characters" | "changed_characters_limit">;

/** Why this version cannot be corrected editorially, or why this correction is refused (`EDITORIAL_CORRECTION_NOT_AVAILABLE` reasons). */
export function editorialRefusal(reason: string | null | undefined, short: string, size?: Partial<Size>): string | null {
  switch (reason) {
    case "review_open": return "A translation review of this version is open. Withdraw it with Remove… in the reviewer’s row of the Translation part, or make the fix in that review.";
    case "not_newest": return "A newer version of this translation exists. Reload the row to see it.";
    case "discarded": return "This translation was discarded. Reload the row to see its current state.";
    case "rejected_or_queried": return `${short} was rejected or queried. Resolve that with Resolve… first; an editorial correction keeps the status of the text.`;
    case "unchanged": return `No changes to ${short}. Nothing is saved.`;
    case "digits_changed": return "A number would change. An editorial correction leaves every digit as it is; change numbers in a translation review.";
    case "too_large": {
      const limit = size?.changed_characters_limit, changed = size?.changed_characters;
      const counted = typeof changed === "number" && typeof limit === "number" ? ` (${plural(changed, "character")} changed, at most ${limit} here)` : "";
      return `This change is too large for an editorial correction${counted}. Make it in a translation review with Correct the translation… or Request correction….`;
    }
    case "reason_required": return "Enter the reason.";
    default: return null;
  }
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);

function refusedSave(error: unknown, short: string): string | null {
  if (!(error instanceof ApiError)) return null;
  if (error.code === "VARIANT_REVIEW_STALE") return "The text of this version changed. Reload the row to see the current text.";
  if (error.code === "NOT_A_TRANSLATION") return "A source text has no editorial correction. Import the corrected source text as an Ontospan bundle.";
  if (error.code !== "EDITORIAL_CORRECTION_NOT_AVAILABLE") return null;
  const details = isRecord(error.details) ? error.details : {};
  return editorialRefusal(typeof details.reason === "string" ? details.reason : null, short, {
    changed_characters: typeof details.changed_characters === "number" ? details.changed_characters : undefined,
    changed_characters_limit: typeof details.changed_characters_limit === "number" ? details.changed_characters_limit : undefined,
  });
}

/** What follows the correction, line by line: tasks that move, work that stays, findings and proposals to check. */
export function editorialConsequences(preview: EditorialCorrectionPreview): string[] {
  const next = `v${preview.next_version}`, moving = preview.tasks_following;
  // Tasks nobody opened move; the "stay" line counts the rest. The new version has this version's status, so an accepted one waits for nothing.
  const staying = { ...preview, annotate_accepted_only: preview.annotate_accepted_only && preview.translation_status !== "accepted",
    annotations: { submitted: preview.annotations.submitted, open: Math.max(0, preview.annotations.open - moving) } };
  const findings = preview.findings, proposals = preview.proposals;
  return [
    moving ? `${plural(moving, "annotation task")} nobody opened ${moving === 1 ? "moves" : "move"} to ${next}.` : null,
    ...correctionConsequences(staying),
    findings && findings.submitted > 0
      ? findings.needs_check
        ? `${findings.needs_check} of ${plural(findings.submitted, "finding")} in submitted annotations ${findings.needs_check === 1 ? "marks" : "mark"} changed words and ${findings.needs_check === 1 ? "needs" : "need"} a check when carried to ${next}.`
        : `All ${plural(findings.submitted, "finding")} in submitted annotations can be placed on ${next}.`
      : null,
    proposals && proposals.carried + proposals.needs_check > 0
      ? `${plural(proposals.carried, "tool proposal")} ${proposals.carried === 1 ? "is" : "are"} carried to ${next}${proposals.needs_check ? `; ${proposals.needs_check} ${proposals.needs_check === 1 ? "marks" : "mark"} changed words and ${proposals.needs_check === 1 ? "waits" : "wait"} for a check` : ""}.`
      : null,
  ].filter((line): line is string => line !== null);
}

export interface EditorialCorrectionDialogProps {
  row: DocumentRowView;
  version: DocumentVersionView;
  projectKey: string;
  /** Saved: the announcement ("EN100022 de v3 saved as an editorial correction of v2. It stays Accepted."). */
  onCorrected: (message: string) => void;
  onClose: () => void;
  returnFocus?: () => HTMLElement | null | undefined;
}

export function EditorialCorrectionDialog({ row, version, projectKey, onCorrected, onClose, returnFocus }: EditorialCorrectionDialogProps): JSX.Element {
  const id = useId();
  const writing = useRef(false);
  const short = versionName(version.version, version.chain_name, row.parallel_roots);
  const title = `Editorial correction, ${row.case_id} ${row.language} ${short}`;
  /** What the server says before any change is known: availability and the size cap. */
  const [state, setState] = useState<EditorialCorrectionPreview | null>(null);
  /** The text of this version, as the editor starts with it. */
  const [original, setOriginal] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<unknown>();
  const [text, setText] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const [tried, setTried] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>();
  /** Step 2: the text as it would be stored, the changes and what follows. */
  const [checked, setChecked] = useState<EditorialCorrectionPreview | null>(null);
  /** The guards' refusal of the text last checked (stays until the text changes). */
  const [refused, setRefused] = useState<{ text: string; message: string } | null>(null);

  useEffect(() => {
    let live = true;
    Promise.all([api.previewEditorialCorrection(projectKey, version.document_id), api.getVariantText(projectKey, version.document_id)]).then(([value, stored]) => {
      if (!live) return;
      setState(value); setOriginal(stored.text); setText(current => current ?? stored.text);
    }, failure => { if (live) setLoadError(failure); });
    return () => { live = false; };
  }, [projectKey, version.document_id]);

  const value = text ?? "";
  const next = state?.next_version ?? version.version + 1;
  const status = statusBadgeText(version.translation_status, version.latest_review_decision, version.accepted_without_review);
  const missingChange = value === original;
  const missingReason = !reason.trim();
  const invalid = !value.trim() || missingChange || missingReason;
  const blocked = state !== null && !state.available ? editorialRefusal(state.reason, short) ?? "This version cannot be corrected here. Reload the row to see its current state." : null;
  const parts = useMemo(() => (checked?.text != null && checked.previous_text != null ? diffTextBounded(checked.previous_text, checked.text) : null), [checked]);

  const check = async () => {
    setTried(true);
    if (writing.current || invalid) return;
    writing.current = true; setBusy(true); setError(undefined);
    try {
      const preview = await api.previewEditorialCorrection(projectKey, version.document_id, value);
      if (preview.available) { setChecked(preview); setRefused(null); }
      else setRefused({ text: value, message: editorialRefusal(preview.reason, short, preview) ?? "This correction cannot be saved. Reload the row to see its current state." });
    } catch (failure: unknown) {
      setError(failure);
    } finally { writing.current = false; setBusy(false); }
  };

  const save = async () => {
    if (writing.current || !checked || checked.text == null) return;
    writing.current = true; setBusy(true); setError(undefined);
    try {
      const saved = await api.editorialCorrection(projectKey, version.document_id, { text: checked.text, expected_text_sha256: checked.text_sha256, reason: reason.trim() });
      onCorrected(`${textLabel(row)} v${saved.version} saved as an editorial correction of ${short}.${status ? ` It stays ${status}.` : ""}`);
    } catch (failure: unknown) {
      setError(failure);
    } finally { writing.current = false; setBusy(false); }
  };

  const refusedText = refusedSave(error, short);
  const failure = refusedText ? <InlineMessage tone="warning">{refusedText}</InlineMessage> : error !== undefined && <ErrorNotice error={error} />;
  const close = busy ? undefined : onClose;

  if (loadError !== undefined || blocked !== null) {
    return <Dialog open size="sm" title={title} onClose={onClose} returnFocus={returnFocus} footer={<Button onClick={onClose}>Close</Button>}>
      {loadError !== undefined ? <ErrorNotice error={loadError} /> : <InlineMessage tone="warning">{blocked}</InlineMessage>}
    </Dialog>;
  }

  if (checked !== null) {
    const consequences = editorialConsequences(checked);
    const changed = checked.changed_characters ?? 0;
    // Work that stays behind or needs a check is a warning, as in the other version dialogs; tasks and proposals that simply follow are not.
    const attention = checked.annotations.submitted + Math.max(0, checked.annotations.open - checked.tasks_following) > 0 || checked.open_consolidations > 0
      || checked.final_result || (checked.findings?.needs_check ?? 0) + (checked.proposals?.needs_check ?? 0) > 0;
    return <Dialog open size="lg" title={title} onClose={close} returnFocus={returnFocus}
      footer={<>
        <Button disabled={busy} onClick={() => { setChecked(null); setError(undefined); }}>Back</Button>
        <Button variant="primary" loading={busy} onClick={() => { void save(); }}>{`Save as v${next}`}</Button>
      </>}>
      <div className="upload-version">
        <p className="upload-version-changes"><strong>{`Changes to ${short}`}</strong>{` · ${plural(changed, "character")} changed, at most ${checked.changed_characters_limit}`}</p>
        {parts
          ? <DiffView before={checked.previous_text ?? ""} after={checked.text ?? ""} parts={parts} lang={row.language} />
          : <TextView text={checked.text ?? ""} label="Corrected text" lang={row.language} />}
        <p className="editorial-correction-reason"><strong>Reason</strong>{` · ${reason.trim()}`}</p>
        {consequences.length > 0 && <InlineMessage tone={attention ? "warning" : "info"} title={`What happens to the work on v${version.version}`}>
          {consequences.map(line => <span key={line} className="lead-correction-consequence">{line} </span>)}
        </InlineMessage>}
        <p className="field-hint">{`v${next} keeps the status of ${short}${status ? `: ${status}` : ""}. No translation review is started.`}</p>
        {failure}
      </div>
    </Dialog>;
  }

  const stale = refused !== null && refused.text === value ? refused.message : null;
  return <Dialog open size="lg" title={title} onClose={close} returnFocus={returnFocus}
    footer={<>
      <Button disabled={busy} onClick={onClose}>Cancel</Button>
      <Button variant="primary" loading={busy} aria-disabled={original === null || invalid || busy ? true : undefined}
        aria-describedby={invalid && tried ? `${id}-missing` : undefined} onClick={() => { void check(); }}>Check changes</Button>
    </>}>
    <div className="editorial-correction">
      <p>{`Fix spacing, typos or grammar. The corrected text becomes v${next} and keeps the status of ${short}${status ? ` (${status})` : ""}; it is not reviewed again.`}</p>
      {state === null || original === null
        ? <InlineMessage tone="info">Loading the text…</InlineMessage>
        : <>
          <div className="form-group">
            <label id={`${id}-text-label`} htmlFor={`${id}-text`} className="form-label">Corrected text</label>
            <TranslationEditor id={`${id}-text`} labelledBy={`${id}-text-label`} describedBy={`${id}-text-hint`} machineText={original} value={value}
              lang={row.language} disabled={busy} onChange={event => { setText(event.target.value); setError(undefined); }} />
            <p id={`${id}-text-hint`} className="field-hint">{`Changed words are marked. At most ${state.changed_characters_limit} characters may change, and every number stays as it is. A larger change belongs in a translation review.`}</p>
            {tried && missingChange && <p className="field-hint field-hint-error" role="alert">Change the text first.</p>}
          </div>
          {stale !== null && <InlineMessage tone="warning">{stale}</InlineMessage>}
          <Textarea id={`${id}-reason`} label="Reason" required rows={2} maxLength={2000} value={reason} disabled={busy}
            hint="What was wrong, for example: space before a full stop. It is kept with the version."
            error={tried && missingReason ? "Enter the reason." : undefined} onChange={event => setReason(event.target.value)} />
        </>}
      {failure}
      {invalid && tried && <p id={`${id}-missing`} className="action-reason">{missingChange ? "Change the text and enter the reason." : "Fill in the required fields."}</p>}
    </div>
  </Dialog>;
}
