/**
 * Overlapping findings (issue 524): where findings overlap, each has its own band in the highlight, and different
 * terms that overlap or stand next to each other never share a colour; the same term keeps one colour.
 *
 * The task is a real ANNOTATION_LOOP task; its opened view is swapped for an invented text with invented findings
 * (nothing is saved). Two texts: "periorbital and facial oedema" (two findings, three pieces) and three findings
 * on "focal motor seizures". Both term pairs prefer the same palette slot. At 1440 px and 390 px, in the light
 * and the dark colour scheme. With OVERLAP_SHOTS=<directory> the screens are saved there as well.
 *
 * Issue 551: the case "Krampfanfälle" / "Krampfanfälle werden" at 1x. The bands are read back from the pixels on
 * screen: each band shows its own fill over most of the run's width, and the two fills differ clearly (CIEDE2000).
 */
import { expect, test, type Locator, type Page } from "@playwright/test";
import { deltaE2000 } from "../tests/support/colour";
import { loginScenarioUser, reviewFlowScenario } from "./reviewFlowHelpers";

test.setTimeout(240_000);
test.use({ actionTimeout: 15_000 });

const DESKTOP = { width: 1440, height: 900 } as const;
const PHONE = { width: 390, height: 844 } as const;

interface Finding { id: string; termId: string; label: string; segments: [number, number][]; negated?: boolean }
interface Example { name: string; text: string; findings: Finding[] }

const at = (text: string, word: string, from = 0): [number, number] => {
  const start = text.indexOf(word, from);
  if (start < 0) throw new Error(`"${word}" is not in the text`);
  return [start, start + word.length];
};

const OEDEMA_TEXT = "The child has periorbital and facial oedema since Monday. No fever.";
const OEDEMA: Example = {
  name: "two",
  text: OEDEMA_TEXT,
  findings: [
    // Both terms hash to the same slot: before issue 524 all three words had one colour.
    { id: "periorbital", termId: "HP:0100539", label: "Periorbital oedema", segments: [at(OEDEMA_TEXT, "periorbital"), at(OEDEMA_TEXT, "oedema")] },
    { id: "facial", termId: "HP:0000282", label: "Facial oedema", segments: [at(OEDEMA_TEXT, "facial oedema")] },
  ],
};

const SEIZURE_TEXT = "Since spring she has recurrent focal motor seizures with hypotonia afterwards.";
const THREE: Example = {
  name: "three",
  text: SEIZURE_TEXT,
  findings: [
    { id: "focal", termId: "HP:0020219", label: "Focal motor seizure", segments: [at(SEIZURE_TEXT, "focal motor seizures")] },
    { id: "motor", termId: "HP:0020217", label: "Motor seizure", segments: [at(SEIZURE_TEXT, "motor seizures")] },
    { id: "seizure", termId: "HP:0001250", label: "Seizure", segments: [at(SEIZURE_TEXT, "seizures")], negated: true },
    { id: "hypotonia", termId: "HP:0001252", label: "Hypotonia", segments: [at(SEIZURE_TEXT, "hypotonia")] },
  ],
};

const FOUR_TEXT = "On examination: generalized tonic-clonic seizure activity.";
const FOUR: Example = {
  name: "four",
  text: FOUR_TEXT,
  findings: [
    { id: "generalized", termId: "HP:0002197", label: "Generalized-onset seizure", segments: [at(FOUR_TEXT, "generalized tonic-clonic seizure")] },
    { id: "tonic-clonic", termId: "HP:0002069", label: "Bilateral tonic-clonic seizure", segments: [at(FOUR_TEXT, "tonic-clonic seizure")] },
    { id: "clonic", termId: "HP:0020221", label: "Clonic seizure", segments: [at(FOUR_TEXT, "clonic seizure")] },
    { id: "seizure", termId: "HP:0001250", label: "Seizure", segments: [at(FOUR_TEXT, "seizure")] },
  ],
};

// Issue 551: "Krampfanfälle" (Seizure) inside "Krampfanfälle werden" (Dialeptic seizure).
const KRAMPF_TEXT = "Im Verlauf: Krampfanfälle werden als positiver Befund vermerkt.";
const KRAMPF: Example = {
  name: "krampf",
  text: KRAMPF_TEXT,
  findings: [
    { id: "dialeptic", termId: "HP:0011146", label: "Dialeptic seizure", segments: [at(KRAMPF_TEXT, "Krampfanfälle werden")] },
    { id: "seizure", termId: "HP:0001250", label: "Seizure", segments: [at(KRAMPF_TEXT, "Krampfanfälle")] },
  ],
};

