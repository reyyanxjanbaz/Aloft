import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cachedPlayer, ensurePlayerDetailed, forgetPlayer } from "./player";

const PROFILE = { id: "p1", name: "High Vector", code: "N4PX7V" };

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as Response;
}

/**
 * A minimal store of our own. happy-dom's localStorage is missing `clear()`,
 * and these tests care about exactly one key anyway.
 */
function stubStorage(): Map<string, string> {
  const store = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
  });
  return store;
}

describe("ensurePlayerDetailed", () => {
  let store: Map<string, string>;

  beforeEach(() => {
    store = stubStorage();
    forgetPlayer();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("registers a fresh device and keeps the token it is issued", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse({ ok: true, player: PROFILE, token: "secret" }))
    );

    const { player, auth } = await ensurePlayerDetailed();

    expect(auth).toBe("ok");
    expect(player?.token).toBe("secret");
    expect(cachedPlayer()?.token).toBe("secret");
  });

  /**
   * The tower answers an unproven id with the public profile and *no* token.
   * Reading that as success cached a tokenless identity that then 401'd on
   * every read and write, while the UI blamed the network and never offered
   * the one control ("start a fresh identity") that could recover it.
   */
  it("treats a 200 carrying no token as an auth failure, not a success", async () => {
    store.set("aloft-player", JSON.stringify(PROFILE)); // no token
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse({ ok: true, player: PROFILE }))
    );

    const { auth } = await ensurePlayerDetailed();

    expect(auth).toBe("auth-failed");
  });

  it("keeps a cached token the tower did not echo back", async () => {
    store.set("aloft-player", JSON.stringify({ ...PROFILE, token: "held" }));
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse({ ok: true, player: PROFILE, token: "held" }))
    );

    const { player, auth } = await ensurePlayerDetailed();

    expect(auth).toBe("ok");
    expect(player?.token).toBe("held");
  });

  it("reports offline rather than losing the identity when the tower is unreachable", async () => {
    store.set("aloft-player", JSON.stringify({ ...PROFILE, token: "held" }));
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("network down");
      })
    );

    const { player, auth } = await ensurePlayerDetailed();

    expect(auth).toBe("offline");
    expect(player?.token).toBe("held");
  });

  /**
   * Registration is not idempotent for a device with no id yet: each call
   * creates a player. React's development double-effect was enough to mint two
   * accounts and orphan one, along with its spotter code.
   */
  it("coalesces concurrent callers into a single registration", async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ ok: true, player: PROFILE, token: "once" }));
    vi.stubGlobal("fetch", fetchMock);

    const [a, b] = await Promise.all([ensurePlayerDetailed(), ensurePlayerDetailed()]);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(a.player?.id).toBe(b.player?.id);
  });

  it("lets a later call register again once the first has settled", async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ ok: true, player: PROFILE, token: "once" }));
    vi.stubGlobal("fetch", fetchMock);

    await ensurePlayerDetailed();
    await ensurePlayerDetailed();

    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
