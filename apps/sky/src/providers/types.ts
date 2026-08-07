import type { AircraftState } from "@aloft/shared";

/**
 * What a provider is actually doing right now, for the client's Signal panel.
 *
 * The System screen used to show four hard-coded strings that never changed
 * ("Community", "Standby"). Nothing downstream can know which upstream served
 * a frame or how long it took, so the provider has to say.
 */
export interface ProviderStatus {
  /** Name of the provider that served the most recent successful call. */
  active: string | null;
  /** Providers currently benched after a failure. */
  benched: string[];
  /** Round-trip of the most recent successful upstream call, milliseconds. */
  lastCallMs: number | null;
}

export interface FlightProvider {
  readonly name: string;
  /** Aircraft with a known position within `radiusNm` of the point. */
  getAircraftNear(lat: number, lon: number, radiusNm: number): Promise<AircraftState[]>;
  /** Optional live telemetry. Only the failover wrapper implements it. */
  status?(): ProviderStatus;
  /**
   * Current state of one specific airframe, wherever it is in the world, or
   * null when it isn't being tracked right now.
   *
   * Separate from getAircraftNear because the answer here is about identity,
   * not geography, and because a grounded or position-less aircraft is a
   * meaningful answer ("resting") rather than something to filter out.
   */
  getAirframe(hex: string): Promise<LiveAirframe | null>;
}

/** Where one collected airframe is right now. */
export interface LiveAirframe {
  hex: string;
  airborne: boolean;
  lat?: number;
  lon?: number;
  altFt?: number;
  gsKt?: number;
  callsign?: string;
  /** Seconds since the position was last seen, when known. */
  seenSec?: number;
}

/** Raw aircraft entry from readsb-style /v2 APIs (adsb.lol, airplanes.live). */
export interface ReadsbAircraft {
  hex: string;
  flight?: string;
  r?: string;
  t?: string;
  lat?: number;
  lon?: number;
  alt_geom?: number;
  alt_baro?: number | "ground";
  gs?: number;
  track?: number;
  seen_pos?: number;
}

/**
 * Airborne test. ADS-B feeds carry a lot of surface clutter — pushback tugs,
 * fire trucks, ground stations like "TWR" — and none of it can be spotted in
 * the sky, so it has no business on the scope.
 */
const AIRBORNE_MIN_ALT_FT = 300;
const AIRBORNE_MIN_SPEED_KT = 60;

export function normalizeReadsb(ac: ReadsbAircraft, now: number): AircraftState | null {
  if (typeof ac.lat !== "number" || typeof ac.lon !== "number") return null;
  if (ac.alt_baro === "ground") return null;

  const geom = typeof ac.alt_geom === "number" ? ac.alt_geom : undefined;
  const baro = typeof ac.alt_baro === "number" ? ac.alt_baro : undefined;
  const altFt = geom ?? baro;
  const gsKt = ac.gs ?? 0;

  // No altitude at all, or crawling along near the ground: treat as surface.
  if (altFt === undefined) return null;
  if (altFt < AIRBORNE_MIN_ALT_FT && gsKt < AIRBORNE_MIN_SPEED_KT) return null;

  return {
    hex: ac.hex,
    callsign: (ac.flight ?? "").trim(),
    reg: ac.r,
    typeIcao: ac.t,
    lat: ac.lat,
    lon: ac.lon,
    altFt,
    gsKt,
    // null, not 0: a defaulted 0 is indistinguishable from due north and
    // sends trackless aircraft sailing northward under dead reckoning.
    track: typeof ac.track === "number" ? ac.track : null,
    seenPosSec: ac.seen_pos ?? 0,
    ts: now,
  };
}

export async function fetchReadsbPoint(
  baseUrl: string,
  lat: number,
  lon: number,
  radiusNm: number,
  timeoutMs = 8000
): Promise<AircraftState[]> {
  const url = `${baseUrl}/v2/point/${lat.toFixed(4)}/${lon.toFixed(4)}/${Math.min(250, Math.ceil(radiusNm))}`;
  const res = await fetch(url, {
    signal: AbortSignal.timeout(timeoutMs),
    headers: { accept: "application/json", "user-agent": "aloft-sky/0.1 (dev)" },
  });
  if (!res.ok) throw new Error(`${url} -> HTTP ${res.status}`);
  const body = (await res.json()) as { ac?: ReadsbAircraft[]; now?: number };
  const now = Date.now();
  return (body.ac ?? [])
    .map((ac) => normalizeReadsb(ac, now))
    .filter((ac): ac is AircraftState => ac !== null);
}

/**
 * One airframe by ICAO hex. Deliberately does NOT reuse normalizeReadsb:
 * that drops ground and position-less aircraft as scope clutter, but here
 * "on the ground at Basel" is exactly the answer being asked for.
 */
export async function fetchReadsbHex(
  baseUrl: string,
  hex: string,
  timeoutMs = 8000
): Promise<LiveAirframe | null> {
  const clean = hex.trim().toLowerCase();
  const res = await fetch(`${baseUrl}/v2/hex/${encodeURIComponent(clean)}`, {
    signal: AbortSignal.timeout(timeoutMs),
    headers: { accept: "application/json", "user-agent": "aloft-sky/0.1 (dev)" },
  });
  if (!res.ok) throw new Error(`${baseUrl}/v2/hex -> HTTP ${res.status}`);
  const body = (await res.json()) as { ac?: ReadsbAircraft[] };
  const ac = (body.ac ?? []).find((a) => a.hex?.toLowerCase() === clean);
  if (!ac) return null;

  const geom = typeof ac.alt_geom === "number" ? ac.alt_geom : undefined;
  const baro = typeof ac.alt_baro === "number" ? ac.alt_baro : undefined;
  const altFt = geom ?? baro;
  const gsKt = ac.gs;
  const onGround = ac.alt_baro === "ground";

  return {
    hex: clean,
    airborne: !onGround && (altFt ?? 0) >= AIRBORNE_MIN_ALT_FT,
    lat: typeof ac.lat === "number" ? ac.lat : undefined,
    lon: typeof ac.lon === "number" ? ac.lon : undefined,
    altFt,
    gsKt,
    callsign: ac.flight?.trim() || undefined,
    seenSec: ac.seen_pos,
  };
}