const shots = process.env.OVERLAP_SHOTS;
async function shot(page: Page, name: string): Promise<void> {
  const path = shots ? `${shots}/${name}.png` : test.info().outputPath(`${name}.png`);
  await page.screenshot({ path });
}

/** Swap the opened task's text and draft for the example; label its terms. */
async function routeExample(page: Page, example: Example): Promise<void> {
  const labels = new Map(example.findings.map(finding => [finding.termId, finding.label]));
  await page.route(url => /\/api\/v1\/assignments\/\d+\/open$/.test(new URL(url).pathname), async route => {
    const response = await route.fetch();
    const body = await response.json();
    const view = body.view;
    const sha = view.document.text_sha256 as string;
    const layer = view.layers?.find((item: { access?: string }) => item.access === "editable")?.layer_id ?? "hpo";
    const evidenceOf = (finding: Finding) => ({
      mention: { evidence_id: `ev-${finding.id}`, segments: finding.segments.map(([start, end]) => ({ start, end })), cue_segments: [] },
      document_id: view.document.document_id, text_sha256: sha, version: `ev-version-${finding.id}`,
    });
    view.document.text = example.text;
    view.draft.annotations = example.findings.map(finding => ({
      schema_version: "ontotator-annotation/v3",
      annotation: {
        annotation_id: `ann-${finding.id}`, document_id: view.document.document_id, layer_id: layer, type_id: "phenotype",
        term_id: finding.termId,
        axes_values: { assertion: finding.negated ? "absent" : "present", experiencer: "patient", temporality: "current" },
        axes_defaulted: [], evidence_refs: [{ evidence_id: `ev-${finding.id}`, version: `ev-version-${finding.id}` }],
        provenance: { actor: { actor_id: "ann-test", kind: "human" }, method: "manual", source_refs: [], assessment: null },
      },
      evidence: [evidenceOf(finding)],
      document_id: view.document.document_id, text_sha256: sha, version: `version-${finding.id}`,
    }));
    view.draft.evidence = example.findings.map(evidenceOf);
    await route.fulfill({ response, json: body });
  });
  await page.route(url => new URL(url).pathname === "/api/v1/terms/labels", async route => {
    const request = route.request().postDataJSON() as { terms: Array<{ term_id: string }> };
    const response = await route.fetch();
    const real = (await response.json()) as Array<{ term_id: string; label: string | null }>;
    const known = new Map(real.map(item => [item.term_id, item]));
    await route.fulfill({ response, json: request.terms.map(term =>
      labels.has(term.term_id) ? { ...term, label: labels.get(term.term_id) } : known.get(term.term_id) ?? { ...term, label: null }) });
  });
}

const textPane = (page: Page) => page.locator(".text-container");
const run = (page: Page, text: string) => textPane(page).locator(".run").filter({ hasText: new RegExp(`^${text}$`) });

/** The distinct colours a run's background images paint, in order of appearance. */
const colours = (locator: Locator) => locator.evaluate(node => {
  const image = getComputedStyle(node).backgroundImage;
  return [...new Set(image.match(/rgba?\([^)]*\)/g) ?? [])].filter(colour => !/rgba\(0, 0, 0, 0\)/.test(colour));
});
/** The fill of each band of a run (one fill: `--run-fill`), as the browser resolves the tokens. */
const bandFills = (locator: Locator) => locator.evaluate(node => {
  const style = getComputedStyle(node);
  const bands = [0, 1, 2, 3].map(band => style.getPropertyValue(`--run-band-${band}`).trim()).filter(Boolean);
  return bands.length ? bands : [style.getPropertyValue("--run-fill").trim()];
});
const slotClasses = (locator: Locator) => locator.evaluate(node =>
  [...node.classList].filter(name => /^run--(?:color|band|bands)-/.test(name)).sort());
/**
 * A run's box. The text pane redraws all its runs when the selection or the drag handles' names change (the names
 * follow the term labels, which can arrive after a click): a run read in that moment is detached and has no box.
 * Read it again until it has one.
 */
const box = async (locator: Locator) => {
  const read: { box: Awaited<ReturnType<Locator["boundingBox"]>> } = { box: null };
  await expect.poll(async () => (read.box = await locator.boundingBox()) !== null, { message: "the piece has a box" }).toBe(true);
  return read.box!;
};
/**
 * The colour seen most often along a row of a run's pixels, at each fraction of the run's height (its border left out):
 * the background of the band there, as the glyphs cover only a small part of a row. "#rrggbb".
 */
