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
  /**
   * How far out to stream aircraft, derived from the map viewport — NOT the
   * capture radius. The scope shows everything you can see; you can only
   * capture what is within CAPTURE_RADIUS_KM.
   */
  viewRadiusKm: number;
  /**
   * Optional player identity, so the server can remember where this player's
   * device last reported itself — used to sanity-check that a later /catch
   * claim was made from somewhere the player actually was, not just
   * somewhere an aircraft happened to be. Ignored server-side unless
   * `playerToken` also proves ownership of `playerId` — otherwise anyone
   * could poison another player's tracked position over an unauthenticated
   * WS message and cause that player's real catches to be wrongly rejected.
   */
  playerId?: string;
  playerToken?: string;
};

/** Server → client messages. */
export type ServerMessage =
  | { type: "planes"; now: number; aircraft: AircraftState[] }
  | { type: "error"; message: string };

/** Range within which an aircraft can be hunted, and which the geofence watches. */
export const CAPTURE_RADIUS_KM = 15;
/** Upper bound on viewport streaming — keeps one upstream request per cell sane. */
export const MAX_VIEW_RADIUS_KM = 250;
export const MIN_VIEW_RADIUS_KM = 5;

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
