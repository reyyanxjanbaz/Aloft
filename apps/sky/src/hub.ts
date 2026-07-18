import {
  deadReckon,
  distanceM,
  MAX_RADIUS_KM,
  NM_TO_KM,
  rarityFor,
  type AircraftState,
  type CatchResponse,
  type ServerMessage,
} from "@aloft/shared";
import type { FlightProvider } from "./providers/types";

const CELL_DEG = 0.5; // ~55 km of latitude per cell
const POLL_MS = 3000;
// Half-diagonal of a 0.5° cell (~39 km at the equator) plus the max player radius —
// one upstream request per cell covers every subscriber assigned to it.
const CELL_SLACK_KM = 40;

export interface Subscriber {
  id: number;
  lat: number;
  lon: number;
  radiusKm: number;
  send(msg: ServerMessage): void;
}

interface Cell {
  key: string;
  centerLat: number;
  centerLon: number;
  subscribers: Map<number, Subscriber>;
  timer?: NodeJS.Timeout;
  polling: boolean;
  /** Last successful fetch, kept so new subscribers get planes instantly. */
  lastAircraft: AircraftState[];
}

function cellKey(lat: number, lon: number): string {
  return `${Math.floor(lat / CELL_DEG)}:${Math.floor(lon / CELL_DEG)}`;
}

/**
 * Groups subscribers into geographic cells so N players in one area cost a
 * single upstream request per poll interval, then fans out per-player slices.
 */
const HISTORY_TTL_MS = 10 * 60_000;
const HISTORY_MAX_FIXES = 40;
/** How stale a fix may be (either side) and still validate a catch. */
const CATCH_TIME_SLACK_MS = 90_000;
const CATCH_MAX_DISTANCE_KM = MAX_RADIUS_KM + 20;

interface AirframeHistory {
  latest: AircraftState;
  fixes: { lat: number; lon: number; track: number; gsKt: number; ts: number }[];
}

export class SkyHub {
  private cells = new Map<string, Cell>();
  private nextId = 1;
  private subscriberCells = new Map<number, string>();
  /** hex → recent position history, the source of truth for catch validation. */
  private history = new Map<string, AirframeHistory>();

  constructor(private provider: FlightProvider) {
    setInterval(() => this.pruneHistory(), 60_000).unref?.();
  }

  /**
   * Validates that `hex` really was near (lat, lon) at time `ts`, using only
   * positions this server saw itself. The client is never trusted.
   */
  validateCatch(hex: string, lat: number, lon: number, ts: number): CatchResponse {
    const entry = this.history.get(hex.toLowerCase());
    if (!entry) return { ok: false, reason: "unknown aircraft — not seen on this radar" };

    const now = Date.now();
    if (Math.abs(now - ts) > CATCH_TIME_SLACK_MS) {
      return { ok: false, reason: "catch timestamp too far from server time" };
    }

    let bestKm = Infinity;
    for (const fix of entry.fixes) {
      if (Math.abs(fix.ts - ts) > CATCH_TIME_SLACK_MS) continue;
      // Project the fix to the claimed catch moment before measuring.
      const [pLat, pLon] = deadReckon(fix.lat, fix.lon, fix.track, fix.gsKt, (ts - fix.ts) / 1000);
      bestKm = Math.min(bestKm, distanceM(lat, lon, pLat, pLon) / 1000);
    }
    if (bestKm === Infinity) return { ok: false, reason: "no recent position fix for that aircraft" };
    if (bestKm > CATCH_MAX_DISTANCE_KM) {
      return { ok: false, reason: `aircraft was ${bestKm.toFixed(0)} km away — out of range` };
    }

    return {
      ok: true,
      catch: {
        aircraft: entry.latest,
        rarity: rarityFor(entry.latest.typeIcao),
        distanceKm: Math.round(bestKm * 10) / 10,
        caughtAt: ts,
      },
    };
  }