const seenAt = async (page: Page, locator: Locator, fractions: number[]) => {
  const png = (await locator.screenshot()).toString("base64");
  const border = await locator.evaluate(node => parseFloat(getComputedStyle(node).borderBottomWidth) || 0);
  return page.evaluate(async ({ png, border, fractions }) => {
    const image = new Image();
    image.src = `data:image/png;base64,${png}`;
    await image.decode();
    const canvas = document.createElement("canvas");
    [canvas.width, canvas.height] = [image.width, image.height];
    const context = canvas.getContext("2d")!;
    context.drawImage(image, 0, 0);
    const inner = image.height - border * window.devicePixelRatio;
    return fractions.map(fraction => {
      const row = context.getImageData(0, Math.floor(inner * fraction), image.width, 1).data;
      const counts = new Map<string, number>();
      for (let x = 0; x < image.width; x++) {
        const hex = `#${[0, 1, 2].map(c => row[x * 4 + c].toString(16).padStart(2, "0")).join("")}`;
        counts.set(hex, (counts.get(hex) ?? 0) + 1);
      }
      return [...counts.entries()].sort((a, b) => b[1] - a[1])[0][0];
    });
  }, { png, border, fractions });
};
const hexOf = (rgb: string) => `#${(rgb.match(/\d+/g) ?? []).slice(0, 3).map(n => Number(n).toString(16).padStart(2, "0")).join("")}`;

const noSidewaysScroll = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);

async function openExample(page: Page, example: Example, size: { width: number; height: number }) {
  await page.setViewportSize(size);
  await routeExample(page, example);
  const s = await reviewFlowScenario(page, "ANNOTATION_LOOP");
  await loginScenarioUser(page, s, "annotator");
  const writes: string[] = [];
  page.on("request", request => { if (request.method() !== "GET" && /\/commands$|\/submit$/.test(request.url())) writes.push(request.url()); });
  await page.goto(`/#/tasks/${s.assignments["loop-en"]}`);
  await expect(textPane(page)).toHaveText(example.text);
  return writes;
}

test("four overlapping findings: two bands and a striped top band", async ({ page }) => {
  const writes = await openExample(page, FOUR, DESKTOP);
  const seizure = run(page, "seizure");
  await expect(seizure).toHaveClass(/\brun--bands-more\b/);
  expect(new Set(await bandFills(seizure)).size).toBe(4);
  // All four findings are on the piece: a click there offers them as before.
  expect((await seizure.getAttribute("data-mentions"))!.split(",")).toHaveLength(4);
  const [a, b] = [await box(run(page, "generalized ")), await box(seizure)];
  expect(Math.abs(a.y - b.y)).toBeLessThan(0.5);
  await shot(page, "overlap-four-1440-light");
  expect(writes).toEqual([]);
});

// A label lookup still running when a test ends is not an error of the test.
test.afterEach(async ({ page }) => { await page.unrouteAll({ behavior: "ignoreErrors" }); });

