import { CAPTURE_RADIUS_KM } from "./types";
import { KT_TO_MS } from "./geo";

/**
 * Closest-approach prediction: when, and how near, an aircraft will pass.
 *
 * The radar answers "what is around me"; this answers "what is about to be".
 * Knowing a 747 is nine minutes out and will pass overhead is the difference
 * between staring at a screen and going outside to look up.
 *
 * Modelled as straight-line motion over a local tangent plane. Over a
 * fifteen-minute horizon and a few hundred kilometres that is accurate to
 * well under the tolerance any of this is displayed at, and it avoids
 * iterating great-circle positions per aircraft per frame.
 */

/** Metres per degree of latitude (mean). */
const M_PER_DEG_LAT = 110_574;
/** Metres per degree of longitude at the equator; scaled by cos(lat). */
const M_PER_DEG_LON_EQUATOR = 111_320;

export interface ClosestApproach {
  /** Seconds until the closest point; 0 when it is already receding. */
  tCloseSec: number;
  /** Distance at that moment, kilometres. */
  closeKm: number;
  /** True when it comes inside the capture ring within the horizon. */
  entersCaptureRange: boolean;
  /** Where to look when it gets there, degrees from true north. */
  bearingAtClose: number;
}

export interface ApproachOptions {
  /** How far ahead to predict. Beyond this, aircraft turn and the model lies. */
  horizonSec?: number;
  captureKm?: number;
}

export interface ApproachTarget {
  lat: number;
  lon: number;
  /** Degrees from true north, or null when not broadcast. */
  track: number | null;
  gsKt: number;
}

/**
 * Returns null when the aircraft isn't usefully predictable — no broadcast
 * track, or not moving. Guessing a heading for those would put a countdown
 * on the board that quietly means nothing.
 */
export function closestApproach(
  player: { lat: number; lon: number },
  ac: ApproachTarget,
  options: ApproachOptions = {}
): ClosestApproach | null {
  if (ac.track === null || !(ac.gsKt > 0)) return null;

  const horizonSec = options.horizonSec ?? 900;
  const captureKm = options.captureKm ?? CAPTURE_RADIUS_KM;

  // Local east/north metres from the player, who is the origin.
  const mPerDegLon = M_PER_DEG_LON_EQUATOR * Math.cos((player.lat * Math.PI) / 180);
  const px = (ac.lon - player.lon) * mPerDegLon;
  const py = (ac.lat - player.lat) * M_PER_DEG_LAT;

  const speed = ac.gsKt * KT_TO_MS;
  const heading = (ac.track * Math.PI) / 180;
  const vx = speed * Math.sin(heading);
  const vy = speed * Math.cos(heading);

  // Time that minimises |p + v·t|, clamped to the horizon. Negative means the
  // closest approach already happened and it is on its way out.
  const vv = vx * vx + vy * vy;
  const tRaw = vv === 0 ? 0 : -(px * vx + py * vy) / vv;
  const tCloseSec = Math.max(0, Math.min(horizonSec, tRaw));

  const cx = px + vx * tCloseSec;
  const cy = py + vy * tCloseSec;
  const closeKm = Math.hypot(cx, cy) / 1000;

  // atan2(east, north) — bearing clockwise from north, the same convention
  // as bearingDeg, so compassWord can consume it directly.
  const bearingAtClose = (((Math.atan2(cx, cy) * 180) / Math.PI) + 360) % 360;

  return {
    tCloseSec,
    closeKm,
    entersCaptureRange: closeKm <= captureKm,
    bearingAtClose,
  };
}
