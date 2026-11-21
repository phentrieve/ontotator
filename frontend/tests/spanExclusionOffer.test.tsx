import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SpanExclusionOffer } from "../src/editor/SpanExclusionOffer";
import { exclusionOffer } from "../src/editor/spanExclusion";

afterEach(cleanup);

const text = "Seit 2 Wochen wiederholt schwere Krampfanfälle.";
const seg = (word: string) => ({ start: text.indexOf(word), end: text.indexOf(word) + word.length });

describe("SpanExclusionOffer", () => {
  it("asks, previews the span now and after, and reports Exclude or Keep span", () => {
    const offer = exclusionOffer(text, [{ evidenceId: "ev", segments: [seg("wiederholt schwere Krampfanfälle")] }], [seg("schwere")])!;
    const onAccept = vi.fn(), onDismiss = vi.fn();
    const { container } = render(<SpanExclusionOffer finding="Seizure" modifier="Severe" text={text} offer={offer} onAccept={onAccept} onDismiss={onDismiss} />);
    expect(screen.getByRole("status", { name: "Exclude Severe from the span" })).toBeDefined();
    expect(screen.getByText("Exclude “schwere” from the text span of Seizure?")).toBeDefined();
    expect(container.querySelector("[data-exclusion-before]")?.textContent).toBe("wiederholt schwere Krampfanfälle");
    expect(container.querySelector("[data-exclusion-before] del")?.textContent).toBe("schwere");
    expect(container.querySelector("[data-exclusion-after]")?.textContent).toBe("wiederholt … Krampfanfälle");
    fireEvent.click(screen.getByRole("button", { name: "Exclude from span" }));
    fireEvent.click(screen.getByRole("button", { name: "Keep span" }));
    expect(onAccept).toHaveBeenCalledTimes(1);
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it("opened from the modifier's row, it focuses Exclude from span (issue 535)", () => {
    const offer = exclusionOffer(text, [{ evidenceId: "ev", segments: [seg("wiederholt schwere Krampfanfälle")] }], [seg("schwere")])!;
    render(<SpanExclusionOffer finding="Seizure" modifier="Severe" text={text} offer={offer} onAccept={vi.fn()} onDismiss={vi.fn()} autoFocus />);
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Exclude from span" }));
  });
});

