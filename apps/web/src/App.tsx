import { useEffect } from "react";
import { CAPTURE_RADIUS_KM } from "@aloft/shared";
import { Shell } from "./components/Shell";
import { HangarView } from "./features/hangar/HangarView";
import { HuntView } from "./features/hunt/HuntView";
import { RadarView } from "./features/radar/RadarView";
import { RevealView } from "./features/reveal/RevealView";
import { SocialView } from "./features/social/SocialView";
import { SystemView } from "./features/system/SystemView";
import { ensurePlayer } from "./lib/player";
import { useGeolocation, type PlayerPosition } from "./lib/useGeolocation";
import { isTab, useApp } from "./state/app";
import { connectSky, disconnectSky } from "./state/planes";
import { IconWarning, IconWorld } from "./ui/icons";

export function App() {
  const { position, error } = useGeolocation();
  const view = useApp((s) => s.view);

  useEffect(() => {
    void ensurePlayer();
  }, []);

  // Open the feed once a position is known; the map re-aims it as it moves.
  useEffect(() => {
    if (!position) return;
    connectSky({ lat: position.lat, lon: position.lon, viewRadiusKm: CAPTURE_RADIUS_KM * 4 });
    return () => disconnectSky();
  }, [position?.lat, position?.lon]);

  if (error) return <Boot error={error} />;
  if (!position) return <Boot />;

  if (view.name === "hunt") return <HuntView hex={view.hex} position={position} />;
  if (view.name === "reveal") {
    return (
      <RevealView
        entry={view.entry}
        isNew={view.isNew}
        firstSpotter={view.firstSpotter === true}
        position={position}
      />
    );
  }

  const tab = isTab(view) ? view.name : "radar";
  return (
    <Shell tab={tab}>
      <TabView tab={tab} position={position} />
    </Shell>
  );
}

function TabView({ tab, position }: { tab: string; position: PlayerPosition }) {
  switch (tab) {
    case "hangar":
      return <HangarView />;
    case "social":
      return <SocialView />;
    case "system":
      return <SystemView position={position} />;
    default:
      return <RadarView position={position} />;
  }
}

/** Pre-flight screen: acquiring position, or explaining why we can't. */
function Boot({ error }: { error?: string }) {
  return (
    <div className="boot">
      <div className="boot__mark">Aloft</div>
      {error ? (
        <>
          <p className="boot__line boot__line--warn">
            <IconWarning size={16} weight="bold" />
            {error}
          </p>
          <p className="boot__help">
            Aloft needs your location to sweep the sky above you. Enable location access, or open a
            simulated position by adding <code>?lat=51.47&amp;lon=-0.45</code> to the address — that
            puts you on final approach at Heathrow.
          </p>
        </>
      ) : (
        <p className="boot__line">
          <IconWorld size={16} weight="bold" />
          Acquiring position
          <span className="boot__dots" aria-hidden="true" />
        </p>
      )}
    </div>
  );
}
