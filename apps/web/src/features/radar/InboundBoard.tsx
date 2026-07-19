import { useEffect, useMemo, useState } from "react";
import {
  CAPTURE_RADIUS_KM,
  closestApproach,
  compassWord,
  distanceM,
  rarityFor,
  typeName,
  type AircraftState,
} from "@aloft/shared";
import { projectedPosition } from "../../lib/project";
import type { PlayerPosition } from "../../lib/useGeolocation";
import { serverNow, usePlanes } from "../../state/planes";

/** Never list more than fits without covering the scope. */
const MAX_ROWS = 4;
/** How far ahead a pass is worth announcing. */
const HORIZON_SEC = 900;

interface Inbound {
  hex: string;
  label: string;
  rarity: ReturnType<typeof rarityFor>;
  /** Server-clock instant of closest approach. */
  etaMs: number;
  closeKm: number;
  look: string;
}

function countdown(msRemaining: number): string {
  const total = Math.max(0, Math.round(msRemaining / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

/**
 * What is about to fly over, and when.
 *
 * The scope shows what is around you now; a contact 60 km out is a dot with
 * no obvious meaning. This turns each one into a decision: something rare is
 * nine minutes away and will pass to the west, so there is time to get
 * outside. Only aircraft currently outside the ring that will enter it are
 * listed — anything already capturable is on the scope in green.
 */
export function InboundBoard({
  position,
  onSelect,
}: {
  position: PlayerPosition;
  onSelect: (hex: string) => void;
}) {
  const planes = usePlanes((s) => s.planes);
  // Frames arrive every few seconds, but a countdown has to tick every
  // second to read as one.
  const [, tick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => tick((n) => n + 1), 1000);
    return () => clearInterval(id);
  }, []);

  const inbound = useMemo(() => {
    const now = serverNow();
    const rows: Inbound[] = [];

    for (const ac of planes.values()) {
      const projected = projectedPosition(ac, now);
      const currentKm = distanceM(position.lat, position.lon, projected.lat, projected.lon) / 1000;
      // Already capturable — the scope is already telling them that.
      if (currentKm <= CAPTURE_RADIUS_KM) continue;

      const approach = closestApproach(
        position,
        { lat: projected.lat, lon: projected.lon, track: ac.track, gsKt: ac.gsKt },
        { horizonSec: HORIZON_SEC }
      );
      if (!approach?.entersCaptureRange || approach.tCloseSec <= 0) continue;

      rows.push({
        hex: ac.hex,
        label: typeName(ac.typeIcao),
        rarity: rarityFor(ac.typeIcao),
        etaMs: now + approach.tCloseSec * 1000,
        closeKm: approach.closeKm,
        look: compassWord(approach.bearingAtClose),
      });
    }

    return rows.sort((a, b) => a.etaMs - b.etaMs).slice(0, MAX_ROWS);
  }, [planes, position.lat, position.lon]);

  if (inbound.length === 0) return null;

  const now = serverNow();

  return (
    <section className="inbound" aria-label="Inbound aircraft">
      <h2 className="label inbound__title">Inbound</h2>
      <ul className="inbound__list">
        {inbound.map((row) => (
          <li key={row.hex}>
            <button
              className="inbound__row"
              style={{ ["--rarity" as string]: `var(--rarity-${row.rarity})` }}
              onClick={() => onSelect(row.hex)}
            >
              <span className="inbound__type">{row.label}</span>
              <span className="inbound__eta mono">{countdown(row.etaMs - now)}</span>
              <span className="inbound__look label">
                {row.closeKm < 3 ? "overhead" : row.look}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
