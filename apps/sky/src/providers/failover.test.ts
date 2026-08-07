import { describe, expect, it, vi } from "vitest";
import type { AircraftState } from "@aloft/shared";
import { FailoverProvider } from "./failover";
import type { FlightProvider } from "./types";

function stub(name: string, behaviour: "ok" | "throw"): FlightProvider {
  return {
    name,
    getAircraftNear: vi.fn(async (): Promise<AircraftState[]> => {
      if (behaviour === "throw") throw new Error(`${name} is down`);
      return [];
    }),
    getAirframe: vi.fn(async () => null),
  };
}

describe("FailoverProvider status", () => {
  it("reports nothing before any call", () => {
    const provider = new FailoverProvider([stub("primary", "ok")]);
    expect(provider.status()).toEqual({ active: null, benched: [], lastCallMs: null });
  });

  it("names the provider that actually served the call", async () => {
    const provider = new FailoverProvider([stub("primary", "ok"), stub("backup", "ok")]);
    await provider.getAircraftNear(51, 0, 50);
    expect(provider.status().active).toBe("primary");
  });

  it("names the backup once the primary has failed over", async () => {
    const provider = new FailoverProvider([stub("primary", "throw"), stub("backup", "ok")]);
    await provider.getAircraftNear(51, 0, 50);
    const status = provider.status();
    expect(status.active).toBe("backup");
    expect(status.benched).toEqual(["primary"]);
  });

  it("times the successful call, not the failed attempts before it", async () => {
    const provider = new FailoverProvider([stub("primary", "ok")]);
    await provider.getAircraftNear(51, 0, 50);
    const { lastCallMs } = provider.status();
    expect(lastCallMs).not.toBeNull();
    expect(lastCallMs).toBeGreaterThanOrEqual(0);
  });

  it("does not report a provider as benched once its cooldown has passed", async () => {
    vi.useFakeTimers();
    try {
      const provider = new FailoverProvider([stub("primary", "throw"), stub("backup", "ok")]);
      await provider.getAircraftNear(51, 0, 50);
      expect(provider.status().benched).toEqual(["primary"]);
      vi.advanceTimersByTime(61_000);
      expect(provider.status().benched).toEqual([]);
    } finally {
      vi.useRealTimers();
    }
  });
});
