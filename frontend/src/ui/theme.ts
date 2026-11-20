import { useEffect, useState } from "react";

/**
 * The theme of this browser (issue 492): "system" follows prefers-color-scheme (styles/tokens.css), "light"
 * and "dark" set `data-theme` on the root element, which wins over the system. The choice is kept per
 * browser, not per account: the login page follows it too. public/theme.js applies it before the first paint.
 */
export type ThemeChoice = "system" | "light" | "dark";

export const THEME_STORAGE_KEY = "ontotator.theme.v1";
export const THEME_CHOICES: ReadonlyArray<{ value: ThemeChoice; label: string }> = [
  { value: "system", label: "System" },
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
];

/** Sent on `window` after `chooseTheme`: every theme control of this tab (user menu, Profile) shows the new choice. */
export const THEME_CHANGED = "ontotator:theme-changed";

/** The stored choice; "system" when nothing (or nothing valid) is stored or storage is blocked. */
export function readTheme(): ThemeChoice {
  try {
    const stored = window.localStorage.getItem(THEME_STORAGE_KEY);
    return stored === "light" || stored === "dark" ? stored : "system";
  } catch {
    return "system";
  }
}

/** Show ``choice`` now, without storing it. */
export function applyTheme(choice: ThemeChoice): void {
  const root = document.documentElement;
  if (choice === "system") root.removeAttribute("data-theme");
  else root.setAttribute("data-theme", choice);
}

/** Show and remember ``choice``. Without storage the choice still holds until the page is reloaded. */
export function chooseTheme(choice: ThemeChoice): void {
  applyTheme(choice);
  try {
    if (choice === "system") window.localStorage.removeItem(THEME_STORAGE_KEY);
    else window.localStorage.setItem(THEME_STORAGE_KEY, choice);
  } catch {
    // Storage is blocked: nothing to remember.
  }
  window.dispatchEvent(new CustomEvent<ThemeChoice>(THEME_CHANGED, { detail: choice }));
}

/** The current choice, following the other theme controls of this tab and other tabs of this browser. */
export function useThemeChoice(): ThemeChoice {
  const [choice, setChoice] = useState<ThemeChoice>(readTheme);
  useEffect(() => {
    const followTab = (event: Event) => setChoice((event as CustomEvent<ThemeChoice>).detail);
    const followBrowser = (event: StorageEvent) => {
      if (event.key !== null && event.key !== THEME_STORAGE_KEY) return;
      const next = readTheme();
      applyTheme(next);
      setChoice(next);
    };
    window.addEventListener(THEME_CHANGED, followTab);
    window.addEventListener("storage", followBrowser);
    return () => { window.removeEventListener(THEME_CHANGED, followTab); window.removeEventListener("storage", followBrowser); };
  }, []);
  return choice;
}
