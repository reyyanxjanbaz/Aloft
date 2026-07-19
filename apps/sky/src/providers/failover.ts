import type { AircraftState } from "@aloft/shared";
import type { FlightProvider, LiveAirframe } from "./types";

const COOLDOWN_MS = 60_000;

/**
 * Tries providers in order; a provider that throws is benched for a cooldown
 * so a dead upstream doesn't add latency to every poll.
 */
export class FailoverProvider implements FlightProvider {
  readonly name = "failover";
  private benchedUntil = new Map<string, number>();

  constructor(private providers: FlightProvider[]) {
    if (providers.length === 0) throw new Error("FailoverProvider needs at least one provider");
  }

  getAircraftNear(lat: number, lon: number, radiusNm: number): Promise<AircraftState[]> {
    return this.attempt((p) => p.getAircraftNear(lat, lon, radiusNm));
  }

  getAirframe(hex: string): Promise<LiveAirframe | null> {
    return this.attempt((p) => p.getAirframe(hex));
  }

  /** Runs `call` against each healthy provider in turn, benching failures. */
  private async attempt<T>(call: (provider: FlightProvider) => Promise<T>): Promise<T> {
    const now = Date.now();
    const candidates = this.providers.filter((p) => (this.benchedUntil.get(p.name) ?? 0) <= now);
    // If everything is benched, try them all anyway rather than returning nothing.
    const order = candidates.length > 0 ? candidates : this.providers;

    let lastError: unknown;
    for (const provider of order) {
      try {
        return await call(provider);
      } catch (err) {
        lastError = err;
        this.benchedUntil.set(provider.name, Date.now() + COOLDOWN_MS);
        console.warn(`[sky] provider ${provider.name} failed, benched ${COOLDOWN_MS / 1000}s:`, err);
      }
    }
    throw lastError;
  }
}
