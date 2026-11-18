/** Summary before submitting the consolidation (X12, T10): the decisions and terms kept twice, then "Submit". When the
 *  server answers with advisory warnings (values by default, modifiers, #57), they are listed in the same dialog and only
 *  "Submit with N warnings" acknowledges them. A modifier term kept as a finding is named with its group and a way to
 *  jump there, already before the first Submit where the view knows it (issue 470). */
import { errorMessage } from "../admin/errors";
import { Button, Dialog, InlineMessage } from "../ui";
import { nextStepText } from "./consolidationText";
import type { ModifierFinding } from "./groupModel";
import type { AxisWarning } from "./useConsolidation";

export interface SummaryDialogProps {
  open: boolean;
  /** The consolidator leads the project and accepts the result themselves (issue 143). */
  lead?: boolean;
  /** A practice task (issue 266): nobody accepts the result. */
  practice?: boolean;
  summary: string;
  /** R-3: terms the result holds more than once ("More than one finding with the same term: Fatigue."). */
  duplicates?: string | null;
  busy: boolean;
  warning: AxisWarning | null;
  error: unknown;
  /** The findings whose term is a modifier term: before the first Submit those the view knows, then the server's. */
  modifierFindings?: readonly ModifierFinding[];
  /** Closes the dialog and shows the group ("Go to group"). */
  onShowGroup?: (groupId: string) => void;
  /** `acknowledged`: the second click, after the warnings were shown. */
  onSubmit: (acknowledged: boolean) => void;
  onClose: () => void;
}

const findings = (count: number) => count === 1 ? "1 finding has" : `${count} findings have`;

export const asFindingLine = (count: number) => `${count === 1 ? "1 finding uses" : `${count} findings use`} a modifier term (such as Severe) as the finding itself.`;

/** The warning lines in plain words; "Some findings have values filled in by default." when the server counts none. */
export function warningLines(warning: AxisWarning): string[] {
  return [
    warning.count > 0 || (!warning.modifiers && !warning.asFinding) ? `${warning.count ? findings(warning.count) : "Some findings have"} values filled in by default, not chosen.` : null,
    warning.asFinding > 0 ? asFindingLine(warning.asFinding) : null,
    warning.modifiers > 0 ? `${findings(warning.modifiers)} a modifier warning: a cohort term, or two of one kind.` : null,
  ].filter((line): line is string => line !== null);
}

export function SummaryDialog({ open, lead = false, practice = false, summary, duplicates, busy, warning, error, modifierFindings = [], onShowGroup, onSubmit, onClose }: SummaryDialogProps): JSX.Element {
  const lines = warning ? warningLines(warning) : [];
  // "1 finding uses a modifier term (such as Severe) as the finding itself: Neonatal onset “since birth” [Go to group]".
  const named = (line: string) => !modifierFindings.length ? line : <>
    {line.replace(/\.$/, ":")}
    <ul className="cons-warning-findings">{modifierFindings.map(finding => <li key={`${finding.groupId} ${finding.label}`}>
      {finding.label}{finding.groupId !== null && onShowGroup && <>{" "}
        <Button size="sm" aria-label={`Go to group, ${finding.label}`} aria-disabled={busy || undefined} onClick={() => { if (!busy) onShowGroup(finding.groupId!); }}>Go to group</Button></>}
    </li>)}</ul>
  </>;
  return <Dialog open={open} title="Submit consolidation?" onClose={busy ? undefined : onClose} footer={<>
    <Button onClick={() => { if (!busy) onClose(); }} aria-disabled={busy || undefined}>Back</Button>
    <Button variant="primary" loading={busy} onClick={() => onSubmit(!!warning)}>
      {warning ? `Submit with ${lines.length} ${lines.length === 1 ? "warning" : "warnings"}` : "Submit"}</Button>
  </>}>
    {!practice && <p>{nextStepText(lead)}</p>}
    <p className="cons-summary">{summary}</p>
    {duplicates && <InlineMessage tone="warning">{duplicates}</InlineMessage>}
    {!warning && modifierFindings.length > 0 && <InlineMessage tone="warning">{named(asFindingLine(modifierFindings.length))}</InlineMessage>}
    {warning && <InlineMessage tone="warning" title="Check before you submit">
      <ul className="cons-warning-list">{lines.map(line => <li key={line}>{warning.asFinding > 0 && line === asFindingLine(warning.asFinding) ? named(line) : line}</li>)}</ul>
    </InlineMessage>}
    {!!error && <InlineMessage tone="error">{errorMessage(error)}</InlineMessage>}
  </Dialog>;
}
