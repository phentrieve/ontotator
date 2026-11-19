/**
 * The findings the consolidator added outside every group ("Add finding"), each with its passage and values. While the
 * consolidation is editable, "Edit values…" sets assertion, experiencer and temporality with the group card's value
 * fields: a new finding starts from the project's creation defaults, which a negated finding must change. It
 * opens by itself right after "Add finding" saved. "Remove" takes a finding added by mistake out again, after a
 * confirmation next to it (issue 470).
 */
import { Fragment, useEffect, useId, useRef, useState } from "react";
import type { ConsolidationMemberView } from "../api/client";
import type { WorkspaceView } from "../app/CaseScreen";
import { Button, InlineConfirm } from "../ui";
import { AxisValue } from "../ui/AxisValue";
import { quoted } from "./consolidationText";
import { AxisFields, axisFields } from "./GroupCard";
import { passage, termLabel } from "./groupModel";

export interface AddedFindingsProps {
  heading: string;
  added: readonly ConsolidationMemberView[];
  text: string;
  /** The editor view (axis definitions); without it, or read-only, the values cannot be edited. */
  workspace?: WorkspaceView | null;
  readOnly: boolean;
  busy: boolean;
  /** The finding "Add finding" just saved: its values open for editing once the list holds it. */
  editRequest?: string | null;
  onSetValues: (annotationId: string, axes: Record<string, string | null>) => Promise<boolean>;
  /** Deletes the added finding; false when nothing changed. */
  onRemove: (annotationId: string, label: string) => Promise<boolean>;
}

function AddedItem({ finding, text, workspace, editable, removable, busy, startEditing, onSetValues, onRemove }: { finding: ConsolidationMemberView; text: string;
  workspace?: WorkspaceView | null; editable: boolean; removable: boolean; busy: boolean; startEditing: boolean;
  onSetValues: AddedFindingsProps["onSetValues"]; onRemove: AddedFindingsProps["onRemove"] }): JSX.Element {
  const label = termLabel(finding);
  const axes = axisFields(workspace, finding);
  const [editing, setEditing] = useState(false);
  const [removing, setRemoving] = useState(false);
  const removeButton = useRef<HTMLButtonElement>(null);
  const where = finding.spans.length ? quoted(passage(text, finding.spans)) : "no text span";
  const [values, setValues] = useState<Record<string, string>>({});
  const id = useId();
  const form = useRef<HTMLDivElement>(null);
  const editButton = useRef<HTMLButtonElement>(null);
  const open = (focus: boolean) => {
    setValues(Object.fromEntries(axes.map(axis => [axis.id, finding.axes[axis.id] ?? ""])));
    setEditing(true);
    if (focus) requestAnimationFrame(() => form.current?.querySelector<HTMLElement>("select")?.focus());
  };
  useEffect(() => { if (startEditing && editable) open(true); }, [startEditing]);
  const close = () => { setEditing(false); requestAnimationFrame(() => editButton.current?.focus()); };
  const save = async () => {
    if (busy) return;
    const ok = await onSetValues(finding.input_id, Object.fromEntries(axes.map(axis => [axis.id, values[axis.id] || null])));
    if (ok) close();
  };
  return <li>
    {label}, {where}
    {axes.map(axis => <Fragment key={axis.id}>, <AxisValue value={finding.axes[axis.id] ?? null} /></Fragment>)}
    {editable && !editing && !removing && <>{" "}<Button ref={editButton} size="sm" aria-label={`Edit values, ${label}`} onClick={() => open(true)}>Edit values…</Button></>}
    {removable && !editing && !removing && <>{" "}<Button ref={removeButton} size="sm" aria-label={`Remove, ${label}`} onClick={() => setRemoving(true)}>Remove</Button></>}
    {removable && removing && <InlineConfirm title="Remove this finding?" message={`${label}, ${where}. You added it; it is in no group.`} confirmLabel="Remove" tone="danger" busy={busy}
      onCancel={() => { setRemoving(false); requestAnimationFrame(() => removeButton.current?.focus()); }}
      onConfirm={() => { void onRemove(finding.input_id, label).then(ok => { if (!ok) setRemoving(false); }); }} />}
    {editable && editing && <div ref={form} className="cons-edit-values" role="group" aria-label={`Values of ${label}`}>
      <AxisFields id={id} axes={axes} values={values} onChange={(axis, value) => setValues(current => ({ ...current, [axis]: value }))} />
      <div className="cons-actions">
        <Button variant="primary" loading={busy} onClick={() => { void save(); }}>Save values</Button>
        <Button onClick={close}>Cancel</Button>
      </div>
    </div>}
  </li>;
}

export function AddedFindings({ heading, added, text, workspace, readOnly, busy, editRequest, onSetValues, onRemove }: AddedFindingsProps): JSX.Element {
  const editable = !readOnly && !!workspace;
  return <section className="cons-added-list" aria-label="Added findings">
    <h2 className="cons-subheading">{heading}</h2>
    <ul>{added.map(finding => <AddedItem key={finding.input_id} finding={finding} text={text} workspace={workspace} editable={editable} removable={!readOnly} busy={busy}
      startEditing={editRequest === finding.input_id} onSetValues={onSetValues} onRemove={onRemove} />)}</ul>
  </section>;
}
