import { useId } from "react";
import type { ProjectSettings } from "../api/client";
import { SettingsCard } from "../admin/SettingsCard";
import { Checkbox } from "../ui";

/** Settings › Workflow › Single-term review: the switch. */
export interface SingleTermDraft { single_term_review: boolean }

export const singleTermOf = (settings: ProjectSettings): SingleTermDraft => ({ single_term_review: settings.single_term_review ?? false });

export function SingleTermSettingsCard({ value, onChange, disabled }: {
  value: SingleTermDraft; onChange: (value: SingleTermDraft) => void; disabled?: boolean;
}): JSX.Element {
  const prefix = useId().replace(/:/g, "");
  return <SettingsCard title="Single-term review" hint="Off by default. Not in practice projects."
    why={<><p>Once final results are accepted, each phrase with its annotated term is reviewed alone, without its sentence. Leads hand out review batches to any project member.</p><p>Turning the review off hides it; stored decisions stay.</p></>}>
    <Checkbox id={`${prefix}-single-term`} label="Review single terms of the final results" hint="Adds “Single terms” to the project navigation."
      checked={value.single_term_review} disabled={disabled} onChange={event => onChange({ single_term_review: event.target.checked })} />
  </SettingsCard>;
}
