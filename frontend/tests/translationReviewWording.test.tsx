/**
 * Issue 610: the lead's "Take the proposed wording" writes into the reviewer's saved draft while the review is open.
 * The screen merges it into the text on screen: no edit is lost, a clash keeps the reviewer's text, and a change it
 * cannot merge offers "Keep my text".
 */
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { api, ApiError, type ProblemReportView } from "../src/api/client";
import type { RouteLeaveGuard } from "../src/app/router";
import { TranslationReviewScreen } from "../src/translation/TranslationReviewScreen";
import { reviewWorkspace } from "./translationFixtures";

const SAVED = "Krampfanfälle seit Geburt. Familienmitglied.";
const WORDING = "Epileptische Anfälle";
const TAKEN = SAVED.replace("Krampfanfälle", WORDING);
const conflict = () => new ApiError(409, "Changed elsewhere", "REVISION_CONFLICT");

const question = (took: boolean): ProblemReportView => ({
  report_id: "q1", kind: "question", state: took ? "resolved" : "open", reason: "Should it be Epileptische Anfälle?",
  quote: "Krampfanfälle", proposed_text: WORDING, took_proposed_text: took, answer: took ? "Yes." : null,
  answered_at: took ? "2026-11-22T10:00:00Z" : null, created_at: "2026-11-22T09:00:00Z", assignment_id: 17, revision: 1,
} as unknown as ProblemReportView);

