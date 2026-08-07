import { useState } from "react";
import { CAPTURE_RADIUS_KM, distanceM } from "@aloft/shared";
import { projectedPosition } from "../../lib/project";
import type { PlayerPosition } from "../../lib/useGeolocation";
import { serverNow, usePlanes } from "../../state/planes";
import { IconPin, IconTower } from "../../ui/icons";
import { ContactCard } from "./ContactCard";
import { InboundBoard } from "./InboundBoard";
import { RadarMap } from "./RadarMap";
import "./radar.css";

const LINK_COPY = {
  live: "Live",
  connecting: "Syncing",
  offline: "Link lost",
} as const;

export function RadarView({ position }: { position: PlayerPosition }) {
  const link = usePlanes((s) => s.link);
  const planes = usePlanes((s) => s.planes);
  const selectedHex = usePlanes((s) => s.selectedHex);
  const [recenter, setRecenter] = useState(0);

  // Projected, exactly as the map and the contact card measure it — a raw
  // position here made the HUD count disagree with the green markers.
  const now = serverNow();
  const inRange = [...planes.values()].filter((ac) => {
    const p = projectedPosition(ac, now);
    return distanceM(position.lat, position.lon, p.lat, p.lon) <= CAPTURE_RADIUS_KM * 1000;
  }).length;

  return (
    <div className="scope">
      <RadarMap position={position} recenterSignal={recenter} />

      {/* The status strip used to carry link state on every screen. It now
          lives here, beside the contacts it actually describes. */}
      <div className="scope__hud">
        <div className="scope__legend">
          <span className={`scope__led scope__led--${link}`} aria-hidden="true" />
          <span className={`label scope__link scope__link--${link}`}>{LINK_COPY[link]}</span>
          <span className="scope__legend-rule" aria-hidden="true" />
          <span className="label">Ring</span>
          <span className="data data--sm">{CAPTURE_RADIUS_KM} km</span>
          <span className="scope__legend-rule" aria-hidden="true" />
          <span className="label">In range</span>
          <span className="data data--sm scope__legend-count">{inRange}</span>
        </div>
        {position.simulated && <span className="scope__sim label">Simulated</span>}
      </div>

      <button
        className="scope__recenter"
        onClick={() => setRecenter((n) => n + 1)}
        aria-label="Center the scope on your position"
      >
        <IconPin size={18} weight="bold" />
      </button>

      {link === "offline" && (
        <div className="scope__offline panel">
          <IconTower size={18} weight="bold" />
          <div>
            <strong>No link to the tower</strong>
            <p>
              The sky service isn&apos;t reachable. Start it with <code>npm run dev</code> — the
              scope reconnects on its own.
            </p>
          </div>
        </div>
      )}

      {link === "live" && planes.size === 0 && (
        <div className="scope__empty panel">
          <p>No contacts in view. Pinch out to widen the scope.</p>
        </div>
      )}

      {/* Hidden while a contact card is open — that card owns the bottom of
          the screen, and two stacked panels would bury the map. */}
      {!selectedHex && (
        <InboundBoard position={position} onSelect={(hex) => usePlanes.getState().select(hex)} />
      )}

      <ContactCard position={position} />
    </div>
  );
}
