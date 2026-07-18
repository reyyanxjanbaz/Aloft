import { useEffect, useState } from "react";
import { CAPTURE_RADIUS_KM } from "@aloft/shared";
import { isMuted, primeAudio, setMuted } from "../../lib/feedback";
import { platformName } from "../../lib/platform";
import { enableSkyPings, pushPermission } from "../../lib/push";
import type { PlayerPosition } from "../../lib/useGeolocation";
import { listAttributions, type ModelEntry } from "../reveal/modelRegistry";
import { IconBell, IconCheck, IconInstall, IconMuted, IconSound } from "../../ui/icons";
import "./system.css";

function isStandalone(): boolean {
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    (navigator as { standalone?: boolean }).standalone === true
  );
}

/** Settings, install guidance, and the attribution the data licences require. */
export function SystemView({ position }: { position: PlayerPosition }) {
  const [muted, setMutedState] = useState(isMuted());
  const [pings, setPings] = useState<"idle" | "busy" | "on" | "failed">(
    pushPermission() === "granted" ? "on" : "idle"
  );
  const [models, setModels] = useState<Array<ModelEntry & { key: string }>>([]);
  const installed = isStandalone();
  const ios = platformName() === "ios" || /iPhone|iPad|iPod/.test(navigator.userAgent);

  useEffect(() => {
    void listAttributions().then(setModels);
  }, []);

  return (
    <div className="screen">
      <header className="screen__head">
        <h1 className="screen__title">System</h1>
      </header>

      <section className="sys">
        <h2 className="label">Settings</h2>
        <div className="sys__row">
          <div className="sys__text">
            <strong>Sound and haptics</strong>
            <span>Lock ticks, capture, and reveal cues</span>
          </div>
          <button
            className={muted ? "btn btn--quiet" : "btn"}
            aria-pressed={!muted}
            onClick={() => {
              primeAudio();
              setMuted(!muted);
              setMutedState(!muted);
            }}
          >
            {muted ? <IconMuted size={16} /> : <IconSound size={16} />}
            {muted ? "Off" : "On"}
          </button>
        </div>

        <div className="sys__row">
          <div className="sys__text">
            <strong>Sky alerts</strong>
            <span>Notify me when a rare aircraft enters {CAPTURE_RADIUS_KM} km</span>
          </div>
          {pings === "on" ? (
            <span className="sys__on">
              <IconCheck size={14} weight="bold" /> On
            </span>
          ) : (
            <button
              className="btn"
              disabled={pings === "busy"}
              onClick={() => {
                setPings("busy");
                enableSkyPings(position.lat, position.lon)
                  .then(() => setPings("on"))
                  .catch(() => setPings("failed"));
              }}
            >
              <IconBell size={16} />
              {pings === "busy" ? "Asking" : "Turn on"}
            </button>
          )}
        </div>
        {pings === "failed" && (
          <p className="note note--warn">
            Notifications are blocked. Allow them in your browser settings, then try again.
          </p>
        )}
      </section>

      {!installed && (
        <section className="sys">
          <h2 className="label">Install</h2>
          <div className="sys__install">
            <IconInstall size={20} />
            <p>
              {ios
                ? "Add Aloft to your home screen from the Share menu. Installed, it runs full screen and can send sky alerts."
                : "Install Aloft from your browser menu for a full-screen scope and sky alerts."}
            </p>
          </div>
        </section>
      )}

      <section className="sys">
        <h2 className="label">Data</h2>
        <p className="sys__copy">
          Live aircraft positions come from <strong>adsb.lol</strong> and <strong>airplanes.live</strong>,
          community ADS-B networks, with aircraft and route details from <strong>adsbdb.com</strong>.
          Map data © OpenStreetMap contributors.
        </p>
        <p className="sys__copy sys__copy--dim">
          These feeds are licensed for non-commercial use. Aloft is a fan project for aviation
          enthusiasts and is not for navigation.
        </p>
      </section>

      <section className="sys">
        <h2 className="label">Models</h2>
        {models.length === 0 ? (
          <p className="sys__copy">
            Aircraft are generated in the app from real family dimensions. Licensed models added to
            the library are credited here.
          </p>
        ) : (
          <ul className="sys__credits">
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
    </div>
  );
}
