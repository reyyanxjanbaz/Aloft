import { describe, expect, it } from "vitest";
import { deriveHeading, derivePitch, type OrientationSample } from "./aimSensor";

const base: OrientationSample = { alpha: null, beta: null, gamma: null, absolute: true };

describe("deriveHeading", () => {
  it("passes an iOS compass heading straight through in portrait", () => {
    expect(deriveHeading({ ...base, webkitCompassHeading: 90 }, 0)).toBe(90);
  });

  it("offsets the iOS heading by the screen rotation", () => {
    // webkitCompassHeading is relative to the top of the device, so rotating
    // the phone into landscape turns the camera without changing the number.
    expect(deriveHeading({ ...base, webkitCompassHeading: 90 }, 90)).toBe(180);
    expect(deriveHeading({ ...base, webkitCompassHeading: 350 }, 90)).toBe(80); // wraps
  });

  it("derives a heading from absolute alpha and folds in screen rotation", () => {
    expect(deriveHeading({ ...base, alpha: 90, absolute: true }, 0)).toBe(270);
    expect(deriveHeading({ ...base, alpha: 90, absolute: true }, 90)).toBe(0);
  });

  it("returns null without any usable input", () => {
    expect(deriveHeading(base, 0)).toBeNull();
  });
});

describe("derivePitch", () => {
  it("uses beta in portrait, zeroed at vertical", () => {
    // beta 90 means the phone is upright: looking at the horizon.
    expect(derivePitch({ ...base, beta: 90 }, 0)).toBe(0);
    expect(derivePitch({ ...base, beta: 135 }, 0)).toBe(45);
  });

  it("uses gamma in landscape, with the sign following the rotation direction", () => {
    // This is the case that was simply wrong before: reading beta in
    // landscape made the elevation readout and reticle height meaningless.
    expect(derivePitch({ ...base, gamma: -45, beta: 0 }, 90)).toBe(45);
    expect(derivePitch({ ...base, gamma: 45, beta: 0 }, 270)).toBe(45);
  });

  it("inverts beta when the phone is upside down", () => {
    expect(derivePitch({ ...base, beta: 45 }, 180)).toBe(45);
  });

  it("clamps to the vertical limits", () => {
    expect(derivePitch({ ...base, beta: 300 }, 0)).toBe(90);
    expect(derivePitch({ ...base, beta: -300 }, 0)).toBe(-90);
  });

  it("returns null when the axis it needs is missing", () => {
    expect(derivePitch({ ...base, gamma: null }, 90)).toBeNull();
    expect(derivePitch({ ...base, beta: null }, 0)).toBeNull();
  });
});
