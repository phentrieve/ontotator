import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { loginExisting, selectText } from "./helpers";

/**
 * Show changes since vN (issue 421): a round carried to a corrected text offers the switch above the text; the marks
 * are an overlay (the text keeps its characters and offsets), marking a finding works while they are on, and the
 * removed-text marker shows the earlier wording on keyboard focus. The lead sees the same on the submitted annotation
 * in the text view. Data: ``POST /__test_carry_forward__`` (tests/browser_carry_fixture.py).
 */

interface Scenario {
  project: string;
  case_id: string;
  documents: string[];
  assignment_id: number;
  username: string;
  text: string;
  old_text: string;
  submissions: Record<string, string>;
  recreate_span: { start: number; end: number };
  lead_username?: string;
}

test.setTimeout(180_000);
test.use({ actionTimeout: 15_000, viewport: { width: 1440, height: 900 } });

async function scenario(page: Page, name: "corrected" | "corrected_done"): Promise<Scenario> {
  const response = await page.request.post("/__test_carry_forward__", { params: { scenario: name }, timeout: 120_000 });
  expect(response.ok(), await response.text()).toBeTruthy();
  return (await response.json()) as Scenario;
}

function consoleErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on("console", message => { if (message.type() === "error") errors.push(message.text()); });
  page.on("pageerror", error => errors.push(error.message));
  return errors;
}

const text = (page: Page) => page.locator(".text-container").first();
const passage = (page: Page) => text(page).locator(".change-passage");
const marker = (page: Page) => text(page).locator(".change-removed");
/** First offset and text of the marked runs. */
const marked = (page: Page) => text(page).evaluate(node => {
  const runs = [...node.querySelectorAll<HTMLElement>(".run--marked")];
  return runs.length ? { start: Number(runs[0].dataset.start), text: runs.map(run => run.textContent).join("") } : null;
});

test("annotator: the switch by keyboard, marks over the exact text, the removed wording, and marking stays possible", async ({ page }) => {
  const errors = consoleErrors(page);
  const s = await scenario(page, "corrected");
  await loginExisting(page, s.username);
  await page.goto(`/#/tasks/${s.assignment_id}`);
  await expect(text(page)).toBeVisible();

  const toggle = page.getByRole("checkbox", { name: "Show changes since v1" });
  await expect(toggle).not.toBeChecked();
  await expect(passage(page)).toHaveCount(0);
  await toggle.focus();
  await page.keyboard.press("Space");
  await expect(toggle).toBeChecked();
  await expect(page.getByRole("status").filter({ hasText: /passage changed/ })).toHaveText("1 passage changed");
  await expect(passage(page)).toHaveCount(1);
  await expect(passage(page)).toContainText("epileptische Anfälle");
  await expect(text(page).locator(".run--marker").first()).toBeVisible();
  // The marks add no characters: the text and its offsets are exactly v2.
  expect(await text(page).evaluate(node => node.textContent)).toBe(s.text);

  // The removed-text marker is the next tab stop after the text; its tooltip names the v1 wording.
  await text(page).focus();
  await page.keyboard.press("Tab");
  await expect(marker(page)).toBeFocused();
  const tip = page.getByRole("tooltip");
  await expect(tip).toBeVisible();
  await expect(tip).toContainText("In v1:");
  await expect(tip.locator("del")).toContainText(["Krampfanfälle"]);
  // Axe (WCAG 2.x A/AA) on the editor with the marks and the tooltip shown.
  const wcag = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];
  const axe = await new AxeBuilder({ page }).include("main").include(".change-tip").withTags(wcag).analyze();
  expect(axe.violations.flatMap(v => v.nodes.map(n => `${v.id} ${n.target.join(" ")}: ${n.failureSummary ?? ""}`))).toEqual([]);
  await page.keyboard.press("Escape");
  await expect(tip).toHaveCount(0);

  await page.getByRole("button", { name: "Next ›" }).click();
  await expect(page.getByRole("status").filter({ hasText: /passage changed/ })).toHaveText("1 passage changed · 1 of 1");
  await expect(passage(page)).toHaveAttribute("data-current", "");

  // Re-create the carried finding inside the changed passage while the marks are shown.
  await page.locator('.sidebar [data-list-key^="input:"]').click();
  await page.getByRole("region", { name: "Carried finding", exact: true }).getByRole("button", { name: "Mark in text", exact: true }).click();
  await selectText(page, s.recreate_span.start, s.recreate_span.end);
  await page.getByRole("button", { name: "Save re-created finding", exact: true }).click();
  const recreated = page.locator('.sidebar [data-list-key^="annotation:"]').filter({ hasText: "Seizure" });
  await expect(recreated).toHaveCount(1);
  // The finding's mark covers exactly the selected v2 offsets (the change marks may split it into several runs).
  const expected = { start: s.recreate_span.start, text: s.text.slice(s.recreate_span.start, s.recreate_span.end) };
  await expect.poll(() => marked(page)).toEqual(expected);
  await expect(passage(page)).toHaveCount(1);

  // Off again: the finding keeps its place.
  await toggle.uncheck();
  await expect(passage(page)).toHaveCount(0);
  await expect.poll(() => marked(page)).toEqual(expected);
  expect(await text(page).evaluate(node => node.textContent)).toBe(s.text);
  expect(errors).toEqual([]);
});

