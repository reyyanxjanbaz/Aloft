import "fake-indexeddb/auto";
import { openDB } from "idb";
import { describe, expect, it } from "vitest";
import {
  enqueuePendingCatch,
  listPendingCatches,
  removePendingCatch,
  type PendingCatch,
} from "./db";

const TS = Date.parse("2026-08-01T12:00:00Z");

function pending(hex: string, over: Partial<PendingCatch> = {}): PendingCatch {
  return { hex, lat: 51.47, lon: -0.45, ts: TS, ...over };
}

describe("pending catch queue", () => {
  it("keeps multiple queued catches instead of overwriting the previous one", async () => {
    // The single-slot store lost the first offline catch when a second was
    // captured before reconnecting. Both must survive.
    await enqueuePendingCatch(pending("aa1111"));
    await enqueuePendingCatch(pending("aa2222"));

    const ids = (await listPendingCatches()).map((p) => p.hex);
    expect(ids).toContain("aa1111");
    expect(ids).toContain("aa2222");
  });

  it("dedupes the same airframe on the same day to a single entry", async () => {
    await enqueuePendingCatch(pending("bb1111"));
    await enqueuePendingCatch(pending("bb1111"));

    const mine = (await listPendingCatches()).filter((p) => p.hex === "bb1111");
    expect(mine).toHaveLength(1);
  });

  it("removes only the identified catch, leaving the rest queued", async () => {
    const keep = pending("cc1111");
    const drop = pending("cc2222");
    await enqueuePendingCatch(keep);
    await enqueuePendingCatch(drop);

    await removePendingCatch(drop);

    const hexes = (await listPendingCatches()).map((p) => p.hex);
    expect(hexes).toContain("cc1111");
    expect(hexes).not.toContain("cc2222");
  });

  it("migrates a legacy single-slot pending catch into the queue", async () => {
    // Older builds stored one pending catch at meta/pendingCatch. A player mid
    // catch across the upgrade must not lose it.
    const legacy = pending("dd1111");
    const raw = await openDB("aloft", 3, {
      upgrade(database, oldVersion) {
        if (oldVersion < 1) database.createObjectStore("catches", { keyPath: "id" });
        if (oldVersion < 2) database.createObjectStore("meta");
        if (oldVersion < 3) database.createObjectStore("pendingCatches", { keyPath: "id" });
      },
    });
    await raw.put("meta", legacy, "pendingCatch");
    raw.close();

    const hexes = (await listPendingCatches()).map((p) => p.hex);
    expect(hexes).toContain("dd1111");
    // And the legacy slot is cleared so it isn't migrated twice.
    const check = await openDB("aloft");
    expect(await check.get("meta", "pendingCatch")).toBeUndefined();
    check.close();
  });
});
