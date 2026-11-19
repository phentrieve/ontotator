import { useEffect, useState } from "react";
import { Select } from "../ui";
import { applyTheme, chooseTheme, readTheme, THEME_CHOICES, THEME_STORAGE_KEY, type ThemeChoice } from "../ui/theme";

/**
 * The setting "Theme": System, Light or Dark, kept in this browser (issue 492). Self-contained: it reads and
 * writes the choice itself and applies it at once, so it can move into another place (a user menu) as it is.
 */
export function ThemeSetting({ id = "theme-choice" }: { id?: string }): JSX.Element {
  const [choice, setChoice] = useState<ThemeChoice>(readTheme);
  // Another tab of this browser changed the theme: follow it.
  useEffect(() => {
    const follow = (event: StorageEvent) => {
      if (event.key !== null && event.key !== THEME_STORAGE_KEY) return;
      const next = readTheme();
      applyTheme(next);
      setChoice(next);
    };
    window.addEventListener("storage", follow);
    return () => window.removeEventListener("storage", follow);
  }, []);
  return <Select id={id} label="Theme" value={choice}
    hint="System follows the light or dark setting of your device. The choice is kept in this browser."
    onChange={(event) => { const next = event.target.value as ThemeChoice; chooseTheme(next); setChoice(next); }}>
    {THEME_CHOICES.map(({ value, label }) => <option key={value} value={value}>{label}</option>)}
  </Select>;
}
