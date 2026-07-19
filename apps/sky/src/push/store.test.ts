import { beforeEach, expect, it } from "vitest";
import type { PushSubscription } from "web-push";
import { PushStore } from "./store";
import { describeIfDb, withCleanDb } from "../testing/db";

const sub = {
  subscription: {
    endpoint: "https://push.example.com/abc",
    keys: { p256dh: "p256dh-key", auth: "auth-key" },
  } as PushSubscription,
  lat: 51.47,
  lon: -0.45,
  radiusKm: 15,
};

describeIfDb("PushStore", () => {
  let store: PushStore;
  beforeEach(() => {
    store = new PushStore();
  });

  it("stores a subscription and reads it back", async () => {
    await withCleanDb(async () => {
      await store.upsert(sub);
      const all = await store.all();
      expect(all).toHaveLength(1);
      expect(all[0]?.subscription.endpoint).toBe(sub.subscription.endpoint);
      expect(all[0]?.subscription.keys.auth).toBe("auth-key");
      expect(all[0]?.lastPingAt).toBe(0);
      expect(all[0]?.pingedHexes).toEqual({});
      expect(await store.count()).toBe(1);
    });
  });

  it("preserves ping history when a subscription is re-upserted", async () => {
    await withCleanDb(async () => {
      await store.upsert(sub);
      await store.markPinged(sub.subscription.endpoint, "abc123", 1_700_000_000_000);
      // The client re-subscribes from a new location.
      await store.upsert({ ...sub, lat: 40.6, lon: -73.8 });

      const [row] = await store.all();
      expect(row?.lat).toBe(40.6);
      expect(row?.lastPingAt).toBe(1_700_000_000_000);
      expect(row?.pingedHexes).toEqual({ abc123: 1_700_000_000_000 });
    });
  });

  it("accumulates pinged hexes rather than replacing them", async () => {
    await withCleanDb(async () => {
      await store.upsert(sub);
      await store.markPinged(sub.subscription.endpoint, "aaa111", 1_700_000_000_000);
      await store.markPinged(sub.subscription.endpoint, "bbb222", 1_700_000_060_000);

      const [row] = await store.all();
      expect(row?.pingedHexes).toEqual({ aaa111: 1_700_000_000_000, bbb222: 1_700_000_060_000 });
      expect(row?.lastPingAt).toBe(1_700_000_060_000);
    });
  });

  it("removes a dead subscription", async () => {
    await withCleanDb(async () => {
      await store.upsert(sub);
      await store.remove(sub.subscription.endpoint);
      expect(await store.count()).toBe(0);
    });
  });
});
