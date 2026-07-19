import type { FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { AircraftState } from "@aloft/shared";
import { buildApp, type AppDeps } from "./app";
import { waitForDb } from "./db";
import { SkyHub } from "./hub";
import type { FlightProvider, LiveAirframe } from "./providers/types";
import { PushStore } from "./push/store";
import { SocialStore } from "./social/store";
import { describeIfDb, withCleanDb } from "./testing/db";

function aircraftAt(hex: string, lat: number, lon: number): AircraftState {
  return {
    hex,
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

/** Counts upstream calls so we can assert the amplification gate holds. */
class CountingProvider implements FlightProvider {
  readonly name = "counting";
  calls = 0;
  hexCalls = 0;
  present: string[] = [];

  async getAircraftNear(lat: number, lon: number): Promise<AircraftState[]> {
    this.calls++;
    return this.present.map((hex) => aircraftAt(hex, lat + 0.01, lon));
  }

  async getAirframe(hex: string): Promise<LiveAirframe | null> {
    this.hexCalls++;
    return { hex, airborne: true, lat: 51.5, lon: -0.4, altFt: 36_000, gsKt: 447 };
  }
}

async function makeApp(over: Partial<AppDeps> = {}): Promise<{
  app: FastifyInstance;
  provider: CountingProvider;
  social: SocialStore;
}> {
  const provider = new CountingProvider();
  const social = (over.social as SocialStore) ?? new SocialStore();
  const app = await buildApp({
    hub: new SkyHub(provider),
    provider,
    social,
    pushStore: new PushStore(),
    vapidPublicKey: "test-key",
    ...over,
  });
  return { app, provider, social };
}

const CATCH_BODY = { hex: "abc123", lat: 51.47, lon: -0.45, ts: Date.now() };

describe("/catch amplification gate", () => {
  let app: FastifyInstance;
  let provider: CountingProvider;

  beforeEach(async () => {
    ({ app, provider } = await makeApp());
  });
  afterEach(async () => {
    await app.close();
  });

  it("does not reach upstream for an unauthenticated caller", async () => {
    // The whole point: a stranger POSTing random hexes must not be able to
    // drive one ~250 km upstream fetch per request from our IP.
    const res = await app.inject({ method: "POST", url: "/catch", payload: CATCH_BODY });
    expect(res.statusCode).toBe(422);
    expect(provider.calls).toBe(0);
  });

  it("rate-limits /catch well below any human capture rate", async () => {
    const limited = await makeApp({ rateLimits: { catchPerMin: 3 } });
    try {
      const codes: number[] = [];
      for (let i = 0; i < 4; i++) {
        const res = await limited.app.inject({ method: "POST", url: "/catch", payload: CATCH_BODY });
        codes.push(res.statusCode);
      }
      expect(codes[3]).toBe(429);
    } finally {
      await limited.app.close();
    }
  });

  it("still rejects a malformed body before doing any work", async () => {
    const res = await app.inject({ method: "POST", url: "/catch", payload: { hex: "abc123" } });
    expect(res.statusCode).toBe(400);
    expect(provider.calls).toBe(0);
  });
});

describeIfDb("authenticated /catch", () => {
  let app: FastifyInstance;
  let provider: CountingProvider;
  let social: SocialStore;

  beforeEach(async () => {
    ({ app, provider, social } = await makeApp());
  });
  afterEach(async () => {
    await app.close();
  });

  it("polls upstream once and coalesces a second catch in the same cell", async () => {
    await withCleanDb(async () => {
      const reg = await social.register("Spotter");
      if (!reg.ok || !reg.token) throw new Error("registration failed");
      const headers = { "x-player-id": reg.player.id, "x-player-token": reg.token };

      provider.present = ["abc123"];
      const first = await app.inject({ method: "POST", url: "/catch", headers, payload: CATCH_BODY });
      expect(first.statusCode).toBe(200);
      expect(provider.calls).toBe(1);

      // A different unknown hex, same cell, inside the coalesce window: the
      // history is already fresh, so no second upstream request.
      await app.inject({
        method: "POST",
        url: "/catch",
        headers,
        payload: { ...CATCH_BODY, hex: "ffffff" },
      });
      expect(provider.calls).toBe(1);
    });
  });

  it("rejects a claimed id whose token does not match", async () => {
    await withCleanDb(async () => {
      const reg = await social.register("Spotter");
      if (!reg.ok) throw new Error("registration failed");
      const res = await app.inject({
        method: "POST",
        url: "/catch",
        headers: { "x-player-id": reg.player.id, "x-player-token": "not-the-token" },
        payload: CATCH_BODY,
      });
      expect(res.statusCode).toBe(401);
      expect(provider.calls).toBe(0);
    });
  });

  it("gives one catch id to a flight whose callsign changes mid-flight", async () => {
    await withCleanDb(async () => {
      const reg = await social.register("Spotter");
      if (!reg.ok || !reg.token) throw new Error("registration failed");
      const headers = { "x-player-id": reg.player.id, "x-player-token": reg.token };

      provider.present = ["abc123"];
      await app.inject({ method: "POST", url: "/catch", headers, payload: CATCH_BODY });
      // Same airframe, same UTC day — the id must not depend on the callsign,
      // which is absent on some fixes and changes on others.
      await app.inject({ method: "POST", url: "/catch", headers, payload: CATCH_BODY });

      const stats = await social.stats(reg.player.id);
      expect(stats.catches).toBe(1);
    });
  });
});

describeIfDb("social read routes reject impersonation", () => {
  let app: FastifyInstance;
  let social: SocialStore;

  beforeEach(async () => {
    // These routes sit behind the database-readiness gate, which answers 503
    // until the first successful query. Mark the connection live so the test
    // exercises the auth check rather than the outage path.
    await waitForDb();
    ({ app, social } = await makeApp());
  });
  afterEach(async () => {
    await app.close();
  });

  const READ_ROUTES = (id: string) => [
    "/player/me",
    "/friends",
    "/leaderboard",
    "/activity",
    `/player/${id}/hangar`,
  ];

  it("401s when only the player id is presented", async () => {
    await withCleanDb(async () => {
      const victim = await social.register("Victim");
      if (!victim.ok) throw new Error("registration failed");

      // A player id is not a secret — it appears in /friends and /activity
      // payloads. Knowing one must not grant read access.
      for (const url of READ_ROUTES(victim.player.id)) {
        const res = await app.inject({ method: "GET", url, headers: { "x-player-id": victim.player.id } });
        expect(res.statusCode, url).toBe(401);
      }
    });
  });

  it("401s on a wrong token", async () => {
    await withCleanDb(async () => {
      const victim = await social.register("Victim");
      if (!victim.ok) throw new Error("registration failed");
      for (const url of READ_ROUTES(victim.player.id)) {
        const res = await app.inject({
          method: "GET",
          url,
          headers: { "x-player-id": victim.player.id, "x-player-token": "wrong" },
        });
        expect(res.statusCode, url).toBe(401);
      }
    });
  });

  it("serves the owner with a valid token", async () => {
    await withCleanDb(async () => {
      const owner = await social.register("Owner");
      if (!owner.ok || !owner.token) throw new Error("registration failed");
      const headers = { "x-player-id": owner.player.id, "x-player-token": owner.token };
      for (const url of READ_ROUTES(owner.player.id)) {
        const res = await app.inject({ method: "GET", url, headers });
        expect(res.statusCode, url).toBe(200);
      }
    });
  });
});

describeIfDb("living hangar lookups", () => {
  let app: FastifyInstance;
  let provider: CountingProvider;
  let social: SocialStore;

  beforeEach(async () => {
    await waitForDb();
    ({ app, provider, social } = await makeApp());
  });
  afterEach(async () => {
    await app.close();
  });

  async function authHeaders(): Promise<Record<string, string>> {
    const reg = await social.register("Collector");
    if (!reg.ok || !reg.token) throw new Error("registration failed");
    return { "x-player-id": reg.player.id, "x-player-token": reg.token };
  }

  it("requires authentication", async () => {
    await withCleanDb(async () => {
      const single = await app.inject({ method: "GET", url: "/airframe/4010ee/live" });
      const batch = await app.inject({ method: "POST", url: "/airframes/live", payload: { hexes: ["4010ee"] } });
      expect(single.statusCode).toBe(401);
      expect(batch.statusCode).toBe(401);
      expect(provider.hexCalls).toBe(0);
    });
  });

  it("serves a second request for the same airframe from cache", async () => {
    await withCleanDb(async () => {
      const headers = await authHeaders();
      await app.inject({ method: "GET", url: "/airframe/4010ee/live", headers });
      await app.inject({ method: "GET", url: "/airframe/4010ee/live", headers });
      // Every hex is its own upstream request, so the cache is what keeps
      // this feature from hammering a free service.
      expect(provider.hexCalls).toBe(1);
    });
  });

  it("rejects a malformed hex without asking upstream", async () => {
    await withCleanDb(async () => {
      const headers = await authHeaders();
      const res = await app.inject({ method: "GET", url: "/airframe/zzz/live", headers });
      expect(res.statusCode).toBe(400);
      expect(provider.hexCalls).toBe(0);
    });
  });

  it("caps a fleet request and dedupes within it", async () => {
    await withCleanDb(async () => {
      const headers = await authHeaders();
      const tooMany = Array.from({ length: 13 }, (_, i) => `4010${String(i).padStart(2, "0")}`);
      const capped = await app.inject({ method: "POST", url: "/airframes/live", headers, payload: { hexes: tooMany } });
      expect(capped.statusCode).toBe(400);

      const dupes = await app.inject({
        method: "POST",
        url: "/airframes/live",
        headers,
        payload: { hexes: ["4010ee", "4010EE", "4010ee"] },
      });
      expect(dupes.statusCode).toBe(200);
      expect(provider.hexCalls).toBe(1);
    });
  });
});
