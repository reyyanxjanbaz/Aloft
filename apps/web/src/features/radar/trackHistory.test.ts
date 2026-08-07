import { beforeEach, describe, expect, it } from "vitest";
import type { AircraftState } from "@aloft/shared";
import { clearTracks, recordTracks, trailFor, trendFor, TRAIL_POINTS } from "./trackHistory";

function ac(over: Partial<AircraftState> & { hex: string }): AircraftState {
  return {
    callsign: "",
    lat: 51.5,
    lon: -0.5,
    altFt: 30_000,
    gsKt: 400,
    track: 90,
    seenPosSec: 0,
    ts: 1_000,
    ...over,
  };
}

beforeEach(() => clearTracks());

describe("recordTracks", () => {
  it("records one point per new server fix", () => {
    recordTracks([ac({ hex: "a", ts: 1000, lat: 51.0 })]);
    recordTracks([ac({ hex: "a", ts: 2000, lat: 51.1 })]);
    expect(trailFor("a").map((p) => p.lat)).toEqual([51.0, 51.1]);
  });

  it("ignores repeats of the same fix", () => {
    // The same state arrives on every render frame until the server sends a
    // new one; recording those would draw a pile of dots in one place.
    recordTracks([ac({ hex: "a", ts: 1000 })]);
    recordTracks([ac({ hex: "a", ts: 1000 })]);
    recordTracks([ac({ hex: "a", ts: 1000 })]);
    expect(trailFor("a")).toHaveLength(1);
  });

  it("keeps only the most recent points", () => {
    for (let i = 0; i < TRAIL_POINTS + 4; i++) {
      recordTracks([ac({ hex: "a", ts: 1000 + i, lat: 50 + i })]);
    }
    const trail = trailFor("a");
    expect(trail).toHaveLength(TRAIL_POINTS);
    // Oldest first, and the very first fixes have been dropped.
    expect(trail[0]!.lat).toBe(54);
    expect(trail[TRAIL_POINTS - 1]!.lat).toBe(57);
  });

  it("forgets contacts that leave the scope", () => {
    // Without this the map grows for every aircraft ever streamed and never
    // shrinks — thousands of entries over a long session on a busy cell.
    recordTracks([ac({ hex: "a", ts: 1000 }), ac({ hex: "b", ts: 1000 })]);
    recordTracks([ac({ hex: "a", ts: 2000 })]);
    expect(trailFor("a")).toHaveLength(2);
    expect(trailFor("b")).toEqual([]);
  });

  it("restarts a contact that comes back rather than joining the old trail", () => {
    recordTracks([ac({ hex: "a", ts: 1000, lat: 40 })]);
    recordTracks([]);
    recordTracks([ac({ hex: "a", ts: 5000, lat: 60 })]);
    expect(trailFor("a").map((p) => p.lat)).toEqual([60]);
  });
});

describe("trendFor", () => {
  it("is level until there are two fixes to compare", () => {
    expect(trendFor("unknown")).toBe("level");
    recordTracks([ac({ hex: "a", ts: 1000, altFt: 10_000 })]);
    expect(trendFor("a")).toBe("level");
  });

  it("reads a climb and a descent from observed altitude", () => {
    recordTracks([ac({ hex: "up", ts: 1000, altFt: 10_000 })]);
    recordTracks([ac({ hex: "up", ts: 2000, altFt: 12_000 })]);
    expect(trendFor("up")).toBe("up");

    recordTracks([ac({ hex: "up", ts: 1000, altFt: 12_000 }), ac({ hex: "dn", ts: 1000, altFt: 30_000 })]);
    recordTracks([ac({ hex: "up", ts: 2000, altFt: 12_000 }), ac({ hex: "dn", ts: 2000, altFt: 24_000 })]);
    expect(trendFor("dn")).toBe("down");
  });

  it("treats small wobble as level", () => {
    recordTracks([ac({ hex: "a", ts: 1000, altFt: 30_000 })]);
    recordTracks([ac({ hex: "a", ts: 2000, altFt: 30_100 })]);
    expect(trendFor("a")).toBe("level");
  });
});
