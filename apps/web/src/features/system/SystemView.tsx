import { useEffect, useState } from "react";
import { CAPTURE_RADIUS_KM } from "@aloft/shared";
import { isMuted, primeAudio, setMuted } from "../../lib/feedback";
import { platformName } from "../../lib/platform";
import { disableSkyPings, enableSkyPings, PushError, skyPingsState } from "../../lib/push";
import type { PlayerPosition } from "../../lib/useGeolocation";
import { listAttributions, type ModelEntry } from "../reveal/modelRegistry";
import { IconInstall } from "../../ui/icons";
import "./system.css";

function isStandalone(): boolean {
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    (navigator as { standalone?: boolean }).standalone === true
  );
}

/** A mechanical on/off switch — the one control idiom for every toggle here. */
function Switch({
  on,
  disabled,
  onToggle,
  label,
}: {
  on: boolean;
  disabled?: boolean;
  onToggle: () => void;
  label: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      disabled={disabled}
      className={on ? "sw sw--on" : "sw"}
      onClick={onToggle}
    >
      <span className="sw__track">
        <span className="sw__thumb" />
      </span>
    </button>
  );
}

type Source = { name: string; role: string; status: string; color: string };
const SOURCES: Source[] = [
  { name: "adsb.lol", role: "Live ADS-B", status: "Community", color: "var(--phos)" },
  { name: "airplanes.live", role: "Failover feed", status: "Standby", color: "var(--ink-3)" },
  { name: "adsbdb.com", role: "Aircraft & routes", status: "Community", color: "var(--phos)" },
  { name: "OpenStreetMap", role: "Map tiles", status: "Licensed", color: "var(--cyan)" },
];

/** Settings, install guidance, and the attribution the data licences require. */
export function SystemView({ position }: { position: PlayerPosition }) {
  const [muted, setMutedState] = useState(isMuted());
  const [pings, setPings] = useState<"idle" | "busy" | "on" | "failed" | "blocked">("idle");
  const [models, setModels] = useState<Array<ModelEntry & { key: string }>>([]);
  const installed = isStandalone();
  const ios = platformName() === "ios" || /iPhone|iPad|iPod/.test(navigator.userAgent);

  useEffect(() => {
    void listAttributions().then(setModels);
  }, []);

  // Read the real subscription rather than assuming permission means armed.
  useEffect(() => {
    let alive = true;
    void skyPingsState().then((state) => {
      if (!alive) return;
      setPings(state === "on" ? "on" : state === "blocked" ? "blocked" : "idle");
    });
    return () => {
      alive = false;
    };
  }, []);

  const toggleSound = () => {
    primeAudio();
    setMuted(!muted);
    setMutedState(!muted);
  };

  const togglePings = () => {
    if (pings === "on") {
      setPings("busy");
      void disableSkyPings()
        .then(() => setPings("idle"))
        .catch(() => setPings("idle"));
      return;
    }
    setPings("busy");
    enableSkyPings(position.lat, position.lon)
      .then(() => setPings("on"))
      .catch((err: unknown) =>
        setPings(err instanceof PushError && err.kind === "denied" ? "blocked" : "failed")
      );
  };

  const pingState =
    pings === "on" ? "On" : pings === "busy" ? "…" : pings === "blocked" ? "Blocked" : "Off";

  return (
    <div className="screen">
      <header className="screen__head">
        <h1 className="screen__title">System</h1>
        <span className="sys-badge">
          {installed ? "Installed" : "Browser"} · <b>{platformName()}</b>
        </span>
      </header>

      {/* Controls */}
      <section className="sys-panel">
        <div className="sys-panel__head">
          <h2 className="label">Controls</h2>
        </div>
        <div className="sys-ctrl">
          <div className="sys-ctrl__text">
            <strong>Sound and haptics</strong>
            <span>Lock ticks, capture, and reveal cues</span>
          </div>
          <div className="sys-ctrl__aside">
            <span className={muted ? "sys-ctrl__state" : "sys-ctrl__state sys-ctrl__state--on"}>
              {muted ? "Off" : "On"}
            </span>
            <Switch on={!muted} onToggle={toggleSound} label="Sound and haptics" />
          </div>
        </div>
        <div className="sys-ctrl">
          <div className="sys-ctrl__text">
            <strong>Sky alerts</strong>
            <span>Notify me when a rare aircraft enters {CAPTURE_RADIUS_KM} km</span>
          </div>
          <div className="sys-ctrl__aside">
            <span className={pings === "on" ? "sys-ctrl__state sys-ctrl__state--on" : "sys-ctrl__state"}>
              {pingState}
            </span>
            <Switch
              on={pings === "on"}
              disabled={pings === "busy" || pings === "blocked"}
              onToggle={togglePings}
              label="Sky alerts"
            />
          </div>
        </div>
        {/* A tower outage and a browser block are different problems and need
            different instructions — both used to read as "blocked". */}
        {pings === "blocked" && (
          <p className="sys-note">
            Notifications are blocked. Allow them in your browser settings, then switch this back on.
          </p>
        )}
        {pings === "failed" && (
          <p className="sys-note">The tower is unreachable — alerts could not be armed. Try again shortly.</p>
        )}
      </section>

      {/* Signal sources */}
      <section className="sys-panel">
        <div className="sys-panel__head">
          <h2 className="label">Signal</h2>
          <span className="sys-badge">4 sources</span>
        </div>
        {SOURCES.map((s) => (
          <div className="sys-src" key={s.name} style={{ ["--color" as string]: s.color }}>
            <span className="sys-src__dot" />
            <span className="sys-src__id">
              <span className="sys-src__name">{s.name}</span>
              <span className="sys-src__role">{s.role}</span>
            </span>
            <span className="sys-src__status">{s.status}</span>
          </div>
        ))}
        <p className="sys-body sys-copy sys-copy--dim">
          Feeds are licensed for non-commercial use. Aloft is a fan project and is not for navigation.
        </p>
      </section>

      {!installed && (
        <section className="sys-panel">
          <div className="sys-panel__head">
            <h2 className="label">Install</h2>
          </div>
          <div className="sys-install">
            <IconInstall size={20} />
            <p>
              {ios
                ? "Add Aloft to your home screen from the Share menu. Installed, it runs full screen and can send sky alerts."
                : "Install Aloft from your browser menu for a full-screen scope and sky alerts."}
            </p>
          </div>
        </section>
      )}

      {/* Models */}
      <section className="sys-panel">
        <div className="sys-panel__head">
          <h2 className="label">Models</h2>
          {models.length > 0 && <span className="sys-badge">{models.length} credited</span>}
        </div>
        {models.length === 0 ? (
          <p className="sys-body sys-copy">
            Aircraft are generated in the app from real airframe dimensions — no downloads. Any licensed
            model added to the library is credited here.
          </p>
        ) : (
          <ul className="sys-credits">
            {models.map((m) => (
              <li key={m.key}>
                <strong className="mono">{m.key}</strong>
                <span>
                  {m.author ?? "Unknown"}
                  {m.license ? ` · ${m.license}` : ""}
                </span>
                {m.sourceUrl && (
                  <a href={m.sourceUrl} target="_blank" rel="noreferrer">
                    Source
                  </a>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      <p className="sys-foot">
        Aloft · a fan project for aviation enthusiasts
        <br />
        Not for navigation
      </p>
    </div>
  );
}
