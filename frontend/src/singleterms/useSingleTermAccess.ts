import { useEffect, useState } from "react";
import { api } from "../api/client";

/** Fired after the project's single-term setting or reviewer grants change: the navigation looks again. */
export const SINGLE_TERMS_CHANGED = "ontotator:single-terms-changed";
export const notifySingleTermsChanged = (): void => { window.dispatchEvent(new Event(SINGLE_TERMS_CHANGED)); };

/**
 * Whether the "Single terms" entry shows for this project: the setting is on and the user is a lead or a
 * granted single-term reviewer. The batch list answers both (409 while the setting is off, 403 for others);
 * any failure hides the entry, the page itself reports errors.
 */
export function useSingleTermAccess(projectKey: string | undefined): boolean {
  const [state, setState] = useState<{ key: string; available: boolean } | null>(null);
  const [generation, setGeneration] = useState(0);
  useEffect(() => {
    const again = () => setGeneration(value => value + 1);
    window.addEventListener(SINGLE_TERMS_CHANGED, again);
    return () => window.removeEventListener(SINGLE_TERMS_CHANGED, again);
  }, []);
  useEffect(() => {
    if (!projectKey) return;
    let active = true;
    let request: Promise<unknown>;
    try { request = api.listSingleTermBatches(projectKey); } catch { return; }
    // A stubbed client may answer anything: only a list means access.
    Promise.resolve(request).then(
      value => { if (active) setState({ key: projectKey, available: Array.isArray(value) }); },
      () => { if (active) setState({ key: projectKey, available: false }); },
    );
    return () => { active = false; };
  }, [projectKey, generation]);
  return !!projectKey && state?.key === projectKey && state.available;
}
