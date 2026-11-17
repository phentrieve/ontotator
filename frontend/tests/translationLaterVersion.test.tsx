import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { api, type ReviewWorkspace } from "../src/api/client";
import { TranslationReviewScreen } from "../src/translation/TranslationReviewScreen";
import { reviewWorkspace } from "./translationFixtures";

afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); window.localStorage.clear(); });

/** The review of v2, uploaded by the lead as a human translation of v1 (a machine translation with a failed check). */
function laterVersion(changes: Partial<ReviewWorkspace> = {}): ReviewWorkspace {
  const base = reviewWorkspace();
  const ancestor = base.translation_ancestor;
  return reviewWorkspace({ variant: { ...base.variant, version: 2, derived_from: ancestor.document_id }, translation_ancestor: ancestor,
    text: "Dosis 5 Milligramm.", draft: { text: "Dosis 5 Milligramm.", form: {}, revision: 1 }, failed_checks: [],
    version_origin: { kind: "upload", previous_version: 1, at: "2026-11-17T09:30:00Z", method: "human_translation", provider: null, model: null, made_on: null, made_by: "Dr. Roe", note: null },
    previous_version: { variant: ancestor, text: "Dosis 5 mg." }, ...changes });
}

async function open(workspace: ReviewWorkspace) {
  vi.spyOn(api, "listSourceObligations").mockResolvedValue([]);
  vi.spyOn(api, "listMyTasks").mockResolvedValue([]);
  vi.stubGlobal("matchMedia", vi.fn((query: string) => ({ matches: false, media: query, onchange: null, addListener: vi.fn(), removeListener: vi.fn(), addEventListener: vi.fn(), removeEventListener: vi.fn(), dispatchEvent: () => true })));
  vi.spyOn(api, "openTranslationReview").mockResolvedValue(workspace);
  vi.spyOn(api, "saveTranslationReviewDraft").mockResolvedValue({ revision: 2 });
  render(<TranslationReviewScreen assignmentId={17} username="alice" onNavigate={vi.fn()} routeLeaveRef={{ current: null }} leaveGuardRef={{ current: null }} />);
  await screen.findByRole("textbox", { name: "Translation (de)" });
}

it("presents a later version as itself: its own origin, the version you were given, the checks of v1", async () => {
  await open(laterVersion());
  const details = screen.getByText("Translation details").closest("details")!;
  const rows = [...details.querySelectorAll("dl > div")].map(row => row.textContent);
  expect(rows.slice(0, 2)).toEqual(["This versionHuman translation", expect.stringMatching(/^Uploadedby the project lead on /)]);
  expect(rows).toContain("Madeby Dr. Roe");
  expect(rows).toContain("Version beforev1");
  expect(rows).toContain("Reviewed versionv2");
  // The run of the first version is named as that, never as how this version was made.
  expect(rows).toContain("Translation run of v1Example MT, model Model 1, run run-1");
  expect(rows.some(row => row?.startsWith("Machine translation"))).toBe(false);
  expect(document.getElementById("review-translation-note")!.textContent).toBe("Same as the version you were given (v2). Compare shows what changed since v1.");
  const band = screen.getByRole("region", { name: "Automatic translation checks" });
  expect(band.textContent).toContain("The automatic checks ran on v1, not on this version (v2). 1 automatic check failed on v1: Units added in translation.");
  // "Accepted unchanged" asks for no rationale because of a check of v1.
  fireEvent.click(screen.getByRole("radio", { name: /Accepted unchanged/ }));
  expect(screen.queryByText(/An automatic check failed/)).toBeNull();
});

it("compares with the previous version by default and marks what changed since it", async () => {
  await open(laterVersion({ comparisons: [{ variant: { ...reviewWorkspace().variant, document_id: "other", external_id: "Other MT" }, text: "Andere Übersetzung." }] }));
  fireEvent.click(screen.getByRole("button", { name: /Compare/ }));
  const items = screen.getAllByRole("menuitem").map(item => item.textContent);
  expect(items).toEqual(["The previous version (v1)", "Other MT de"]);
  fireEvent.click(screen.getByRole("menuitem", { name: "The previous version (v1)" }));
  const pane = await screen.findByRole("region", { name: "Comparison" });
  expect(pane.closest(".translation-column")!.querySelector(".translation-column-subtitle")!.textContent).toBe("Changes from v1 to v2");
  expect([...pane.querySelectorAll("del")].map(node => node.textContent)).toEqual(["mg"]);
  expect([...pane.querySelectorAll("ins")].map(node => node.textContent)).toEqual(["Milligramm"]);
  // "Show changes" keeps showing the reviewer's own edits against the given version.
  fireEvent.click(screen.getByRole("checkbox", { name: "Show changes" }));
  expect(within(screen.getByRole("region", { name: "Text changes" })).queryByText("mg")).toBeNull();
  expect(document.getElementById("review-translation-note")!.textContent).toBe("Showing your changes against the version you were given (v2). Turn off Show changes to edit. Compare shows what changed since v1.");
});

it("keeps the first version of a machine translation as before", async () => {
  const base = reviewWorkspace();
  await open(reviewWorkspace({ variant: base.translation_ancestor, failed_checks: [{ code: "units_added", passed: false, detail: "A unit changed" }], version_origin: null, previous_version: null }));
  expect(document.getElementById("review-translation-note")!.textContent).toBe("Same as the machine translation.");
  const rows = [...screen.getByText("Translation details").closest("details")!.querySelectorAll("dl > div")].map(row => row.textContent);
  expect(rows.slice(0, 3)).toEqual(["Machine translationExample MT", "ModelModel 1", "Runrun-1"]);
  expect(screen.queryByRole("button", { name: "Compare" })).toBeNull();
  expect(screen.getByRole("region", { name: "Automatic translation checks" }).textContent).toContain("1 automatic check failed: Units added in translation");
});
