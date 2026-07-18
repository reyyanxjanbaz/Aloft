import { describe, expect, it } from "vitest";
import { bearingDeg, deadReckon, distanceM, elevationDeg, FT_TO_M } from "./geo";

// Fixture: observer in central London, plane over Heathrow (~23 km west).
const LON = { lat: 51.5074, lon: -0.1278 };
const LHR = { lat: 51.47, lon: -0.4543 };

describe("distanceM", () => {
  it("London → Heathrow is ~23 km", () => {
    const d = distanceM(LON.lat, LON.lon, LHR.lat, LHR.lon);
    expect(d).toBeGreaterThan(22_000);
    expect(d).toBeLessThan(24_000);
  });

  it("zero for identical points", () => {
    expect(distanceM(10, 20, 10, 20)).toBe(0);
  });
});

describe("bearingDeg", () => {
  it("due north is 0", () => {
    expect(bearingDeg(51, 0, 52, 0)).toBeCloseTo(0, 5);
  });

  it("due east is ~90", () => {
    expect(bearingDeg(0, 0, 0, 1)).toBeCloseTo(90, 5);
  });

  it("London → Heathrow is roughly west-southwest", () => {
    const b = bearingDeg(LON.lat, LON.lon, LHR.lat, LHR.lon);
    expect(b).toBeGreaterThan(240);
    expect(b).toBeLessThan(270);
  });
});

describe("elevationDeg", () => {
  it("plane at FL350 10 km away sits at ~46-47 degrees", () => {
    const el = elevationDeg(10_000, 0, 35_000 * FT_TO_M);
    expect(el).toBeGreaterThan(45);
    expect(el).toBeLessThan(48);
  });

  it("directly overhead is 90", () => {
    expect(elevationDeg(0, 0, 10_000)).toBe(90);
  });

  it("below the horizon is negative", () => {
    expect(elevationDeg(10_000, 1_000, 0)).toBeLessThan(0);
  });

  it("directly below at zero ground distance is -90, not +90", () => {
    // Regression: a special-cased `groundDistanceM <= 0 -> return 90` used to
    // report "straight up" for a target directly underneath the observer.
    expect(elevationDeg(0, 100, 50)).toBeCloseTo(-90, 5);
  });

  it("same altitude at zero ground distance is level (0), not +90", () => {
    expect(elevationDeg(0, 50, 50)).toBe(0);
  });
});

describe("deadReckon", () => {
  it("450 kt due north for 10 s moves ~2.3 km north", () => {
    const [lat, lon] = deadReckon(51.5, -0.12, 0, 450, 10);
    const moved = distanceM(51.5, -0.12, lat, lon);
    expect(moved).toBeGreaterThan(2_200);
    expect(moved).toBeLessThan(2_450);
    expect(lat).toBeGreaterThan(51.5);
    expect(Math.abs(lon - -0.12)).toBeLessThan(0.001);
  });

  it("no movement when speed is zero", () => {
    expect(deadReckon(51.5, -0.12, 90, 0, 10)).toEqual([51.5, -0.12]);
  });

  it("no movement when speed is negative or NaN (corrupted reading)", () => {
    expect(deadReckon(51.5, -0.12, 90, -50, 10)).toEqual([51.5, -0.12]);
    expect(deadReckon(51.5, -0.12, 90, NaN, 10)).toEqual([51.5, -0.12]);
  });
});
