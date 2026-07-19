import type { AircraftState } from "@aloft/shared";

export interface FlightProvider {
  readonly name: string;
  /** Aircraft with a known position within `radiusNm` of the point. */
  getAircraftNear(lat: number, lon: number, radiusNm: number): Promise<AircraftState[]>;
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
