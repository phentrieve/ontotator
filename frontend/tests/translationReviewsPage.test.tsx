import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { api, ApiClient, ApiError, type TranslationReviewListPage, type TranslationReviewListRow } from "../src/api/client";
import { parseRoute, routeHref, type Route, type TranslationReviewsQuery } from "../src/app/router";
import { REVIEW_LIST_PAGE, TranslationReviewsPage } from "../src/admin/TranslationReviewsPage";

const ana = { pseudonym: "ann-0002", display_name: "Ana Weber", is_me: false };
const ben = { pseudonym: "ann-0003", display_name: "Ben Roth", is_me: false };
const review = (id: number, overrides: Partial<TranslationReviewListRow> = {}): TranslationReviewListRow => ({
  review_id: id, assignment_id: 100 + id, document_id: `doc-${id}`, case_id: `case-${id}`, language: "de", version: 1, reviewer: ana,
  decision: "accepted_unchanged", clinical_change: false, categories: [], rationale: null, changed_passages: 0, created_variant_id: null,
  submitted_at: "2026-11-05T10:00:00Z", assigned_at: "2026-11-04T09:00:00Z", ...overrides,
});
const pageOf = (reviews: TranslationReviewListRow[], overrides: Partial<TranslationReviewListPage> = {}): TranslationReviewListPage => ({
  reviews, total: reviews.length, limit: REVIEW_LIST_PAGE, offset: 0, reviewers: [ana, ben], languages: ["de", "fr"], ...overrides,
});
const show = (query: TranslationReviewsQuery = {}, onNavigate: (route: Route) => void = vi.fn()) =>
  render(<TranslationReviewsPage projectKey="p" query={query} onNavigate={onNavigate} />);
const row = (name: string) => within(screen.getByRole("row", { name }));

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

it("lists each review with reviewer, decision, flag, categories, rationale, changes and date", async () => {
  vi.spyOn(api, "listTranslationReviewList").mockResolvedValue(pageOf([
    review(3, { decision: "query", clinical_change: true, categories: ["source", "value"], rationale: "Is 5 mg right?", reviewer: ben, language: "fr" }),
    review(2, { decision: "accepted_corrected", changed_passages: 2, created_variant_id: "doc-2~de~v2", version: 1 }),
    review(1, { rationale: "The dose looks low, but the source says so.", version: 2 }),
    review(4, { review_id: null, decision: "open", clinical_change: null, changed_passages: null, submitted_at: null, reviewer: ben }),
  ]));
  show();
  await screen.findByRole("table", { name: "Translation reviews" });
  expect(api.listTranslationReviewList).toHaveBeenCalledWith("p", { reviewer: undefined, decision: undefined, language: undefined, sort: "-submitted", limit: REVIEW_LIST_PAGE, offset: 0 });
  expect(screen.getByRole("status").textContent).toContain("4 reviews.");

  const query = row("case-3 fr v1, Query");
  expect(query.getByRole("rowheader").textContent).toBe("case-3 fr v1");
  expect(query.getAllByRole("cell").map(cell => cell.textContent)).toEqual([
    "Ben Roth (ann-0003)", "Query", "Yes", "Problem in the source, Number or unit", "Is 5 mg right?", "None", expect.stringContaining("5 Nov"), "Open text",
  ]);
  // A query creates no version: its row opens the reviewed text.
  expect(query.getByRole("link").getAttribute("href")).toBe("#/projects/p/cases/case-3?variant=doc-3");

  const corrected = row("case-2 de v1, Accepted with corrections");
  expect(corrected.getByText("2 passages")).toBeTruthy();
  const compare = corrected.getByRole("link", { name: "Compare versions: case-2 de v1, Ana Weber (ann-0002)" });
  expect(compare.getAttribute("href")).toBe("#/projects/p/cases/case-2?variant=doc-2&compare=doc-2%7Ede%7Ev2");

  // The rationale of an accepting review is shown.
  const accepted = row("case-1 de v2, Accepted unchanged");
  expect(accepted.getByText("The dose looks low, but the source says so.")).toBeTruthy();
  expect(accepted.getByText("No")).toBeTruthy();

  const open = row("case-4 de v1, Open");
  expect(open.getByText("Not submitted")).toBeTruthy();
  expect(open.getAllByText("not set")).toHaveLength(4);
});

