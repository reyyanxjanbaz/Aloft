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

export function cachedPlayer(): PlayerProfile | null {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as PlayerProfile) : null;
  } catch {
    return null;
  }
}

function cache(player: PlayerProfile): void {
  localStorage.setItem(KEY, JSON.stringify(player));
}

/**
 * Device-local identity: registers with the sky service on first run and
 * reuses the same id afterwards. Pre-auth by design — swapping in Supabase
 * auth later means replacing this module, not its callers.
 */
export async function ensurePlayer(): Promise<PlayerProfile | null> {
  const existing = cachedPlayer();
  try {
    const res = await fetch(`${SKY_URL}/player/register`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: existing?.name ?? suggestName(), id: existing?.id }),
    });
    if (!res.ok) return existing;
    const { player } = (await res.json()) as { player: PlayerProfile };
    cache(player);
    return player;
  } catch {
    // Offline: keep playing solo with whatever identity we already had.
    return existing;
  }
}

export async function renamePlayer(name: string): Promise<PlayerProfile | null> {
  const existing = cachedPlayer();
  if (!existing) return null;
  const res = await fetch(`${SKY_URL}/player/register`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name, id: existing.id }),
  });
  if (!res.ok) return existing;
  const { player } = (await res.json()) as { player: PlayerProfile };
  cache(player);
  return player;
}

/** Headers that identify this player to the sky service. */
export function playerHeaders(): Record<string, string> {
  const player = cachedPlayer();
  return player ? { "x-player-id": player.id } : {};
}
