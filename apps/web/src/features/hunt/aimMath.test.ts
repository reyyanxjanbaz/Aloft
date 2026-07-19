import { describe, expect, it } from "vitest";
import type { AircraftState } from "@aloft/shared";
import { CAPTURE_SECONDS, computeAimSolution, stepProgress } from "./aimMath";

const LHR = { lat: 51.47, lon: -0.45 };

function contact(over: Partial<AircraftState> = {}): AircraftState {
  return {
    hex: "abc123",
    callsign: "BAW1",
    lat: 51.47,
    lon: -0.45,
    altFt: 30_000,
    gsKt: 0,
    track: null,
    seenPosSec: 0,
    ts: 1_000_000,
    ...over,
  } as AircraftState;
}

describe("computeAimSolution", () => {
  it("reports no offset when aiming straight at the contact", () => {
    // Due north of the player, so the true bearing is 0.
    const ac = contact({ lat: 51.6, lon: -0.45 });
    const solution = computeAimSolution(LHR, { heading: 0, pitch: 0 }, ac, 1_000_000);
    expect(Math.abs(solution.dAz)).toBeLessThan(0.5);
    expect(solution.aligned).toBe(false); // elevation is still off
  });

  it("takes the short way around north", () => {
    // Aiming at 359 with the target at 1 is a 2 degree error, not 358 — get
    // this wrong and the reticle becomes unreachable near north.
    const ac = contact({ lat: 51.6, lon: -0.45 });
    const solution = computeAimSolution(LHR, { heading: 359, pitch: 0 }, ac, 1_000_000);
    expect(solution.dAz).toBeGreaterThan(0);
    expect(solution.dAz).toBeLessThan(2);
  });

  it("aligns when both axes are inside tolerance", () => {
    const ac = contact({ lat: 51.6, lon: -0.45, altFt: 30_000 });
    const aimed = computeAimSolution(LHR, { heading: 0, pitch: 0 }, ac, 1_000_000);
    const solution = computeAimSolution(LHR, { heading: 0, pitch: aimed.el }, ac, 1_000_000);
    expect(solution.aligned).toBe(true);
  });

  it("projects a moving contact forward, but never an unknown track", () => {
    const moving = contact({ gsKt: 450, track: 90, ts: 1_000_000 });
    const trackless = contact({ gsKt: 450, track: null, ts: 1_000_000 });
    const later = 1_030_000; // 30s on

    const movedAz = computeAimSolution(LHR, { heading: 0, pitch: 0 }, moving, later).az;
    const stillAz = computeAimSolution(LHR, { heading: 0, pitch: 0 }, trackless, later).az;

    // The eastbound contact has visibly moved; the trackless one must not
    // have been flung due north by a defaulted heading.
    expect(movedAz).toBeGreaterThan(45);
    expect(stillAz).toBe(0);
  });
});

describe("stepProgress", () => {
  it("fills the ring in exactly the capture time while aligned", () => {
    let p = 0;
    for (let t = 0; t < CAPTURE_SECONDS; t += 0.1) p = stepProgress(p, 0.1, true);
    expect(p).toBeCloseTo(1, 5);
  });

  it("drains faster than it fills when aim is lost", () => {
    const filled = stepProgress(0.5, 0.5, true);
    const drained = stepProgress(0.5, 0.5, false);
    expect(filled).toBeGreaterThan(0.5);
    expect(0.5 - drained).toBeGreaterThan(filled - 0.5);
  });

  it("clamps to the 0..1 range", () => {
    expect(stepProgress(1, 5, true)).toBe(1);
    expect(stepProgress(0, 5, false)).toBe(0);
  });
});
