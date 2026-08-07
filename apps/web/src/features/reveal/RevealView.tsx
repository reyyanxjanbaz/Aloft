import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { ACHIEVEMENTS, evaluateAchievements } from "@aloft/shared";
import { lookupRoute, type FlightRoute } from "../../lib/adsbdb";
import { sfxAchievement, sfxReveal } from "../../lib/feedback";
import { enableSkyPings, PushError, skyPingsState } from "../../lib/push";
import type { PlayerPosition } from "../../lib/useGeolocation";
import { useApp } from "../../state/app";
import { AchievementIcon } from "../../ui/AchievementIcon";
import { IconBell, IconCheck, IconMedal, IconStar, IconWarning } from "../../ui/icons";
import { RARITY_LABEL } from "../../ui/rarity";
import { getSeenAchievements, listCatches, setSeenAchievements, type HangarEntry } from "../hangar/db";
import { CatchCard } from "../hangar/CatchCard";
import { useCollectionTilt } from "../hangar/useCollectionTilt";
import { ShareCardButton } from "../share/ShareCardButton";
import "./reveal.css";

const ease = [0.16, 1, 0.3, 1] as const;

export function RevealView({
  entry,
  isNew,
  firstSpotter = false,
  localSaveFailed = false,
  position,
}: {
  entry: HangarEntry;
  isNew: boolean;
  firstSpotter?: boolean;
  /** Tower has it; this device's copy failed to write. */
  localSaveFailed?: boolean;
  position: PlayerPosition;
}) {
  const go = useApp((s) => s.go);
  // One light source for the card, exactly as in the hangar — a foil that
  // doesn't move under the phone is just a picture of a foil.
  const tiltRef = useCollectionTilt<HTMLDivElement>();
  const [route, setRoute] = useState<FlightRoute | null>(null);
  const [unlocked, setUnlocked] = useState<string[]>([]);
  // From the real subscription, not from Notification.permission — permission
  // granted once at another location does not mean alerts are armed here.
  const [pings, setPings] = useState<"idle" | "busy" | "on" | "failed" | "blocked">("idle");

  useEffect(() => {
    let alive = true;
    void skyPingsState().then((state) => {
      if (alive) setPings(state === "on" ? "on" : state === "blocked" ? "blocked" : "idle");
    });
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    if (entry.callsign) void lookupRoute(entry.callsign).then(setRoute);
  }, [entry.callsign]);

  useEffect(() => {
    sfxReveal(entry.rarity);
  }, [entry.id, entry.rarity]);

  useEffect(() => {
    let cancelled = false;
    let chime: ReturnType<typeof setTimeout> | undefined;
    void (async () => {
      try {
        const [catches, seen] = await Promise.all([listCatches(), getSeenAchievements()]);
        const fresh = evaluateAchievements(catches).filter((id) => !seen.has(id));
        if (cancelled || fresh.length === 0) return;
        setUnlocked(fresh);
        chime = setTimeout(sfxAchievement, 900);
        // If this write fails the same badges re-award on the next reveal —
        // cosmetic, and far better than an unhandled rejection here.
        await setSeenAchievements(new Set([...seen, ...fresh]));
      } catch (err) {
        console.warn("[reveal] achievement bookkeeping failed:", err);
      }
    })();
    return () => {
      cancelled = true;
      // Otherwise the chime still fires after the player has already tapped
      // through to the hangar or back to the scope.
      if (chime) clearTimeout(chime);
    };
  }, [entry.id]);

  const freshDefs = ACHIEVEMENTS.filter((a) => unlocked.includes(a.id));
  // Offer alerts at the moment of a first catch — peak motivation. Offered
  // whenever there is genuinely no subscription, including the case where
  // permission was granted long ago somewhere else and has since lapsed.
  // "busy" keeps the button mounted (disabled) while the request is in
  // flight rather than having it vanish mid-tap.
  const offerPings = isNew && (pings === "idle" || pings === "busy");

  return (
    <div className="reveal" style={{ ["--rarity" as string]: `var(--rarity-${entry.rarity})` }}>
      {/*
        The trophy is the card, not a model. Three.js and the whole
        react-three stack are off the reveal entirely — the moment of reward is
        "you got the card", and it is the same object that will sit in the
        hangar afterwards rather than a separate rendering of the same aircraft.
        The 3D viewer still exists, lazily, behind a card in the hangar.
      */}
      <div className="reveal__stage" ref={tiltRef}>
        <motion.div
          className="reveal__card"
          initial={{ rotateY: 180, opacity: 0 }}
          animate={{ rotateY: 0, opacity: 1 }}
          transition={{ duration: 0.62, ease, delay: 0.05 }}
        >
          <CatchCard entry={entry} />
        </motion.div>
        <motion.div
          className="reveal__badge"
          initial={{ opacity: 0, y: -8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.15, duration: 0.4, ease }}
        >
          <span className="reveal__rarity">{RARITY_LABEL[entry.rarity]}</span>
          {!isNew && <span className="reveal__again">Logged again</span>}
        </motion.div>
      </div>

      <motion.div
        className="reveal__body"
        initial={{ opacity: 0, y: 14 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.1, duration: 0.45, ease }}
      >
        <header className="reveal__head">
          <p className="label">Captured</p>
          <h1 className="reveal__type">{entry.typeLabel}</h1>
          <p className="reveal__ident mono">
            {entry.callsign || "No callsign"}
            {entry.reg && <span className="reveal__reg"> · {entry.reg}</span>}
          </p>
        </header>

        {firstSpotter && (
          <motion.p
            className="reveal__first"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.5, duration: 0.4 }}
          >
            <IconStar size={14} weight="fill" />
            First spotter — nobody on Aloft had caught this airframe before
          </motion.p>
        )}

        {localSaveFailed && (
          <p className="reveal__note">
            <IconWarning size={13} weight="bold" />
            Recorded with the tower, but this device couldn&apos;t save its own copy — the catch
            won&apos;t appear in your hangar.
          </p>
        )}

        {route && (
          <div className="reveal__route">
            <span>{route.origin}</span>
            <span className="reveal__route-rule" aria-hidden="true" />
            <span>{route.destination}</span>
          </div>
        )}

        <dl className="reveal__stats">
          <Stat label="Altitude" value={entry.altFt > 0 ? Math.round(entry.altFt).toLocaleString() : "Ground"} unit={entry.altFt > 0 ? "ft" : ""} />
          <Stat label="Speed" value={Math.round(entry.gsKt).toString()} unit="kt" />
          <Stat label="Range" value={entry.distanceKm.toFixed(1)} unit="km" />
        </dl>

        {freshDefs.length > 0 && (
          <ul className="reveal__unlocks">
            {freshDefs.map((a, i) => (
              <motion.li
                key={a.id}
                className="unlock"
                initial={{ opacity: 0, x: -10 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: 0.7 + i * 0.09, duration: 0.35, ease }}
              >
                <span className="unlock__icon">
                  <AchievementIcon name={a.icon} size={18} weight="bold" />
                </span>
                <span className="unlock__text">
                  <strong>{a.name}</strong>
                  <span>{a.description}</span>
                </span>
                <IconMedal size={14} className="unlock__flag" />
              </motion.li>
            ))}
          </ul>
        )}

        {offerPings && (
          <button
            className="btn btn--block"
            disabled={pings === "busy"}
            onClick={() => {
              setPings("busy");
              enableSkyPings(position.lat, position.lon)
                .then(() => setPings("on"))
                .catch((err: unknown) =>
                  setPings(err instanceof PushError && err.kind === "denied" ? "blocked" : "failed")
                );
            }}
          >
            <IconBell size={16} />
            Alert me when something rare flies over
          </button>
        )}
        {pings === "on" && (
          <p className="reveal__note reveal__note--ok">
            <IconCheck size={14} weight="bold" /> Sky alerts are on for this spot
          </p>
        )}
        {pings === "blocked" && (
          <p className="reveal__note reveal__note--warn">
            Alerts are blocked in your browser settings.
          </p>
        )}
        {pings === "failed" && (
          <p className="reveal__note reveal__note--warn">
            The tower is unreachable — alerts could not be armed.
          </p>
        )}

        <div className="reveal__actions">
          {/* No snapshot to offer any more — the share card falls back to the
              family silhouette, which is the same artwork the catch card above
              is showing, so the two finally match. */}
          <ShareCardButton entry={entry} firstSpotter={firstSpotter} />
          <button className="btn btn--primary" onClick={() => go({ name: "hangar" })}>
            Add to hangar
          </button>
          <button className="btn btn--quiet" onClick={() => go({ name: "radar" })}>
            Back to scope
          </button>
        </div>
      </motion.div>
    </div>
  );
}

function Stat({ label, value, unit }: { label: string; value: string; unit: string }) {
  return (
    <div className="readout">
      <dt className="label">{label}</dt>
      <dd className="readout__value">
        {value} {unit && <span className="unit">{unit}</span>}
      </dd>
    </div>
  );
}