afterEach(() => { cleanup(); window.localStorage.clear(); vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

function setup(took = false) {
  vi.spyOn(api, "listSourceObligations").mockResolvedValue([]);
  vi.spyOn(api, "listMyTasks").mockResolvedValue([]);
  vi.stubGlobal("matchMedia", vi.fn((query: string) => ({ matches: /min-width:\s*(\d+)px/.test(query) ? Number(/min-width:\s*(\d+)px/.exec(query)![1]) <= 1440 : false,
    media: query, onchange: null, addListener: vi.fn(), removeListener: vi.fn(), addEventListener: vi.fn(), removeEventListener: vi.fn(), dispatchEvent: () => true })));
  const listed = vi.spyOn(api, "listQuestions").mockResolvedValue([question(took)]);
  const open = vi.spyOn(api, "openTranslationReview").mockResolvedValue(reviewWorkspace({ draft: { text: SAVED, form: {}, revision: 6 } }));
  const save = vi.spyOn(api, "saveTranslationReviewDraft");
  const routeLeaveRef: { current: RouteLeaveGuard | null } = { current: null };
  const leaveGuardRef: { current: ((proceed: () => void) => void) | null } = { current: null };
  render(<TranslationReviewScreen assignmentId={17} username="alice" onNavigate={vi.fn()} routeLeaveRef={routeLeaveRef} leaveGuardRef={leaveGuardRef} />);
  return { open, save, listed };
}
const editor = () => screen.getByRole("textbox", { name: "Translation (de)" }) as HTMLTextAreaElement;
const status = () => document.querySelector(".translation-save-status")!.textContent;
async function settle(ms = 1000) { await act(async () => { await vi.advanceTimersByTimeAsync(ms); }); }
/** The lead took the wording: the saved draft has it at revision 7, the question says so. */
function leadTakes(open: ReturnType<typeof setup>["open"], listed: ReturnType<typeof setup>["listed"], text = TAKEN) {
  open.mockResolvedValue(reviewWorkspace({ draft: { text, form: {}, revision: 7 } }));
  listed.mockResolvedValue([question(true)]);
}

it("merges the wording into an edit that was waiting at the answer and saves it with the new revision", async () => {
  const { open, save, listed } = setup();
  await screen.findByRole("textbox", { name: "Translation (de)" });
  vi.useFakeTimers();
  save.mockRejectedValueOnce(conflict()).mockResolvedValue({ revision: 8 });
  fireEvent.change(editor(), { target: { value: `${SAVED} EDITC` } });
  leadTakes(open, listed);
  await settle();
  // The refused save is merged, not left for a discarding reload.
  expect(save).toHaveBeenCalledTimes(2);
  expect(save).toHaveBeenLastCalledWith(17, expect.objectContaining({ expected_revision: 7, text: `${TAKEN} EDITC` }));
  expect(editor().value).toBe(`${TAKEN} EDITC`);
  expect(status()).toBe("Saved");
  expect(screen.getByText(`The lead's wording is in your text now: “${WORDING}”. Your own edits are kept.`)).toBeDefined();
  // Typing goes on and is saved on top.
  fireEvent.change(editor(), { target: { value: `${TAKEN} EDITC EDITD` } });
  await settle();
  expect(save).toHaveBeenLastCalledWith(17, expect.objectContaining({ expected_revision: 8, text: `${TAKEN} EDITC EDITD` }));
  expect(screen.queryByRole("dialog", { name: "Changes not saved" })).toBeNull();
});

it("shows the wording at once when the lead took it while nothing was waiting (window focus), never a stale Saved", async () => {
  const { open, save, listed } = setup();
  await screen.findByRole("textbox", { name: "Translation (de)" });
  vi.useFakeTimers();
  save.mockResolvedValue({ revision: 8 });
  leadTakes(open, listed);
  await act(async () => { window.dispatchEvent(new Event("focus")); });
  await settle();
  expect(screen.getByText(`The lead's wording is in your text now: “${WORDING}”. Your own edits are kept.`)).toBeDefined();
  expect(editor().value).toBe(TAKEN);
  expect(status()).toBe("Saved");
  // The changed text selects Accepted with corrections, as typing it would; that is saved on the new revision.
  expect(save).toHaveBeenLastCalledWith(17, expect.objectContaining({ expected_revision: 7, text: TAKEN }));
  // "Show it in my text" selects the wording.
  fireEvent.click(screen.getByRole("button", { name: "Show it in my text" }) );
  await settle(50);
  expect(editor().value.slice(editor().selectionStart, editor().selectionEnd)).toBe(WORDING);
});

it("keeps the reviewer's text where they changed the passage and offers the wording in one click", async () => {
  const { open, save, listed } = setup();
  await screen.findByRole("textbox", { name: "Translation (de)" });
  vi.useFakeTimers();
  save.mockRejectedValueOnce(conflict()).mockResolvedValueOnce({ revision: 8 }).mockResolvedValue({ revision: 9 });
  const mine = SAVED.replace("Krampfanfälle", "Krampfanfall");
  fireEvent.change(editor(), { target: { value: mine } });
  leadTakes(open, listed);
  await settle();
  // The reviewer's text wins and is saved over the wording; they are told.
  expect(save).toHaveBeenLastCalledWith(17, expect.objectContaining({ expected_revision: 7, text: mine }));
  expect(editor().value).toBe(mine);
  const kept = screen.getByText("Your text was kept").closest(".notice") as HTMLElement;
  expect(kept.textContent).toContain(`You changed “Krampfanfälle” after you asked, so the lead's wording was not put in: “${WORDING}”.`);
  fireEvent.click(within(kept).getByRole("button", { name: "Use the lead's wording" }));
  expect(editor().value).toBe(TAKEN);
  await settle();
  expect(save).toHaveBeenLastCalledWith(17, expect.objectContaining({ expected_revision: 8, text: TAKEN }));
  expect(screen.queryByText("Your text was kept")).toBeNull();
});

it("offers Keep my text for a change elsewhere it cannot merge, and saves the reviewer's text over it", async () => {
  const { open, save, listed } = setup();
  await screen.findByRole("textbox", { name: "Translation (de)" });
  vi.useFakeTimers();
  save.mockRejectedValueOnce(conflict()).mockResolvedValue({ revision: 8 });
  fireEvent.change(editor(), { target: { value: `${SAVED} mine` } });
  leadTakes(open, listed, `${SAVED} from another tab`);
  await settle();
  expect(status()).toBe("Conflict");
  expect(save).toHaveBeenCalledTimes(1);
  const banner = screen.getByText("This review was changed elsewhere").closest(".notice") as HTMLElement;
  // Further typing is kept for Keep my text.
  fireEvent.change(editor(), { target: { value: `${SAVED} mine and more` } });
  await act(async () => { fireEvent.click(within(banner).getByRole("button", { name: "Keep my text" })); });
  await settle();
  expect(save).toHaveBeenLastCalledWith(17, expect.objectContaining({ expected_revision: 7, text: `${SAVED} mine and more` }));
  expect(status()).toBe("Saved");
  expect(screen.queryByText("This review was changed elsewhere")).toBeNull();
});
