/**
 * Lead actions on one version row of the Translation part (issue 341):
 * - `EditTranslationDialog` (issue 555): "Edit the translation…", one action for every change the lead makes
 *   to an accepted version; the lead chooses by consequence (the meaning stays: no review, annotations move along /
 *   the meaning changes: reviewed again, annotations stay), then the dialog of that way opens.
 * - `CorrectVersionDialog` (b): "Correct it myself…" of an accepted version; the lead correction panel
 *   lists the annotation work that stays on the version before anything is saved.
 * - `AcceptVersionDialog` (d): "Accept this version…" with a required reason, recorded like the work plan's
 *   acceptance ("Accepted: reviewed outside Ontotator, {lead}, {time}, {reason}"); other chains stay as they are.
 */
import { useId, useRef, useState } from "react";
import { api, ApiError, type DocumentRowView, type DocumentVersionView } from "../api/client";
import { textLabel } from "../app/identity";
import type { Route } from "../app/router";
import { ErrorNotice } from "../admin/ErrorNotice";
import { Button, Dialog, InlineMessage, Textarea } from "../ui";
import { LeadCorrectionPanel } from "./LeadCorrectionPanel";
import { versionName } from "./labels";

/** "de v2", or "{chain name} v2" with parallel roots. */
function versionLabel(row: DocumentRowView, version: DocumentVersionView): string {
  return `${row.language} ${versionName(version.version, version.chain_name, row.parallel_roots)}`;
}

export interface CorrectVersionDialogProps {
  row: DocumentRowView;
  version: DocumentVersionView;
  projectKey: string;
  onNavigate: (route: Route) => void;
  onClose: () => void;
  returnFocus?: () => HTMLElement | null | undefined;
}

export function CorrectVersionDialog({ row, version, projectKey, onNavigate, onClose, returnFocus }: CorrectVersionDialogProps): JSX.Element {
  return <Dialog open size="md" title={`Correct it myself, ${row.case_id} ${versionLabel(row, version)}, accepted`} onClose={onClose} returnFocus={returnFocus}>
    <LeadCorrectionPanel row={row} projectKey={projectKey} documentId={version.document_id} inDialog
      onNavigate={route => { onClose(); onNavigate(route); }} onCancel={onClose} />
  </Dialog>;
}

/** Issue 555: the two ways to edit a version, named by what follows (no hint under the buttons). */
export type EditKind = "typos" | "meaning";

export function editChoices(version: number): ReadonlyArray<{ kind: EditKind; label: string; consequence: string }> {
  return [
    { kind: "typos", label: "Only spelling, spacing or grammar", consequence: `The meaning stays. No review; submitted annotations move to v${version + 1}.` },
    { kind: "meaning", label: "The meaning changes", consequence: `v${version + 1} is reviewed again. Annotations stay on v${version}; you handle the text change after.` },
  ];
}

export interface EditTranslationDialogProps {
  row: DocumentRowView;
  version: DocumentVersionView;
  onChoose: (kind: EditKind) => void;
  onClose: () => void;
  returnFocus?: () => HTMLElement | null | undefined;
}

/** "Edit the translation…": the question first, the consequence of each answer in its label; Continue opens that way. */
export function EditTranslationDialog({ row, version, onChoose, onClose, returnFocus }: EditTranslationDialogProps): JSX.Element {
  const id = useId();
  const [kind, setKind] = useState<EditKind | null>(null);
  const [tried, setTried] = useState(false);
  const missing = tried && kind === null;
  return <Dialog open size="md" title={`Edit the translation, ${row.case_id} ${versionLabel(row, version)}`} onClose={onClose} returnFocus={returnFocus}
    footer={<>
      <Button onClick={onClose}>Cancel</Button>
      <Button variant="primary" aria-describedby={missing ? `${id}-missing` : undefined}
        onClick={() => { setTried(true); if (kind) onChoose(kind); }}>Continue</Button>
    </>}>
    <fieldset className="edit-translation-choice" aria-describedby={missing ? `${id}-missing` : undefined} aria-invalid={missing || undefined}>
      <legend className="form-label">What changes?</legend>
      {editChoices(version.version).map(choice => <label key={choice.kind} className="form-checkbox-row edit-translation-option">
        <input type="radio" name={`${id}-kind`} value={choice.kind} checked={kind === choice.kind}
          aria-labelledby={`${id}-${choice.kind}-label`} aria-describedby={`${id}-${choice.kind}`} onChange={() => setKind(choice.kind)} />
        <span><span id={`${id}-${choice.kind}-label`} className="edit-translation-label">{choice.label}</span>
          <span id={`${id}-${choice.kind}`} className="edit-translation-consequence">{choice.consequence}</span></span>
      </label>)}
      {missing && <InlineMessage tone="error"><span id={`${id}-missing`}>Choose what changes.</span></InlineMessage>}
    </fieldset>
  </Dialog>;
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);

