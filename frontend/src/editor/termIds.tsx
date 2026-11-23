import { createContext, useContext, useMemo, type ReactNode } from "react";

/**
 * How a term id is shown. With the project setting "Show codes without the ontology prefix"
 * (`hide_term_id_prefix`), a project with a single ontology shows its codes without the
 * prefix: `N18.1`, not `ICD10CM:N18.1`. The prefix says which ontology a code is from, and
 * with one ontology that is clear from the project. An ontology's id is its id prefix in
 * lower case (`icd10cm` for `ICD10CM:`, see ontology/registry.py), so only that prefix is
 * dropped; an id with any other prefix is shown in full. Stored and exported ids, links,
 * keys and the search stay the full id: this is display only.
 */
export function shortTermId(termId: string, ontologyIds: readonly string[]): string {
  if (ontologyIds.length !== 1) return termId;
  const colon = termId.indexOf(":");
  if (colon <= 0 || colon === termId.length - 1) return termId;
  return termId.slice(0, colon).toLowerCase() === ontologyIds[0].toLowerCase() ? termId.slice(colon + 1) : termId;
}

const FULL = (termId: string) => termId;
const TermIdDisplay = createContext<(termId: string) => string>(FULL);

/** The project's ontologies when the setting is on, else none: ids below are shown in full without it. */
export function TermIdsProvider({ ontologyIds, children }: { ontologyIds: readonly string[]; children: ReactNode }) {
  const key = ontologyIds.join("\n");
  const show = useMemo(() => {
    const ids = key ? key.split("\n") : [];
    return (termId: string) => shortTermId(termId, ids);
  }, [key]);
  return <TermIdDisplay.Provider value={show}>{children}</TermIdDisplay.Provider>;
}

/** The function that turns a term id into the text shown for it. */
export function useTermIdDisplay(): (termId: string) => string {
  return useContext(TermIdDisplay);
}
