import { Suspense, useEffect, useState } from "react";
import { Canvas } from "@react-three/fiber";
import { OrbitControls, Stars } from "@react-three/drei";
import { ACHIEVEMENTS, evaluateAchievements } from "@aloft/shared";
import { lookupRoute, type FlightRoute } from "../../lib/adsbdb";
import { sfxAchievement, sfxReveal } from "../../lib/feedback";
import { enableSkyPings, pushPermission } from "../../lib/push";
import type { PlayerPosition } from "../../lib/useGeolocation";
import { useApp } from "../../state/app";
import { getSeenAchievements, listCatches, setSeenAchievements, type HangarEntry } from "../hangar/db";
import { AircraftModel } from "./AircraftModel";

const RARITY_LABEL: Record<string, string> = {
  common: "COMMON",
  uncommon: "UNCOMMON",
  rare: "RARE",
  epic: "EPIC",
  legendary: "LEGENDARY",
};

export function ModelStage({ entry }: { entry: HangarEntry }) {
  return (
    <Canvas camera={{ position: [0, 2.5, 9], fov: 45 }}>
      <ambientLight intensity={0.7} />
      <directionalLight position={[6, 8, 4]} intensity={1.4} />
      <directionalLight position={[-6, -2, -4]} intensity={0.3} color="#7dd3fc" />
      <Suspense fallback={null}>
        <Stars radius={60} depth={30} count={1200} factor={3} fade speed={0.6} />
        <AircraftModel typeIcao={entry.typeIcao} callsign={entry.callsign} />
      </Suspense>
      <OrbitControls enablePan={false} minDistance={4} maxDistance={16} />
    </Canvas>
  );
}

export function RevealView({
  entry,
  isNew,
  firstSpotter = false,
  position,
}: {
  entry: HangarEntry;
  isNew: boolean;
  firstSpotter?: boolean;
  position: PlayerPosition;
}) {
  const go = useApp((s) => s.go);
  const [route, setRoute] = useState<FlightRoute | null>(null);
  const [unlocked, setUnlocked] = useState<string[]>([]);
  const [pingState, setPingState] = useState<"idle" | "busy" | "on" | "failed">(
    pushPermission() === "granted" ? "on" : "idle"
  );

  useEffect(() => {
    if (entry.callsign) void lookupRoute(entry.callsign).then(setRoute);
  }, [entry.callsign]);

  useEffect(() => {
    sfxReveal(entry.rarity);
  }, [entry.id, entry.rarity]);

  // Celebrate newly earned achievements exactly once.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const [catches, seen] = await Promise.all([listCatches(), getSeenAchievements()]);
      const current = evaluateAchievements(catches);
      const fresh = current.filter((id) => !seen.has(id));
      if (cancelled || fresh.length === 0) return;
      setUnlocked(fresh);
      // Let the reveal chord land before the achievement chime.
      setTimeout(sfxAchievement, 900);
      await setSeenAchievements(new Set([...seen, ...fresh]));
    })();
    return () => {
      cancelled = true;
    };
  }, [entry.id]);

  const freshDefs = ACHIEVEMENTS.filter((a) => unlocked.includes(a.id));
  const showPingOptIn = isNew && pingState !== "on" && pushPermission() === "default";

  return (
    <div className="reveal">
      <div className={`reveal__banner reveal__banner--${entry.rarity}`}>
        {RARITY_LABEL[entry.rarity]}
        {!isNew && <span className="reveal__again"> · logged again</span>}
      </div>
      <h1 className="reveal__type">{entry.typeLabel}</h1>
      <p className="reveal__identity">
        {entry.callsign || "No callsign"} {entry.reg ? `· ${entry.reg}` : ""}
      </p>
      {route && (
        <p className="reveal__route">
          {route.origin} → {route.destination}
        </p>
      )}

      {firstSpotter && (
        <div className="reveal__first">🥇 First Spotter — nobody on Aloft had caught this airframe before</div>
      )}

      <div className="reveal__stage">
        <ModelStage entry={entry} />
      </div>

      {freshDefs.length > 0 && (
        <div className="reveal__achievements">
          {freshDefs.map((a) => (
            <div key={a.id} className="achievement-chip">
              <span className="achievement-chip__icon">{a.icon}</span>
              <span>
                <strong>{a.name}</strong>
                <small>{a.description}</small>
              </span>
            </div>
          ))}
        </div>
      )}

      <dl className="reveal__stats">
        <div><dt>Caught at</dt><dd>{entry.altFt > 0 ? `${Math.round(entry.altFt).toLocaleString()} ft` : "on ground"}</dd></div>
        <div><dt>Speed</dt><dd>{Math.round(entry.gsKt)} kt</dd></div>
        <div><dt>Distance</dt><dd>{entry.distanceKm.toFixed(1)} km</dd></div>
      </dl>

      {showPingOptIn && (
        <button
          className="btn reveal__pings"
          disabled={pingState === "busy"}
          onClick={() => {
            setPingState("busy");
            enableSkyPings(position.lat, position.lon)
              .then(() => setPingState("on"))
              .catch(() => setPingState("failed"));
          }}
        >
          🔔 Ping me when something good flies over
        </button>
      )}
      {pingState === "on" && <p className="reveal__pings-ok">Sky pings enabled for this spot ✓</p>}
      {pingState === "failed" && <p className="reveal__pings-fail">Couldn't enable pings — notifications may be blocked.</p>}

      <div className="reveal__actions">
        <button className="btn btn--primary" onClick={() => go({ name: "hangar" })}>To the Hangar</button>
        <button className="btn" onClick={() => go({ name: "radar" })}>Back to radar</button>
      </div>
    </div>
  );
}