it("says so when the changes could not be counted, and counts one passage in the singular", async () => {
  vi.spyOn(api, "listTranslationReviewList").mockResolvedValue(pageOf([
    review(1, { decision: "rejected", changed_passages: null }), review(2, { decision: "accepted_corrected", changed_passages: 1 }),
  ]));
  show();
  expect((await screen.findByText("Not counted")).title).toBe("The texts differ too much to count the changes.");
  expect(screen.getByText("1 passage")).toBeTruthy();
});

it("sends the filters, the order and the page of the address to the server", async () => {
  const list = vi.spyOn(api, "listTranslationReviewList").mockResolvedValue(pageOf([review(1)], { total: 60, offset: 25 }));
  const onNavigate = vi.fn();
  show({ reviewer: "ann-0003", decision: "query", language: "fr", sort: "oldest", page: "2" }, onNavigate);
  await screen.findByRole("table", { name: "Translation reviews" });
  expect(list).toHaveBeenCalledWith("p", { reviewer: "ann-0003", decision: ["query"], language: ["fr"], sort: "submitted", limit: REVIEW_LIST_PAGE, offset: 25 });
  expect((screen.getByLabelText("Person") as HTMLSelectElement).value).toBe("ann-0003");
  expect((screen.getByLabelText("Decision") as HTMLSelectElement).value).toBe("query");
  expect((screen.getByLabelText("Language") as HTMLSelectElement).value).toBe("fr");
  expect((screen.getByLabelText("Order") as HTMLSelectElement).value).toBe("oldest");
  expect(screen.getByRole("status").textContent).toContain("60 reviews match the filters, page 2 of 3.");

  // A changed filter keeps the others and starts at page 1.
  fireEvent.change(screen.getByLabelText("Person"), { target: { value: "ann-0002" } });
  expect(onNavigate).toHaveBeenLastCalledWith({ name: "projectTranslationReviews", key: "p", reviewer: "ann-0002", decision: "query", language: "fr", sort: "oldest" });
  fireEvent.change(screen.getByLabelText("Decision"), { target: { value: "" } });
  expect(onNavigate).toHaveBeenLastCalledWith({ name: "projectTranslationReviews", key: "p", reviewer: "ann-0003", language: "fr", sort: "oldest" });
  fireEvent.change(screen.getByLabelText("Order"), { target: { value: "" } });
  expect(onNavigate).toHaveBeenLastCalledWith({ name: "projectTranslationReviews", key: "p", reviewer: "ann-0003", decision: "query", language: "fr" });

  const paging = within(screen.getByRole("navigation", { name: "Pages of translation reviews" }));
  expect(paging.getByRole("link", { name: "Previous" }).getAttribute("href")).toBe("#/projects/p/translation-reviews?reviewer=ann-0003&decision=query&language=fr&sort=oldest");
  fireEvent.click(paging.getByRole("link", { name: "Next" }));
  expect(onNavigate).toHaveBeenLastCalledWith({ name: "projectTranslationReviews", key: "p", reviewer: "ann-0003", decision: "query", language: "fr", sort: "oldest", page: "3" });
});

