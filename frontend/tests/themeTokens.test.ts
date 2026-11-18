// @vitest-environment node
/**
 * Light and dark theme (issue 492): the dark values are complete, the two dark blocks agree, and the colours
 * used together (tests/support/themePairs.ts) keep WCAG AA contrast in both themes.
 */
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { contrast, declarations, deltaE2000, hexTokens, parseColourTokens, ruleBody, simulate, type Deficiency } from "./support/colour";
import { GRAPHIC_PAIRS, MARK_FILLS, TEXT_PAIRS, TINT_ON_SURFACE, type Pair } from "./support/themePairs";

const here = dirname(fileURLToPath(import.meta.url));
const css = readFileSync(resolve(here, "../src/styles/tokens.css"), "utf8");
const lightAll = declarations(ruleBody(css, ":root"));
const light = parseColourTokens(css);
const darkChosen = declarations(ruleBody(css, ':root[data-theme="dark"]'));
const darkSystem = declarations(ruleBody(css, ':root:not([data-theme="light"])'));
const THEMES: Array<[string, Record<string, string>]> = [["light", light], ["dark", { ...light, ...hexTokens(darkChosen) }]];
const DEFICIENCIES: Deficiency[] = ["protan", "deutan", "tritan"];

const isColour = (value: string) => /^(?:#|rgba?\(|url\(|0 )/.test(value);

function failing(tokens: Record<string, string>, pairs: Pair[], measure: (a: string, b: string) => number, floor: number): string[] {
  return pairs.flatMap(([a, b, where]) => {
    for (const name of [a, b]) if (!tokens[name]) throw new Error(`Missing colour token ${name}`);
    const value = measure(tokens[a], tokens[b]);
    return value < floor ? [`${a} on ${b}: ${value.toFixed(2)} (${where})`] : [];
  });
}
const pairsOf = (items: string[]): Pair[] => items.flatMap((a, index) => items.slice(index + 1).map((b) => [a, b, "mark fills"] as Pair));

describe("theme tokens", () => {
  it("the_system_and_the_chosen_dark_block_are_equal", () => {
    expect(darkSystem).toEqual(darkChosen);
    expect(Object.keys(darkSystem)).toEqual(Object.keys(darkChosen));
  });

  it("the_system_block_yields_to_an_explicit_choice", () => {
    const plain = css.replace(/\/\*[\s\S]*?\*\//g, "");
    expect(plain).toMatch(/@media \(prefers-color-scheme: dark\) \{\s*:root:not\(\[data-theme="light"\]\) \{/);
    expect(ruleBody(css, ":root")).toMatch(/(?:^|\s)color-scheme: light dark;/);
    expect(ruleBody(css, ':root[data-theme="dark"]')).toMatch(/(?:^|\s)color-scheme: dark;/);
    expect(ruleBody(css, ':root:not([data-theme="light"])')).toMatch(/(?:^|\s)color-scheme: dark;/);
    expect(ruleBody(css, ':root[data-theme="light"]')).toMatch(/(?:^|\s)color-scheme: light;/);
  });

  it("every_light_colour_has_a_dark_value", () => {
    // Aliases (var(--…)) follow their target; sizes, fonts and spacing do not depend on the theme.
    const colours = Object.entries(lightAll).filter(([, value]) => isColour(value)).map(([name]) => name);
    expect(colours.length).toBeGreaterThan(50);
    expect(colours.filter((name) => !(name in darkChosen))).toEqual([]);
    // And nothing in the dark block that the light theme does not know.
    expect(Object.keys(darkChosen).filter((name) => !(name in lightAll))).toEqual([]);
    // A dark value has the kind of its light value (a hex stays a hex: the contrast checks read hex values).
    const kind = (value: string) => /^#[0-9a-fA-F]{6}$/.test(value) ? "hex" : value.replace(/[^a-z].*$/i, "");
    expect(Object.keys(darkChosen).filter((name) => kind(darkChosen[name]) !== kind(lightAll[name]))).toEqual([]);
  });

  describe.each(THEMES)("%s", (_name, tokens) => {
    it("text_pairs_meet_aa", () => {
      expect(failing(tokens, TEXT_PAIRS, contrast, 4.5)).toEqual([]);
    });

    it("lines_and_marks_meet_three_to_one", () => {
      expect(failing(tokens, GRAPHIC_PAIRS, contrast, 3)).toEqual([]);
    });

    it("tints_differ_from_the_surface_they_lie_on", () => {
      expect(failing(tokens, TINT_ON_SURFACE, deltaE2000, 5)).toEqual([]);
    });

    it("mark_fills_are_distinct", () => {
      // The floors of tokens.test.ts (mark_fills_are_distinct_…), for this theme.
      expect(failing(tokens, pairsOf(MARK_FILLS), deltaE2000, 10)).toEqual([]);
      expect(failing(tokens, MARK_FILLS.map((fill) => [fill, "--surface-raised", "a mark on the sheet"] as Pair), deltaE2000, 10)).toEqual([]);
      for (const d of DEFICIENCIES) {
        const simulated = (a: string, b: string) => deltaE2000(simulate(a, d), simulate(b, d));
        expect(failing(tokens, pairsOf(MARK_FILLS), simulated, 4), d).toEqual([]);
      }
    });

    it("the_first_two_person_lanes_stay_apart", () => {
      expect(deltaE2000(tokens["--accent"], tokens["--warning"])).toBeGreaterThan(20);
      for (const d of DEFICIENCIES) {
        expect(deltaE2000(simulate(tokens["--accent"], d), simulate(tokens["--warning"], d)), d).toBeGreaterThan(10);
      }
    });
  });
});
