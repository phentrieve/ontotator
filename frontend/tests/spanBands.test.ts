/**
 * Overlapping marks (issue 524): a piece of text that belongs to marks of several colours gets one band per
 * colour, in an order that follows the marks' start; the colours come from one colouring of the whole text.
 */
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mountSpanEditor, type MentionDisplay } from "../src/spans/adapter";
import { bandClasses, MAX_BANDS } from "../src/vendor/spans.js";

const here = dirname(fileURLToPath(import.meta.url));

const OEDEMA = "periorbital and facial oedema";
// Both terms prefer slot 2: the text moves the later one, so the two findings never share a colour.
const PERIORBITAL: MentionDisplay = { evidence_id: "ev-periorbital", kind: "own", colorIndex: 2, colourKey: "term:A",
  segments: [{ start: 0, end: 11 }, { start: 23, end: 29 }] };
const FACIAL: MentionDisplay = { evidence_id: "ev-facial", kind: "own", colorIndex: 2, colourKey: "term:B",
  segments: [{ start: 16, end: 29 }] };

const classesOf = (node: Element) => [...node.classList].filter((name) => /^run--(?:color|band|bands)-/.test(name)).sort();

describe("bands of overlapping marks", () => {
  let container: HTMLDivElement;
  beforeEach(() => { container = document.createElement("div"); document.body.appendChild(container); });
  afterEach(() => container.remove());

  const runs = () => Object.fromEntries([...container.querySelectorAll<HTMLElement>(".run")]
    .filter((node) => node.textContent!.trim()).map((node) => [node.textContent, node]));

  it("the_example_of_the_issue_shows_two_colours_and_two_bands", () => {
    const handle = mountSpanEditor(container, OEDEMA, [PERIORBITAL, FACIAL], vi.fn(), vi.fn());
    const pieces = runs();
    expect(classesOf(pieces.periorbital)).toEqual(["run--color-2"]);
    expect(classesOf(pieces["facial "])).toEqual(["run--color-3"]);
    // "oedema" belongs to both: Periorbital oedema starts first, so it is band 0 (the bottom band).
    expect(classesOf(pieces.oedema)).toEqual(["run--band-0-2", "run--band-1-3", "run--bands-2", "run--color-2"]);
    expect(pieces.oedema.classList.contains("run--multi")).toBe(true);
    expect(pieces.oedema.dataset.mentions!.split(",").sort()).toEqual(["ev-facial", "ev-periorbital"]);
    handle.destroy();
  });

  it("a_mark_keeps_its_band_in_every_piece_and_selection_does_not_reorder", () => {
    const text = "aaa bbb ccc ddd";
    const a: MentionDisplay = { evidence_id: "z-a", colorIndex: 0, colourKey: "term:A", segments: [{ start: 0, end: 11 }] };
    const b: MentionDisplay = { evidence_id: "a-b", colorIndex: 1, colourKey: "term:B", segments: [{ start: 4, end: 15 }] };
    const c: MentionDisplay = { evidence_id: "m-c", colorIndex: 2, colourKey: "term:C", segments: [{ start: 8, end: 11 }] };
    const handle = mountSpanEditor(container, text, [c, b, a], vi.fn(), vi.fn());
    const check = () => {
      const pieces = runs();
      expect(classesOf(pieces["aaa "])).toEqual(["run--color-0"]);
      expect(classesOf(pieces["bbb "])).toEqual(["run--band-0-0", "run--band-1-1", "run--bands-2", "run--color-0"]);
      expect(classesOf(pieces.ccc)).toEqual(["run--band-0-0", "run--band-1-1", "run--band-2-2", "run--bands-3", "run--color-0"]);
      expect(classesOf(pieces[" ddd"])).toEqual(["run--color-1"]);
    };
    check();
    handle.setSelected("m-c");
    check();
    expect(runs().ccc.classList.contains("run--hot")).toBe(true);
    handle.destroy();
  });

  it("negated_modifier_and_line_styles_stay_on_banded_runs", () => {
    const text = "schwere Krampfanfälle";
    const finding: MentionDisplay = { evidence_id: "ev", kind: "own", colorIndex: 0, colourKey: "term:A", negated: true,
      segments: [{ start: 0, end: 21 }] };
    const source: MentionDisplay = { evidence_id: "src", kind: "source", colorIndex: 0, colourKey: "term:B",
      segments: [{ start: 8, end: 21 }] };
    const modifier: MentionDisplay = { evidence_id: "mod:ann:HP:1", kind: "modifier", colorIndex: 0, colourKey: "term:A",
      segments: [{ start: 0, end: 7 }] };
    const handle = mountSpanEditor(container, text, [finding, source, modifier], vi.fn(), vi.fn());
    handle.setFramed(["ev"]);
    const pieces = runs();
    // The modifier shares its finding's key: one colour, no band of its own.
    expect(classesOf(pieces.schwere)).toEqual(["run--color-0"]);
    expect(pieces.schwere.classList.contains("run--modifier")).toBe(true);
    const shared = pieces["Krampfanfälle"];
    expect(classesOf(shared)).toEqual(["run--band-0-0", "run--band-1-1", "run--bands-2", "run--color-0"]);
    for (const name of ["run--negated", "run--own", "run--source", "run--framed"]) expect(shared.classList.contains(name), name).toBe(true);
    handle.destroy();
  });
});

