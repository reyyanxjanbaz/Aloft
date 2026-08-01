import { describe, expect, it } from "vitest";
import { remapForScreen, tiltVector, TILT_RANGE_DEG } from "./tiltMath";

describe("remapForScreen", () => {
  it("passes beta/gamma straight through in portrait", () => {
    expect(remapForScreen(60, 20, 0)).toEqual({ pitch: 60, roll: 20 });
  });

  it("swaps the axes in landscape so roll stays roll however the phone is held", () => {
    expect(remapForScreen(60, 20, 90)).toEqual({ pitch: -20, roll: 60 });
    expect(remapForScreen(60, 20, 270)).toEqual({ pitch: 20, roll: -60 });
    expect(remapForScreen(60, 20, 180)).toEqual({ pitch: -60, roll: -20 });
  });
});

describe("tiltVector", () => {
  // The bug: the old mapping saturated at 22 degrees, so any normal handheld
  // roll pinned the light to a corner and the foil stopped responding.
  it("does not saturate at ordinary handheld angles", () => {
    const { tx } = tiltVector(25, 60, 60);
    expect(Math.abs(tx)).toBeLessThan(1);
    const bigger = tiltVector(40, 60, 60);
    expect(Math.abs(bigger.tx)).toBeGreaterThan(Math.abs(tx)); // still responding
  });

  it("is neutral when the phone rests at the calibrated pitch", () => {
    // Whatever posture you hold the phone in becomes the resting position.
    expect(tiltVector(0, 60, 60)).toEqual({ tx: 0, ty: 0 });
    expect(tiltVector(0, 0, 0)).toEqual({ tx: 0, ty: 0 });
  });

  it("responds symmetrically either side of the calibrated pitch", () => {
    const up = tiltVector(0, 60 + 15, 60);
    const down = tiltVector(0, 60 - 15, 60);
    expect(up.ty).toBeCloseTo(-down.ty, 5);
    expect(up.ty).not.toBe(0);
  });

  it("still clamps once the tilt runs past the usable range", () => {
    expect(tiltVector(TILT_RANGE_DEG * 3, 60, 60).tx).toBe(1);
    expect(tiltVector(-TILT_RANGE_DEG * 3, 60, 60).tx).toBe(-1);
  });

  it("uses a range wide enough for real wrist movement", () => {
    // A 22 degree range was the defect; a wrist roll easily exceeds it.
    expect(TILT_RANGE_DEG).toBeGreaterThanOrEqual(30);
  });
});
