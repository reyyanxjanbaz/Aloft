import {
  CAPTURE_RADIUS_KM,
  KT_TO_MS,
  closestApproach,
  distanceM,
  type AircraftState,
} from "@aloft/shared";
import { projectedPosition } from "../../lib/project";
import { trendFor, type Trend } from "./trackHistory";

/**
 * Which contacts earn a data block, and what it says.
 *
 * A block per contact is unreadable within seconds over a hub — the option that
 * introduced them said so, and said the decluttering was the hard part. This is
 * that decluttering, kept deliberately simple and explicit rather than
 * emergent: a zoom floor, a hard cap, and a stated priority order.
 */

/** Below this zoom the scope is too coarse for text to mean anything. */
export const BLOCK_MIN_ZOOM = 7.5;
/** Hard ceiling on blocks drawn at once, whatever the zoom. */
export const MAX_BLOCKS = 12;
/** How far ahead the prediction vector reaches. */
export const PREDICT_SEC = 60;
/** Vectors are only drawn for contacts arriving inside this horizon. */
const PREDICT_HORIZON_SEC = 900;
/**
 * Ceilings that keep per-frame work independent of feed size. A wide viewport
 * over Europe streams the better part of a thousand contacts; without these the
 * render loop's cost scaled with all of them, every frame.
 */
export const MAX_VECTORS = 12;
export const MAX_TRAILS = 60;

export interface BlockDatum {
  hex: string;
  /** Projected position — where the mark actually is this frame. */
  lat: number;
  lon: number;
  /** Line one: callsign, registration, or the hex. */
  ident: string;
  /** Line two: flight level (or GND), trend arrow, ground speed. */
  level: string;
  trend: Trend;
  gs: string;
  selected: boolean;
  inRange: boolean;
  /** Ground range in km, for the priority sort. */
  km: number;
}

function flightLevel(altFt: number): string {
  if (altFt <= 0) return "GND";
  return String(Math.round(altFt / 100)).padStart(3, "0");
}

/**
 * Ranks contacts and returns only those that should carry a block.
 *
 * Priority is selected first, then capturable, then nearest — so the cap always
 * spends itself on the contacts the player can act on rather than on whatever
 * happened to be first in the map.
 */
export function selectBlocks(
  planes: Iterable<AircraftState>,
  me: { lat: number; lon: number },
  selectedHex: string | null,
  zoom: number,
  nowMs: number
): BlockDatum[] {
  if (zoom < BLOCK_MIN_ZOOM) return [];

  const rows: BlockDatum[] = [];
  for (const ac of planes) {
    const { lat, lon } = projectedPosition(ac, nowMs);
    const km = distanceM(me.lat, me.lon, lat, lon) / 1000;
    rows.push({
      hex: ac.hex,
      lat,
      lon,
      ident: ac.callsign || ac.reg || ac.hex.toUpperCase(),
      level: flightLevel(ac.altFt),
      trend: trendFor(ac.hex),
      gs: String(Math.round(ac.gsKt)),
      selected: ac.hex === selectedHex,
      inRange: km <= CAPTURE_RADIUS_KM,
      km,
    });
  }

  rows.sort((a, b) => {
    if (a.selected !== b.selected) return a.selected ? -1 : 1;
    if (a.inRange !== b.inRange) return a.inRange ? -1 : 1;
    return a.km - b.km;
  });

  return rows.slice(0, MAX_BLOCKS);
}

/**
 * Contacts worth drawing a prediction vector for.
 *
 * Only the ones actually coming to you, plus whatever is selected. A vector on
 * every contact is 40 lines saying "this aircraft is moving", which the mark's
 * own rotation already says; a vector on the six that will be capturable within
 * fifteen minutes is the useful half.
 */
export function selectPredicted(
  planes: Iterable<AircraftState>,
  me: { lat: number; lon: number },
  selectedHex: string | null,
  nowMs: number
): AircraftState[] {
  const out: AircraftState[] = [];
  for (const ac of planes) {
    // A vector needs a direction and a speed to mean anything. Without both,
    // `deadReckon` returns the aircraft's own position — which would draw a
    // zero-length line and park the open "predicted position" circle directly
    // on top of the mark, claiming a prediction that was never made. This has
    // to be checked for the selected contact too, not only the rest.
    if (ac.track === null || !(ac.gsKt > 0)) continue;
    if (ac.hex === selectedHex) {
      out.push(ac);
      continue;
    }
    const p = projectedPosition(ac, nowMs);
    const km = distanceM(me.lat, me.lon, p.lat, p.lon) / 1000;
    // Already capturable — the ring and the mark's own colour say so.
    if (km <= CAPTURE_RADIUS_KM) continue;
    // Cheap reject before the expensive one: anything beyond the distance it
    // could physically cover inside the horizon can never reach the ring, and
    // skipping it here keeps `closestApproach` off the bulk of a busy feed.
    if (km - CAPTURE_RADIUS_KM > (ac.gsKt * KT_TO_MS * PREDICT_HORIZON_SEC) / 1000) continue;
    if (out.length >= MAX_VECTORS) continue;
    const approach = closestApproach(
      me,
      { lat: p.lat, lon: p.lon, track: ac.track, gsKt: ac.gsKt },
      { horizonSec: PREDICT_HORIZON_SEC }
    );
    if (approach?.entersCaptureRange && approach.tCloseSec > 0) out.push(ac);
  }
  return out;
}

/**
 * Contacts that get a trail, nearest first.
 *
 * Trails were drawn for every contact the feed streamed — at 900 aircraft that
 * is nearly 4,000 point features rebuilt twenty times a second, tens of
 * thousands of throwaway objects per second, for marks a few pixels across that
 * nobody is reading. Capping by proximity keeps the cost flat no matter how
 * busy the cell is, and keeps the trails where they are actually legible.
 */
export function selectTrailed(
  planes: Iterable<AircraftState>,
  me: { lat: number; lon: number },
  selectedHex: string | null,
  nowMs: number
): AircraftState[] {
  const rows: Array<{ ac: AircraftState; km: number; selected: boolean }> = [];
  for (const ac of planes) {
    const p = projectedPosition(ac, nowMs);
    rows.push({
      ac,
      km: distanceM(me.lat, me.lon, p.lat, p.lon) / 1000,
      selected: ac.hex === selectedHex,
    });
  }
  rows.sort((a, b) => {
    if (a.selected !== b.selected) return a.selected ? -1 : 1;
    return a.km - b.km;
  });
  return rows.slice(0, MAX_TRAILS).map((r) => r.ac);
}