for (const scheme of ["light", "dark"] as const) {
  test.describe(`${scheme} colour scheme`, () => {
    test.use({ colorScheme: scheme });

    test("issue 551: two overlapping findings show two bands that tell apart at normal size (1440 px, 1x)", async ({ page }) => {
      const writes = await openExample(page, KRAMPF, DESKTOP);
      const both = run(page, "Krampfanfälle");
      const werden = run(page, " werden");
      await expect(both).toHaveClass(/\brun--bands-2\b/);
      const [bottom, top] = await bandFills(both);
      const [werdenFill] = await bandFills(werden);
      // Dialeptic seizure runs on into " werden": its band is the bottom one, in the zone of a single mark.
      expect(bottom).toBe(werdenFill);
      expect(top).not.toBe(bottom);
      await page.mouse.move(0, 0);
      // On screen: the top band fills the upper part of the run, the bottom band the lower part.
      const fill = async (token: string) => hexOf(await page.evaluate(value => {
        const probe = document.createElement("span");
        probe.style.color = value;
        document.body.append(probe);
        const colour = getComputedStyle(probe).color;
        probe.remove();
        return colour;
      }, token));
      const [topSeen, bottomSeen] = await seenAt(page, both, [0.3, 0.8]);
      expect([topSeen, bottomSeen]).toEqual([await fill(top), await fill(bottom)]);
      expect((await seenAt(page, werden, [0.8]))[0]).toBe(bottomSeen);
      // The two bands differ clearly, not only for a zoomed-in eye (tokens.test.ts: every slot pair >= 20).
      expect(deltaE2000(topSeen, bottomSeen)).toBeGreaterThanOrEqual(20);
      // Bands never move the text.
      const [a, b] = [await box(both), await box(werden)];
      expect(Math.abs(a.y - b.y)).toBeLessThan(0.5);
      await shot(page, `overlap-551-1440-${scheme}`);
      expect(writes).toEqual([]);
    });

    for (const size of [DESKTOP, PHONE]) {
      test(`two overlapping findings: three pieces, two colours, a band each (${size.width} px)`, async ({ page }) => {
        const writes = await openExample(page, OEDEMA, size);
        const periorbital = run(page, "periorbital");
        const facial = run(page, "facial ");
        const oedema = run(page, "oedema");
        await expect(oedema).toHaveClass(/\brun--bands-2\b/);
        // The two findings prefer the same slot; the text gives the later one the next slot.
        expect(await slotClasses(periorbital)).toEqual(["run--color-2"]);
        expect(await slotClasses(facial)).toEqual(["run--color-3"]);
        expect(await slotClasses(oedema)).toEqual(["run--band-0-2", "run--band-1-3", "run--bands-2", "run--color-2"]);
        const [periorbitalFill] = await colours(periorbital);
        const [facialFill] = await colours(facial);
        expect(periorbitalFill).not.toBe(facialFill);
        // The fills are the tokens of this scheme (frontend/src/styles/tokens.css, slots 2 and 3).
        expect([periorbitalFill, facialFill]).toEqual(scheme === "dark"
          ? ["rgb(110, 43, 0)", "rgb(59, 47, 131)"]
          : ["rgb(250, 185, 161)", "rgb(183, 201, 254)"]);
        // "oedema": Facial oedema's band above Periorbital oedema's band, a gap of the sheet between them (issue 551).
        const sheet = scheme === "dark" ? "rgb(36, 32, 27)" : "rgb(255, 253, 248)";
        expect(await colours(oedema)).toEqual([facialFill, sheet, periorbitalFill]);
        // Bands never move the text: the banded piece starts on the line of its neighbour (only the 3 px line of
        // an overlap, unchanged, is 1 px taller at the bottom).
        const [a, b] = [await box(facial), await box(oedema)];
        expect(Math.abs(a.y - b.y)).toBeLessThan(0.5);
        const inText = async () => { const [piece, pane] = [await box(oedema), await box(textPane(page))]; return { x: piece.x - pane.x, y: piece.y - pane.y }; };
        const before = await inText();
        await shot(page, `overlap-two-${size.width}-${scheme}`);

        // Selected: a frame around the finding, the colours and bands stay.
        if (size.width < 700) await page.getByRole("navigation", { name: "Select view" }).getByRole("button", { name: /^Findings/ }).click();
        await page.locator('.sidebar [data-list-key="annotation:ann-facial"]').click();
        if (size.width < 700) await page.getByRole("navigation", { name: "Select view" }).getByRole("button", { name: "Document" }).click();
        await expect(oedema).toHaveClass(/\brun--hot\b/);
        expect(await slotClasses(oedema)).toEqual(["run--band-0-2", "run--band-1-3", "run--bands-2", "run--color-2"]);
        // The selection redraws the runs (handles); the piece stays where it was once they are in place.
        await expect.poll(inText).toEqual(before);
        expect(await noSidewaysScroll(page)).toBe(true);
        await shot(page, `overlap-two-selected-${size.width}-${scheme}`);
        expect(writes).toEqual([]);
      });

      test(`three overlapping findings: three bands, and a neighbour of another colour (${size.width} px)`, async ({ page }) => {
        const writes = await openExample(page, THREE, size);
        const focal = run(page, "focal ");
        const motor = run(page, "motor ");
        const seizures = run(page, "seizures");
        const hypotonia = run(page, "hypotonia");
        await expect(seizures).toHaveClass(/\brun--bands-3\b/);
        await expect(seizures).toHaveClass(/\brun--negated\b/);
        expect(await slotClasses(focal)).toEqual(["run--color-0"]);
        expect(await slotClasses(motor)).toEqual(["run--band-0-0", "run--band-1-2", "run--bands-2", "run--color-0"]);
        // Seizure prefers slot 0 like Focal motor seizure; slot 1 is the next free one.
        expect(await slotClasses(seizures)).toEqual(["run--band-0-0", "run--band-1-2", "run--band-2-1", "run--bands-3", "run--color-0"]);
        const fills = await bandFills(seizures);
        expect(new Set(fills).size).toBe(3);
        // Painted: the hatch of the excluded Seizure, the three fills and the gap of the sheet between them.
        expect((await colours(seizures)).length).toBe(5);
        // Hypotonia stands next to the seizures: a colour none of them has.
        const [hypotoniaFill] = await bandFills(hypotonia);
        expect(fills).not.toContain(hypotoniaFill);
        const [a, b] = [await box(motor), await box(seizures)];
        if (size.width > 700) expect(Math.abs(a.y - b.y)).toBeLessThan(0.5);
        expect(await noSidewaysScroll(page)).toBe(true);
        await shot(page, `overlap-three-${size.width}-${scheme}`);
        expect(writes).toEqual([]);
      });
    }
  });
}
