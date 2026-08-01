import { describe, expect, it } from "vitest";
import { NM_TO_KM, type AircraftState, type ServerMessage } from "@aloft/shared";
import { SkyHub } from "./hub";
import type { FlightProvider } from "./providers/types";

function aircraftAt(lat: number, lon: number): AircraftState {
  return {
    hex: "abc123",
    callsign: "BAW1",
    reg: "G-EUUU",
    typeIcao: "A320",
    lat,
    lon,
    altFt: 30_000,
    gsKt: 450,
    track: 90,
    seenPosSec: 0,
    ts: Date.now(),
  } as AircraftState;
}

/** Counts upstream polls so we can assert the on-demand path fires exactly once. */
class CountingProvider implements FlightProvider {
  readonly name = "counting";
  calls = 0;
  lastRadiusNm = 0;

  async getAircraftNear(lat: number, lon: number, radiusNm: number): Promise<AircraftState[]> {
    this.calls++;
    this.lastRadiusNm = radiusNm;
    return [aircraftAt(lat + 0.01, lon)];
  }

  async getAirframe(): Promise<null> {
    return null; // unused by the hub
  }
}

const AUTHED = { allowOnDemandPoll: true };

describe("SkyHub.validateCatch", () => {
  it("polls on demand when history is empty, as after a restart", async () => {
    const provider = new CountingProvider();
    const hub = new SkyHub(provider);

    // A fresh instance has no position history for any hex, which without
    // the on-demand poll would reject every catch for a full poll cycle.
    const result = await hub.validateCatch("abc123", 51.47, -0.45, Date.now(), undefined, AUTHED);

    expect(provider.calls).toBe(1);
    expect(result.ok).toBe(true);
  });

  it("does not poll at all for an unauthenticated caller", async () => {
    const provider = new CountingProvider();
    const hub = new SkyHub(provider);

    // Without this gate, anyone could drive one wide upstream fetch per
    // request by submitting random hexes.
    const result = await hub.validateCatch("abc123", 51.47, -0.45, Date.now());

    expect(provider.calls).toBe(0);
    expect(result.ok).toBe(false);
  });

  it("coalesces on-demand polls landing in the same cell", async () => {
    const provider = new CountingProvider();
    const hub = new SkyHub(provider);

    await Promise.all([
      hub.validateCatch("aaaaaa", 51.47, -0.45, Date.now(), undefined, AUTHED),
      hub.validateCatch("bbbbbb", 51.48, -0.44, Date.now(), undefined, AUTHED),
    ]);

    expect(provider.calls).toBe(1);
  });

  it("does not poll again once history covers the hex", async () => {
    const provider = new CountingProvider();
    const hub = new SkyHub(provider);

    await hub.validateCatch("abc123", 51.47, -0.45, Date.now(), undefined, AUTHED); // seeds history
    provider.calls = 0;
    await hub.validateCatch("abc123", 51.47, -0.45, Date.now(), undefined, AUTHED);

    expect(provider.calls).toBe(0);
  });

  it("still rejects an aircraft the on-demand poll does not find", async () => {
    const provider = new CountingProvider();
    const hub = new SkyHub(provider);

    const result = await hub.validateCatch("ffffff", 51.47, -0.45, Date.now(), undefined, AUTHED);

    expect(provider.calls).toBe(1);
    expect(result.ok).toBe(false);
  });
});

/**
 * Returns a stationary aircraft sitting exactly at the queried coordinate, with
 * a caller-set hex — so each catch can validate against a real plane genuinely
 * present at its own claimed location. That isolates the travel-plausibility
 * check from the ordinary "was the plane there?" distance check.
 */
class PlaceProvider implements FlightProvider {
  readonly name = "place";
  hex = "abc123";

  async getAircraftNear(lat: number, lon: number): Promise<AircraftState[]> {
    return [{ ...aircraftAt(lat, lon), hex: this.hex, track: null, gsKt: 0 } as AircraftState];
  }

  async getAirframe(): Promise<null> {
    return null;
  }
}

describe("SkyHub.validateCatch anti-cheat: implausible travel", () => {
  const PLAYER = "player-1";

  it("accepts a player's first catch, with no prior location to compare against", async () => {
    const hub = new SkyHub(new PlaceProvider());
    const result = await hub.validateCatch("abc123", 51.47, -0.45, Date.now(), PLAYER, AUTHED);
    expect(result.ok).toBe(true);
  });

  it("rejects a second catch that implies impossible travel from the first", async () => {
    // A worldwide catch-farmer echoing each plane's own broadcast position
    // teleports across the planet between catches. A real plane sits at each
    // spot (so the distance check passes), but no vehicle covers ~9,500 km
    // (London → Tokyo) in 30 s, so the second catch must be refused.
    const provider = new PlaceProvider();
    const hub = new SkyHub(provider);
    const t0 = Date.now();
    provider.hex = "london";
    const london = await hub.validateCatch("london", 51.47, -0.45, t0, PLAYER, AUTHED);
    expect(london.ok).toBe(true);
    provider.hex = "tokyo";
    const tokyo = await hub.validateCatch("tokyo", 35.68, 139.76, t0 + 30_000, PLAYER, AUTHED);
    expect(tokyo.ok).toBe(false);
  });

  it("allows a second catch a short distance from the first", async () => {
    // Ordinary movement between two nearby catches must never be mistaken for
    // teleporting — the plausibility gate only rejects globe-spanning jumps.
    const provider = new PlaceProvider();
    const hub = new SkyHub(provider);
    const t0 = Date.now();
    provider.hex = "one";
    const first = await hub.validateCatch("one", 51.47, -0.45, t0, PLAYER, AUTHED);
    expect(first.ok).toBe(true);
    const second = await hub.validateCatch("one", 51.475, -0.451, t0 + 5_000, PLAYER, AUTHED);
    expect(second.ok).toBe(true);
  });

  it("does not constrain anonymous catches by travel speed (no identity to attribute movement to)", async () => {
    const provider = new PlaceProvider();
    const hub = new SkyHub(provider);
    const t0 = Date.now();
    provider.hex = "london";
    await hub.validateCatch("london", 51.47, -0.45, t0, undefined, AUTHED);
    provider.hex = "tokyo";
    const second = await hub.validateCatch("tokyo", 35.68, 139.76, t0 + 30_000, undefined, AUTHED);
    expect(second.ok).toBe(true);
  });
});

describe("SkyHub.subscribe", () => {
  it("sizes a new cell's very first poll to the joining subscriber's viewport", () => {
    const provider = new CountingProvider();
    const hub = new SkyHub(provider);
    const id = hub.allocateId();

    // The first poll of a fresh cell runs synchronously inside subscribe().
    // If the subscriber isn't registered by then, the radius collapses to the
    // cell slack alone and a wide scope arrives truncated to ~40 km.
    hub.subscribe({
      id,
      lat: 51.47,
      lon: -0.45,
      viewRadiusKm: 100,
      send: (_m: ServerMessage) => {},
    });

    try {
      expect(provider.calls).toBe(1);
      expect(provider.lastRadiusNm).toBeGreaterThanOrEqual(100 / NM_TO_KM);
    } finally {
      hub.unsubscribe(id); // clears the cell's poll interval
    }
  });
});