it("loads again when the address changes, and disables Previous on the first page", async () => {
  const list = vi.spyOn(api, "listTranslationReviewList").mockResolvedValue(pageOf([review(1)], { total: 30 }));
  const { rerender } = show();
  await screen.findByRole("table", { name: "Translation reviews" });
  const paging = within(screen.getByRole("navigation", { name: "Pages of translation reviews" }));
  expect(paging.getByRole("link", { name: "Previous" }).getAttribute("aria-disabled")).toBe("true");
  expect(paging.getByRole("link", { name: "Next" }).getAttribute("aria-disabled")).toBeNull();
  rerender(<TranslationReviewsPage projectKey="p" query={{ decision: "open" }} onNavigate={vi.fn()} />);
  await waitFor(() => expect(list).toHaveBeenCalledTimes(2));
  expect(list.mock.calls[1][1]).toMatchObject({ decision: ["open"], offset: 0 });
  // An unknown decision or page in the address is ignored.
  rerender(<TranslationReviewsPage projectKey="p" query={{ decision: "other", page: "x" }} onNavigate={vi.fn()} />);
  await waitFor(() => expect(list).toHaveBeenCalledTimes(3));
  expect(list.mock.calls[2][1]).toMatchObject({ decision: undefined, offset: 0 });
});

it("tells an empty project from an empty filter result", async () => {
  const list = vi.spyOn(api, "listTranslationReviewList").mockResolvedValue(pageOf([], { reviewers: [], languages: [] }));
  const { rerender } = show();
  expect(await screen.findByText("No translation reviews yet")).toBeTruthy();
  expect(screen.queryByRole("table")).toBeNull();
  list.mockResolvedValue(pageOf([]));
  rerender(<TranslationReviewsPage projectKey="p" query={{ reviewer: "gone-0001" }} onNavigate={vi.fn()} />);
  expect(await screen.findByText("No review matches the filters")).toBeTruthy();
  // The chosen person stays visible in the filter although the project no longer offers them.
  expect((screen.getByLabelText("Person") as HTMLSelectElement).value).toBe("gone-0001");
  expect(screen.getByRole("link", { name: "Show all reviews" }).getAttribute("href")).toBe("#/projects/p/translation-reviews");
});

it("says that the page is for leads when the server refuses", async () => {
  vi.spyOn(api, "listTranslationReviewList").mockRejectedValue(new ApiError(403, "Forbidden", "FORBIDDEN"));
  show();
  expect(await screen.findByText("You do not have access to this page.")).toBeTruthy();
  expect(screen.queryByLabelText("Person")).toBeNull();
});

it("has an address that keeps the filters", () => {
  const route: Route = { name: "projectTranslationReviews", key: "study a", reviewer: "ann-0003", decision: "accepted_corrected", language: "de", sort: "oldest", page: "2" };
  const href = routeHref(route);
  expect(href).toBe("#/projects/study%20a/translation-reviews?reviewer=ann-0003&decision=accepted_corrected&language=de&sort=oldest&page=2");
  expect(parseRoute(href)).toEqual(route);
  expect(parseRoute("#/projects/p/translation-reviews")).toEqual({ name: "projectTranslationReviews", key: "p" });
  expect(routeHref({ name: "projectTranslationReviews", key: "p" })).toBe("#/projects/p/translation-reviews");
});

it("asks the list route with repeated decision and language parameters", async () => {
  const fetchMock = vi.fn().mockImplementation(async () => new Response(JSON.stringify(pageOf([])), { status: 200, headers: { "Content-Type": "application/json" } }));
  vi.stubGlobal("fetch", fetchMock);
  try {
    await new ApiClient().listTranslationReviewList("study a", { reviewer: "ann-0003", decision: ["query", "open"], language: ["de"], sort: "submitted", limit: 25, offset: 50 });
    expect(String(fetchMock.mock.calls[0][0])).toBe("/api/v1/projects/study%20a/translation-review-list?reviewer=ann-0003&decision=query&decision=open&language=de&sort=submitted&limit=25&offset=50");
    await new ApiClient().listTranslationReviewList("p");
    expect(String(fetchMock.mock.calls[1][0])).toBe("/api/v1/projects/p/translation-review-list");
  } finally { vi.unstubAllGlobals(); }
});
