const EARTH_RADIUS_M = 6_371_000;
export const FT_TO_M = 0.3048;
export const KT_TO_MS = 0.514444;
export const NM_TO_KM = 1.852;

const rad = (deg: number) => (deg * Math.PI) / 180;
const deg = (r: number) => (r * 180) / Math.PI;

/** Great-circle distance in meters. */
export function distanceM(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const dLat = rad(lat2 - lat1);
  const dLon = rad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.sqrt(a));
}

/** Initial bearing from point 1 to point 2, degrees clockwise from true north (0–360). */
export function bearingDeg(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const dLon = rad(lon2 - lon1);
  const y = Math.sin(dLon) * Math.cos(rad(lat2));
  const x =
    Math.cos(rad(lat1)) * Math.sin(rad(lat2)) -
    Math.sin(rad(lat1)) * Math.cos(rad(lat2)) * Math.cos(dLon);
  return (deg(Math.atan2(y, x)) + 360) % 360;
}

/**
 * Elevation angle in degrees from an observer to an aircraft.
 * Ground distance uses the great circle; height difference is in meters.
 */
export function elevationDeg(groundDistanceM: number, observerAltM: number, targetAltM: number): number {
  if (groundDistanceM <= 0) return 90;
  return deg(Math.atan2(targetAltM - observerAltM, groundDistanceM));
}

/** Project a point `distM` meters along `bearing` degrees. Returns [lat, lon]. */
export function destinationPoint(lat: number, lon: number, bearing: number, distM: number): [number, number] {
  const δ = distM / EARTH_RADIUS_M;
  const θ = rad(bearing);
  const φ1 = rad(lat);
  const λ1 = rad(lon);
  const φ2 = Math.asin(
    Math.sin(φ1) * Math.cos(δ) + Math.cos(φ1) * Math.sin(δ) * Math.cos(θ)
  );
  const λ2 =
    λ1 +
    Math.atan2(
      Math.sin(θ) * Math.sin(δ) * Math.cos(φ1),
      Math.cos(δ) - Math.sin(φ1) * Math.sin(φ2)
    );
  return [deg(φ2), ((deg(λ2) + 540) % 360) - 180];
}

/** Signed shortest angular difference a→b in degrees, in (-180, 180]. */
export function angleDiffDeg(a: number, b: number): number {
  let d = (b - a) % 360;
  if (d <= -180) d += 360;
  if (d > 180) d -= 360;
  return d;
}

/**
 * Dead-reckon an aircraft position forward by `dtSec` along its track at its ground speed.
 * Returns [lat, lon].
 */
export function deadReckon(lat: number, lon: number, track: number, gsKt: number, dtSec: number): [number, number] {
  if (!gsKt || dtSec <= 0) return [lat, lon];
  return destinationPoint(lat, lon, track, gsKt * KT_TO_MS * dtSec);
}