  private recordHistory(aircraft: AircraftState[]): void {
    for (const ac of aircraft) {
      const key = ac.hex.toLowerCase();
      const entry = this.history.get(key) ?? { latest: ac, fixes: [] };
      entry.latest = ac;
      entry.fixes.push({ lat: ac.lat, lon: ac.lon, track: ac.track, gsKt: ac.gsKt, ts: ac.ts });
      if (entry.fixes.length > HISTORY_MAX_FIXES) entry.fixes.shift();
      this.history.set(key, entry);
    }
  }

  private pruneHistory(): void {
    const cutoff = Date.now() - HISTORY_TTL_MS;
    for (const [key, entry] of this.history) {
      if (entry.latest.ts < cutoff) this.history.delete(key);
    }
  }

  allocateId(): number {
    return this.nextId++;
  }

  subscribe(sub: Subscriber): void {
    sub.radiusKm = Math.min(Math.max(sub.radiusKm, 1), MAX_RADIUS_KM);
    this.unsubscribe(sub.id);

    const key = cellKey(sub.lat, sub.lon);
    let cell = this.cells.get(key);
    if (!cell) {
      cell = {
        key,
        centerLat: (Math.floor(sub.lat / CELL_DEG) + 0.5) * CELL_DEG,
        centerLon: (Math.floor(sub.lon / CELL_DEG) + 0.5) * CELL_DEG,
        subscribers: new Map(),
        polling: false,
        lastAircraft: [],
      };
      this.cells.set(key, cell);
      this.startPolling(cell);
    }
    cell.subscribers.set(sub.id, sub);
    this.subscriberCells.set(sub.id, key);

    if (cell.lastAircraft.length > 0) {
      this.deliver(cell, sub);
    }
  }

  unsubscribe(id: number): void {
    const key = this.subscriberCells.get(id);
    if (!key) return;
    this.subscriberCells.delete(id);
    const cell = this.cells.get(key);
    if (!cell) return;
    cell.subscribers.delete(id);
    if (cell.subscribers.size === 0) {
      if (cell.timer) clearInterval(cell.timer);
      this.cells.delete(key);
    }
  }

  /** One-shot query for the REST debug endpoint. */
  async query(lat: number, lon: number, radiusKm: number): Promise<AircraftState[]> {
    const aircraft = await this.provider.getAircraftNear(lat, lon, radiusKm / NM_TO_KM);
    this.recordHistory(aircraft);
    return aircraft.filter((ac) => distanceM(lat, lon, ac.lat, ac.lon) <= radiusKm * 1000);
  }

  get stats() {
    return {
      cells: this.cells.size,
      subscribers: this.subscriberCells.size,
      upstreamReqPerMin: Math.round((this.cells.size * 60_000) / POLL_MS),
    };
  }

  private startPolling(cell: Cell): void {
    const poll = async () => {
      if (cell.polling) return;
      cell.polling = true;
      try {
        const maxSubRadius = Math.max(
          ...[...cell.subscribers.values()].map((s) => s.radiusKm),
          0
        );
        const radiusNm = (CELL_SLACK_KM + maxSubRadius) / NM_TO_KM;
        cell.lastAircraft = await this.provider.getAircraftNear(cell.centerLat, cell.centerLon, radiusNm);
        this.recordHistory(cell.lastAircraft);
        for (const sub of cell.subscribers.values()) {
          this.deliver(cell, sub);
        }
      } catch (err) {
        console.warn(`[sky] cell ${cell.key} poll failed:`, err);
      } finally {
        cell.polling = false;
      }
    };
    void poll();
    cell.timer = setInterval(poll, POLL_MS);
  }

  private deliver(cell: Cell, sub: Subscriber): void {
    const aircraft = cell.lastAircraft.filter(
      (ac) => distanceM(sub.lat, sub.lon, ac.lat, ac.lon) <= sub.radiusKm * 1000
    );
    sub.send({ type: "planes", now: Date.now(), aircraft });
  }
}