describe("bandClasses", () => {
  const m = (id: string, colorIndex?: number) => ({ mention_id: id, colorIndex });

  it("one_colour_is_a_plain_fill_and_marks_of_one_slot_share_a_band", () => {
    expect(bandClasses([])).toEqual([]);
    expect(bandClasses([m("pending")])).toEqual([]);
    expect(bandClasses([m("a", 4), m("b", 4), m("pending")])).toEqual(["run--color-4"]);
  });

  it("orders_bands_by_the_start_of_the_marks_then_by_id", () => {
    const starts = new Map([["late", 9], ["early", 2], ["b", 5], ["a", 5]]);
    expect(bandClasses([m("late", 1), m("early", 5)], starts)).toEqual(["run--color-5", "run--bands-2", "run--band-0-5", "run--band-1-1"]);
    expect(bandClasses([m("b", 3), m("a", 0)], starts)).toEqual(["run--color-0", "run--bands-2", "run--band-0-0", "run--band-1-3"]);
  });

  it("from_the_fourth_colour_on_the_top_band_is_striped", () => {
    expect(MAX_BANDS).toBe(3);
    const many = ["a", "b", "c", "d", "e"].map((id, slot) => m(id, slot));
    expect(bandClasses(many)).toEqual(["run--color-0", "run--bands-more", "run--band-0-0", "run--band-1-1", "run--band-2-2", "run--band-3-3"]);
  });
});

describe("band styles", () => {
  const css = readFileSync(resolve(here, "../src/styles/screens/editor.css"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
  const rule = (selector: string): string => {
    const at = css.indexOf(`${selector} {`);
    if (at < 0) throw new Error(`Missing rule ${selector}`);
    return css.slice(at, css.indexOf("}", at));
  };

  it("binds_every_band_and_slot_to_its_palette_token", () => {
    for (let band = 0; band <= MAX_BANDS; band++) {
      for (let slot = 0; slot < 6; slot++) {
        expect(rule(`.run--band-${band}-${slot}`)).toContain(`--run-band-${band}: var(--mark-${slot}-fill);`);
      }
    }
  });

  it("bands_stay_inside_the_lower_highlight_and_never_move_the_text", () => {
    for (const selector of [".run--bands-2", ".run--bands-3", ".run--bands-more", ".run--negated.run--bands-more"]) {
      const body = rule(selector);
      expect(body, selector).not.toMatch(/padding|margin|line-height|font|border|height:/);
    }
    expect(rule(".run--bands-2")).toMatch(/transparent 0 40%,\s*var\(--run-band-1\) 54% 77%, var\(--run-band-0\) 77% 100%/);
    expect(rule(".run--bands-3")).toMatch(/var\(--run-band-2\) 54% 69%, var\(--run-band-1\) 69% 85%, var\(--run-band-0\) 85% 100%/);
    // The negated hatch is drawn over the bands, also for the striped band.
    expect(rule(".run--negated.run--bands-more")).toMatch(/var\(--mark-negated-hatch\)[\s\S]*var\(--run-highlight\), var\(--run-stripes\)/);
  });
});
