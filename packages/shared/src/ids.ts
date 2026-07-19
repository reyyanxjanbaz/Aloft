/**
 * Canonical identity for a catch: one airframe, one UTC day.
 *
 * Deliberately excludes the callsign. A flight's callsign is not stable — it
 * is absent on some fixes and changes mid-flight on others — so keying on it
 * split a single flight into two catches and let the same airframe be counted
 * twice in a day. The airframe (hex) is the thing being collected; the day is
 * what makes a re-catch tomorrow a new entry.
 *
 * UTC rather than local time so the id a client computes and the id the server
 * computes always agree, wherever the player is.
 */
export function catchIdUtc(hex: string, caughtAtMs: number): string {
  const day = new Date(caughtAtMs).toISOString().slice(0, 10).replaceAll("-", "");
  return `${hex.toLowerCase()}:${day}`;
}
