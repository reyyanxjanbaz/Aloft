import { describe, expect, it } from "vitest";
import { closestApproach, type ApproachTarget } from "./approach";

const ME = { lat: 51.47, lon: -0.45 };
/** Degrees of latitude per kilometre, near enough for fixtures. */
const KM_LAT = 1 / 110.574;
const KM_LON = 1 / (111.32 * Math.cos((ME.lat * Math.PI) / 180));

function target(over: Partial<ApproachTarget> = {}): ApproachTarget {
  return { lat: ME.lat, lon: ME.lon, track: 90, gsKt: 450, ...over };
}

describe("closestApproach", () => {
  it("predicts a head-on crossing passing overhead", () => {
    // 50 km due west, flying east straight at the player.
    const ac = target({ lon: ME.lon - 50 * KM_LON, track: 90 });
    const result = closestApproach(ME, ac);

    expect(result).not.toBeNull();
    expect(result!.closeKm).toBeLessThan(1);
    expect(result!.entersCaptureRange).toBe(true);
    // 50 km at 450 kt (~833 km/h) is about 3.6 minutes.
    expect(result!.tCloseSec).toBeGreaterThan(180);
    expect(result!.tCloseSec).toBeLessThan(260);
  });

  it("reports a receding aircraft as already at its closest", () => {
    // 50 km east and continuing east: the closest point is behind it.
    const ac = target({ lon: ME.lon + 50 * KM_LON, track: 90 });
    const result = closestApproach(ME, ac)!;

    expect(result.tCloseSec).toBe(0);
    expect(result.closeKm).toBeCloseTo(50, 0);
    expect(result.entersCaptureRange).toBe(false);
  });

  it("keeps a parallel track at its offset and never in range", () => {
    // 40 km north of the player, flying east — it never gets closer.
    const ac = target({ lat: ME.lat + 40 * KM_LAT, lon: ME.lon - 50 * KM_LON, track: 90 });
    const result = closestApproach(ME, ac)!;

    expect(result.closeKm).toBeCloseTo(40, 0);
    expect(result.entersCaptureRange).toBe(false);
  });

  it("names the direction to look at the closest point", () => {
    // Passing 30 km to the north: at closest approach it is due north, so
    // the bearing is 0 — the player should be told to look north, not at
    // where it is right now (west).
    const ac = target({ lat: ME.lat + 30 * KM_LAT, lon: ME.lon - 60 * KM_LON, track: 90 });
    const result = closestApproach(ME, ac)!;

    expect(result.bearingAtClose).toBeCloseTo(0, 1);
    expect(result.closeKm).toBeCloseTo(30, 0);
  });

  it("gives a southern pass the opposite bearing", () => {
    const ac = target({ lat: ME.lat - 30 * KM_LAT, lon: ME.lon - 60 * KM_LON, track: 90 });
    expect(closestApproach(ME, ac)!.bearingAtClose).toBeCloseTo(180, 1);
  });

  it("excludes an aircraft with no broadcast track", () => {
    // Guessing a heading would put a confident countdown on the board for an
    // aircraft we cannot actually predict.
    expect(closestApproach(ME, target({ track: null }))).toBeNull();
  });

  it("excludes a stationary aircraft", () => {
    expect(closestApproach(ME, target({ gsKt: 0 }))).toBeNull();
  });

  it("does not look further ahead than the horizon", () => {
    // 900 km out: within the horizon it barely closes, and the prediction is
    // clamped rather than promising an arrival 20 minutes away.
    const ac = target({ lon: ME.lon - 900 * KM_LON, track: 90 });
    const result = closestApproach(ME, ac, { horizonSec: 900 })!;

    expect(result.tCloseSec).toBe(900);
    expect(result.entersCaptureRange).toBe(false);
  });

  it("honours a custom capture radius", () => {
    const ac = target({ lat: ME.lat + 20 * KM_LAT, lon: ME.lon - 50 * KM_LON, track: 90 });
    expect(closestApproach(ME, ac, { captureKm: 15 })!.entersCaptureRange).toBe(false);
    expect(closestApproach(ME, ac, { captureKm: 25 })!.entersCaptureRange).toBe(true);
  });
});
