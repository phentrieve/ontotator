import { useEffect, useRef } from "react";
import { TextInput } from "../ui";

/** The longest link template the server takes (ontology/links.py). */
export const LINK_TEMPLATE_MAX_LENGTH = 500;
const PLACEHOLDERS = ["{code}", "{id}"];

/**
 * Why a link template for term codes cannot be saved, or null when it can; the server checks the same
 * (ontology/links.py `link_template_problem`). Empty means no template: the default link stays.
 */
export function linkTemplateProblem(template: string): string | null {
  if (!template) return null;
  if (template.length > LINK_TEMPLATE_MAX_LENGTH) return `Use at most ${LINK_TEMPLATE_MAX_LENGTH} characters.`;
  if (/\s/.test(template)) return "Remove the blanks.";
  // The host is fixed: a placeholder there could send the link anywhere.
  const authority = template.slice("https://".length).split(/[/?#]/, 1)[0] ?? "";
  let host = "";
  try { host = new URL(template).hostname; } catch { /* no address */ }
  if (!template.startsWith("https://")) return "Use an https:// address.";
  // Issue 634: an https address with a placeholder in the host names that rule, not the https one.
  if (/[{}]/.test(authority)) return "Put {code} or {id} after the host, not in it.";
  if (!host) return "Use an https:// address.";
  if ((template.match(/\{[^{}]*\}|[{}]/g) ?? []).some(brace => !PLACEHOLDERS.includes(brace))) return "Use only {code} and {id} in braces.";
  if (!PLACEHOLDERS.some(placeholder => template.includes(placeholder))) return "Put {code} or {id} where the code goes.";
  return null;
}

/** One ontology's link template in the card Term codes; a problem blocks Save through the form's own check. */
export function TermLinkField({ ontologyId, label, value, onChange }: {
  ontologyId: string;
  /** The ontology's name, e.g. "ICD-10-CM". */
  label: string;
  value: string;
  onChange: (value: string) => void;
}): JSX.Element {
  const input = useRef<HTMLInputElement>(null);
  const problem = linkTemplateProblem(value.trim());
  useEffect(() => { input.current?.setCustomValidity(problem ?? ""); }, [problem]);
  return <TextInput ref={input} id={`project-term-link-${ontologyId}`} label={`Code link for ${label}`} type="text" inputMode="url"
    spellCheck={false} autoComplete="off" maxLength={LINK_TEMPLATE_MAX_LENGTH} placeholder="https://example.org/search?q={code}"
    hint="Empty: the default link. {code} is the code without the prefix, {id} the full code."
    error={problem ?? undefined} value={value} onChange={event => onChange(event.target.value)} />;
}
