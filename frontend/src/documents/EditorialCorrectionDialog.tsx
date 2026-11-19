/**
 * "Fix typos…" on the newest version row of a translation (issue 453, an editorial correction): the lead fixes
 * spacing, typos or grammar without a translation review. One page: the text in the translation editor
 * (changed words are marked while typing), below it the changes with removed text struck through, how many
 * characters changed, a notice when a number changes, the reason (chips and an optional note), what happens
 * to the work on the version, and "Save as v2". The server preview runs when the dialog opens and, briefly
 * after the last keystroke, for the text as it stands. The new version is a correction of this version with
 * its status: an accepted text stays accepted, a rejected one stays rejected.
 */
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { api, ApiError, type DocumentRowView, type DocumentVersionView, type EditorialCorrectionPreview } from "../api/client";
import { textLabel } from "../app/identity";
import { ErrorNotice } from "../admin/ErrorNotice";
import { DiffView } from "../translation/DiffView";
import { TranslationEditor } from "../translation/TranslationEditor";
import { diffTextBounded } from "../translation/textDiff";
import { Button, Dialog, InlineMessage, TextInput } from "../ui";
import { statusBadgeText, versionName } from "./labels";

const plural = (count: number, noun: string) => `${count} ${noun}${count === 1 ? "" : "s"}`;

/** Why this version cannot be corrected editorially, or why this correction is refused (`EDITORIAL_CORRECTION_NOT_AVAILABLE` reasons). */
export function editorialRefusal(reason: string | null | undefined, short: string): string | null {
  switch (reason) {
    case "review_open": return "A translation review of this version is open. Withdraw it with Remove… in the reviewer’s row of the Translation part, or make the fix in that review.";
    case "not_newest": return "A newer version of this translation exists. Reload the row to see it.";
    case "discarded": return "This translation was discarded. Reload the row to see its current state.";
    case "unchanged": return `No changes to ${short}. Nothing is saved.`;
    case "reason_required": return "Enter the reason.";
    default: return null;
  }
}

/** "Changes a number: 15 → 50", "Changes numbers: 15 → 50, adds 3, removes 2"; null when no number changes (a notice, not a refusal). */
export function numberNotice(changes: EditorialCorrectionPreview["number_changes"]): string | null {
  if (!changes?.length) return null;
  const parts = changes.map(item => (item.old != null && item.new != null ? `${item.old} → ${item.new}` : item.new != null ? `adds ${item.new}` : `removes ${item.old ?? ""}`));
  return `Changes ${changes.length === 1 ? "a number" : "numbers"}: ${parts.join(", ")}. Check that this is intended.`;
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);

function refusedSave(error: unknown, short: string): string | null {
  if (!(error instanceof ApiError)) return null;
  if (error.code === "VARIANT_REVIEW_STALE") return "The text of this version changed. Reload the row to see the current text.";
  if (error.code === "NOT_A_TRANSLATION") return "A source text has no typo fix. Import the corrected source text as an Ontospan bundle.";
  if (error.code !== "EDITORIAL_CORRECTION_NOT_AVAILABLE") return null;
  return editorialRefusal(isRecord(error.details) && typeof error.details.reason === "string" ? error.details.reason : null, short);
}

/**
 * The reasons a click gives; the stored reason is their words plus the optional note ("Spacing; Typo", "Typo: Hypotnie").
 * "Removed addition" (issue 483): words the machine added that the source does not have, e.g. a synonym in brackets.
 */
export const REASON_CHIPS = ["Spacing", "Typo", "Grammar", "Removed addition"] as const;
export function reasonText(chips: readonly string[], note: string): string {
  const chosen = REASON_CHIPS.filter(chip => chips.includes(chip)).join("; ");
  return [chosen, note.trim()].filter(Boolean).join(": ");
}

/** How long after the last keystroke the server checks the text as it stands. */
export const PREVIEW_DELAY_MS = 400;

export interface EditorialConsequences {
  /** Something stays on this version for the lead (started or submitted annotations, consolidations, a final result): the highlighted block. */
  attention: boolean;
  lines: string[];
}

/**
 * What happens to the work on the version, in plain words. Quiet when nothing needs the lead afterwards
 * ("Nobody has worked on v1 yet.", "2 waiting tasks continue on v2."); when started or submitted work stays,
 * what stays and what to do next ("2 annotations stay on v1. After saving, use Handle text change… and
 * Carry to v2… on this row to move them.").
 */
