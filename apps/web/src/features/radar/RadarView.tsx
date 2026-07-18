import { useState } from "react";
import { CAPTURE_RADIUS_KM, distanceM } from "@aloft/shared";
import type { PlayerPosition } from "../../lib/useGeolocation";
import { usePlanes } from "../../state/planes";
import { IconPin, IconTower } from "../../ui/icons";
import { ContactCard } from "./ContactCard";
import { RadarMap } from "./RadarMap";
import "./radar.css";

export function RadarView({ position }: { position: PlayerPosition }) {
  const link = usePlanes((s) => s.link);
  const planes = usePlanes((s) => s.planes);
  const [recenter, setRecenter] = useState(0);

  const inRange = [...planes.values()].filter(
    (ac) => distanceM(position.lat, position.lon, ac.lat, ac.lon) <= CAPTURE_RADIUS_KM * 1000
  ).length;

  return (
    <div className="scope">
      <RadarMap position={position} recenterSignal={recenter} />

      <div className="scope__hud">
        <div className="scope__legend">
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

      <ContactCard position={position} />
    </div>
  );
}
