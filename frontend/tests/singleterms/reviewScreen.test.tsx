// Single-term review screen: two-step flow, blocked groups, reasons, keys, adjust and conflict (invented data).
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api, type SingleTermDecisionRequest, type SingleTermGroup } from "../../src/api/client";
import { ReviewScreen } from "../../src/singleterms/ReviewScreen";
import { batch, context, contexts, decision, gid, group } from "./fixtures";

let groups: SingleTermGroup[];
const decided = () => vi.mocked(api.decideSingleTerm).mock.calls.map(call => call[2] as SingleTermDecisionRequest);

beforeEach(() => {
  groups = [group(1), group(2, { blocked_reason: "contains_other_finding", state: "blocked" }), group(3)];
  vi.spyOn(api, "getSingleTermBatch").mockResolvedValue(batch());
  vi.spyOn(api, "listSingleTermGroups").mockImplementation(async () => groups);
  vi.spyOn(api, "singleTermContexts").mockImplementation(async (_key, groupId, options) =>
    options?.offset ? { ...contexts(groupId, [context(3), context(4)], 7), offset: options.offset } : contexts(groupId, [context(1), context(2)], 7));
  let next = 10;
  vi.spyOn(api, "decideSingleTerm").mockImplementation(async (_key, _batch, body) => decision(body.group_id, {
    decision_id: next++, decision: body.decision, phrase_only: body.phrase_only ?? null, reason: body.reason ?? null, note: body.note ?? null,
    adjusted_term_id: body.adjusted_term_id ?? null, adjusted_span: body.adjusted_span ? { ...body.adjusted_span } : null,
  }));
  vi.spyOn(api, "singleTermBatchAction").mockResolvedValue(batch({ state: "submitted" }));
  vi.spyOn(api, "singleTermAncestors").mockImplementation(async (_key, groupId) => ({
    group_id: groupId, term_id: "HP:0001250",
    ancestors: [
      { term_id: "HP:0012638", label: "Abnormal nervous system physiology", nearest: true },
      { term_id: "HP:0000001", label: "All", nearest: false },
    ],
  }));
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

const renderScreen = (extra: Partial<Parameters<typeof ReviewScreen>[0]> = {}) =>
  render(<ReviewScreen projectKey="p" batchId={3} username="rev-04" canManage={false} onNavigate={vi.fn()} {...extra} />);

describe("single-term review screen", () => {
  it("records the phrase-only judgment before it shows the contexts", async () => {
    renderScreen();
    expect(await screen.findByRole("heading", { name: "Phrase 1" })).toBeDefined();
    expect(screen.getByText(/Would a clinician map this phrase alone/)).toBeDefined();
    expect(screen.queryByText(/Step 2/)).toBeNull();
    expect(api.singleTermContexts).not.toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: /^Accept/ })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: /Yes, as a phrase/ }));
    expect(screen.getByText(/Phrase-only judgment recorded/).textContent).toContain("would accept");
    await waitFor(() => expect(api.singleTermContexts).toHaveBeenCalledWith("p", gid(1), { batch: 3, limit: 5, offset: 0 }));
    expect(await screen.findByText("2 of 7")).toBeDefined();
    expect(screen.getAllByText("Schwindel")).toHaveLength(2);
    expect(screen.queryByRole("button", { name: /Yes, as a phrase/ })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Show more contexts" }));
    await waitFor(() => expect(api.singleTermContexts).toHaveBeenLastCalledWith("p", gid(1), { batch: 3, limit: 5, offset: 2 }));
    expect(await screen.findByText("4 of 7")).toBeDefined();

    fireEvent.click(screen.getByRole("button", { name: /^Accept/ }));
    await waitFor(() => expect(decided()).toHaveLength(1));
    expect(decided()[0]).toMatchObject({ group_id: gid(1), decision: "accept", phrase_only: "would_accept", note: null });
    expect(decided()[0].request_id).toEqual(expect.any(String));
    // On to the next open group; the last decision can be undone.
    expect(await screen.findByRole("heading", { name: "Phrase 2" })).toBeDefined();
    expect(screen.getByText(/Phrase 1: Accepted\./)).toBeDefined();
    expect(screen.getByText("1 of 3 decided")).toBeDefined();
    fireEvent.click(screen.getByRole("button", { name: "Undo" }));
    await waitFor(() => expect(decided()).toHaveLength(2));
    expect(decided()[1]).toMatchObject({ group_id: gid(1), decision: "withdrawn" });
    expect(decided()[1].phrase_only).toBeUndefined();
    await waitFor(() => expect(screen.getByText("0 of 3 decided")).toBeDefined());
  });

  it("shows the resulting phrase or term of a decided group, without the block notice", async () => {
    groups = [
      group(1, { blocked_reason: "negation_in_span", state: "decided", decision: decision(gid(1), {
        decision: "adjust_span", adjusted_span: { occurrence_ref: "occ-1", start: 30, end: 37, text: "hwindel" } }) }),
      group(2, { state: "decided", decision: decision(gid(2), { decision: "adjust_term", adjusted_term_id: "HP:0012638" }) }),
    ];
    vi.mocked(api.singleTermContexts).mockImplementation(async (_key, groupId) => contexts(groupId, [
      context(1), context(2, { start: 300, end: 309, text_length: 900 }),
    ]));
    renderScreen({ group: gid(1) });
    expect(await screen.findByText(/Adjusted and accepted: re-cut to “hwindel”/)).toBeDefined();
    expect(screen.queryByText(/Blocked: the span/)).toBeNull();
    // "…" only where a context stops short of the text's start or end.
    const items = await screen.findAllByRole("listitem");
    const shown = items.filter(item => item.classList.contains("st-context")).map(item => item.textContent ?? "");
    expect(shown[0].startsWith("Seit") && shown[0].includes("Aufstehen. ")).toBe(true);
    expect(shown[1].startsWith("…Seit") && shown[1].includes("Aufstehen.… ")).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: /Decided/ }));
    fireEvent.click(await screen.findByRole("button", { name: /Phrase 2/ }));
    expect(await screen.findByText(/generalised to Abnormal nervous system physiology \(HP:0012638\)/)).toBeDefined();
  });

  it("does not offer Accept for a blocked group", async () => {
    renderScreen({ group: gid(2) });
    expect(await screen.findByRole("heading", { name: "Phrase 2" })).toBeDefined();
    expect(screen.getByText(/Blocked: the span contains another finding/)).toBeDefined();
    fireEvent.click(screen.getByRole("button", { name: /^No/ }));
    const accept = await screen.findByRole("button", { name: /^Accept/ });
    expect((accept as HTMLButtonElement).disabled).toBe(true);
    fireEvent.keyDown(window, { key: "a" });
    expect(api.decideSingleTerm).not.toHaveBeenCalled();
    expect((screen.getByRole("button", { name: /^Adjust/ }) as HTMLButtonElement).disabled).toBe(false);
  });

  it("rejects only with a reason and sends the note", async () => {
    renderScreen();
    fireEvent.click(await screen.findByRole("button", { name: /^No/ }));
    const reject = await screen.findByRole("button", { name: /^Reject/ });
    expect((reject as HTMLButtonElement).disabled).toBe(true);
    const reasons = screen.getByRole("group", { name: "Reject reason" });
    expect(within(reasons).getAllByRole("button").map(button => button.textContent)).toEqual([
      "needs context", "ambiguous abbreviation", "too general", "term wrong out of context", "contains other finding", "negation in span", "only usable rewritten (words inside removed)", "other",
    ]);
    fireEvent.click(within(reasons).getByRole("button", { name: "too general" }));
    expect(within(reasons).getByRole("button", { name: "too general" }).getAttribute("aria-pressed")).toBe("true");
    fireEvent.change(screen.getByLabelText("Note (optional)"), { target: { value: "  wider term exists " } });
    fireEvent.click(screen.getByRole("button", { name: /^Reject/ }));
    await waitFor(() => expect(decided()).toHaveLength(1));
    expect(decided()[0]).toMatchObject({ decision: "reject", reason: "too_general", phrase_only: "would_reject", note: "wider term exists" });
  });

  it("works with the keys Y, N, A and R", async () => {
    renderScreen();
    await screen.findByRole("heading", { name: "Phrase 1" });
    fireEvent.keyDown(window, { key: "a" });
    expect(api.decideSingleTerm).not.toHaveBeenCalled();
    fireEvent.keyDown(window, { key: "y" });
    await screen.findByText(/Step 3/);
    fireEvent.keyDown(window, { key: "a" });
    await waitFor(() => expect(decided()).toHaveLength(1));
    expect(decided()[0]).toMatchObject({ group_id: gid(1), decision: "accept", phrase_only: "would_accept" });

    // Next open group (Phrase 2 is blocked): N, then R moves focus to the reasons until one is chosen.
    await screen.findByRole("heading", { name: "Phrase 2" });
    fireEvent.click(screen.getByRole("button", { name: /Phrase 3/ }));
    await screen.findByRole("heading", { name: "Phrase 3" });
    fireEvent.keyDown(window, { key: "n" });
    await screen.findByText(/Step 3/);
    fireEvent.keyDown(window, { key: "r" });
    expect(document.activeElement?.textContent).toBe("needs context");
    expect(decided()).toHaveLength(1);
    fireEvent.click(screen.getByRole("button", { name: "needs context" }));
    fireEvent.keyDown(window, { key: "r" });
    await waitFor(() => expect(decided()).toHaveLength(2));
    expect(decided()[1]).toMatchObject({ group_id: gid(3), decision: "reject", reason: "needs_context", phrase_only: "would_reject" });
    // Keys are ignored while typing a note.
    fireEvent.click(screen.getByRole("button", { name: /Phrase 2/ }));
    fireEvent.keyDown(window, { key: "y" });
    const note = await screen.findByLabelText("Note (optional)");
    fireEvent.keyDown(note, { key: "r" });
    expect(decided()).toHaveLength(2);
  });

  it("re-cuts a blocked span in code points, across an astral character", async () => {
    vi.mocked(api.singleTermContexts).mockResolvedValue(contexts(gid(2), [
      context(5, { before: "Befund: 𝑥 Beine ", text: "geschwollen und gerötet", after: ", Puls ruhig.", start: 216, end: 239 }),
    ]));
    renderScreen({ group: gid(2) });
    fireEvent.click(await screen.findByRole("button", { name: /^No/ }));
    await screen.findByText("geschwollen und gerötet");
    fireEvent.keyDown(window, { key: "e" });
    expect(await screen.findByRole("heading", { name: "Re-cut the span" })).toBeDefined();
    const words = screen.getByRole("group", { name: "Words of the context" });
    const word = (text: string) => within(words).getByRole("button", { name: text });
    expect(word("geschwollen").getAttribute("aria-pressed")).toBe("true");
    expect(word("gerötet").getAttribute("aria-pressed")).toBe("true");
    const accept = screen.getByRole("button", { name: "Accept adjusted case" }) as HTMLButtonElement;
    expect(accept.disabled).toBe(true);
    // A generalised term does not lift the block.
    const parent = await screen.findByRole("radio", { name: /Abnormal nervous system physiology · HP:0012638 \(parent\)/ });
    expect((parent as HTMLInputElement).disabled).toBe(true);

    fireEvent.click(word("𝑥"));
    fireEvent.click(word("geschwollen"));
    expect(screen.getByText("New phrase").nextElementSibling?.textContent).toBe("𝑥 Beine geschwollen");
    expect(word("gerötet").getAttribute("aria-pressed")).toBe("false");
    expect(accept.disabled).toBe(false);
    fireEvent.click(accept);
    await waitFor(() => expect(decided()).toHaveLength(1));
    // Window base 216 − 16 code points = 200; "𝑥" starts at code point 8, "geschwollen" ends at 27.
    expect(decided()[0]).toMatchObject({
      group_id: gid(2), decision: "adjust_span", phrase_only: "would_reject",
      adjusted_span: { occurrence_ref: "occ-5", start: 208, end: 227 },
    });
    expect(decided()[0].adjusted_term_id).toBeUndefined();
  });

  it("generalises the term as the one adjustment of an unblocked group", async () => {
    renderScreen();
    fireEvent.click(await screen.findByRole("button", { name: /Yes, as a phrase/ }));
    fireEvent.click(await screen.findByRole("button", { name: /^Adjust/ }));
    const all = await screen.findByRole("radio", { name: "All · HP:0000001" });
    expect(api.singleTermAncestors).toHaveBeenCalledWith("p", gid(1), { batch: 3 });
    fireEvent.click(all);
    const words = screen.getByRole("group", { name: "Words of the context" });
    fireEvent.click(within(words).getByRole("button", { name: "beim" }));
    expect(screen.getByRole("radio", { name: "All · HP:0000001" })).toHaveProperty("checked", false);
    fireEvent.click(screen.getByRole("radio", { name: "All · HP:0000001" }));
    fireEvent.click(screen.getByRole("button", { name: "Accept adjusted case" }));
    await waitFor(() => expect(decided()).toHaveLength(1));
    expect(decided()[0]).toMatchObject({ decision: "adjust_term", adjusted_term_id: "HP:0000001", phrase_only: "would_accept" });
  });

  it("resolves a phrase conflict by choosing one term and rejecting the other", async () => {
    groups = [
      group(1),
      group(4, { phrase: "schwäche", display_text: "Schwäche", label: "Muscle weakness", conflict_with: [gid(5)] }),
      group(5, { phrase: "schwäche", display_text: "Schwäche", label: "Fatigue", conflict_with: [gid(4), gid(6)] }),
    ];
    renderScreen();
    const queue = await screen.findByRole("complementary", { name: "Groups in this batch" });
    fireEvent.click(within(queue).getByRole("button", { name: /Schwäche/ }));
    expect(await screen.findByText("same phrase, 3 terms")).toBeDefined();
    expect(screen.getByText(/1 other term of this phrase is in another batch/)).toBeDefined();
    expect(screen.queryByRole("button", { name: "Use this term" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Fatigue" }));
    const cards = await screen.findAllByRole("button", { name: "Use this term" });
    expect(cards).toHaveLength(2);
    fireEvent.click(within(screen.getByRole("region", { name: /Muscle weakness/ })).getByRole("button", { name: "Use this term" }));
    await waitFor(() => expect(decided()).toHaveLength(2));
    expect(decided()[0]).toMatchObject({ group_id: gid(5), decision: "reject", reason: "conflict", phrase_only: "would_accept" });
    expect(decided()[1]).toMatchObject({ group_id: gid(4), decision: "accept", phrase_only: "would_reject" });
  });

  it("submits the batch once every group is decided and shows another's batch read-only", async () => {
    groups = [group(1, { state: "decided", decision: decision(gid(1)) })];
    const { unmount } = renderScreen();
    const submit = await screen.findByRole("button", { name: "Submit batch" });
    fireEvent.click(submit);
    await waitFor(() => expect(api.singleTermBatchAction).toHaveBeenCalledWith("p", 3, "submit", expect.any(String)));
    expect(await screen.findByText(/This batch is submitted/)).toBeDefined();
    unmount();

    groups = [group(1)];
    renderScreen({ username: "lead-1", canManage: true });
    expect(await screen.findByText(/belongs to rev-04/)).toBeDefined();
    expect(screen.queryByRole("button", { name: /Yes, as a phrase/ })).toBeNull();
    expect(screen.queryByRole("button", { name: "Submit batch" })).toBeNull();
    await waitFor(() => expect(api.singleTermContexts).toHaveBeenCalled());
  });
});
