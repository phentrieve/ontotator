import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it } from "vitest";
import type { ConsolidationGroupView } from "../../src/api/client";
import type { ConsolidationPersonView } from "../../src/api/client";
import { choose, comparisonRows, resultLine, type Choices } from "../../src/consolidation/groupModel";
import { ComparisonTable } from "../../src/consolidation/ComparisonTable";
import { ResultLine } from "../../src/consolidation/ResultLine";
import { ANA, BEN, CHRIS, frequent, group, hypotoniaThree, LUC, member, MOD_TEXT, recurrent, seizure, severe, span, TEXT, THREE } from "./fixtures";

afterEach(cleanup);

function Harness({ group, people = THREE, text = TEXT, readOnly = false }: { group: ConsolidationGroupView; people?: ConsolidationPersonView[]; text?: string; readOnly?: boolean }) {
  const [choices, setChoices] = useState<Choices>({});
  return <>
    <ComparisonTable name="muscular hypotonia" group={group} people={people} rows={comparisonRows(group, people, text, choices)} readOnly={readOnly}
      onChoose={(row, value) => setChoices(current => choose(group, current, row, value))} />
    <ResultLine line={resultLine(group, people, text, choices)} />
  </>;
}

const result = () => document.querySelector(".cons-result")!.textContent;

