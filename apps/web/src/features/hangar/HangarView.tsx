import { useEffect, useState } from "react";
import { ACHIEVEMENTS, evaluateAchievements, RARITY_ORDER, streakDays } from "@aloft/shared";
import { useApp } from "../../state/app";
import { ModelStage } from "../reveal/RevealView";
import { listCatches, type HangarEntry } from "./db";

export function HangarView() {
  const go = useApp((s) => s.go);
  const [entries, setEntries] = useState<HangarEntry[] | null>(null);
  const [selected, setSelected] = useState<HangarEntry | null>(null);

  useEffect(() => {
    void listCatches().then(setEntries);
  }, []);

  const rarityScore = (entries ?? []).reduce(
    (sum, e) => sum + (RARITY_ORDER.indexOf(e.rarity) + 1) ** 2,
    0
  );
  const streak = streakDays(entries ?? [], Date.now());
  const earned = new Set(evaluateAchievements(entries ?? []));

  return (
    <div className="hangar">
      <header className="hangar__header">
        <button className="btn" onClick={() => go({ name: "radar" })}>← Radar</button>
        <h1>Hangar</h1>
        <span className="hangar__score">
          {entries?.length ?? 0} caught · {rarityScore} pts{streak > 1 ? ` · 🔥 ${streak}d` : ""}
        </span>
      </header>

      {entries && entries.length === 0 && (
        <p className="hangar__empty">
          Nothing here yet. Get outside, find a plane on the radar, and hunt it down. 🛫
        </p>
      )}

      {entries && entries.length > 0 && (
        <div className="hangar__badges">
          {ACHIEVEMENTS.map((a) => (
            <div
              key={a.id}
              className={earned.has(a.id) ? "badge badge--earned" : "badge"}
              title={`${a.name} — ${a.description}`}
            >
              <span className="badge__icon">{a.icon}</span>
              <span className="badge__name">{a.name}</span>
            </div>
          ))}
        </div>
      )}

      <div className="hangar__grid">
        {(entries ?? []).map((e) => (
          <button key={e.id} className={`hangar__card hangar__card--${e.rarity}`} onClick={() => setSelected(e)}>
            <span className="hangar__card-type">{e.typeLabel}</span>
            <span className="hangar__card-id">{e.callsign || e.reg || e.hex.toUpperCase()}</span>
            <span className="hangar__card-rarity">{e.rarity}</span>
            <span className="hangar__card-date">{new Date(e.caughtAt).toLocaleDateString()}</span>
          </button>
        ))}
      </div>

      {selected && (
        <div className="hangar__viewer" onClick={() => setSelected(null)}>
          <div className="hangar__viewer-stage" onClick={(ev) => ev.stopPropagation()}>
            <ModelStage entry={selected} />
            <div className="hangar__viewer-caption">
              <strong>{selected.typeLabel}</strong>
              <span>{selected.callsign || selected.reg || selected.hex.toUpperCase()} · {selected.rarity}</span>
            </div>
            <button className="plane-card__close" onClick={() => setSelected(null)}>✕</button>
          </div>
        </div>
      )}
    </div>
  );
}
