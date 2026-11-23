import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { TermName } from "../src/editor/TermName";
import { shortTermId, TermIdsProvider } from "../src/editor/termIds";

afterEach(cleanup);

describe("shortTermId", () => {
  it("drops the prefix of the project's one ontology", () => {
    expect(shortTermId("XMPL:A01.1", ["xmpl"])).toBe("A01.1");
    expect(shortTermId("HP:0001250", ["hp"])).toBe("0001250");
  });

  it("keeps the full id with no, two or another ontology", () => {
    expect(shortTermId("XMPL:A01.1", [])).toBe("XMPL:A01.1");
    expect(shortTermId("XMPL:A01.1", ["xmpl", "hp"])).toBe("XMPL:A01.1");
    expect(shortTermId("HP:0001250", ["xmpl"])).toBe("HP:0001250");
  });

  it("keeps something that is no CURIE", () => {
    expect(shortTermId("A01.1", ["xmpl"])).toBe("A01.1");
    expect(shortTermId("XMPL:", ["xmpl"])).toBe("XMPL:");
    expect(shortTermId(":A01", ["xmpl"])).toBe(":A01");
  });
});

describe("TermName", () => {
  it("shows the full id without a provider", () => {
    render(<TermName termId="XMPL:A01.1" label="Example code one" />);
    expect(screen.getByText("XMPL:A01.1")).toBeTruthy();
  });

  it("shows the short code under the setting and keeps the full id as its title", () => {
    render(<TermIdsProvider ontologyIds={["xmpl"]}><TermName termId="XMPL:A01.1" label="Example code one" /></TermIdsProvider>);
    const code = screen.getByText("A01.1");
    expect(code.getAttribute("title")).toBe("XMPL:A01.1");
    expect(screen.queryByText("XMPL:A01.1")).toBeNull();
  });
});
