import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { ACHIEVEMENTS, evaluateAchievements } from "@aloft/shared";
import { lookupRoute, type FlightRoute } from "../../lib/adsbdb";
import { sfxAchievement, sfxReveal } from "../../lib/feedback";
import { enableSkyPings, pushPermission } from "../../lib/push";
import type { PlayerPosition } from "../../lib/useGeolocation";
import { useApp } from "../../state/app";
import { AchievementIcon } from "../../ui/AchievementIcon";
import { IconBell, IconCheck, IconMedal, IconStar, IconWarning } from "../../ui/icons";
import { RARITY_LABEL } from "../../ui/rarity";
import { getSeenAchievements, listCatches, setSeenAchievements, type HangarEntry } from "../hangar/db";
import { Stage } from "./Stage";
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
  const [route, setRoute] = useState<FlightRoute | null>(null);
  const [unlocked, setUnlocked] = useState<string[]>([]);
  const [pings, setPings] = useState<"idle" | "busy" | "on" | "failed">(
    pushPermission() === "granted" ? "on" : "idle"
  );

  useEffect(() => {
    if (entry.callsign) void lookupRoute(entry.callsign).then(setRoute);
  }, [entry.callsign]);

  useEffect(() => {
    sfxReveal(entry.rarity);
  }, [entry.id, entry.rarity]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const [catches, seen] = await Promise.all([listCatches(), getSeenAchievements()]);
      const fresh = evaluateAchievements(catches).filter((id) => !seen.has(id));
      if (cancelled || fresh.length === 0) return;
      setUnlocked(fresh);
      setTimeout(sfxAchievement, 900);
      await setSeenAchievements(new Set([...seen, ...fresh]));
    })();
    return () => {
      cancelled = true;
    };
  }, [entry.id]);

  const freshDefs = ACHIEVEMENTS.filter((a) => unlocked.includes(a.id));
  // Offer alerts at the moment of a first catch — peak motivation, once only.
  const offerPings = isNew && pings !== "on" && pushPermission() === "default";

  return (
    <div className="reveal" style={{ ["--rarity" as string]: `var(--rarity-${entry.rarity})` }}>
      <div className="reveal__stage">
        <Stage typeIcao={entry.typeIcao} callsign={entry.callsign} />
        <motion.div
          className="reveal__badge"
          initial={{ opacity: 0, y: -8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.15, duration: 0.4, ease }}
        >
          <span className="reveal__rarity">{RARITY_LABEL[entry.rarity]}</span>
          {!isNew && <span className="reveal__again">Logged again</span>}
        </motion.div>
        <span className="reveal__hint label">Drag to inspect</span>
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
                .catch(() => setPings("failed"));
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
        {pings === "failed" && (
          <p className="reveal__note reveal__note--warn">
            Alerts are blocked in your browser settings.
          </p>
        )}

        <div className="reveal__actions">
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
