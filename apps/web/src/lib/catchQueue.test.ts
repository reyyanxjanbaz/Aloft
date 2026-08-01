import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({
  enqueuePendingCatch: vi.fn(async () => {}),
  removePendingCatch: vi.fn(async () => {}),
  listPendingCatches: vi.fn(async () => [] as unknown[]),
  saveCatch: vi.fn(async () => ({ isNew: true })),
  entryFromCatch: (c: unknown) => c,
}));
vi.mock("../features/hangar/db", () => db);
vi.mock("./player", () => ({ ensurePlayer: vi.fn(async () => {}), playerHeaders: () => ({}) }));
vi.mock("../state/planes", () => ({ SKY_URL: "http://sky.test" }));

import { flushPendingCatches, submitCatch } from "./catchQueue";

const PENDING = { hex: "abc123", lat: 51.47, lon: -0.45, ts: Date.now() };
const CAUGHT_BODY = {
  ok: true,
  catch: { aircraft: { hex: "abc123" }, rarity: "common", distanceKm: 1, caughtAt: PENDING.ts },
};

function jsonResponse(status: number, body: unknown): Response {
  return { ok: status >= 200 && status < 300, status, json: async () => body } as Response;
}

beforeEach(() => {
  vi.clearAllMocks();
  db.listPendingCatches.mockResolvedValue([]);
  db.saveCatch.mockResolvedValue({ isNew: true });
});

describe("submitCatch", () => {
  it("persists the catch before the network attempt and keeps it queued when the network fails", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("offline"); }));

    const outcome = await submitCatch(PENDING);

    expect(db.enqueuePendingCatch).toHaveBeenCalledWith(PENDING);
    expect(db.removePendingCatch).not.toHaveBeenCalled();
    expect(outcome.status).toBe("queued");
  });

  it("keeps the catch queued on a 5xx server error rather than dropping it", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse(500, "<html>gateway</html>")));

    const outcome = await submitCatch(PENDING);

    expect(db.removePendingCatch).not.toHaveBeenCalled();
    expect(outcome.status).toBe("queued");
  });

  it("clears the catch on a 422 validation rejection", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse(422, { ok: false, reason: "out of range" })));

    const outcome = await submitCatch(PENDING);

    expect(db.removePendingCatch).toHaveBeenCalledWith(PENDING);
    expect(outcome).toMatchObject({ status: "rejected", reason: "out of range" });
  });

  it("threads isNew from the local save into a caught outcome", async () => {
    db.saveCatch.mockResolvedValue({ isNew: false });
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse(200, CAUGHT_BODY)));

    const outcome = await submitCatch(PENDING);

    expect(outcome).toMatchObject({ status: "caught", isNew: false });
    expect(db.removePendingCatch).toHaveBeenCalledWith(PENDING);
  });
});

describe("flushPendingCatches", () => {
  it("coalesces concurrent flushes into a single pass", async () => {
    db.listPendingCatches.mockResolvedValue([PENDING]);
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse(200, CAUGHT_BODY)));

    await Promise.all([flushPendingCatches(), flushPendingCatches()]);

    expect(db.listPendingCatches).toHaveBeenCalledTimes(1);
  });
});