export function editorialConsequences(preview: EditorialCorrectionPreview): EditorialConsequences {
  const old = `v${preview.version}`, next = `v${preview.next_version}`, moving = preview.tasks_following;
  const started = Math.max(0, preview.annotations.open - moving), submitted = preview.annotations.submitted;
  const staying = submitted + started;
  // The row's own next steps: started work is moved with "Handle text change…", submitted work with "Carry to v2…".
  const steps = [started ? "Handle text change…" : null, submitted ? `Carry to ${next}…` : null].filter(Boolean).join(" and ");
  const count = preview.open_consolidations, findings = preview.findings, proposals = preview.proposals;
  const attention = staying > 0 || count > 0 || preview.final_result;
  // The text-change steps wait for the acceptance of a version that is not accepted yet (rule "annotate accepted translations only").
  const waits = preview.annotate_accepted_only && preview.translation_status !== "accepted";
  const others = [count ? plural(count, "open consolidation") : null, preview.final_result ? "the final result" : null].filter(Boolean).join(" and ");
  const lines = [
    staying ? `${plural(staying, "annotation")} ${staying === 1 ? "stays" : "stay"} on ${old}. ${waits ? `Once ${next} is accepted` : "After saving"}, use ${steps} on this row to move ${staying === 1 ? "it" : "them"}.` : null,
    others ? `${others.charAt(0).toUpperCase()}${others.slice(1)} ${count + (preview.final_result ? 1 : 0) === 1 ? "stays" : "stay"} on ${old}${staying ? " as well" : ""}.` : null,
    findings?.needs_check ? `${findings.needs_check} of ${plural(findings.submitted, "finding")} ${findings.needs_check === 1 ? "marks" : "mark"} words you changed and will need a check when moved.` : null,
    moving ? `${plural(moving, "waiting task")} ${moving === 1 ? "continues" : "continue"} on ${next}.` : null,
    proposals && proposals.carried + proposals.needs_check > 0
      ? `Tool proposals move to ${next}${proposals.needs_check ? `; ${proposals.needs_check} ${proposals.needs_check === 1 ? "marks" : "mark"} words you changed and ${proposals.needs_check === 1 ? "waits" : "wait"} for a check` : ""}.`
      : null,
  ].filter((line): line is string => line !== null);
  return { attention, lines: lines.length ? lines : [`Nobody has worked on ${old} yet.`] };
}

export interface EditorialCorrectionDialogProps {
  row: DocumentRowView;
  version: DocumentVersionView;
  projectKey: string;
  /** Saved: the announcement ("Typos fixed: v3 of EN100022 de saved. It stays Accepted."). */
  onCorrected: (message: string) => void;
  onClose: () => void;
  returnFocus?: () => HTMLElement | null | undefined;
}

