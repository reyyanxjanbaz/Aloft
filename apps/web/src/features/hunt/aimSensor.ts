/**
 * Turning a DeviceOrientationEvent into where the camera is actually pointing.
 *
 * Kept pure and separate from the hook so the platform quirks below can be
 * tested — they are impossible to exercise by hand on a desktop and were
 * silently wrong in landscape for every Android device.
 */

export interface OrientationSample {
  alpha: number | null;
  beta: number | null;
  gamma: number | null;
  absolute: boolean;
  /** iOS only: true compass heading of the top of the device. */
  webkitCompassHeading?: number;
}

export interface AimSolution {
  /** Degrees clockwise from true north the camera looks along. */
  heading: number;
  /** Degrees above the horizon, -90..90. */
  pitch: number;
}

const clampPitch = (p: number) => Math.max(-90, Math.min(90, p));
const wrap360 = (d: number) => ((d % 360) + 360) % 360;

/**
 * `screenAngleDeg` is `screen.orientation.angle`: 0 portrait, 90/270
 * landscape. Both the heading and the pitch axis depend on it, because the
 * sensor frame is fixed to the device while the camera the player is aiming
 * turns with the screen.
 */
export function deriveAim(s: OrientationSample, screenAngleDeg: number): AimSolution | null {
  const heading = deriveHeading(s, screenAngleDeg);
  const pitch = derivePitch(s, screenAngleDeg);
  if (heading === null || pitch === null) return null;
  return { heading, pitch };
}

export function deriveHeading(s: OrientationSample, screenAngleDeg: number): number | null {
  // iOS reports a true compass heading directly, but it is relative to the
  // top of the *device*, so rotating the phone into landscape turns the
  // camera 90° without changing the reported number.
  if (typeof s.webkitCompassHeading === "number" && !Number.isNaN(s.webkitCompassHeading)) {
    return wrap360(s.webkitCompassHeading + screenAngleDeg);
  }
  if (s.alpha === null) return null;
  // Absolute orientation is required for alpha to mean anything compass-like;
  // a relative alpha is an arbitrary zero and would send the player in a
  // random direction.
  if (!s.absolute && "ondeviceorientationabsolute" in window) return null;
  return wrap360(360 - s.alpha + screenAngleDeg);
}

export function derivePitch(s: OrientationSample, screenAngleDeg: number): number | null {
  const angle = wrap360(screenAngleDeg);
  // In portrait the phone tips about its X axis (beta). Rotate it into
  // landscape and the same physical "aim upward" motion now shows up on
  // gamma, with the sign depending on which way it was rotated. Reading beta
  // regardless — the old behaviour — made the elevation readout and the
  // reticle's vertical position wrong the moment the phone was turned.
  if (angle === 90) return s.gamma === null ? null : clampPitch(-s.gamma);
  if (angle === 270) return s.gamma === null ? null : clampPitch(s.gamma);
  if (angle === 180) return s.beta === null ? null : clampPitch(-(s.beta - 90));
  return s.beta === null ? null : clampPitch(s.beta - 90);
}

/** Current screen rotation, tolerating browsers without screen.orientation. */
export function screenAngle(): number {
  const fromApi = window.screen?.orientation?.angle;
  if (typeof fromApi === "number") return fromApi;
  const legacy = (window as { orientation?: number }).orientation;
  return typeof legacy === "number" ? wrap360(legacy) : 0;
}
