import { angleDiffDeg, bearingDeg, distanceM, elevationDeg, FT_TO_M, type AircraftState } from "@aloft/shared";
import { projectedPosition } from "../../lib/project";

export const AZ_TOLERANCE = 15;
export const EL_TOLERANCE = 12;
export const CAPTURE_SECONDS = 2.5;
/** How long a full ring drains from when aim is lost. */
const DECAY_SECONDS = 1.5;

export interface AimSolution {
  /** Signed horizontal offset from where the player is aiming, degrees. */
  dAz: number;
  /** Signed vertical offset, degrees. */
  dEl: number;
  aligned: boolean;
  /** Within the wider "closing" band that drives the near state. */
  near: boolean;
  groundM: number;
  /** True bearing to the aircraft. */
  az: number;
  /** Elevation angle to the aircraft. */
  el: number;
}

/**
 * Where the aircraft is relative to where the phone is pointing.
 *
 * `dAz` goes through angleDiffDeg rather than plain subtraction: aiming at
 * 359° with the target at 1° is a 2° error, not 358°, and getting that wrong
 * makes the reticle unreachable near north.
 */
export function computeAimSolution(
  player: { lat: number; lon: number },
  aim: { heading: number; pitch: number },
  ac: AircraftState,
  nowMs: number
): AimSolution {
  const p = projectedPosition(ac, nowMs);
  const groundM = distanceM(player.lat, player.lon, p.lat, p.lon);
  const az = bearingDeg(player.lat, player.lon, p.lat, p.lon);
  const el = elevationDeg(groundM, 0, ac.altFt * FT_TO_M);

  const dAz = angleDiffDeg(aim.heading, az);
  const dEl = el - aim.pitch;

  return {
    dAz,
    dEl,
    aligned: Math.abs(dAz) < AZ_TOLERANCE && Math.abs(dEl) < EL_TOLERANCE,
    near: Math.abs(dAz) < AZ_TOLERANCE * 2.5 && Math.abs(dEl) < EL_TOLERANCE * 2.5,
    groundM,
    az,
    el,
  };
}

/** Advance the capture ring: fills while aligned, drains faster when not. */
export function stepProgress(progress: number, dtSec: number, aligned: boolean): number {
  const delta = aligned ? dtSec / CAPTURE_SECONDS : -dtSec / DECAY_SECONDS;
  return Math.max(0, Math.min(1, progress + delta));
}
