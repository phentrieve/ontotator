/**
 * "Withdraw final…" (issue 343): takes a text's final result back. The dialog lists what follows, asks for a Reason
 * and an "I understand" tick; the danger button "Withdraw final result" sends the final's revision, so a final that
 * changed meanwhile is refused instead of withdrawn. After such a refusal the dialog says so, the rows reload
 * (`onStale`) and the lead ticks "I understand" again for the final result as it is now.
 */
import { useId, useState } from "react";
import { api, ApiError, type DocumentRowView, type FinalWithdrawalView } from "../api/client";
import { errorMessage } from "../admin/errors";
import { Button, Checkbox, Dialog, InlineMessage, Textarea } from "../ui";

/** What withdrawing changes, in the dialog's words. */
export const WITHDRAW_CONSEQUENCES = [
  "The text has no final result until you choose one again.",
  "Final exports already made stay as they are.",
  "Change mode… is possible again.",
  "Submissions and consolidation stay.",
] as const;

/** After a refusal because the final result changed (like "This final result changed." of Change final…). */
export const WITHDRAW_CHANGED = "This final result changed. Nothing was withdrawn.";

export function WithdrawFinalDialog({ projectKey, row, onCancel, onWithdrawn, onStale }: {
  projectKey: string;
  /** The row as the page shows it now: after `onStale` reloaded it, its final carries the new revision. */
  row: Pick<DocumentRowView, "case_id" | "language" | "final">;
  onCancel: () => void;
  onWithdrawn: (result: FinalWithdrawalView) => void;
  /** The final result changed since the row was loaded: reload it. */
  onStale?: () => void;
}): JSX.Element {
  const id = useId().replace(/:/g, "");
  const [reason, setReason] = useState("");
  const [understood, setUnderstood] = useState(false);
  const [missing, setMissing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** The revision a refused request sent; the button waits until the reloaded row shows another one. */
  const [staleRevision, setStaleRevision] = useState<number | null>(null);
  const final = row.final;
  const waiting = staleRevision !== null && final?.revision === staleRevision;
  const ready = !!final && !waiting && reason.trim() !== "" && understood;

  const confirm = async () => {
    if (busy || !final || waiting) return;
    if (!reason.trim() || !understood) { setMissing(true); return; }
    setBusy(true);
    setError(null);
    try {
      onWithdrawn(await api.withdrawFinalResult(projectKey, {
        case_id: row.case_id, language: row.language, expected_revision: final.revision, reason: reason.trim(),
      }));
    } catch (failure) {
      if (failure instanceof ApiError && failure.code === "REVISION_CONFLICT") {
        // Someone changed or withdrew the final result meanwhile: reload the row and ask again.
        setError(WITHDRAW_CHANGED);
        setStaleRevision(final.revision);
        setUnderstood(false);
        onStale?.();
      } else {
        setError(errorMessage(failure));
      }
      setBusy(false);
    }
  };

  const footer = <>
    <Button disabled={busy} onClick={onCancel}>Cancel</Button>
    <Button variant="danger" loading={busy} aria-disabled={ready ? undefined : "true"} onClick={() => { void confirm(); }}>Withdraw final result</Button>
  </>;
  return <Dialog open title={`Withdraw final result: ${row.case_id} ${row.language}`} size="md" onClose={busy ? undefined : onCancel} footer={footer}>
    <div className="withdraw-final-dialog">
      <ul aria-label="What happens" className="withdraw-final-consequences">
        {WITHDRAW_CONSEQUENCES.map(line => <li key={line}>{line}</li>)}
      </ul>
      <Textarea id={`${id}-reason`} label="Reason" required maxLength={2000} value={reason} disabled={busy}
        error={missing && !reason.trim() ? "Give a reason for withdrawing the final result." : undefined}
        onChange={event => { setReason(event.target.value); setMissing(false); }} />
      <Checkbox id={`${id}-understood`} label="I understand" checked={understood} disabled={busy}
        hint={missing && !understood ? "Tick “I understand” to withdraw." : undefined}
        onChange={event => { setUnderstood(event.target.checked); setMissing(false); }} />
      {error && <InlineMessage tone="error">{error}</InlineMessage>}
      {staleRevision !== null && !final && <p role="status">The text has no final result any more. Close this dialog.</p>}
      {staleRevision !== null && final && !waiting && <p role="status">The current final result is loaded. Tick “I understand” again to withdraw it.</p>}
    </div>
  </Dialog>;
}
