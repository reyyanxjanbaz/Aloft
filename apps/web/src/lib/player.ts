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
interface CachedPlayer extends PlayerProfile {
  token?: string;
}

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

async function register(name: string, id?: string, token?: string): Promise<CachedPlayer | null> {
  const res = await fetch(`${SKY_URL}/player/register`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name, id, token }),
  });
  if (!res.ok) return null;
  const body = (await res.json()) as { ok: boolean; player?: PlayerProfile; token?: string; reason?: string };
  if (!body.ok || !body.player) return null;
  // The server only echoes a token back once ownership is proven; if it
  // didn't (e.g. this device's cached token no longer matches), keep
  // whatever token we already had rather than silently dropping it.
  return { ...body.player, token: body.token ?? token };
}

/**
 * Device-local identity: registers with the sky service on first run and
 * reuses the same id afterwards. Pre-auth by design — swapping in Supabase
 * auth later means replacing this module, not its callers.
 */
export async function ensurePlayer(): Promise<CachedPlayer | null> {
  const existing = cachedPlayer();
  try {
    const player = await register(existing?.name ?? suggestName(), existing?.id, existing?.token);
    if (!player) return existing;
    cache(player);
    return player;
  } catch {
    // Offline: keep playing solo with whatever identity we already had.
    return existing;
  }
}

export async function renamePlayer(name: string): Promise<CachedPlayer | null> {
  const existing = cachedPlayer();
  if (!existing) return null;
  try {
    const player = await register(name, existing.id, existing.token);
    if (!player) return existing;
    cache(player);
    return player;
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
