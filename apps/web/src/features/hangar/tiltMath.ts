/**
 * Pure orientation → light-vector maths for the collection foil.
 *
 * Kept separate from the hook so the response curve can be tested without a
 * sensor. The previous curve saturated at 22 degrees and measured pitch against
 * a fixed 45 degree "neutral", which meant an ordinary wrist roll pinned the
 * light into a corner and left it there — the foil looked broken even when the
 * gyroscope was working perfectly.
 */

/** Degrees of tilt that map to the full sweep of the light. */
export const TILT_RANGE_DEG = 34;

const clamp = (v: number, a = -1, b = 1): number => Math.min(Math.max(v, a), b);

/**
 * Re-express beta/gamma in the frame the player actually sees, so "roll" is
 * always across the screen whichever way the phone is rotated.
 */
export function remapForScreen(
  beta: number,
  gamma: number,
  screenAngle: number
): { pitch: number; roll: number } {
  if (screenAngle === 90) return { pitch: -gamma, roll: beta };
  if (screenAngle === 270 || screenAngle === -90) return { pitch: gamma, roll: -beta };
  if (screenAngle === 180) return { pitch: -beta, roll: -gamma };
  return { pitch: beta, roll: gamma };
}

/**
 * Map roll/pitch to the light vector, relative to the posture the phone is
 * actually being held in (`neutralPitch`, calibrated from the first readings).
 * Holding the phone flat on a table and holding it up to read both rest at
 * zero, so the sweep is symmetric from wherever the player starts.
 */
export function tiltVector(
  roll: number,
  pitch: number,
  neutralPitch: number
): { tx: number; ty: number } {
  return {
    tx: clamp(roll / TILT_RANGE_DEG),
    ty: clamp((pitch - neutralPitch) / TILT_RANGE_DEG),
  };
}
