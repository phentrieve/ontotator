/**
 * The text card names the version each person works on (issue 445): `v{n}` in the annotator rows when the text has
 * several versions, and on the "Submission ID" and "Round ID" lines of the technical details. A text with one version
 * shows no version in the rows. With SHOTS_DIR set, the states are saved as screenshots (desktop and phone).
 *
 * Builds a fresh project through ``POST /__test_documents__`` (scenario S445).
 */
import { expect, test, type Locator, type Page } from "@playwright/test";
import { documentsReady, documentsScenario } from "./documentsHelpers";
import { loginExisting } from "./helpers";
import { textCard } from "./proposalCheckHelpers";

test.setTimeout(180_000);
test.use({ actionTimeout: 15_000 });

const shots = process.env.SHOTS_DIR;
async function shot(page: Page, name: string): Promise<void> {
  if (shots) await page.screenshot({ path: `${shots}/${name}.png` });
}
const noHorizontalScroll = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);

/** Every person row lies inside the card and no part of it is cut off. */
async function rowsNotClipped(card: Locator): Promise<void> {
  const problems = await card.evaluate(element => {
    const box = element.getBoundingClientRect();
    const found: string[] = [];
    for (const row of element.querySelectorAll<HTMLElement>(".person-row, .person-row *")) {
      const rect = row.getBoundingClientRect();
      if (rect.width === 0) continue;
      if (rect.left < box.left - 1 || rect.right > box.right + 1) found.push(`outside the card: ${row.className} "${row.textContent}"`);
      if (row.scrollWidth > row.clientWidth + 1 && getComputedStyle(row).overflowX !== "visible") found.push(`cut off: ${row.className} "${row.textContent}"`);
    }
    return found;
  });
  expect(problems).toEqual([]);
}

/** Opens the card of a text on its Annotation part (by its link: the phone layout has no text-name button). */
async function openAnnotationPart(page: Page, project: string, caseId: string): Promise<Locator> {
  await page.goto(`/#/projects/${encodeURIComponent(project)}/documents?panel=${encodeURIComponent(`${caseId}:en`)}&panel_stage=annotation`);
  await documentsReady(page);
  const card = textCard(page, caseId, "en");
  await expect(card.getByRole("heading", { level: 3, name: "Annotation", exact: true })).toBeVisible();
  return card;
}

const details = (card: Locator) => card.getByRole("list", { name: "Annotators", exact: true }).locator(".person-row-details");

for (const [width, height, suffix] of [[1440, 900, ""], [390, 844, "-phone"]] as const) {
  test(`the annotator rows and the technical details name each person's version (${width} px)`, async ({ page }) => {
    const errors: string[] = [];
    page.on("console", message => { if (message.type() === "error") errors.push(message.text()); });
    page.on("pageerror", error => errors.push(String(error)));
    await page.setViewportSize({ width, height });
    const s = await documentsScenario(page, "S445");
    await loginExisting(page, s.users.lead);

    // Two versions: R. Roe works on v2 (unsubmitted rows come first), Tom Reis submitted on v1.
    let card = await openAnnotationPart(page, s.project, "case-0445");
    await expect(card.getByRole("link", { name: "Open annotation of Tom Reis" })).toBeVisible();
    await expect(details(card)).toHaveText([/^Assigned .+ · v2$/, /^Submitted .+ · assigned .+ · v1$/]);
    await rowsNotClipped(card);
    expect(await noHorizontalScroll(page)).toBe(true);
    await shot(page, `445-rows-two-versions-after${suffix}`);

    await card.getByRole("button", { name: "Details", exact: true }).click();
    const technical = card.locator(".technical-details");
    await expect(technical.locator("dt").filter({ hasText: "Submission ID" })).toHaveText(/^Submission ID, .+, v1$/);
    await expect(technical.locator("dt").filter({ hasText: "Round ID" })).toHaveText(/^Round ID, .+, v2$/);
    expect(await noHorizontalScroll(page)).toBe(true);
    await technical.locator("dt").filter({ hasText: "Round ID" }).scrollIntoViewIfNeeded();
    await shot(page, `445-details-two-versions-after${suffix}`);

    // One version: no version in the rows.
    card = await openAnnotationPart(page, s.project, "case-0446");
    await expect(card.getByRole("link", { name: "Open annotation of Tom Reis" })).toBeVisible();
    await expect(details(card)).toHaveCount(2);
    for (const text of await details(card).allTextContents()) expect(text).not.toMatch(/\bv\d/);
    await rowsNotClipped(card);
    expect(await noHorizontalScroll(page)).toBe(true);
    await shot(page, `445-rows-one-version-after${suffix}`);

    expect(errors).toEqual([]);
  });
}
