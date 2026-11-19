import { Select } from "../ui";
import { chooseTheme, THEME_CHOICES, useThemeChoice, type ThemeChoice } from "../ui/theme";

/**
 * The setting "Theme": System, Light or Dark, kept in this browser (issue 492). It applies the choice at once
 * and follows the same choice made in the user menu.
 */
export function ThemeSetting({ id = "theme-choice" }: { id?: string }): JSX.Element {
  const choice = useThemeChoice();
  return <Select id={id} label="Theme" value={choice}
    hint="System follows the light or dark setting of your device. The choice is kept in this browser."
    onChange={(event) => chooseTheme(event.target.value as ThemeChoice)}>
    {THEME_CHOICES.map(({ value, label }) => <option key={value} value={value}>{label}</option>)}
  </Select>;
}
