import { useEffect, useRef, useState } from "react";
import { Shell } from "./components/Shell";
import { HangarView } from "./features/hangar/HangarView";
import { HuntView } from "./features/hunt/HuntView";
import { RadarView } from "./features/radar/RadarView";
import { RevealView } from "./features/reveal/RevealView";
import { SocialView } from "./features/social/SocialView";
import { SystemView } from "./features/system/SystemView";
import { flushPendingCatches } from "./lib/catchQueue";
import { sfxConfirm } from "./lib/feedback";
import { usePlayer } from "./state/player";
import { useGeolocation, type PlayerPosition } from "./lib/useGeolocation";
import { isTab, useApp } from "./state/app";
import { connectSky, disconnectSky, setGpsPosition, setSkyIdentity, usePlanes } from "./state/planes";
import { checkHangar, checkPosition, checkSensors, type Check } from "./lib/selfTest";

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
    void usePlayer.getState().refresh().then((p) => setSkyIdentity(p?.id, p?.token));
  }, []);

  // Open the feed once a position is first known, then re-aim the *same*
  // socket as GPS refines — tearing the WebSocket down and rebuilding it on
  // every position update (position changes on essentially every GPS tick)
  // used to flash the aircraft list empty and re-handshake constantly.
  useEffect(() => {
    if (!position) return;
    if (!connectedRef.current) {
      connectedRef.current = true;
      connectSky({ lat: position.lat, lon: position.lon });
    } else {
      // Reports where the device is. While the scope is mounted the map owns
      // the streamed view, so this no longer fights a deliberate pan.
      setGpsPosition(position.lat, position.lon);
    }
  }, [position?.lat, position?.lon]);

  // A capture that couldn't reach the tower is held on the device. Retry it
  // at launch and whenever the network returns, so a lock the player earned
  // offline still lands in their hangar.
  useEffect(() => {
    let alive = true;
    const flush = () => {
      void flushPendingCatches().then((outcomes) => {
        // Sounded, not shown. This lands while the player is on some other
        // screen entirely, which is exactly why it is a cue rather than a
        // panel that would have to appear over whatever they were doing.
        if (alive && outcomes.some((o) => o.status === "caught")) sfxConfirm();
      });
    };
    flush();
    window.addEventListener("online", flush);
    return () => {
      alive = false;
      window.removeEventListener("online", flush);
    };
  }, []);

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
        localSaveFailed={view.localSaveFailed === true}
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
      return <HangarView position={position} />;
    case "social":
      return <SocialView />;
    case "system":
      return <SystemView position={position} />;
    default:
      return <RadarView position={position} />;
  }
}

/**
 * Pre-flight: the power-on self test.
 *
 * Each line reports a check the app actually runs, and resolves when that check
 * really resolves. Nothing here is theatre — the screen leaves the moment a fix
 * lands, so the sequence takes exactly as long as acquiring a position takes and
 * never adds a wait of its own. On a warm start the hangar and sensor lines are
 * already filled in before the first paint.
 */
function Boot({ error }: { error?: string }) {
  const [hangar, setHangar] = useState<Check | null>(null);
  const sensors = checkSensors();
  const gnss = checkPosition(null, error ?? null);

  useEffect(() => {
    let alive = true;
    void checkHangar().then((c) => {
      if (alive) setHangar(c);
    });
    return () => {
      alive = false;
    };
  }, []);

  const checks: Check[] = [
    gnss,
    hangar ?? { id: "hangar", label: "Hangar", state: "pending", value: "READING" },
    sensors,
  ];

  return (
    <div className="boot">
      <div className="boot__mark">Aloft</div>

      <ul className="post" aria-live="polite">
        {checks.map((c) => (
          <li key={c.id} className={`post__row post__row--${c.state}`}>
            <span className="post__label">{c.label}</span>
            <span className="post__fill" aria-hidden="true" />
            <span className="post__value">
              {c.value}
              {c.state === "pending" && <span className="boot__dots" aria-hidden="true" />}
            </span>
          </li>
        ))}
      </ul>

      {error && (
        <p className="boot__help">
          Aloft needs your location to sweep the sky above you. Enable location access, or open a
          simulated position by adding <code>?lat=51.47&amp;lon=-0.45</code> to the address — that
          puts you on final approach at Heathrow.
        </p>
      )}
    </div>
  );
}