describe("ComparisonTable", () => {
  it("a conflicting row has a check per person and takes the value", () => {
    render(<Harness group={hypotoniaThree()} />);
    expect(screen.getByRole("table", { name: "Comparison of muscular hypotonia" })).toBeTruthy();
    const take = screen.getByRole("button", { name: "Take Absent from Mia Berg for Assertion" });
    expect(take.getAttribute("aria-pressed")).toBe("false");
    fireEvent.click(take);
    expect(take.getAttribute("aria-pressed")).toBe("true");
    expect(result()).toContain("Absent, Patient, Current");
    expect(screen.getByRole("rowheader", { name: /Assertion/ }).textContent).toContain("Conflict");
  });

  it("agreed rows are one grey line", () => {
    render(<Harness group={hypotoniaThree()} />);
    const cells = [...document.querySelectorAll(".cons-agreed")].filter(cell => cell.textContent === "Patient (all agree)");
    expect(cells).toHaveLength(1);
    expect(cells[0].getAttribute("colspan")).toBe("3");
    expect(cells[0].querySelector(".axis-value--patient")?.textContent).toBe("Patient");
    // #472: everyone marked the same passage, so the Text row agrees like any other row.
    expect(screen.getByText("“muscular hypotonia” (all agree)").closest("td")?.className).toBe("cons-agreed cons-agreed-once");
    expect(document.body.textContent).not.toContain("overlapping");
  });

  // Issue 470: with many people the table scrolls sideways; one line per row to decide says who holds which value.
  it("a row to decide among many people says who holds which value, in a line that stays in view", () => {
    const people = Array.from({ length: 6 }, (_, index) => ({ person_id: `annotator-${index}`, label: `Annotator ${"ABCDEF"[index]}`, lane: Math.min(index + 1, 4) }));
    const many = group("g-many", ["term_related", "values_differ"], people.map((person, index) => member(`in-${index}`, person,
      index % 3 === 2 ? "HP:0000707" : "HP:0001252", index % 3 === 2 ? "Abnormality of the nervous system" : "Hypotonia", [span("muscular hypotonia")],
      { axes: { assertion: index === 1 ? "absent" : "present", experiencer: "patient", temporality: "current" } })),
    { differing_axes: ["assertion"], term_lineage: ["HP:0000707", "HP:0001252"] });
    render(<Harness group={many} people={people} />);
    const rows = [...document.querySelectorAll("tbody tr")];
    // Term row, its split, then the parent-term sentence; Assertion row, its split.
    expect(rows.slice(0, 5).map(row => row.className)).toEqual(["cons-row--conflict", "cons-row-hint cons-row-split", "cons-row-hint cons-row-hint",
      "cons-row--conflict", "cons-row-hint cons-row-split"]);
    expect(rows[1].textContent).toBe("Hypotonia 4 · Abnormality of the nervous system 2 (C, F)");
    expect(rows[2].textContent).toBe("Abnormality of the nervous system is a parent term of Hypotonia.");
    expect(rows[4].textContent).toBe("Present 5 · Absent 1 (B)");
    // Each line is one cell across the table whose content is pinned (.cons-pin), as is an agreed value shown once.
    for (const index of [1, 2, 4]) {
      expect(rows[index].querySelector("td")?.getAttribute("colspan")).toBe("7");
      expect(rows[index].querySelector("td > .cons-pin")?.textContent).toBe(rows[index].textContent);
    }
    expect(screen.getByText("“muscular hypotonia” (all agree)").className).toBe("cons-pin cons-pin-value");
    // Blinding: letters only, never a name or pseudonym.
    expect(document.querySelector(".cons-compare")?.textContent).not.toMatch(/ann-\d|annotator-\d/);
    // Read-only (a decided group): no rows to decide, no split lines.
    cleanup();
    render(<Harness group={many} people={people} readOnly />);
    expect(document.querySelector(".cons-row-split")).toBeNull();
    expect(document.querySelector(".cons-row-hint")?.textContent).toBe("Abnormality of the nervous system is a parent term of Hypotonia.");
  });

  it("three people fit without the split line", () => {
    render(<Harness group={hypotoniaThree()} />);
    expect(document.querySelector(".cons-row-split")).toBeNull();
  });

  it("an agreed value stands under every person, the line across is the narrow variant (B5-2)", () => {
    render(<Harness group={hypotoniaThree()} />);
    const row = screen.getByRole("rowheader", { name: "Experiencer" }).closest("tr")!;
    expect([...row.querySelectorAll(".cons-agreed-each")].map(cell => cell.textContent)).toEqual(["Patient", "Patient", "Patient"]);
    expect(row.querySelector(".cons-agreed-once")?.getAttribute("colspan")).toBe("3");
  });

  it("every row is visible: rows to decide first and highlighted, agreed rows muted; no Whole finding row (M-7d, M-7e)", () => {
    render(<Harness group={hypotoniaThree()} />);
    const headers = screen.getAllByRole("rowheader").map(header => header.textContent);
    expect(headers.slice(0, 2).every(header => header?.startsWith("Conflict"))).toBe(true);
    expect(screen.queryByRole("rowheader", { name: "Agreed" })).toBeNull();
    expect(screen.queryByRole("button", { name: /Show values/ })).toBeNull();
    for (const name of ["Experiencer", "Temporality"]) {
      const row = screen.getByRole("rowheader", { name }).closest("tr")!;
      expect(row.hidden).toBe(false);
      expect(row.classList.contains("cons-row--agreed")).toBe(true);
      expect(row.querySelector(".axis-value")).not.toBeNull();
    }
    expect(screen.getByRole("rowheader", { name: /Assertion/ }).closest("tr")!.classList.contains("cons-row--conflict")).toBe(true);
    expect(headers).not.toContain("Whole finding");
    expect(screen.queryByRole("button", { name: /finding$/ })).toBeNull();
  });

  it("a one-person group shows its values without '(all agree)' and without folding", () => {
    const lone = group("g-micro", ["partial"], [member("in-ml", LUC, "HP:0000252", "Microcephaly", [span("seizures")])]);
    const { container } = render(<Harness group={lone} people={[LUC]} />);
    expect(container.textContent).not.toContain("all agree");
    expect(screen.queryByRole("button", { name: "Show values" })).toBeNull();
    expect(screen.getByRole("rowheader", { name: "Term" })).toBeTruthy();
  });

  it("axis values use the fixed colour slots", () => {
    render(<Harness group={hypotoniaThree()} />);
    const present = within(screen.getByRole("row", { name: /Assertion/ })).getAllByText("Present");
    expect(present[0].classList.contains("axis-value--present")).toBe(true);
  });

  it("a one-person group and the result line show axis values as chips (F16)", () => {
    const lone = group("g-micro", ["partial"], [member("in-ml", LUC, "HP:0000252", "Microcephaly", [span("seizures")])]);
    const { container } = render(<Harness group={lone} people={[LUC]} />);
    for (const [label, slot] of [["Assertion", "present"], ["Experiencer", "patient"], ["Temporality", "current"]]) {
      expect(within(screen.getByRole("row", { name: new RegExp(label) })).getByText(/./, { selector: ".axis-value" }).classList.contains(`axis-value--${slot}`)).toBe(true);
    }
    expect(container.querySelectorAll(".cons-result .axis-value")).toHaveLength(3);
    expect(result()).toBe(resultLine(lone, [LUC], TEXT, {}).saved);
  });

  it("no pill buttons, no separators and no differs text", () => {
    const { container } = render(<Harness group={hypotoniaThree()} />);
    expect(screen.queryByText(/differs/)).toBeNull();
    expect(container.querySelector(".cons-chip")).toBeNull();
    expect(container.textContent).not.toContain("·");
    expect(container.textContent).not.toMatch(/both/i);
  });

  it("findings from a tool proposal carry the robot icon", () => {
    render(<Harness group={hypotoniaThree({}, { mia: { from_tool_proposal: true } })} />);
    const headers = screen.getAllByRole("columnheader");
    const mia = headers.find(header => header.textContent?.includes("Mia Berg"))!;
    const tom = headers.find(header => header.textContent?.includes("Tom Reis"))!;
    expect(within(mia).getByRole("img", { name: "From a tool proposal" }).getAttribute("title")).toBe("From a tool proposal");
    expect(within(tom).queryByRole("img", { name: "From a tool proposal" })).toBeNull();
  });
});