/** `VERSION_NOT_ACCEPTABLE` reasons, as the version row would explain them. */
const NOT_ACCEPTABLE: Readonly<Record<string, string>> = {
  not_newest: "A newer version of this translation exists. Reload the row to see it.",
  accepted: "This version is already accepted. Reload the row to see its current state.",
  reviewed: "This version was reviewed in Ontotator. Reload the row to see its current state.",
  discarded: "This translation was discarded. Reload the row to see its current state.",
  review_open: "A translation review of this version is open. Withdraw it with Remove… in the reviewer’s row of the Translation part before you accept the version.",
};

function refusalText(error: unknown): string | null {
  if (!(error instanceof ApiError)) return null;
  if (error.code === "VARIANT_REVIEW_STALE") return "The text of this version changed. Reload the row to see the current text.";
  if (error.code !== "VERSION_NOT_ACCEPTABLE") return null;
  const reason = isRecord(error.details) && typeof error.details.reason === "string" ? error.details.reason : "";
  return Object.hasOwn(NOT_ACCEPTABLE, reason) ? NOT_ACCEPTABLE[reason] : null;
}

export interface AcceptVersionDialogProps {
  row: DocumentRowView;
  version: DocumentVersionView;
  projectKey: string;
  /** Saved: the announcement ("EN100022 de v2 accepted as reviewed outside Ontotator."). */
  onAccepted: (message: string) => void;
  onClose: () => void;
  returnFocus?: () => HTMLElement | null | undefined;
}

/** How "Accept this version…" is recorded: no translation review in Ontotator stands behind it. */
export const ACCEPT_VERSION_RECORDED = "It is recorded as “Accepted: reviewed outside Ontotator”, with your name, the reason and the time: no translation review in Ontotator stands behind this version. Say in the reason how it was checked.";

export function AcceptVersionDialog({ row, version, projectKey, onAccepted, onClose, returnFocus }: AcceptVersionDialogProps): JSX.Element {
  const id = useId();
  const writing = useRef(false);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>();
  const [tried, setTried] = useState(false);
  const label = versionLabel(row, version);
  const short = versionName(version.version, version.chain_name, row.parallel_roots);
  const missing = !reason.trim();

  const accept = async () => {
    setTried(true);
    if (writing.current || missing) return;
    writing.current = true; setBusy(true); setError(undefined);
    try {
      const { text_sha256 } = await api.getVariantMetadata(projectKey, version.document_id);
      await api.acceptVersion(projectKey, version.document_id, { reason: reason.trim(), expected_text_sha256: text_sha256 });
      onAccepted(`${textLabel(row)} ${short} accepted as reviewed outside Ontotator.`);
    } catch (failure: unknown) {
      setError(failure);
    } finally { writing.current = false; setBusy(false); }
  };

  const refused = refusalText(error);
  return <Dialog open size="sm" title={`Accept ${label}`} onClose={busy ? undefined : onClose} returnFocus={returnFocus}
    footer={<>
      <Button disabled={busy} onClick={onClose}>Cancel</Button>
      <Button variant="primary" loading={busy} aria-disabled={missing || busy ? true : undefined}
        aria-describedby={missing && tried ? `${id}-missing` : undefined} onClick={() => { void accept(); }}>{`Accept ${short}`}</Button>
    </>}>
    <Textarea id={`${id}-reason`} label="Reason" required maxLength={2000} value={reason} disabled={busy}
      onChange={event => setReason(event.target.value)} />
    {/* The wording the acceptance gets in the version list and in History, said before it is saved. */}
    <p className="field-hint">{ACCEPT_VERSION_RECORDED}</p>
    {missing && tried && <p id={`${id}-missing`} className="action-reason">Enter a reason.</p>}
    {refused ? <InlineMessage tone="warning">{refused}</InlineMessage> : error !== undefined && <ErrorNotice error={error} />}
  </Dialog>;
}
