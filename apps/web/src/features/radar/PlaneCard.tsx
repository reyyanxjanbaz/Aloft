import { useEffect, useState } from "react";
import { distanceM, elevationDeg, FT_TO_M } from "@aloft/shared";
import { lookupRoute, type FlightRoute } from "../../lib/adsbdb";
import type { PlayerPosition } from "../../lib/useGeolocation";
import { useApp } from "../../state/app";
import { usePlanes } from "../../state/planes";

export function PlaneCard({ position }: { position: PlayerPosition }) {
  const selectedHex = usePlanes((s) => s.selectedHex);
  const plane = usePlanes((s) => (s.selectedHex ? s.planes.get(s.selectedHex) : undefined));
  const select = usePlanes((s) => s.select);
  const [route, setRoute] = useState<FlightRoute | null | "loading">(null);

  useEffect(() => {
    if (!plane?.callsign) {
      setRoute(null);
      return;
    }
    let cancelled = false;
    setRoute("loading");
    lookupRoute(plane.callsign).then((r) => {
      if (!cancelled) setRoute(r);
    });
    return () => {
      cancelled = true;
    };
  }, [plane?.callsign]);

  if (!selectedHex) return null;
  if (!plane) {
    // The plane left the radius while its card was open.
    return (
      <div className="plane-card">
        <p className="plane-card__gone">It slipped away beyond your radar…</p>
        <button className="plane-card__close" onClick={() => select(null)}>✕</button>
      </div>
    );
  }

  const groundM = distanceM(position.lat, position.lon, plane.lat, plane.lon);
  const elev = elevationDeg(groundM, 0, plane.altFt * FT_TO_M);

  return (
    <div className="plane-card">
      <button className="plane-card__close" onClick={() => select(null)}>✕</button>
      <div className="plane-card__title">
        <span className="plane-card__callsign">{plane.callsign || plane.reg || plane.hex.toUpperCase()}</span>
        {plane.typeIcao && <span className="plane-card__type">{plane.typeIcao}</span>}
      </div>
      <div className="plane-card__route">
        {route === "loading" && <span>Looking up route…</span>}
        {route && route !== "loading" && (
          <span>
            {route.origin} → {route.destination}
          </span>
        )}
        {route === null && plane.callsign && <span>Route unknown</span>}
      </div>
      <dl className="plane-card__stats">
        <div><dt>Registration</dt><dd>{plane.reg ?? "—"}</dd></div>
        <div><dt>Altitude</dt><dd>{plane.altFt > 0 ? `${Math.round(plane.altFt).toLocaleString()} ft` : "on ground"}</dd></div>
        <div><dt>Speed</dt><dd>{Math.round(plane.gsKt)} kt</dd></div>
        <div><dt>Distance</dt><dd>{(groundM / 1000).toFixed(1)} km</dd></div>
        <div><dt>Look up</dt><dd>{elev > 0 ? `${elev.toFixed(0)}° above horizon` : "below horizon"}</dd></div>
      </dl>
      <button
        className="plane-card__hunt"
        onClick={() => {
          select(null);
          useApp.getState().go({ name: "hunt", hex: plane.hex });
        }}
      >
        🎯 Hunt this plane
      </button>
    </div>
  );
}
