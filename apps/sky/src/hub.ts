import {
  CAPTURE_RADIUS_KM,
  deadReckon,
  distanceM,
  MAX_VIEW_RADIUS_KM,
  MIN_VIEW_RADIUS_KM,
  NM_TO_KM,
  rarityFor,
  type AircraftState,
  type CatchResponse,
  type ServerMessage,
} from "@aloft/shared";
import type { FlightProvider } from "./providers/types";

const CELL_DEG = 0.5; // ~55 km of latitude per cell
const POLL_MS = 3000;
/** How long one cell's on-demand catch-validation poll is reused. */
const ON_DEMAND_POLL_TTL_MS = POLL_MS * 4;
// Half-diagonal of a 0.5° cell (~39 km at the equator) plus the max player radius —
// one upstream request per cell covers every subscriber assigned to it.
const CELL_SLACK_KM = 40;

export interface Subscriber {
  id: number;
  lat: number;
  lon: number;
  /** Viewport radius — how much sky this client is looking at. */
  viewRadiusKm: number;
  /**
   * Where the device is, when the player has panned the scope away from
   * themselves. Falls back to lat/lon when absent.
   */
  playerLat?: number;
  playerLon?: number;
  /** Player identity, if known — enables the catch-location cross-check below. */
  playerId?: string;
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
/**
 * Outer bound for accepting a catch. Generous relative to the capture radius so
 * GPS drift and stale fixes never reject a legitimate capture, while still
 * rejecting anything absurd.
 */
const CATCH_MAX_DISTANCE_KM = CAPTURE_RADIUS_KM * 6;
/** How long a player's last-reported position stays usable for the cross-check below. */
const PLAYER_POSITION_MAX_AGE_MS = 5 * 60_000;
/**
 * How far a claimed catch location may drift from the player's last-known
 * subscribed position. Generous relative to CAPTURE_RADIUS_KM so ordinary GPS
 * drift and the gap between "last WS position update" and "catch submitted"
 * never reject a real capture, while still requiring the player to have
 * actually been in the neighbourhood — not simply copying the aircraft's own
 * broadcast position, which validateCatch alone can't distinguish from a real
 * capture.
 */
const PLAYER_POSITION_TOLERANCE_KM = CAPTURE_RADIUS_KM * 2;
/**
 * A player cannot plausibly travel faster than this between two catches. Set
 * well above airliner cruise (~900 km/h) so someone catching planes from a
 * window seat is never flagged; only globe-spanning jumps — the signature of a
 * client echoing aircrafts' own broadcast positions from anywhere on Earth —
 * exceed it.
 */
const MAX_PLAYER_SPEED_KMH = 1500;
/** Jumps shorter than this are never treated as teleporting, whatever the implied speed. */
const CATCH_TELEPORT_MIN_KM = 25;
/** How long a player's last catch location is retained for the plausibility check. */
const CATCH_POSITION_TTL_MS = 6 * 60 * 60_000;

interface AirframeHistory {
  latest: AircraftState;
  fixes: { lat: number; lon: number; track: number | null; gsKt: number; ts: number }[];
}

interface PlayerPosition {
  lat: number;
  lon: number;
  ts: number;
}

export class SkyHub {
  private cells = new Map<string, Cell>();
  private nextId = 1;
  private subscriberCells = new Map<number, string>();
  /** hex → recent position history, the source of truth for catch validation. */
  private history = new Map<string, AirframeHistory>();
  /** playerId → last position we saw them subscribe from. */
  private playerPositions = new Map<string, PlayerPosition>();
  /** playerId → where/when they last landed a validated catch, for the travel-plausibility check. */
  private lastCatchPositions = new Map<string, PlayerPosition>();
  /** cellKey → in-flight or recent on-demand catch-validation poll. */
  private onDemandPolls = new Map<string, { at: number; promise: Promise<void> }>();

  constructor(private provider: FlightProvider) {
    setInterval(() => this.pruneHistory(), 60_000).unref?.();
  }

  /**
   * One upstream fetch per cell per ON_DEMAND_POLL_TTL_MS, shared by every
   * caller that lands in the same cell. A burst of catches in one area — a
   * group of players at an airfield, or a client retrying — collapses into a
   * single request rather than one each.
   */
  private onDemandPoll(lat: number, lon: number): Promise<void> {
    const key = cellKey(lat, lon);
    const existing = this.onDemandPolls.get(key);
    if (existing && Date.now() - existing.at < ON_DEMAND_POLL_TTL_MS) return existing.promise;

    const promise = this.provider
      .getAircraftNear(lat, lon, MAX_VIEW_RADIUS_KM / NM_TO_KM)
      .then((aircraft) => {
        this.recordHistory(aircraft);
      })
      .catch((err) => {
        // A failed poll must not be cached as a success, or the next caller
        // in this cell would silently skip its own attempt.
        this.onDemandPolls.delete(key);
        console.warn("[hub] on-demand poll for catch validation failed:", err);
      });

    this.onDemandPolls.set(key, { at: Date.now(), promise });
    return promise;
  }

