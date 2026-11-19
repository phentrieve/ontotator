/**
 * Overlapping findings (issue 524): where findings overlap, each has its own band in the highlight, and different
 * terms that overlap or stand next to each other never share a colour; the same term keeps one colour.
 *
 * The task is a real ANNOTATION_LOOP task; its opened view is swapped for an invented text with invented findings
 * (nothing is saved). Two texts: "periorbital and facial oedema" (two findings, three pieces) and three findings
 * on "focal motor seizures". Both term pairs prefer the same palette slot. At 1440 px and 390 px, in the light
 * and the dark colour scheme. With OVERLAP_SHOTS=<directory> the screens are saved there as well.
 */
import { expect, test, type Locator, type Page } from "@playwright/test";
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
const box = async (locator: Locator) => (await locator.boundingBox())!;
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

// A label lookup still running when a test ends is not an error of the test.
test.afterEach(async ({ page }) => { await page.unrouteAll({ behavior: "ignoreErrors" }); });

for (const scheme of ["light", "dark"] as const) {
  test.describe(`${scheme} colour scheme`, () => {
    test.use({ colorScheme: scheme });

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
        // "oedema": Facial oedema's band above Periorbital oedema's band.
        expect(await colours(oedema)).toEqual([facialFill, periorbitalFill]);
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
        expect(await inText()).toEqual(before);
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
        // Painted: the three fills and the hatch of the excluded Seizure.
        expect((await colours(seizures)).length).toBe(4);
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
