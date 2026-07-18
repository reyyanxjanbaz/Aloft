import { AnimatePresence, motion } from "framer-motion";
import { useEffect, useState } from "react";
import {
  CAPTURE_RADIUS_KM,
  distanceM,
  elevationDeg,
  FT_TO_M,
  bearingDeg,
  rarityFor,
  typeName,
  type AircraftState,
} from "@aloft/shared";
import { lookupRoute, type FlightRoute } from "../../lib/adsbdb";
import type { PlayerPosition } from "../../lib/useGeolocation";
import { useApp } from "../../state/app";
import { usePlanes } from "../../state/planes";
import { IconClose, IconHunt } from "../../ui/icons";
import { RARITY_LABEL } from "../../ui/rarity";

const COMPASS = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];

function compass(bearing: number): string {
  return COMPASS[Math.round(bearing / 45) % 8] ?? "—";
}

/** The MFD contact readout: everything known about the selected aircraft. */
export function ContactCard({ position }: { position: PlayerPosition }) {
  const selectedHex = usePlanes((s) => s.selectedHex);
  const plane = usePlanes((s) => (s.selectedHex ? s.planes.get(s.selectedHex) : undefined));
  const select = usePlanes((s) => s.select);
  const go = useApp((s) => s.go);
  const [route, setRoute] = useState<FlightRoute | null | "loading">(null);

  useEffect(() => {
    if (!plane?.callsign) {
      setRoute(null);
      return;
    }
    let cancelled = false;
    setRoute("loading");
    void lookupRoute(plane.callsign).then((r) => {
      if (!cancelled) setRoute(r);
    });
    return () => {
      cancelled = true;
    };
  }, [plane?.callsign]);

  return (
    <AnimatePresence>
      {selectedHex && (
        <motion.section
          key={selectedHex}
          className="contact"
          initial={{ y: 24, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: 24, opacity: 0 }}
          transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
          aria-label="Selected contact"
        >
          {!plane ? (
            <div className="contact__lost">
              <p>Contact lost — it left the scope.</p>
              <button className="btn btn--quiet" onClick={() => select(null)}>
                Dismiss
              </button>
            </div>
          ) : (
            <ContactBody plane={plane} position={position} route={route} onClose={() => select(null)} onHunt={() => {
              select(null);
              go({ name: "hunt", hex: plane.hex });
            }} />
          )}
        </motion.section>
      )}
    </AnimatePresence>
  );
}

function ContactBody({
  plane,
  position,
  route,
  onClose,
  onHunt,
}: {
  plane: AircraftState;
  position: PlayerPosition;
  route: FlightRoute | null | "loading";
  onClose: () => void;
  onHunt: () => void;
}) {
  const groundM = distanceM(position.lat, position.lon, plane.lat, plane.lon);
  const km = groundM / 1000;
  const elev = elevationDeg(groundM, 0, plane.altFt * FT_TO_M);
  const bearing = bearingDeg(position.lat, position.lon, plane.lat, plane.lon);
  const rarity = rarityFor(plane.typeIcao);
  const inRange = km <= CAPTURE_RADIUS_KM;

  return (
    <>
      <header className="contact__head">
        <div className="contact__ident">
          <h2 className="contact__callsign">
            {plane.callsign || plane.reg || plane.hex.toUpperCase()}
          </h2>
          <span className={`tag tag--${rarity}`}>{RARITY_LABEL[rarity]}</span>
        </div>
        <button className="icon-btn" onClick={onClose} aria-label="Close contact">
          <IconClose size={18} />
        </button>
      </header>

      <p className="contact__type">{typeName(plane.typeIcao)}</p>

      <div className="contact__route">
        {route === "loading" && <span className="contact__route-pending">Requesting flight plan</span>}
        {route && route !== "loading" && (
          <span className="contact__route-legs">
            <span>{route.origin}</span>
            <span className="contact__route-rule" aria-hidden="true" />
            <span>{route.destination}</span>
          </span>
        )}
        {route === null && <span className="contact__route-pending">No flight plan filed</span>}
      </div>

      <dl className="contact__grid">
        <Readout label="Altitude" value={plane.altFt > 0 ? Math.round(plane.altFt).toLocaleString() : "Ground"} unit={plane.altFt > 0 ? "ft" : ""} />
        <Readout label="Speed" value={Math.round(plane.gsKt).toString()} unit="kt" />
        <Readout label="Range" value={km.toFixed(1)} unit="km" />
        <Readout label="Bearing" value={`${Math.round(bearing).toString().padStart(3, "0")}°`} unit={compass(bearing)} />
        <Readout
          label="Elevation"
          value={elev === 0 ? "Level" : `${Math.round(Math.abs(elev))}°`}
          unit={elev === 0 ? "" : elev > 0 ? "up" : "below"}
        />
        <Readout label="Tail" value={plane.reg ?? "—"} unit="" />
      </dl>

      <button className="btn btn--primary btn--block" onClick={onHunt} disabled={!inRange}>
        <IconHunt size={18} weight="bold" />
        {inRange ? "Hunt this contact" : `Out of range — ${km.toFixed(0)} km`}
      </button>
      {!inRange && (
        <p className="contact__hint">
          Move within {CAPTURE_RADIUS_KM} km to capture. Contacts inside the ring are lit green.
        </p>
      )}
    </>
  );
}

function Readout({ label, value, unit }: { label: string; value: string; unit: string }) {
  return (
    <div className="readout">
      <dt className="label">{label}</dt>
      <dd className="readout__value">
        {value} {unit && <span className="unit">{unit}</span>}
      </dd>
    </div>
  );
}
