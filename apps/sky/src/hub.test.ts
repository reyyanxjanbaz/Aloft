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
