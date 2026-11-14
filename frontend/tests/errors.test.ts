// @vitest-environment node
import { describe, expect, it } from "vitest";
import { ApiError } from "../src/api/client";
import { ERROR_MESSAGES, errorMessage } from "../src/admin/errors";
import backendCodes from "../../contracts/admin-error-codes.json";

describe("shared API error messages", () => {
  it("maps every code from the actual committed backend catalog export", () => {
    expect(backendCodes.length).toBeGreaterThan(0);
    const missing = backendCodes.filter(code => !Object.hasOwn(ERROR_MESSAGES, code) || !ERROR_MESSAGES[code]?.trim());
    expect(missing).toEqual([]);
  });

  it("preserves the server's specific ORCID validation message", () => {
    expect(errorMessage(new ApiError(422, "ORCID checksum is invalid.", "ORCID_INVALID"))).toBe("ORCID checksum is invalid.");
  });
  it("gives a useful explanation for a known access code", () => {
    expect(errorMessage(new ApiError(404, "raw", "PROJECT_NOT_FOUND"))).toContain("You do not have access to this project");
  });

  it("says a busy project in words true for loads and writes, whatever the server text", () => {
    expect(errorMessage(new ApiError(503, "raw", "PROJECT_BUSY"))).toBe("The project is busy right now. Try again in a moment.");
  });

  it.each(["FUTURE_CODE", "toString", "constructor"])("uses the server message for unmapped code %s", code => {
    expect(errorMessage(new ApiError(500, "Server explanation", code))).toBe("Server explanation");
  });

  it("handles network errors and unknown thrown values without displaying object internals", () => {
    expect(errorMessage(new Error("Network unavailable"))).toBe("Network unavailable");
    expect(errorMessage({ secret: "not UI text" })).toBe("Something went wrong. Please try again.");
  });
});

it("explains the pending reanchor count and unsupported flagged re-import", () => {
  expect(errorMessage(new ApiError(422, "raw", "REANCHOR_ITEMS_UNRESOLVED", { count: 3 }))).toBe("3 finding(s) after text correction still need review. Re-create them or dismiss them with a reason before submitting.");
  expect(errorMessage(new ApiError(422, "raw", "UNSUPPORTED_REVIEW_RESOLUTION"))).toContain("cannot currently be imported again as proposals");
});

it("names the version and the refused field in guideline refusals", () => {
  expect(errorMessage(new ApiError(409, "raw", "GUIDELINE_UNCHANGED", { version: 2 }))).toBe("This file is identical to v2. Nothing was published.");
  expect(errorMessage(new ApiError(409, "raw", "GUIDELINE_ALREADY_WITHDRAWN", { version: 4 }))).toBe("v4 is already withdrawn.");
  expect(errorMessage(new ApiError(422, "raw", "GUIDELINE_NOTE_INVALID", { field: "change_note" }))).toBe("The change note must be one line of at most 280 characters.");
  expect(errorMessage(new ApiError(422, "raw", "GUIDELINE_NOTE_INVALID", { field: "reason" }))).toBe("The reason must be one line of at most 280 characters.");
  expect(errorMessage(new ApiError(413, "raw", "GUIDELINE_TOO_LARGE", { max_bytes: 262144 }))).toBe("The file is larger than 256 KB.");
  expect(errorMessage(new ApiError(422, "raw", "GUIDELINE_FILE_TYPE", { filename: "a.pdf" }))).toBe("Upload a .md or .txt file.");
  expect(errorMessage(new ApiError(409, "raw", "GUIDELINE_UNCHANGED", { version: "x" }))).toBe(ERROR_MESSAGES.GUIDELINE_UNCHANGED);
  expect(Object.hasOwn(ERROR_MESSAGES, "GUIDELINE_INCOMPLETE")).toBe(false);
});

it("names the queue limit of a refused job (issue 396)", () => {
  expect(errorMessage(new ApiError(429, "raw", "JOB_QUEUE_LIMIT", { max: 3 }))).toBe("You already have 3 jobs waiting. Try again when one of them has started.");
  expect(errorMessage(new ApiError(429, "raw", "JOB_QUEUE_LIMIT"))).toBe(ERROR_MESSAGES.JOB_QUEUE_LIMIT);
});

it("explains a text change refused because the new version has no proposals (issue 414)", () => {
  expect(errorMessage(new ApiError(422, "raw", "TEXT_CHANGE_NOT_APPLICABLE", { reason: "no_target_proposals" })))
    .toBe("The new version has no proposals yet, so this work cannot be carried. Import proposals for the new version first, or annotate it from scratch.");
  expect(errorMessage(new ApiError(422, "raw", "TEXT_CHANGE_NOT_APPLICABLE", { reason: "from_proposals" }))).toBe(ERROR_MESSAGES.TEXT_CHANGE_NOT_APPLICABLE);
});
