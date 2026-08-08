import type { PlayerProfile } from "@aloft/shared";
import { SKY_URL } from "../state/planes";

const KEY = "aloft-player";

const CALLSIGN_ADJECTIVES = ["Swift", "Silent", "Golden", "Night", "High", "Lone", "Iron", "Blue"];
const CALLSIGN_NOUNS = ["Spotter", "Falcon", "Beacon", "Vector", "Contrail", "Tailwind", "Compass"];

function suggestName(): string {
  const a = CALLSIGN_ADJECTIVES[Math.floor(Math.random() * CALLSIGN_ADJECTIVES.length)];
  const n = CALLSIGN_NOUNS[Math.floor(Math.random() * CALLSIGN_NOUNS.length)];
  return `${a} ${n}`;
}

/**
 * The device's local copy of its identity, including the bearer token that
 * proves ownership. Never send `token` anywhere except to the sky service
 * itself, and never derive `PlayerProfile` (the type shared with friends'
 * views) from this without dropping the token field.
 */
export interface CachedPlayer extends PlayerProfile {
  token?: string;
}

/**
 * Why a registration attempt ended the way it did. "auth" is distinct from
 * "http" because it is recoverable and needs a different message: the device
 * is online and the tower is fine, this identity just isn't accepted.
 */
export type RegisterResult =
  | { status: "ok"; player: CachedPlayer }
  | { status: "auth" }
  | { status: "http" };

export function cachedPlayer(): CachedPlayer | null {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as CachedPlayer) : null;
  } catch {
    return null;
  }
}

function cache(player: CachedPlayer): void {
  localStorage.setItem(KEY, JSON.stringify(player));
}

async function register(name: string, id?: string, token?: string): Promise<RegisterResult> {
  const res = await fetch(`${SKY_URL}/player/register`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name, id, token }),
  });
  // 401 means this id exists but the token we sent is wrong — recoverable by
  // discarding the token, which the caller does. Anything else is a server
  // problem and must not cost the device its identity.
  if (res.status === 401) return { status: "auth" };
  if (!res.ok) return { status: "http" };
  const body = (await res.json()) as { ok: boolean; player?: PlayerProfile; token?: string; reason?: string };
  if (!body.ok || !body.player) return { status: "auth" };
  // The server only echoes a token back once ownership is proven. A 200 that
  // carries no token is the tower saying "this is who that id belongs to, but
  // you have not shown me you are them" — it hands back the public profile
  // and nothing else.
  //
  // That used to be reported as `ok`, so the device cached a tokenless
  // identity, believed it was signed in, and then 401'd on every read and
  // write for the rest of its life. Spotters showed "No link to the tower",
  // which was the wrong diagnosis — the tower was right there — and the one
  // control that could have fixed it (start a fresh identity) never appeared
  // because it is gated on the auth-failed state this never reached.
  const proven = body.token ?? token;
  if (!proven) return { status: "auth" };
  return { status: "ok", player: { ...body.player, token: proven } };
}

/**
 * Device-local identity: registers with the sky service on first run and
 * reuses the same id afterwards. Pre-auth by design — swapping in Supabase
 * auth later means replacing this module, not its callers.
 */
export type EnsureOutcome = { player: CachedPlayer | null; auth: "ok" | "offline" | "auth-failed" };

/**
 * In-flight registration, shared by every concurrent caller.
 *
 * Registration is not idempotent for a device that has no identity yet: with
 * no id to claim, each call *creates a player*. Two callers racing — React's
 * development double-effect is enough — therefore minted two accounts, cached
 * whichever answered last, and orphaned the other along with its spotter code.
 */
let inFlight: Promise<EnsureOutcome> | null = null;

export async function ensurePlayerDetailed(): Promise<EnsureOutcome> {
  inFlight ??= run().finally(() => {
    inFlight = null;
  });
  return inFlight;
}

async function run(): Promise<EnsureOutcome> {
  const existing = cachedPlayer();
  try {
    let result = await register(existing?.name ?? suggestName(), existing?.id, existing?.token);

    // A token the server no longer accepts used to be re-sent on every
    // launch forever, so the device 401'd on everything with no way out
    // short of clearing site data. Drop it and claim the id afresh.
    if (result.status === "auth" && existing?.token) {
      result = await register(existing.name ?? suggestName(), existing.id, undefined);
    }

    if (result.status === "ok") {
      cache(result.player);
      return { player: result.player, auth: "ok" };
    }
    return { player: existing, auth: result.status === "auth" ? "auth-failed" : "offline" };
  } catch {
    // Offline: keep playing solo with whatever identity we already had.
    return { player: existing, auth: "offline" };
  }
}

/**
 * Device-local identity. Kept for callers that only need the player.
 */
export async function ensurePlayer(): Promise<CachedPlayer | null> {
  return (await ensurePlayerDetailed()).player;
}

/** Discards this device's identity so the next ensurePlayer registers fresh. */
export function forgetPlayer(): void {
  localStorage.removeItem(KEY);
  // Also drop any registration already in flight for the *old* identity —
  // otherwise "start a fresh identity" would be handed the very result it is
  // trying to escape.
  inFlight = null;
}

export async function renamePlayer(name: string): Promise<CachedPlayer | null> {
  const existing = cachedPlayer();
  if (!existing) return null;
  try {
    const result = await register(name, existing.id, existing.token);
    if (result.status !== "ok") return existing;
    cache(result.player);
    return result.player;
  } catch {
    return existing;
  }
}

/** Headers that identify and authenticate this player to the sky service. */
export function playerHeaders(): Record<string, string> {
  const player = cachedPlayer();
  if (!player) return {};
  const headers: Record<string, string> = { "x-player-id": player.id };
  if (player.token) headers["x-player-token"] = player.token;
  return headers;
}
