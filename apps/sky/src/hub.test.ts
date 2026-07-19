import { describe, expect, it } from "vitest";
import type { AircraftState } from "@aloft/shared";
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

  async getAircraftNear(lat: number, lon: number): Promise<AircraftState[]> {
    this.calls++;
    return [aircraftAt(lat + 0.01, lon)];
  }
}

describe("SkyHub.validateCatch", () => {
  it("polls on demand when history is empty, as after a restart", async () => {
    const provider = new CountingProvider();
    const hub = new SkyHub(provider);

    // A fresh instance has no position history for any hex, which without
    // the on-demand poll would reject every catch for a full poll cycle.
    const result = await hub.validateCatch("abc123", 51.47, -0.45, Date.now());

    expect(provider.calls).toBe(1);
    expect(result.ok).toBe(true);
  });

  it("does not poll again once history covers the hex", async () => {
    const provider = new CountingProvider();
    const hub = new SkyHub(provider);

    await hub.validateCatch("abc123", 51.47, -0.45, Date.now()); // seeds history
    provider.calls = 0;
    await hub.validateCatch("abc123", 51.47, -0.45, Date.now());

    expect(provider.calls).toBe(0);
  });

  it("still rejects an aircraft the on-demand poll does not find", async () => {
    const provider = new CountingProvider();
    const hub = new SkyHub(provider);

    const result = await hub.validateCatch("ffffff", 51.47, -0.45, Date.now());

    expect(provider.calls).toBe(1);
    expect(result.ok).toBe(false);
  });
});