describe("ComparisonTable, Modifiers row", () => {
  const PEOPLE = [{ ...ANA, lane: 1 }, BEN, CHRIS];
  const s16 = () => seizure("g", ["modifiers_differ"], [[ANA, [severe("schwere")]], [BEN, [recurrent("wiederholt"), frequent()]], [CHRIS, [severe("schwere")]]]);
  const pressedOf = (name: string) => screen.getByRole("button", { name }).getAttribute("aria-pressed");

  it("one toggle per modifier per cell, named in words; identical modifiers press together", () => {
    render(<Harness group={s16()} people={PEOPLE} text={MOD_TEXT} />);
    const ana = "Take Severe “schwere” from Ana Weber for Modifiers (2 of 3)";
    const chris = "Take Severe “schwere” from Chris Lee for Modifiers (2 of 3)";
    expect(within(screen.getByRole("list", { name: "Modifiers of Ben Roth" })).getAllByRole("button")).toHaveLength(2);
    expect(pressedOf(ana)).toBe("false");
    fireEvent.click(screen.getByRole("button", { name: ana }));
    expect(pressedOf(ana)).toBe("true");
    expect(pressedOf(chris)).toBe("true");
    expect(result()).toContain("modifiers: Severe “schwere”");
    expect(screen.getByRole("rowheader", { name: /Modifiers/ }).textContent).toContain("Conflict");
  });

  it("majority and cohort term in words; no union, no Text of row, no separator", () => {
    const { container } = render(<Harness group={s16()} people={PEOPLE} text={MOD_TEXT} />);
    expect(within(screen.getByRole("list", { name: "Modifiers of Ana Weber" })).getByText("Severe “schwere” (2 of 3)")).toBeTruthy();
    expect(within(screen.getByRole("list", { name: "Modifiers of Ben Roth" })).getByText("Cohort term")).toBeTruthy();
    expect(container.textContent).not.toMatch(/·|Text of|All:|union/);
  });

  it("a released variant reads other text chosen; No modifiers is a toggle too", () => {
    const value = seizure("g", ["modifiers_differ"], [[ANA, [severe("schwere")]], [BEN, [severe()]], [CHRIS, []]]);
    render(<Harness group={value} people={PEOPLE} text={MOD_TEXT} />);
    fireEvent.click(screen.getByRole("button", { name: "Take Severe (no text) from Ben Roth for Modifiers" }));
    expect(within(screen.getByRole("list", { name: "Modifiers of Ana Weber" })).getByText("other text chosen")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Take No modifiers from Chris Lee for Modifiers" }));
    expect(pressedOf("Take Severe (no text) from Ben Roth for Modifiers")).toBe("false");
    expect(result()).toContain("no modifiers");
  });

  it("read-only shows the modifiers without toggles", () => {
    render(<Harness group={s16()} people={PEOPLE} text={MOD_TEXT} readOnly />);
    expect(within(screen.getByRole("list", { name: "Modifiers of Ana Weber" })).queryByRole("button")).toBeNull();
    expect(screen.getAllByText("Severe “schwere” (2 of 3)")).toHaveLength(2);
  });

  it("read-only tags the kept modifiers with kept (#163)", () => {
    const value = s16();
    const rows = comparisonRows(value, PEOPLE, MOD_TEXT, {});
    const kept = rows.find(row => row.id === "modifiers")!.cells[0].toggles![0].id;
    render(<ComparisonTable name="seizures" group={value} people={PEOPLE} readOnly onChoose={() => undefined}
      rows={comparisonRows(value, PEOPLE, MOD_TEXT, { modifiers: kept })} />);
    const ana = screen.getByRole("list", { name: "Modifiers of Ana Weber" });
    expect(within(ana).getByText("kept")).toBeTruthy();
    expect(screen.getAllByText("kept")).toHaveLength(2);
  });

  it("agreed modifiers are one grey line", () => {
    render(<Harness group={seizure("g", ["match"], [[ANA, [severe("schwere")]], [BEN, [severe("schwere")]]])} people={PEOPLE} text={MOD_TEXT} />);
    expect(screen.getByText("Severe “schwere” (all agree)").closest("td")?.getAttribute("colspan")).toBe("2");
  });
});
