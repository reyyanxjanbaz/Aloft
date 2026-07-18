/** Normalized aircraft state, provider-agnostic. */
export interface AircraftState {
  /** ICAO 24-bit hex address — the stable airframe identity. */
  hex: string;
  /** Callsign / flight number, trimmed. Empty if not broadcast. */
  callsign: string;
  /** Registration (tail number), if known. */
  reg?: string;
  /** ICAO aircraft type designator, e.g. "A320", "B77W". */
  typeIcao?: string;
  lat: number;
  lon: number;
  /** Geometric altitude in feet (baro fallback); 0 when on ground. */
  altFt: number;
  /** Ground speed in knots. */
  gsKt: number;
  /** True track in degrees (0–360). */
  track: number;
  /** Seconds since this position fix (staleness). */
  seenPosSec: number;
  /** Server timestamp (ms epoch) when this state was captured. */
  ts: number;
}

/** Client → server messages. */
export type ClientMessage = {
  type: "sub";
  lat: number;
  lon: number;
  radiusKm: number;
};

/** Server → client messages. */
export type ServerMessage =
  | { type: "planes"; now: number; aircraft: AircraftState[] }
  | { type: "error"; message: string };

export const DEFAULT_RADIUS_KM = 15;
export const MAX_RADIUS_KM = 100;

/** POST /catch request body. `ts` is the client's catch moment (ms epoch). */
export interface CatchRequest {
  hex: string;
  lat: number;
  lon: number;
  ts: number;
}

import type { Rarity } from "./rarity";

export interface ValidatedCatch {
  aircraft: AircraftState;
  rarity: Rarity;
  /** Ground distance player → plane at catch time, km. */
  distanceKm: number;
  caughtAt: number;
}

export type CatchResponse =
  | { ok: true; catch: ValidatedCatch; firstSpotter?: boolean }
  | { ok: false; reason: string };

/* ── Social ─────────────────────────────────────────── */

export interface PlayerProfile {
  id: string;
  name: string;
  /** Shareable 6-character code others type to add you. */
  code: string;
}

export interface PlayerStats {
  catches: number;
  rarityScore: number;
  streak: number;
  badges: number;
  bestRarity: Rarity | null;
  lastCatchAt: number | null;
  firstSpots: number;
}

export type FriendSummary = PlayerProfile & { stats: PlayerStats };

export interface SharedCatch {
  id: string;
  hex: string;
  callsign: string;
  reg?: string;
  typeIcao?: string;
  typeLabel: string;
  rarity: Rarity;
  caughtAt: number;
  altFt: number;
  distanceKm: number;
  firstSpotter: boolean;
}

export interface ActivityItem {
  player: PlayerProfile;
  catch: SharedCatch;
}

export interface LeaderboardRow extends PlayerProfile {
  rarityScore: number;
  catches: number;
  isYou?: boolean;
}
