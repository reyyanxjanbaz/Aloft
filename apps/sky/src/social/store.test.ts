import { beforeEach, expect, it } from "vitest";
import type { SharedCatch } from "@aloft/shared";
import { SocialStore } from "./store";
import { describeIfDb, withCleanDb } from "../testing/db";

function catchEntry(over: Partial<Omit<SharedCatch, "firstSpotter">> = {}): Omit<SharedCatch, "firstSpotter"> {
  return {
    id: "abc123:BAW1:20260719",
    hex: "abc123",
    callsign: "BAW1",
    reg: "G-EUUU",
    typeIcao: "A320",
    typeLabel: "Airbus A320",
    rarity: "common",
    caughtAt: Date.now(),
    altFt: 30_000,
    distanceKm: 4.2,
    ...over,
  };
}

describeIfDb("SocialStore", () => {
  let store: SocialStore;
  beforeEach(() => {
    store = new SocialStore();
  });

  it("issues a token on registration and verifies it synchronously", async () => {
    await withCleanDb(async () => {
      const res = await store.register("Reyyan");
      if (!res.ok) throw new Error(res.reason);
      expect(res.token).toBeTruthy();
      // Synchronous by design — called from the WebSocket message callback.
      expect(store.verifyToken(res.player.id, res.token)).toBe(true);
      expect(store.verifyToken(res.player.id, "wrong-token")).toBe(false);
      expect(store.verifyToken(res.player.id, undefined)).toBe(false);
    });
  });

  it("withholds the token when an id is supplied without proof of ownership", async () => {
    await withCleanDb(async () => {
      const first = await store.register("Reyyan");
      if (!first.ok) throw new Error(first.reason);
      const impostor = await store.register("Hacker", first.player.id);
      if (!impostor.ok) throw new Error("expected the public profile");
      expect(impostor.token).toBeUndefined();
      // The rename must not have been applied.
      expect(impostor.player.name).toBe("Reyyan");
    });
  });

  it("rebuilds the token cache from Postgres on hydrate", async () => {
    await withCleanDb(async () => {
      const res = await store.register("Reyyan");
      if (!res.ok) throw new Error(res.reason);
      // A fresh instance, as after a Railway restart.
      const restarted = new SocialStore();
      expect(restarted.verifyToken(res.player.id, res.token)).toBe(false);
      await restarted.hydrateTokens();
      expect(restarted.verifyToken(res.player.id, res.token)).toBe(true);
    });
  });

  it("awards first spotter once, to exactly one of two concurrent catchers", async () => {
    await withCleanDb(async () => {
      const a = await store.register("A");
      const b = await store.register("B");
      if (!a.ok || !b.ok) throw new Error("registration failed");

      const [ra, rb] = await Promise.all([
        store.recordCatch(a.player.id, catchEntry({ id: "abc123:BAW1:20260719" })),
        store.recordCatch(b.player.id, catchEntry({ id: "abc123:BAW2:20260719" })),
      ]);
      expect([ra.firstSpotter, rb.firstSpotter].filter(Boolean)).toHaveLength(1);
    });
  });

  it("is idempotent on the client-side catch id", async () => {
    await withCleanDb(async () => {
      const p = await store.register("A");
      if (!p.ok) throw new Error("registration failed");
      const first = await store.recordCatch(p.player.id, catchEntry());
      const again = await store.recordCatch(p.player.id, catchEntry());
      expect(first.firstSpotter).toBe(true);
      expect(again.firstSpotter).toBe(true);
      const s = await store.stats(p.player.id);
      expect(s.catches).toBe(1);
    });
  });

  it("keeps hangars private until friendship is mutual", async () => {
    await withCleanDb(async () => {
      const a = await store.register("A");
      const b = await store.register("B");
      if (!a.ok || !b.ok) throw new Error("registration failed");
      await store.recordCatch(b.player.id, catchEntry());

      const denied = await store.hangarOf(a.player.id, b.player.id);
      expect(denied.ok).toBe(false);

      await store.addFriendByCode(a.player.id, b.player.code);
      const allowed = await store.hangarOf(a.player.id, b.player.id);
      expect(allowed.ok).toBe(true);
      // Friendship is symmetric — B can see A too.
      const reverse = await store.hangarOf(b.player.id, a.player.id);
      expect(reverse.ok).toBe(true);
    });
  });
});