test("lead: the annotation carried to v2 shows the same switch in the text view", async ({ page }) => {
  const errors = consoleErrors(page);
  const s = await scenario(page, "corrected_done");
  await loginExisting(page, s.lead_username!);
  const show = encodeURIComponent(`submission:${s.submissions.round2}`);
  await page.goto(`/#/projects/${encodeURIComponent(s.project)}/cases/${encodeURIComponent(s.case_id)}?variant=${encodeURIComponent(s.documents[1])}&show=${show}`);
  const toggle = page.getByRole("checkbox", { name: "Show changes since v1" });
  await expect(toggle).toBeVisible();
  await expect(toggle).not.toBeChecked();
  await toggle.check();
  await expect(passage(page)).toContainText("epileptische Anfälle");
  await marker(page).hover();
  await expect(page.getByRole("tooltip")).toContainText("Krampfanfälle");
  expect(await text(page).evaluate(node => node.textContent)).toBe(s.text);
  // The first round on v1 was not carried: no switch there.
  await page.goto(`/#/projects/${encodeURIComponent(s.project)}/cases/${encodeURIComponent(s.case_id)}?variant=${encodeURIComponent(s.documents[0])}&show=${encodeURIComponent(`submission:${s.submissions.round1}`)}`);
  await expect(text(page)).toContainText("Krampfanfälle");
  await expect(page.getByRole("checkbox", { name: /Show changes since/ })).toHaveCount(0);
  expect(errors).toEqual([]);
});

/** Viewport point of the left edge (or, for `end`, the right edge) of the character at `offset`. */
const pointAt = (page: Page, offset: number, end = false) => text(page).evaluate((node, [at, atEnd]) => {
  const index = atEnd ? (at as number) - 1 : (at as number);
  for (const run of node.querySelectorAll<HTMLElement>(".run")) {
    const start = Number(run.dataset.start), value = run.firstChild;
    if (!value || index < start || index >= start + (value.textContent?.length ?? 0)) continue;
    const range = document.createRange();
    range.setStart(value, index - start); range.setEnd(value, index - start + 1);
    const box = range.getBoundingClientRect();
    return { x: atEnd ? box.right - 1 : box.left + 1, y: box.top + box.height / 2 };
  }
  throw new Error(`No character at ${index}`);
}, [offset, end] as const);

