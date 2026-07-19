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

export async function fetchLiveAirframe(hex: string): Promise<LiveAirframe | null> {
  const res = await fetch(`${SKY_URL}/airframe/${encodeURIComponent(hex)}/live`, {
    headers: playerHeaders(),
  });
  if (!res.ok) throw new Error(`live lookup failed: ${res.status}`);
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
  if (!res.ok) throw new Error(`fleet lookup failed: ${res.status}`);
  const body = (await res.json()) as { ok: boolean; live: Record<string, LiveAirframe | null> };
  return body.live;
}