export function EditorialCorrectionDialog({ row, version, projectKey, onCorrected, onClose, returnFocus }: EditorialCorrectionDialogProps): JSX.Element {
  const id = useId();
  const writing = useRef(false);
  const short = versionName(version.version, version.chain_name, row.parallel_roots);
  const title = `Fix typos, ${row.case_id} ${row.language} ${short}`;
  /** What the server says about this version: availability and the work on it. */
  const [state, setState] = useState<EditorialCorrectionPreview | null>(null);
  /** The text of this version, as the editor starts with it. */
  const [original, setOriginal] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<unknown>();
  const [text, setText] = useState<string | null>(null);
  const [chips, setChips] = useState<string[]>([]);
  const [note, setNote] = useState("");
  const [tried, setTried] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>();
  /** The server's check of a changed text: the count, the numbers that change and what follows. */
  const [checked, setChecked] = useState<{ text: string; preview: EditorialCorrectionPreview } | null>(null);

  useEffect(() => {
    let live = true;
    Promise.all([api.previewEditorialCorrection(projectKey, version.document_id), api.getVariantText(projectKey, version.document_id)]).then(([value, stored]) => {
      if (!live) return;
      setState(value); setOriginal(stored.text); setText(current => current ?? stored.text);
    }, failure => { if (live) setLoadError(failure); });
    return () => { live = false; };
  }, [projectKey, version.document_id]);

  const value = text ?? "";
  const changed = original !== null && value !== original;
  // The check of the text as it stands, shortly after the last keystroke; an answer for an older text is dropped.
  useEffect(() => {
    if (!changed || !value.trim()) return undefined;
    let live = true;
    const timer = window.setTimeout(() => {
      api.previewEditorialCorrection(projectKey, version.document_id, value).then(preview => { if (live) setChecked({ text: value, preview }); }, () => undefined);
    }, PREVIEW_DELAY_MS);
    return () => { live = false; window.clearTimeout(timer); };
  }, [changed, value, projectKey, version.document_id]);

  const next = state?.next_version ?? version.version + 1;
  const status = statusBadgeText(version.translation_status, version.latest_review_decision, version.accepted_without_review);
  const reason = reasonText(chips, note);
  const missingReason = !reason;
  const invalid = !value.trim() || !changed || missingReason;
  const blocked = state !== null && !state.available ? editorialRefusal(state.reason, short) ?? "This version cannot be corrected here. Reload the row to see its current state." : null;
  const current = checked !== null && checked.text === value && changed ? checked.preview : null;
  const parts = useMemo(() => (changed && original !== null ? diffTextBounded(original, value) : null), [changed, original, value]);
  const refusedCheck = current !== null && !current.available ? editorialRefusal(current.reason, short) ?? "This correction cannot be saved. Reload the row to see its current state." : null;
  const numbers = current ? numberNotice(current.number_changes) : null;
  const consequences = current ?? state;
  const work = consequences ? editorialConsequences(consequences) : null;

  const save = async () => {
    setTried(true);
    if (writing.current || invalid || state === null || refusedCheck !== null) return;
    writing.current = true; setBusy(true); setError(undefined);
    try {
      const saved = await api.editorialCorrection(projectKey, version.document_id, { text: value, expected_text_sha256: state.text_sha256, reason });
      onCorrected(`Typos fixed: v${saved.version} of ${textLabel(row)} saved.${status ? ` It stays ${status}.` : ""}`);
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

  const ready = state !== null && original !== null;
  return <Dialog open size="lg" title={title} onClose={close} returnFocus={returnFocus}
    footer={<>
      <Button disabled={busy} onClick={onClose}>Cancel</Button>
      <Button variant="primary" loading={busy} aria-disabled={!ready || invalid || refusedCheck !== null || busy ? true : undefined}
        aria-describedby={invalid && tried ? `${id}-missing` : undefined} onClick={() => { void save(); }}>{`Save as v${next}`}</Button>
    </>}>
    <div className="editorial-correction">
      <p>Fix spacing, typos or grammar directly in the text. A change of content belongs in a translation review.</p>
      {!ready
        ? <InlineMessage tone="info">Loading the text…</InlineMessage>
        : <>
          <div className="form-group">
            <label id={`${id}-text-label`} htmlFor={`${id}-text`} className="form-label">Corrected text</label>
            <TranslationEditor id={`${id}-text`} labelledBy={`${id}-text-label`} machineText={original} value={value}
              lang={row.language} disabled={busy} onChange={event => { setText(event.target.value); setError(undefined); }} />
            {tried && !changed && <p className="field-hint field-hint-error" role="alert">Change the text first.</p>}
          </div>
          {parts !== null && <div className="editorial-correction-changes">
            <p className="upload-version-changes"><strong>{`Changes to ${short}`}</strong>
              {current?.changed_characters != null && ` · ${plural(current.changed_characters, "character")} changed`}</p>
            <DiffView before={original} after={value} parts={parts} lang={row.language} />
          </div>}
          {changed && parts === null && <p className="field-hint">The texts differ too much to mark the changes.</p>}
          {refusedCheck !== null && <InlineMessage tone="warning">{refusedCheck}</InlineMessage>}
          {numbers !== null && <InlineMessage tone="warning">{numbers}</InlineMessage>}
          <fieldset className="plan-step editorial-correction-reason" aria-describedby={tried && missingReason ? `${id}-reason-error` : undefined}>
            <legend>What did you fix? (required)</legend>
            <div className="editorial-correction-chips">
              {REASON_CHIPS.map(chip => <button key={chip} type="button" className="ui-plan-chip" data-size="card" aria-pressed={chips.includes(chip)} disabled={busy}
                onClick={() => setChips(chosen => (chosen.includes(chip) ? chosen.filter(item => item !== chip) : [...chosen, chip]))}>{chip}</button>)}
            </div>
            <TextInput id={`${id}-note`} label="Note" maxLength={1900} value={note} disabled={busy}
              hint="Optional, for example the word you corrected. Kept with the version." onChange={event => setNote(event.target.value)} />
            {tried && missingReason && <p id={`${id}-reason-error`} className="field-hint field-hint-error" role="alert">Choose what you fixed or write a note.</p>}
          </fieldset>
          {work !== null && (work.attention
            ? <InlineMessage tone="warning" title={`Work stays on v${version.version}`}>
              {work.lines.map(line => <span key={line} className="lead-correction-consequence">{line} </span>)}
            </InlineMessage>
            : <p className="editorial-correction-work">{work.lines.join(" ")}</p>)}
          <p className="field-hint">{`v${next} keeps the status of ${short}${status ? `: ${status}` : ""}. No translation review is started.`}</p>
        </>}
      {failure}
      {invalid && tried && <p id={`${id}-missing`} className="action-reason">{!changed ? "Change the text and say what you fixed." : "Say what you fixed."}</p>}
    </div>
  </Dialog>;
}
