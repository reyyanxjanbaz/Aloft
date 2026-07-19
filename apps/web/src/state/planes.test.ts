import { describe, expect, it } from "vitest";
import { MAX_VIEW_RADIUS_KM, MIN_VIEW_RADIUS_KM } from "@aloft/shared";
import { clampView, sameView } from "./planes";

describe("clampView", () => {
  it("holds the radius inside what the server will serve", () => {
    expect(clampView({ lat: 0, lon: 0, viewRadiusKm: 1 }).viewRadiusKm).toBe(MIN_VIEW_RADIUS_KM);
    expect(clampView({ lat: 0, lon: 0, viewRadiusKm: 9999 }).viewRadiusKm).toBe(MAX_VIEW_RADIUS_KM);
  });

  it("leaves a sane radius and the position untouched", () => {
    const v = clampView({ lat: 51.47, lon: -0.45, viewRadiusKm: 60 });
    expect(v).toEqual({ lat: 51.47, lon: -0.45, viewRadiusKm: 60 });
  });
});

describe("sameView", () => {
  const base = { lat: 51.47, lon: -0.45, viewRadiusKm: 60 };

  it("treats GPS jitter as the same view", () => {
    // Otherwise a resting device re-subscribes on every fix.
    expect(sameView(base, { ...base, lat: 51.4705, lon: -0.4503 })).toBe(true);
  });

  it("treats a real move as a new view", () => {
    expect(sameView(base, { ...base, lat: 51.6 })).toBe(false);
  });

  it("ignores a trivial zoom change but not a real one", () => {
    expect(sameView(base, { ...base, viewRadiusKm: 61 })).toBe(true);
    expect(sameView(base, { ...base, viewRadiusKm: 120 })).toBe(false);
  });
});