/** Selects [start, end) with a real mouse drag and returns what the editor marked. */
async function dragSelect(page: Page, start: number, end: number) {
  const from = await pointAt(page, start), to = await pointAt(page, end, true);
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move((from.x + to.x) / 2, (from.y + to.y) / 2, { steps: 4 });
  await page.mouse.move(to.x, to.y, { steps: 4 });
  await page.mouse.up();
  const discard = page.locator(".inspector-pane").getByRole("button", { name: "Discard", exact: true });
  await expect(discard).toBeVisible();
  const result = await marked(page);
  await discard.click();
  await expect.poll(() => marked(page)).toBeNull();
  return result;
}

test("a mouse drag across a passage frame and next to the removed-text marker marks the same offsets as with the switch off", async ({ page }) => {
  const errors = consoleErrors(page);
  const s = await scenario(page, "corrected");
  await loginExisting(page, s.username);
  await page.goto(`/#/tasks/${s.assignment_id}`);
  await expect(text(page)).toBeVisible();
  // "Sommer treten" starts before the passage and crosses the marker and the frame; "treten epileptische" starts
  // right after the marker; "Anfälle auf. Bei" leaves the frame at its end.
  const spans = ["Sommer treten", "treten epileptische", "Anfälle auf. Bei"].map(part => ({ start: s.text.indexOf(part), end: s.text.indexOf(part) + part.length, part }));
  const off = [];
  for (const span of spans) off.push(await dragSelect(page, span.start, span.end));
  expect(off).toEqual(spans.map(span => ({ start: span.start, text: span.part })));
  await page.getByRole("checkbox", { name: "Show changes since v1" }).check();
  await expect(marker(page)).toHaveCount(1);
  const on = [];
  for (const span of spans) on.push(await dragSelect(page, span.start, span.end));
  expect(on).toEqual(off);
  expect(await text(page).evaluate(node => node.textContent)).toBe(s.text);
  expect(errors).toEqual([]);
});

test("the removed-text tooltip stays inside the viewport and closes with Esc after hover", async ({ page }) => {
  const errors = consoleErrors(page);
  const s = await scenario(page, "corrected_done");
  await loginExisting(page, s.lead_username!);
  await page.goto(`/#/projects/${encodeURIComponent(s.project)}/cases/${encodeURIComponent(s.case_id)}?variant=${encodeURIComponent(s.documents[1])}&show=${encodeURIComponent(`submission:${s.submissions.round2}`)}`);
  await page.getByRole("checkbox", { name: "Show changes since v1" }).check();
  const tip = page.getByRole("tooltip");
  const inside = async () => {
    const box = (await tip.boundingBox())!, view = page.viewportSize()!;
    expect(box.x).toBeGreaterThanOrEqual(0); expect(box.y).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(view.width); expect(box.y + box.height).toBeLessThanOrEqual(view.height);
    return box;
  };
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 900 });
    await marker(page).scrollIntoViewIfNeeded();
    // The marker ends up just above the bottom edge: no room below, so the tooltip opens above it.
    const at = (await marker(page).boundingBox())!;
    await page.setViewportSize({ width, height: Math.ceil(at.y + at.height + 12) });
    await marker(page).focus();
    await expect(tip).toBeVisible();
    const box = await inside();
    const now = (await marker(page).boundingBox())!;
    // At phone width the layer's findings are below the text (issue 438), so the marker is not at the window's
    // bottom edge and the tooltip has room below it: there it must only stay clear of the marker.
    if (width >= 700) expect(box.y + box.height).toBeLessThanOrEqual(now.y);
    else expect(box.y + box.height <= now.y || box.y >= now.y + now.height).toBe(true);
    await page.keyboard.press("Escape");
    await expect(tip).toHaveCount(0);
    await marker(page).blur();
  }
  // Opened by hover (focus elsewhere): it stays while the pointer is on it, and Esc closes it.
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.getByRole("checkbox", { name: "Show changes since v1" }).focus();
  await marker(page).hover();
  await expect(tip).toBeVisible();
  await inside();
  await tip.hover();
  await page.waitForTimeout(400);
  await expect(tip).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(tip).toHaveCount(0);
  expect(errors).toEqual([]);
});
