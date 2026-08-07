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

/**
 * Running tally of what this channel is actually doing, for the System screen's
 * Signal panel. The route feed is the one upstream the client talks to
 * directly, so it is the one whose health the client can report first-hand.
 */
const tally = { ok: 0, failed: 0 };

export interface ChannelStats {
  ok: number;
  failed: number;
}

export function routeStats(): ChannelStats {
  return { ...tally };
}

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
    tally.ok++;
    return route;
  } catch {
    // A network/HTTP failure isn't a genuine "no route" answer from the API —
    // don't cache it, so a transient blip doesn't permanently deny route info
    // this callsign's next lookup would have happily returned.
    tally.failed++;
    return null;
  }
}
