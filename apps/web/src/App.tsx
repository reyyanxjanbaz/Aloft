import { useEffect, useRef } from "react";
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
import { connectSky, disconnectSky, setSkyIdentity, updateView, usePlanes } from "./state/planes";
import { IconWarning, IconWorld } from "./ui/icons";

/** Jumps to the scope and opens a contact — from a notification tap. */
function focusContact(hex: string): void {
  usePlanes.getState().select(hex);
  useApp.getState().go({ name: "radar" });
}

export function App() {
  const { position, error } = useGeolocation();
  const view = useApp((s) => s.view);
  const connectedRef = useRef(false);

  useEffect(() => {
    void ensurePlayer().then((p) => setSkyIdentity(p?.id, p?.token));
  }, []);

  // Open the feed once a position is first known, then re-aim the *same*
  // socket as GPS refines — tearing the WebSocket down and rebuilding it on
  // every position update (position changes on essentially every GPS tick)
  // used to flash the aircraft list empty and re-handshake constantly.
  useEffect(() => {
    if (!position) return;
    if (!connectedRef.current) {
      connectedRef.current = true;
      connectSky({ lat: position.lat, lon: position.lon, viewRadiusKm: CAPTURE_RADIUS_KM * 4 });
    } else {
      updateView({ lat: position.lat, lon: position.lon, viewRadiusKm: CAPTURE_RADIUS_KM * 4 });
    }
  }, [position?.lat, position?.lon]);

  useEffect(() => {
    return () => {
      connectedRef.current = false;
      disconnectSky();
    };
  }, []);

  // Tapping a sky-alert notification carries the aircraft it was about, so
  // the player lands on that contact instead of wherever the app happened to
  // be — via a fresh window's URL, or a postMessage to an already-open one.
  useEffect(() => {
    const hex = new URLSearchParams(window.location.search).get("focus");
    if (hex) {
      focusContact(hex);
      const url = new URL(window.location.href);
      url.searchParams.delete("focus");
      window.history.replaceState(null, "", url.pathname + url.search);
    }
  }, []);

  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      if (event.data?.type === "focus-contact" && typeof event.data.hex === "string") {
        focusContact(event.data.hex);
      }
    };
    navigator.serviceWorker?.addEventListener("message", onMessage);
    return () => navigator.serviceWorker?.removeEventListener("message", onMessage);
  }, []);

  // A transient GPS error (elevator, tunnel, a single watchPosition timeout)
  // must not throw away an already-acquired, still-usable position — that
  // used to unmount the in-progress Hunt capture screen out from under the
  // player. Only show the error screen when we've never gotten a fix at all.
  if (!position) return error ? <Boot error={error} /> : <Boot />;

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
