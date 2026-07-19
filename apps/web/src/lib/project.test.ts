import { describe, expect, it } from "vitest";
import { distanceM, type AircraftState } from "@aloft/shared";
import { projectedPosition } from "./project";

function contact(over: Partial<AircraftState> = {}): AircraftState {
  return {
    hex: "abc123",
    callsign: "BAW1",
    lat: 51.47,
    lon: -0.45,
    altFt: 30_000,
    gsKt: 450,
    track: 90,
    seenPosSec: 0,
    ts: 1_000_000,
    ...over,
  } as AircraftState;
}

describe("projectedPosition", () => {
  it("leaves a just-reported contact where it is", () => {
    const ac = contact();
    const p = projectedPosition(ac, ac.ts);
    expect(p.lat).toBeCloseTo(ac.lat, 6);
    expect(p.lon).toBeCloseTo(ac.lon, 6);
  });

  it("carries a moving contact along its track", () => {
    const ac = contact({ track: 90 }); // due east
    const p = projectedPosition(ac, ac.ts + 30_000);
    expect(p.lon).toBeGreaterThan(ac.lon);
    expect(p.lat).toBeCloseTo(ac.lat, 2);
    // 450 kt for 30s is about 6.9 km.
    expect(distanceM(ac.lat, ac.lon, p.lat, p.lon)).toBeGreaterThan(6000);
  });

  it("never projects a contact with an unknown track", () => {
    // A defaulted 0 here would send it due north at cruise speed.
    const ac = contact({ track: null });
    const p = projectedPosition(ac, ac.ts + 30_000);
    expect(p.lat).toBe(ac.lat);
    expect(p.lon).toBe(ac.lon);
  });

  it("includes the feed's own reported staleness in the age", () => {
    const fresh = projectedPosition(contact({ seenPosSec: 0 }), 1_000_000);
    const stale = projectedPosition(contact({ seenPosSec: 20 }), 1_000_000);
    expect(distanceM(fresh.lat, fresh.lon, stale.lat, stale.lon)).toBeGreaterThan(1000);
  });

  it("stops extrapolating after a minute", () => {
    const ac = contact();
    const oneMinute = projectedPosition(ac, ac.ts + 60_000);
    const tenMinutes = projectedPosition(ac, ac.ts + 600_000);
    // Beyond a minute the straight line is fiction — a turning aircraft is
    // long gone, so the projection is capped rather than confidently wrong.
    expect(tenMinutes.lat).toBeCloseTo(oneMinute.lat, 6);
    expect(tenMinutes.lon).toBeCloseTo(oneMinute.lon, 6);
  });

  it("does not project a stationary contact", () => {
    const ac = contact({ gsKt: 0 });
    const p = projectedPosition(ac, ac.ts + 30_000);
    expect(p.lat).toBe(ac.lat);
    expect(p.lon).toBe(ac.lon);
  });
});
