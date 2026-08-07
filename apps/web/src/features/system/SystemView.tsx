import { useEffect, useState } from "react";
import { CAPTURE_RADIUS_KM, type FeedStatus } from "@aloft/shared";
import { routeStats, type ChannelStats } from "../../lib/adsbdb";
import { usePlanes, type LinkState } from "../../state/planes";
import { hapticsEnabled, isMuted, primeAudio, setHaptics, setMuted } from "../../lib/feedback";
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

interface Channel {
  name: string;
  role: string;
  status: string;
  color: string;
}

function ago(ms: number): string {
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s ago`;
  return `${Math.round(s / 60)}m ago`;
}

/**
 * What the feeds are actually doing, rather than four fixed labels.
 *
 * The ADS-B rows come from the tower — only it knows which upstream served a
 * frame and how long that call took. The route row is first-hand: the client
 * calls adsbdb itself. Anything genuinely unknown says so instead of being
 * dressed up as healthy.
 */
function channels(
  feed: FeedStatus | null,
  link: LinkState,
  lastFrameAt: number | null,
  routes: ChannelStats
): Channel[] {
  const rows: Channel[] = [];

  for (const name of ["adsb.lol", "airplanes.live"]) {
    const isActive = feed?.active === name;
    const isBenched = feed?.benched.includes(name) === true;
    if (isBenched) {
      rows.push({ name, role: "Live ADS-B", status: "Benched", color: "var(--amber)" });
    } else if (isActive && link === "live") {
      const latency = feed?.lastCallMs != null ? `${feed.lastCallMs} ms` : "live";
      const age = lastFrameAt ? ` · ${ago(Date.now() - lastFrameAt)}` : "";
      rows.push({ name, role: "Live ADS-B", status: `${latency}${age}`, color: "var(--phos)" });
    } else if (link === "offline") {
      rows.push({ name, role: "Live ADS-B", status: "No link", color: "var(--crimson)" });
    } else if (feed) {
      rows.push({ name, role: "Failover feed", status: "Standby", color: "var(--ink-3)" });
    } else {
      // Connected to a tower that doesn't report feed status — say that,
      // rather than claiming a health we have not been told.
      rows.push({ name, role: "Live ADS-B", status: "Not reported", color: "var(--ink-3)" });
    }
  }

  const routeTotal = routes.ok + routes.failed;
  rows.push({
    name: "adsbdb.com",
    role: "Aircraft & routes",
    status:
      routeTotal === 0
        ? "Idle"
        : routes.failed === 0
          ? `${routes.ok} ok`
          : `${routes.failed} of ${routeTotal} failed`,
    color: routes.failed > 0 ? "var(--amber)" : routeTotal > 0 ? "var(--phos)" : "var(--ink-3)",
  });

  rows.push({ name: "OpenStreetMap", role: "Map tiles", status: "Licensed", color: "var(--cyan)" });
  return rows;
}

/** Settings, install guidance, and the attribution the data licences require. */
export function SystemView({ position }: { position: PlayerPosition }) {
  const [muted, setMutedState] = useState(isMuted());
  const [haptics, setHapticsState] = useState(hapticsEnabled());
  const [pings, setPings] = useState<"idle" | "busy" | "on" | "failed" | "blocked">("idle");
  const [models, setModels] = useState<Array<ModelEntry & { key: string }>>([]);
  const feed = usePlanes((s) => s.feed);
  const link = usePlanes((s) => s.link);
  const lastFrameAt = usePlanes((s) => s.lastFrameAt);
  // Re-read the route tally on a timer: it is a plain counter, not reactive
  // state, and this panel is the only thing that ever looks at it.
  const [routes, setRoutes] = useState<ChannelStats>(routeStats);
  useEffect(() => {
    const id = setInterval(() => setRoutes(routeStats()), 2000);
    return () => clearInterval(id);
  }, []);
  const sources = channels(feed, link, lastFrameAt, routes);
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

  const toggleHaptics = () => {
    setHaptics(!haptics);
    setHapticsState(!haptics);
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
        {/* Sound and haptics are separate switches now that transients are
            carried by sound: one mute must not silence every notification. */}
        <div className="sys-ctrl">
          <div className="sys-ctrl__text">
            <strong>Sound</strong>
            <span>Lock ticks, capture, reveal, and alerts</span>
          </div>
          <div className="sys-ctrl__aside">
            <span className={muted ? "sys-ctrl__state" : "sys-ctrl__state sys-ctrl__state--on"}>
              {muted ? "Off" : "On"}
            </span>
            <Switch on={!muted} onToggle={toggleSound} label="Sound" />
          </div>
        </div>
        <div className="sys-ctrl">
          <div className="sys-ctrl__text">
            <strong>Haptics</strong>
            <span>The same cues, felt rather than heard</span>
          </div>
          <div className="sys-ctrl__aside">
            <span className={haptics ? "sys-ctrl__state sys-ctrl__state--on" : "sys-ctrl__state"}>
              {haptics ? "On" : "Off"}
            </span>
            <Switch on={haptics} onToggle={toggleHaptics} label="Haptics" />
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
          <span className="sys-badge">{sources.length} channels</span>
        </div>
        {sources.map((s) => (
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
