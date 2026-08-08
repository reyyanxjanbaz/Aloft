import { playerHeaders } from "../../lib/player";
import { SKY_URL } from "../../state/planes";

/** Where a collected airframe is right now, as reported by the tower. */
export interface LiveAirframe {
  hex: string;
  airborne: boolean;
  lat?: number;
  lon?: number;
  altFt?: number;
  gsKt?: number;
  callsign?: string;
  seenSec?: number;
}

/** Most airframes one fleet request may ask about; mirrors the server cap. */
export const FLEET_LIMIT = 12;

/**
 * A refusal is an answer; only silence is an outage.
 *
 * The tower rejects a lookup it cannot make sense of — an address that isn't a
 * six-digit ICAO hex, say — with a 400, immediately and correctly. Throwing on
 * that put "Tower unreachable" under an aircraft whose tower had just replied,
 * blaming the network for a question the player's own data could not answer.
 * A 4xx now means the same as an empty result: nothing is being tracked. Only
 * a transport failure or a 5xx is an outage.
 */
function assertReachable(res: Response): void {
  if (res.status >= 500) throw new Error(`live lookup failed: ${res.status}`);
}

export async function fetchLiveAirframe(hex: string): Promise<LiveAirframe | null> {
  const res = await fetch(`${SKY_URL}/airframe/${encodeURIComponent(hex)}/live`, {
    headers: playerHeaders(),
  });
  assertReachable(res);
  if (!res.ok) return null;
  const body = (await res.json()) as { ok: boolean; live: LiveAirframe | null };
  return body.live;
}

export async function fetchLiveAirframes(hexes: string[]): Promise<Record<string, LiveAirframe | null>> {
  if (hexes.length === 0) return {};
  const res = await fetch(`${SKY_URL}/airframes/live`, {
    method: "POST",
    headers: { "content-type": "application/json", ...playerHeaders() },
    body: JSON.stringify({ hexes: hexes.slice(0, FLEET_LIMIT) }),
  });
  assertReachable(res);
  if (!res.ok) return {};
  const body = (await res.json()) as { ok: boolean; live: Record<string, LiveAirframe | null> };
  return body.live;
}
