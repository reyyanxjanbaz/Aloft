import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { motion } from "framer-motion";
import { ACHIEVEMENTS, evaluateAchievements, RARITY_ORDER, streakDays } from "@aloft/shared";
import { AchievementIcon } from "../../ui/AchievementIcon";
import { IconClose, IconStreak } from "../../ui/icons";
import { RARITY_LABEL } from "../../ui/rarity";
import { Stage } from "../reveal/Stage";
import { ShareCardButton } from "../share/ShareCardButton";
import type { PlayerPosition } from "../../lib/useGeolocation";
import { CatchCard } from "./CatchCard";
import { listCatches, type HangarEntry } from "./db";
import { FleetStatus } from "./FleetStatus";
import { LiveStatus } from "./LiveStatus";
import { useDialog } from "./useDialog";
import "./hangar.css";

type Filter = "all" | "rare";

export function HangarView({ position }: { position: PlayerPosition }) {
  const [entries, setEntries] = useState<HangarEntry[] | null>(null);
  const [selected, setSelected] = useState<HangarEntry | null>(null);
  const [filter, setFilter] = useState<Filter>("all");
  const [unreadable, setUnreadable] = useState(false);
  const snapshotRef = useRef<(() => string | null) | null>(null);
  const closeViewer = useCallback(() => setSelected(null), []);

  useEffect(() => {
    // Without this catch, a storage failure (private mode, a blocked upgrade,
    // a corrupt database) left entries null forever and the hangar rendered
    // "Nothing logged yet" — telling a player with a full collection that
    // they had caught nothing.
    void listCatches()
      .then(setEntries)
      .catch((err) => {
        console.error("[hangar] could not read the local hangar:", err);
        setUnreadable(true);
      });
  }, []);

  const all = entries ?? [];
  // Recomputed only when the collection changes: evaluateAchievements and
  // streakDays walk every catch, and this used to run on every render —
  // including each filter toggle and every viewer open.
  const { points, streak, earned } = useMemo(
    () => ({
      points: all.reduce((sum, e) => sum + (RARITY_ORDER.indexOf(e.rarity) + 1) ** 2, 0),
      streak: streakDays(all, Date.now()),
      earned: new Set(evaluateAchievements(all)),
    }),
    [entries]
  );
  const shown = useMemo(
    () =>
      filter === "rare"
        ? all.filter((e) => RARITY_ORDER.indexOf(e.rarity) >= RARITY_ORDER.indexOf("rare"))
        : all,
    [entries, filter]
  );

  return (
    <div className="screen hangar">
      <header className="screen__head">
        <h1 className="screen__title">Hangar</h1>
        {streak > 1 && (
          <span className="hangar__streak">
            <IconStreak size={14} weight="fill" />
            <span className="mono">{streak}</span>
            <span className="unit">day streak</span>
          </span>
        )}
      </header>

      <dl className="hangar__totals">
        <Total label="Airframes" value={all.length} />
        <Total label="Rarity points" value={points} />
        <Total label="Badges" value={`${earned.size}/${ACHIEVEMENTS.length}`} />
      </dl>

      {all.length > 0 && <FleetStatus hexes={[...new Set(all.map((e) => e.hex.toLowerCase()))]} />}

      {unreadable ? (
        <p className="empty">
          This device&apos;s hangar store could not be opened.
          <br />
          Your catches are safe — reload to try again.
        </p>
      ) : entries === null ? (
        <p className="empty">Opening the hangar…</p>
      ) : all.length === 0 ? (
        <p className="empty">
          Nothing logged yet.
          <br />
          Find a contact inside the capture ring and hunt it down.
        </p>
      ) : (
        <>
          <section className="hangar__section">
            <h2 className="label">Badges</h2>
            <ul className="hangar__badges">
              {ACHIEVEMENTS.map((a) => {
                const has = earned.has(a.id);
                return (
                  <li
                    key={a.id}
                    className={has ? "badge badge--earned" : "badge"}
                    title={`${a.name} — ${a.description}`}
                  >
                    <AchievementIcon name={a.icon} size={16} weight={has ? "fill" : "regular"} />
                    <span>{a.name}</span>
                  </li>
                );
              })}
            </ul>
          </section>

          <section className="hangar__section">
            <div className="hangar__filters">
              <h2 className="label">Collection</h2>
              <div className="segmented">
                <button
                  className={filter === "all" ? "segmented__opt segmented__opt--on" : "segmented__opt"}
                  onClick={() => setFilter("all")}
                >
                  All
                </button>
                <button
                  className={filter === "rare" ? "segmented__opt segmented__opt--on" : "segmented__opt"}
                  onClick={() => setFilter("rare")}
                >
                  Rare+
                </button>
              </div>
            </div>

            {shown.length === 0 ? (
              <p className="empty">Nothing rare yet. Keep watching the ring.</p>
            ) : (
              <ul className="hangar__grid">
                {shown.map((e, i) => (
                  <motion.li
                    key={e.id}
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: Math.min(i * 0.03, 0.4), duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
                  >
                    <CatchCard entry={e} onOpen={() => setSelected(e)} />
                  </motion.li>
                ))}
              </ul>
            )}
          </section>
        </>
      )}

      {selected && (
        <Viewer entry={selected} position={position} snapshotRef={snapshotRef} onClose={closeViewer} />
      )}
    </div>
  );
}

/**
 * The full-screen model viewer, as a real modal dialog — focus moves in on
 * open, Tab is trapped, Escape closes, and focus returns to the card that
 * opened it. `onClose` is stabilised by the caller so the trap doesn't re-arm
 * on every render.
 */
function Viewer({
  entry,
  position,
  snapshotRef,
  onClose,
}: {
  entry: HangarEntry;
  position: PlayerPosition;
  snapshotRef: React.MutableRefObject<(() => string | null) | null>;
  onClose: () => void;
}) {
  const ref = useDialog<HTMLDivElement>(onClose);
  return (
    <div
      ref={ref}
      className="viewer"
      role="dialog"
      aria-modal="true"
      aria-label={entry.typeLabel}
      tabIndex={-1}
    >
      <div className="viewer__stage">
        <Stage typeIcao={entry.typeIcao} callsign={entry.callsign} snapshotRef={snapshotRef} />
      </div>
      <div className="viewer__bar">
        <div className="viewer__ident">
          <strong>{entry.typeLabel}</strong>
          <span className="mono">
            {entry.callsign || entry.reg || entry.hex.toUpperCase()} · {RARITY_LABEL[entry.rarity]}
          </span>
          <LiveStatus hex={entry.hex} position={position} />
        </div>
        <ShareCardButton
          entry={entry}
          firstSpotter={false}
          snapshotRef={snapshotRef}
          className="btn btn--quiet"
        />
        <button className="icon-btn" onClick={onClose} aria-label="Close viewer">
          <IconClose size={20} weight="bold" />
        </button>
      </div>
    </div>
  );
}

function Total({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="readout">
      <dt className="label">{label}</dt>
      <dd className="readout__value data--xl">{value}</dd>
    </div>
  );
}
