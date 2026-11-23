import { useTermIdDisplay } from "./termIds";

/**
 * The ontology's primary labels are English (translations only add search names, see
 * ontology/translations.py), so a label is marked up as English whatever the text's
 * language; `hyphens: auto` on `.term-name` then breaks a long label at a syllable, not
 * mid-word. A caller that shows a label in another language passes its `lang`.
 */
export const TERM_LABEL_LANGUAGE = "en";

export function TermName({ termId, label, lang = TERM_LABEL_LANGUAGE }: { termId: string; label?: string | null; lang?: string }) {
  const shown = useTermIdDisplay()(termId);
  return (
    <span className="term-name">
      <span lang={label ? lang : undefined}>{label || shown}</span>
      {label && <small title={shown === termId ? undefined : termId}>{shown}</small>}
    </span>
  );
}