  /**
   * Validates that `hex` really was near (lat, lon) at time `ts`, using only
   * positions this server saw itself, AND — when `claimingPlayerId` has a
   * recent tracked position — that (lat, lon) is somewhere near where that
   * player's own device was actually reporting itself. Without the second
   * check, a client could pass validation by simply echoing back the plane's
   * own broadcast position (which it already receives over the live feed)
   * without the player needing to be anywhere near it.
   */
  async validateCatch(
    hex: string,
    lat: number,
    lon: number,
    ts: number,
    claimingPlayerId?: string,
    opts: { allowOnDemandPoll?: boolean } = {}
  ): Promise<CatchResponse> {
    let entry = this.history.get(hex.toLowerCase());
    if (!entry && opts.allowOnDemandPoll) {
      // Every deploy starts a fresh instance with an empty history, which
      // would reject legitimate catches until the first poll of that cell
      // lands. Poll the claimed position once so a catch made seconds after
      // a restart still counts.
      //
      // Gated on the caller being an authenticated player, and coalesced per
      // cell: unauthenticated callers could otherwise drive one ~250 km
      // upstream fetch per request just by submitting random hexes, which is
      // an amplification vector against the ADS-B feeds we depend on and a
      // fast route to having this server's IP banned.
      await this.onDemandPoll(lat, lon);
      entry = this.history.get(hex.toLowerCase());
    }
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

    if (claimingPlayerId) {
      const known = this.playerPositions.get(claimingPlayerId);
      if (known && now - known.ts < PLAYER_POSITION_MAX_AGE_MS) {
        const driftKm = distanceM(known.lat, known.lon, lat, lon) / 1000;
        if (driftKm > PLAYER_POSITION_TOLERANCE_KM) {
          return { ok: false, reason: "claimed location doesn't match your reported position" };
        }
      }

      // Travel-plausibility. The drift check above compares against a position
      // the client also supplies over the socket, so a client echoing a
      // plane's own broadcast position passes it. This check instead uses
      // something the client cannot fake away — its own catch history — and
      // rejects a claimed location no real journey could reach from the last
      // catch in the time elapsed. It's what stops a single identity from
      // farming rare airframes all over the globe. Catch timestamps are
      // pinned to within CATCH_TIME_SLACK_MS of real time (checked above), so
      // the elapsed interval can't be inflated to sneak a jump through.
      const last = this.lastCatchPositions.get(claimingPlayerId);
      if (last) {
        const jumpKm = distanceM(last.lat, last.lon, lat, lon) / 1000;
        const elapsedH = Math.max(ts - last.ts, 1) / 3_600_000;
        if (jumpKm > CATCH_TELEPORT_MIN_KM && jumpKm / elapsedH > MAX_PLAYER_SPEED_KMH) {
          return { ok: false, reason: "claimed location is impossibly far from your last catch" };
        }
      }
      this.lastCatchPositions.set(claimingPlayerId, { lat, lon, ts });
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
    const now = Date.now();
    const cutoff = now - HISTORY_TTL_MS;
    for (const [key, entry] of this.history) {
      if (entry.latest.ts < cutoff) this.history.delete(key);
    }
    const posCutoff = now - PLAYER_POSITION_MAX_AGE_MS;
    for (const [playerId, pos] of this.playerPositions) {
      if (pos.ts < posCutoff) this.playerPositions.delete(playerId);
    }
    const catchCutoff = now - CATCH_POSITION_TTL_MS;
    for (const [playerId, pos] of this.lastCatchPositions) {
      if (pos.ts < catchCutoff) this.lastCatchPositions.delete(playerId);
    }
  }

  allocateId(): number {
    return this.nextId++;
  }

  subscribe(sub: Subscriber): void {
    sub.viewRadiusKm = Math.min(
      Math.max(sub.viewRadiusKm, MIN_VIEW_RADIUS_KM),
      MAX_VIEW_RADIUS_KM
    );

    if (sub.playerId) {
      // Prefer the device's own position over the viewport centre: a player
      // panning the scope across the country is still standing where they
      // were, and the catch cross-check must not treat that as teleporting.
      const lat = Number.isFinite(sub.playerLat) ? (sub.playerLat as number) : sub.lat;
      const lon = Number.isFinite(sub.playerLon) ? (sub.playerLon as number) : sub.lon;
      this.playerPositions.set(sub.playerId, { lat, lon, ts: Date.now() });
    }

    const key = cellKey(sub.lat, sub.lon);

    // Re-subscribing to the same cell (a GPS refresh, or a map pan that
    // didn't cross a cell boundary) just updates this subscriber's record in
    // place. Tearing the cell down and recreating it — the previous
    // behaviour, via an unconditional unsubscribe+recreate below — meant a
    // client that re-subscribes often (every GPS tick is a realistic
    // pattern) forced a fresh, unthrottled upstream poll on every message
    // instead of respecting POLL_MS.
    if (this.subscriberCells.get(sub.id) === key) {
      const existingCell = this.cells.get(key);
      if (existingCell) {
        existingCell.subscribers.set(sub.id, sub);
        if (existingCell.lastAircraft.length > 0) this.deliver(existingCell, sub);
        return;
      }
    }

    this.unsubscribe(sub.id);

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
      // Register before starting the poll loop: startPolling fires its first
      // poll synchronously, and that poll sizes its radius from the widest
      // subscriber viewport. Registering afterwards meant the first fetch of a
      // brand-new cell always saw zero subscribers and fell back to
      // CELL_SLACK_KM alone, so a client with a wide viewport got a scope
      // truncated to 40 km until the next tick.
      cell.subscribers.set(sub.id, sub);
      this.subscriberCells.set(sub.id, key);
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
          ...[...cell.subscribers.values()].map((s) => s.viewRadiusKm),
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
    // Stream everything inside the viewport, not just what's capturable —
    // an empty-looking scope was the single worst thing about the old build.
    const aircraft = cell.lastAircraft.filter(
      (ac) => distanceM(sub.lat, sub.lon, ac.lat, ac.lon) <= sub.viewRadiusKm * 1000
    );
    sub.send({ type: "planes", now: Date.now(), aircraft });
  }
}
