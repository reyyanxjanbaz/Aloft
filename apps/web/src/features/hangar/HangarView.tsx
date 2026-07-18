import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { ACHIEVEMENTS, evaluateAchievements, RARITY_ORDER, streakDays } from "@aloft/shared";
import { AchievementIcon } from "../../ui/AchievementIcon";
import { IconClose, IconStreak } from "../../ui/icons";
import { RARITY_LABEL } from "../../ui/rarity";
import { Stage } from "../reveal/Stage";
import { AircraftGlyph } from "./AircraftGlyph";
import { listCatches, type HangarEntry } from "./db";
import "./hangar.css";

type Filter = "all" | "rare";

export function HangarView() {
  const [entries, setEntries] = useState<HangarEntry[] | null>(null);
  const [selected, setSelected] = useState<HangarEntry | null>(null);
  const [filter, setFilter] = useState<Filter>("all");

  useEffect(() => {
    void listCatches().then(setEntries);
  }, []);

  const all = entries ?? [];
  const points = all.reduce((sum, e) => sum + (RARITY_ORDER.indexOf(e.rarity) + 1) ** 2, 0);
  const streak = streakDays(all, Date.now());
  const earned = new Set(evaluateAchievements(all));
  const shown = filter === "rare"
    ? all.filter((e) => RARITY_ORDER.indexOf(e.rarity) >= RARITY_ORDER.indexOf("rare"))
    : all;

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

      {all.length === 0 ? (
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
                    <button
                      className="card"
                      style={{ ["--rarity" as string]: `var(--rarity-${e.rarity})` }}
                      onClick={() => setSelected(e)}
                    >
                      <AircraftGlyph typeIcao={e.typeIcao} />
                      <span className="card__type">{e.typeLabel}</span>
                      <span className="card__ident mono">
                        {e.callsign || e.reg || e.hex.toUpperCase()}
                      </span>
                      <span className="card__foot">
                        <span className="card__rarity">{RARITY_LABEL[e.rarity]}</span>
                        <span className="card__date mono">
                          {new Date(e.caughtAt).toLocaleDateString(undefined, {
                            day: "2-digit",
                            month: "short",
                          })}
                        </span>
                      </span>
                    </button>
                  </motion.li>
                ))}
              </ul>
            )}
          </section>
        </>
      )}

      {selected && (
        <div className="viewer" role="dialog" aria-label={selected.typeLabel}>
          <div className="viewer__stage">
            <Stage typeIcao={selected.typeIcao} callsign={selected.callsign} />
          </div>
          <div className="viewer__bar">
            <div className="viewer__ident">
              <strong>{selected.typeLabel}</strong>
              <span className="mono">
                {selected.callsign || selected.reg || selected.hex.toUpperCase()} ·{" "}
                {RARITY_LABEL[selected.rarity]}
              </span>
            </div>
            <button className="icon-btn" onClick={() => setSelected(null)} aria-label="Close viewer">
              <IconClose size={20} weight="bold" />
            </button>
          </div>
        </div>
      )}
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
