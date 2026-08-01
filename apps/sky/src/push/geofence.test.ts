import { describe, expect, it, vi } from "vitest";
import type { AircraftState } from "@aloft/shared";
import type { FlightProvider } from "../providers/types";
import type { PushStore, StoredSub } from "./store";
import { runGeofenceTick } from "./geofence";

const idleProvider: FlightProvider = {
  name: "idle",
  async getAircraftNear(): Promise<AircraftState[]> {
    return [];
  },
  async getAirframe() {
    return null;
  },
};

/** A store stub exposing just the surface the geofence tick uses. */
function fakeStore(overrides: Partial<PushStore>): PushStore {
  return {
    all: async () => [] as StoredSub[],
    markPinged: async () => {},
    remove: async () => {},
    ...overrides,
  } as unknown as PushStore;
}

describe("runGeofenceTick", () => {
  it("resolves instead of rejecting when loading subscriptions fails", async () => {
    // A transient Supabase/pooler blip must not crash the single instance —
    // the tick fires unawaited on an interval, so a rejection here would be an
    // unhandled rejection that takes down the whole service (radar included).
    const store = fakeStore({
      all: vi.fn(async () => {
        throw new Error("pooler restarting");
      }),
    });

    await expect(runGeofenceTick(idleProvider, store, Date.now())).resolves.toBeUndefined();
  });
});
