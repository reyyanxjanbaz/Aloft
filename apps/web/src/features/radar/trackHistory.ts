import type { AircraftState } from "@aloft/shared";

/**
 * Where each contact has actually been, and how its altitude has moved.
 *
 * The scope draws a short trail behind every mark and a climb/descend arrow in
 * its data block. Neither can come from the feed: `AircraftState` carries no
 * vertical rate and no history, only the latest fix. So this records what we
 * were actually told, sample by sample.
 *
 * Only *new* server fixes are recorded — samples are keyed on `ac.ts`, not on
 * the render clock. Recording the dead-reckoned position every frame would draw
 * a perfectly straight trail that says nothing except "we extrapolated", and
 * would make a turning aircraft look like it flew straight.
 */

/** How many past fixes to keep per contact. Four is what the trail draws. */
export const TRAIL_POINTS = 4;

/** Feet of altitude change before a contact counts as climbing or descending. */
const TREND_FT = 250;

export interface TrackPoint {
  lat: number;
  lon: number;
  altFt: number;
  ts: number;
}

export type Trend = "up" | "down" | "level";

interface Track {
  points: TrackPoint[];
  lastTs: number;
}

const tracks = new Map<string, Track>();

/**
 * Records this frame's contacts, and forgets any that have left the scope.
 *
 * Pruning is not optional: without it this map grows for every aircraft ever
 * streamed into the viewport and never shrinks, which on a long session over a
 * busy cell is thousands of entries the scope will never draw again.
 */
export function recordTracks(planes: Iterable<AircraftState>): void {
  const seen = new Set<string>();

  for (const ac of planes) {
    seen.add(ac.hex);
    let track = tracks.get(ac.hex);
    if (!track) {
      track = { points: [], lastTs: 0 };
      tracks.set(ac.hex, track);
    }
    // The same fix arrives on every frame until the server sends a new one.
    if (ac.ts === track.lastTs) continue;
    track.lastTs = ac.ts;
    track.points.push({ lat: ac.lat, lon: ac.lon, altFt: ac.altFt, ts: ac.ts });
    if (track.points.length > TRAIL_POINTS) track.points.shift();
  }

  for (const hex of tracks.keys()) {
    if (!seen.has(hex)) tracks.delete(hex);
  }
}

/** Past fixes for a contact, oldest first. Empty until a second fix arrives. */
export function trailFor(hex: string): TrackPoint[] {
  return tracks.get(hex)?.points ?? [];
}

/**
 * Whether a contact is climbing, descending or level, from observed altitude.
 *
 * Reports "level" until there are two fixes to compare — an unknown trend must
 * never be drawn as a confident arrow.
 */
export function trendFor(hex: string): Trend {
  const points = tracks.get(hex)?.points;
  if (!points || points.length < 2) return "level";
  const delta = points[points.length - 1]!.altFt - points[0]!.altFt;
  if (delta > TREND_FT) return "up";
  if (delta < -TREND_FT) return "down";
  return "level";
}

/** Test seam, and used when the feed is torn down so a reconnect starts clean. */
export function clearTracks(): void {
  tracks.clear();
}
