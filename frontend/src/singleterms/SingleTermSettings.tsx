import { useId } from "react";
import type { ProjectSettings } from "../api/client";
import { SettingsCard } from "../admin/SettingsCard";
import { Checkbox, Textarea } from "../ui";
import { languageLabel } from "./labels";

/** Settings › Workflow › Single-term review: the switch and the negation cues per language (one per line). */
export interface SingleTermDraft { single_term_review: boolean; cues: Record<string, string> }

/** "kein\n nicht, ohne" → ["kein", "nicht", "ohne"]; the server trims, deduplicates and sorts again. */
export const parseCues = (text: string): string[] => [...new Set(text.split(/[\n,]+/).map(cue => cue.trim()).filter(Boolean))];

/** Languages with a cue field: the project's languages, then any language that already has cues. */
export const cueLanguages = (settings: Pick<ProjectSettings, "languages" | "single_term_negation_cues">): string[] =>
  [...new Set([...(settings.languages ?? []), ...Object.keys(settings.single_term_negation_cues ?? {})])];

export const singleTermOf = (settings: ProjectSettings): SingleTermDraft => ({
  single_term_review: settings.single_term_review ?? false,
  cues: Object.fromEntries(cueLanguages(settings).map(language => [language, (settings.single_term_negation_cues?.[language] ?? []).join("\n")])),
});

/** The change to send: languages without cues are left out. */
export const singleTermPatch = (draft: SingleTermDraft): { single_term_review: boolean; single_term_negation_cues: Record<string, string[]> } => ({
  single_term_review: draft.single_term_review,
  single_term_negation_cues: Object.fromEntries(Object.entries(draft.cues).map(([language, text]) => [language, parseCues(text)] as const).filter(([, cues]) => cues.length)),
});

/** Equal when they send the same change (whitespace and order of typing aside). */
export const singleTermDirty = (draft: SingleTermDraft, saved: SingleTermDraft): boolean =>
  JSON.stringify(singleTermPatch(draft)) !== JSON.stringify(singleTermPatch(saved));

export function SingleTermSettingsCard({ value, languages, onChange, disabled }: {
  value: SingleTermDraft; languages: readonly string[]; onChange: (value: SingleTermDraft) => void; disabled?: boolean;
}): JSX.Element {
  const prefix = useId().replace(/:/g, "");
  return <SettingsCard title="Single-term review" hint="Off by default. Not in practice projects."
    why={<><p>After the final results are accepted, leads freeze them as a review basis. Each phrase with its annotated term is then reviewed alone, without its sentence, by single-term reviewers (Settings › People).</p><p>A phrase holding one of the negation cues of its language (a whole word, any case) is blocked: it can only be re-cut or rejected. Turning the review off hides it; stored decisions stay.</p></>}>
    <Checkbox id={`${prefix}-single-term`} label="Review single terms of the final results" hint="Adds “Single terms” to the project navigation."
      checked={value.single_term_review} disabled={disabled} onChange={event => onChange({ ...value, single_term_review: event.target.checked })} />
    {languages.length ? <div className="settings-card-row">
      {languages.map(language => <Textarea key={language} id={`${prefix}-cues-${language}`} label={`Negation cues, ${languageLabel(language)}`} hint="One cue per line." rows={Math.max(3, (value.cues[language] ?? "").split("\n").length + 1)}
        value={value.cues[language] ?? ""} disabled={disabled} onChange={event => onChange({ ...value, cues: { ...value.cues, [language]: event.target.value } })} />)}
    </div> : <p className="field-hint">Add the project's languages under General to list negation cues.</p>}
  </SettingsCard>;
}
