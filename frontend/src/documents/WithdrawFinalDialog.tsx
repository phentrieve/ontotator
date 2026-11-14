/**
 * "Withdraw final…" (issue 343): takes a text's final result back. The dialog lists what follows, asks for a Reason
 * and an "I understand" tick; the danger button "Withdraw final result" sends the final's revision, so a final that
 * changed meanwhile is refused instead of withdrawn.
 */
import { useId, useState } from "react";
import { api, type DocumentRowView, type FinalWithdrawalView } from "../api/client";
import { errorMessage } from "../admin/errors";
import { Button, Checkbox, Dialog, InlineMessage, Textarea } from "../ui";

/** What withdrawing changes, in the dialog's words. */
export const WITHDRAW_CONSEQUENCES = [
  "The text has no final result until you choose one again.",
  "Final exports already made stay as they are.",
  "Change mode… is possible again.",
  "Submissions and consolidation stay.",
] as const;

export function WithdrawFinalDialog({ projectKey, row, onCancel, onWithdrawn }: {
  projectKey: string;
  row: Pick<DocumentRowView, "case_id" | "language" | "final">;
  onCancel: () => void;
  onWithdrawn: (result: FinalWithdrawalView) => void;
}): JSX.Element {
  const id = useId().replace(/:/g, "");
  const [reason, setReason] = useState("");
  const [understood, setUnderstood] = useState(false);
  const [missing, setMissing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const final = row.final;
  const ready = !!final && reason.trim() !== "" && understood;

  const confirm = async () => {
    if (busy || !final) return;
    if (!reason.trim() || !understood) { setMissing(true); return; }
    setBusy(true);
    setError(null);
    try {
      onWithdrawn(await api.withdrawFinalResult(projectKey, {
        case_id: row.case_id, language: row.language, expected_revision: final.revision, reason: reason.trim(),
      }));
    } catch (failure) {
      setError(errorMessage(failure));
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
    </div>
  </Dialog>;
}
