import { deadReckon, type AircraftState } from "@aloft/shared";
import { serverNow } from "../state/planes";

/**
 * Positions arrive every few seconds, so anything that draws or measures an
 * aircraft has to project it forward to *now* first. Every caller must use
 * the same projection: the map used to dead-reckon while the contact card
 * measured raw positions, so a fast aircraft near the 15 km ring could be lit
 * green and counted in range on the scope while its own card said "out of
 * range" and disabled the Hunt button.
 *
 * Ages are measured against the server's clock (positions are stamped
 * server-side), not this device's, which may be minutes off.
 */
const MAX_PROJECTION_SEC = 60;

export interface Projected {
  lat: number;
  lon: number;
  /** Seconds of extrapolation applied, before clamping. */
  ageSec: number;
}

export function projectedPosition(ac: AircraftState, nowMs: number = serverNow()): Projected {
  const ageSec = (nowMs - ac.ts) / 1000 + ac.seenPosSec;
  // Beyond a minute the extrapolation is fiction — a turning aircraft has
  // long since left the straight line we're projecting along.
  const [lat, lon] = deadReckon(ac.lat, ac.lon, ac.track, ac.gsKt, Math.min(ageSec, MAX_PROJECTION_SEC));
  return { lat, lon, ageSec };
}
