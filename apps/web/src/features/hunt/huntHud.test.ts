import { describe, expect, it } from "vitest";
import { BRACKET_CLOSED, BRACKET_OPEN, bracketScale } from "./Reticle";
import { ladderOffsetPx, LADDER_PX_PER_DEG, LADDER_SPAN_DEG } from "./ElevationLadder";

describe("bracketScale", () => {
  it("runs from fully open to fully closed across the hold", () => {
    expect(bracketScale(0)).toBe(BRACKET_OPEN);
    expect(bracketScale(1)).toBe(BRACKET_CLOSED);
    expect(bracketScale(0.5)).toBeCloseTo((BRACKET_OPEN + BRACKET_CLOSED) / 2, 5);
  });

  it("clamps, so a progress value outside 0..1 can never invert the brackets", () => {
    // stepProgress already clamps, but the loop writes this straight into a
    // transform — a negative scale would flip the reticle inside out.
    expect(bracketScale(-3)).toBe(BRACKET_OPEN);
    expect(bracketScale(9)).toBe(BRACKET_CLOSED);
  });

  it("closes monotonically", () => {
    let previous = bracketScale(0);
    for (let p = 0.1; p <= 1; p += 0.1) {
      const next = bracketScale(p);
      expect(next).toBeLessThan(previous);
      previous = next;
    }
  });
});

describe("ladderOffsetPx", () => {
  it("puts the horizon at the bottom and the top of the span at the top", () => {
    expect(ladderOffsetPx(0)).toBe(0);
    expect(ladderOffsetPx(LADDER_SPAN_DEG)).toBe(LADDER_SPAN_DEG * LADDER_PX_PER_DEG);
  });

  it("clamps below the horizon and above the zenith", () => {
    // Contacts below the horizon and a phone pointed at the ground both
    // happen; neither may push a mark off the end of the scale.
    expect(ladderOffsetPx(-40)).toBe(0);
    expect(ladderOffsetPx(140)).toBe(LADDER_SPAN_DEG * LADDER_PX_PER_DEG);
  });
});
