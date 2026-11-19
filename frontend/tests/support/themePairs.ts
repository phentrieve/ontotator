/**
 * The colour tokens that are used together, in one place: frontend/tests/themeTokens.test.ts checks every
 * pair in the light and in the dark theme. A pair is [foreground, background, where it is used]. Add a
 * pair here when a stylesheet puts a token on a background it was not on before.
 */
export type Pair = [foreground: string, background: string, where: string];

const SURFACES = ["--surface", "--surface-raised", "--surface-sunken"];
/** The tinted fills of states, notices and badges: body text and hints sit on them. */
const TINTS = [
  "--accent-light", "--success-light", "--warning-light", "--danger-light",
  "--notice-warning-fill", "--notice-info-fill", "--review-badge-fill", "--obsolete-fill",
];
export const MARK_FILLS = [0, 1, 2, 3, 4, 5].map((slot) => `--mark-${slot}-fill`);
const STATES = ["--accent", "--success", "--warning", "--danger"];

const cross = (foregrounds: string[], backgrounds: string[], where: string): Pair[] =>
  foregrounds.flatMap((foreground) => backgrounds.map((background) => [foreground, background, where] as Pair));

/** Text: WCAG AA, 4.5:1. */
export const TEXT_PAIRS: Pair[] = [
  ...cross(["--text", "--text-muted"], SURFACES, "body text, hints, table cells, bars"),
  ...cross(["--text", "--text-muted"], TINTS, "text and hints inside notices, selected rows, badges, chosen cells"),
  ...cross(["--text"], MARK_FILLS, "the annotated text under a mark"),
  ...cross(STATES, ["--surface", "--surface-raised", "--surface-sunken"], "links, status words, stage cells, counts"),
  ...cross(["--accent-hover", "--danger-hover"], ["--surface", "--surface-raised"], "hovered links and danger links"),
  ["--accent", "--accent-light", "badges, the current step, selected rows"],
  ["--success", "--success-light", "Show changes: added; done states"],
  ["--warning", "--warning-light", "saving, paused, over the limit"],
  ["--danger", "--danger-light", "Show changes: removed; errors; danger buttons"],
  ["--danger", "--danger-hover-fill", "hovered danger button"],
  ["--on-accent", "--accent", "primary button, chosen value, checked checkbox"],
  ["--on-accent", "--accent-hover", "hovered primary button"],
  ["--on-accent", "--success", "pressed decision: confirmed"],
  ["--on-accent", "--danger", "solid danger button, pressed decision: rejected"],
  ["--on-accent", "--danger-hover", "hovered solid danger button"],
  ["--on-accent", "--warning", "emphasised tab count, pressed decision: uncertain"],
  ["--on-accent", "--text", "toast"],
  ["--on-accent", "--text-muted", "hovered toast button"],
  ["--border", "--text", "note in a toast"],
  ["--on-accent", "--assistant-gradient-start", "assistant badge"],
  ["--on-accent", "--assistant-gradient-end", "assistant badge"],
  ["--review-badge-text", "--review-badge-fill", "review badge, axis value: family"],
  ["--notice-success-text", "--success-light", "success notice"],
  ["--notice-warning-text", "--notice-warning-fill", "warning notice, axis value: future"],
  ["--notice-info-text", "--notice-info-fill", "information notice, axis value: current"],
  ["--text-muted", "--surface-sunken", "disabled fields, axis values: other, historical"],
];

/** Lines and marks that carry meaning without text: WCAG 1.4.11, 3:1. */
export const GRAPHIC_PAIRS: Pair[] = [
  ...cross(["--focus-ring", "--border-strong"], SURFACES, "focus rings and the borders of controls"),
  ...cross(["--focus-ring"], [...TINTS.slice(0, 4), ...MARK_FILLS], "focus ring on selected rows, notices and marks"),
  ...cross(["--mark-line", "--mark-selected"], ["--surface-raised", ...MARK_FILLS], "the line of a mark, the frame of the selected mark"),
  ...cross(["--mark-negated-hatch"], ["--surface-raised"], "the hatch of an excluded finding"),
  ...cross(["--accent", "--warning", "--success", "--mark-line"], ["--surface-raised", "--surface-sunken"], "person lanes in the consolidation text"),
  ["--success", "--success-light", "Show changes: the underline of added text"],
  ["--danger", "--danger-light", "Show changes: the line through removed text"],
];

/** A tint must be told from the surface it lies on (paused, over the limit, warnings, selected rows): CIEDE2000. */
export const TINT_ON_SURFACE: Pair[] = cross(
  ["--accent-light", "--success-light", "--warning-light", "--danger-light", "--notice-warning-fill", "--notice-info-fill", "--review-badge-fill"],
  ["--surface", "--surface-raised"],
  "states that differ from their surroundings by a tint",
);
