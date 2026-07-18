import { useEffect, useState } from "react";
import { DEFAULT_RADIUS_KM } from "@aloft/shared";
import { Credits } from "./components/Credits";
import { InstallPrompt } from "./components/InstallPrompt";
import { HangarView } from "./features/hangar/HangarView";
import { HuntView } from "./features/hunt/HuntView";
import { PlaneCard } from "./features/radar/PlaneCard";
import { RadarMap } from "./features/radar/RadarMap";
import { RevealView } from "./features/reveal/RevealView";
import { SocialView } from "./features/social/SocialView";
import { isMuted, primeAudio, setMuted } from "./lib/feedback";
import { ensurePlayer } from "./lib/player";
import { useGeolocation } from "./lib/useGeolocation";
import { useApp } from "./state/app";
import { connectSky, disconnectSky, usePlanes } from "./state/planes";

export function App() {
  const { position, error } = useGeolocation();
  const view = useApp((s) => s.view);
  const go = useApp((s) => s.go);
  const connected = usePlanes((s) => s.connected);
  const planeCount = usePlanes((s) => s.planes.size);
  const [showCredits, setShowCredits] = useState(false);
  const [muted, setMutedState] = useState(isMuted());

  useEffect(() => {
    void ensurePlayer();
  }, []);

  useEffect(() => {
    if (!position) return;
    connectSky(position.lat, position.lon, DEFAULT_RADIUS_KM);
    return () => disconnectSky();
  }, [position?.lat, position?.lon]);

  if (error) {
    return (
      <div className="splash">
        <h1>Aloft</h1>
        <p className="splash__error">{error}</p>
        <p>Aloft needs your location to find the planes above you. You can also try a simulated position, e.g. <code>?lat=51.47&amp;lon=-0.45</code> (Heathrow).</p>
      </div>
    );
  }

  if (!position) {
    return (
      <div className="splash">
        <h1>Aloft</h1>
        <p>Finding you on the map…</p>
      </div>
    );
  }

  if (view.name === "hunt") return <HuntView hex={view.hex} position={position} />;
  if (view.name === "reveal")
    return (
      <RevealView
        entry={view.entry}
        isNew={view.isNew}
        firstSpotter={view.firstSpotter === true}
        position={position}
      />
    );
  if (view.name === "hangar") return <HangarView />;
  if (view.name === "social") return <SocialView />;

  return (
    <div className="app">
      <RadarMap position={position} />
      <header className="hud">
        <span className="hud__logo">✈ Aloft</span>
        <span className={connected ? "hud__status hud__status--on" : "hud__status"}>
          {connected ? `${planeCount} aircraft in range` : "connecting…"}
        </span>
        {position.simulated && <span className="hud__sim">SIM</span>}
        <button
          className="hud__hangar"
          title={muted ? "Unmute" : "Mute"}
          onClick={() => {
            primeAudio();
            setMuted(!muted);
            setMutedState(!muted);
          }}
        >
          {muted ? "🔇" : "🔊"}
        </button>
        <button className="hud__hangar" title="Credits" onClick={() => setShowCredits(true)}>ⓘ</button>
        <button className="hud__hangar" onClick={() => go({ name: "social" })}>👥</button>
        <button className="hud__hangar" onClick={() => go({ name: "hangar" })}>🛫 Hangar</button>
      </header>
      <InstallPrompt />
      <PlaneCard position={position} />
      {showCredits && <Credits onClose={() => setShowCredits(false)} />}
    </div>
  );
}
