export interface FlightRoute {
  origin: string;
  destination: string;
}

interface AdsbdbAirport {
  iata_code?: string;
  icao_code?: string;
  municipality?: string;
}

const cache = new Map<string, FlightRoute | null>();

function label(a: AdsbdbAirport | undefined): string {
  if (!a) return "?";
  const code = a.iata_code ?? a.icao_code ?? "?";
  return a.municipality ? `${a.municipality} (${code})` : code;
}

/** callsign → route via the free adsbdb.com API. Returns null when unknown. */
export async function lookupRoute(callsign: string): Promise<FlightRoute | null> {
  const key = callsign.trim().toUpperCase();
  if (!key) return null;
  if (cache.has(key)) return cache.get(key) ?? null;
  try {
    const res = await fetch(`https://api.adsbdb.com/v0/callsign/${encodeURIComponent(key)}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const body = (await res.json()) as {
      response?: { flightroute?: { origin?: AdsbdbAirport; destination?: AdsbdbAirport } } | string;
    };
    const fr = typeof body.response === "object" ? body.response?.flightroute : undefined;
    const route = fr ? { origin: label(fr.origin), destination: label(fr.destination) } : null;
    cache.set(key, route);
    return route;
  } catch {
    cache.set(key, null);
    return null;
  }
}
