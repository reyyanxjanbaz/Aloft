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

export function normalizeReadsb(ac: ReadsbAircraft, now: number): AircraftState | null {
  if (typeof ac.lat !== "number" || typeof ac.lon !== "number") return null;
  const geom = typeof ac.alt_geom === "number" ? ac.alt_geom : undefined;
  const baro = typeof ac.alt_baro === "number" ? ac.alt_baro : ac.alt_baro === "ground" ? 0 : undefined;
  return {
    hex: ac.hex,
    callsign: (ac.flight ?? "").trim(),
    reg: ac.r,
    typeIcao: ac.t,
    lat: ac.lat,
    lon: ac.lon,
    altFt: geom ?? baro ?? 0,
    gsKt: ac.gs ?? 0,
    track: ac.track ?? 0,
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
