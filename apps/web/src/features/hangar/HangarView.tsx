import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { motion } from "framer-motion";
import { ACHIEVEMENTS, evaluateAchievements, RARITY_ORDER, streakDays } from "@aloft/shared";
import { AchievementIcon } from "../../ui/AchievementIcon";
import { ErrorBoundary } from "../../components/ErrorBoundary";
import { IconClose, IconStreak, IconTrophy } from "../../ui/icons";
import { RARITY_LABEL } from "../../ui/rarity";
import { ShareCardButton } from "../share/ShareCardButton";
import type { PlayerPosition } from "../../lib/useGeolocation";
import { CatchCard } from "./CatchCard";
import { DeckView } from "./DeckView";
import { listCatches, type HangarEntry } from "./db";
import { FleetStatus } from "./FleetStatus";
import { LiveStatus } from "./LiveStatus";
import { TypeBoard } from "./TypeBoard";
import { useCollectionTilt } from "./useCollectionTilt";
import { useDialog } from "./useDialog";
import "./hangar.css";

/**
 * The 3D viewer, and with it Three.js, @react-three/fiber and drei, are pulled
 * only when a card is actually opened. The reveal no longer renders a model at
 * all, so this is the single entry point to that stack — keeping it out of the
 * initial bundle takes it off the path to the scope, which is the screen the
 * app opens on.
 */
const Stage = lazy(() => import("../reveal/Stage").then((m) => ({ default: m.Stage })));

type Filter = "all" | "rare";
type Mode = "gallery" | "deck" | "board";

export function HangarView({ position }: { position: PlayerPosition }) {
  const [entries, setEntries] = useState<HangarEntry[] | null>(null);
  const [selected, setSelected] = useState<HangarEntry | null>(null);
  const [filter, setFilter] = useState<Filter>("all");
  const [mode, setMode] = useState<Mode>("gallery");
  const [statsOpen, setStatsOpen] = useState(false);
  const [unreadable, setUnreadable] = useState(false);
  const snapshotRef = useRef<(() => string | null) | null>(null);
  const closeViewer = useCallback(() => setSelected(null), []);
  const closeStats = useCallback(() => setStatsOpen(false), []);
  // One light source for the whole collection — tilting the phone (or moving
  // the pointer) makes every foil card catch the light together.
  const tiltRef = useCollectionTilt<HTMLDivElement>();

  useEffect(() => {
    // Without this catch, a storage failure (private mode, a blocked upgrade,
    // a corrupt database) left entries null forever and the hangar rendered
    // "Nothing logged yet" — telling a player with a full collection they had
    // caught nothing.
    void listCatches()
      .then(setEntries)
      .catch((err) => {
        console.error("[hangar] could not read the local hangar:", err);
        setUnreadable(true);
      });
  }, []);

  const all = entries ?? [];
  // Recomputed only when the collection changes: these walk every catch.
  const { points, streak, earned, rarityCounts } = useMemo(() => {
    const counts = Object.fromEntries(RARITY_ORDER.map((r) => [r, 0])) as Record<string, number>;
    for (const e of all) counts[e.rarity] = (counts[e.rarity] ?? 0) + 1;
    return {
      points: all.reduce((sum, e) => sum + (RARITY_ORDER.indexOf(e.rarity) + 1) ** 2, 0),
      streak: streakDays(all, Date.now()),
      earned: new Set(evaluateAchievements(all)),
      rarityCounts: counts,
    };
  }, [entries]);
  const featured = all[0];
  // The grid shows the collection minus the featured hero, filtered.
  const galleryRest = useMemo(() => {
    const base =
      filter === "rare"
        ? all.filter((e) => RARITY_ORDER.indexOf(e.rarity) >= RARITY_ORDER.indexOf("rare"))
        : all;
    return base.filter((e) => e.id !== featured?.id);
  }, [entries, filter]);
  const hexes = useMemo(() => [...new Set(all.map((e) => e.hex.toLowerCase()))], [entries]);

  return (
    <div className="screen hangar" ref={tiltRef}>
      <header className="screen__head hangar__head">
        <h1 className="screen__title">Hangar</h1>
        {all.length > 0 && (
          <div className="hangar__ribbon">
            <span>
              <b className="mono">{all.length}</b> airframes
            </span>
            <span>
              <b className="mono">{points}</b> pts
            </span>
            {streak > 1 && (
              <span className="hangar__ribbon-fire">
                <IconStreak size={12} weight="fill" />
                <b className="mono">{streak}</b> day
              </span>
            )}
          </div>
        )}
      </header>

      {all.length > 0 && (
        <div className="hangar__tools">
          <div className="segmented" role="group" aria-label="Collection layout">
            <button
              className={mode === "gallery" ? "segmented__opt segmented__opt--on" : "segmented__opt"}
              onClick={() => setMode("gallery")}
              aria-pressed={mode === "gallery"}
            >
              Gallery
            </button>
            <button
              className={mode === "deck" ? "segmented__opt segmented__opt--on" : "segmented__opt"}
              onClick={() => setMode("deck")}
              aria-pressed={mode === "deck"}
            >
              Deck
            </button>
            <button
              className={mode === "board" ? "segmented__opt segmented__opt--on" : "segmented__opt"}
              onClick={() => setMode("board")}
              aria-pressed={mode === "board"}
            >
              Board
            </button>
          </div>
          <button className="pill" onClick={() => setStatsOpen(true)}>
            <IconTrophy size={13} weight="bold" />
            Badges
            <b className="mono">
              {earned.size}/{ACHIEVEMENTS.length}
            </b>
          </button>
        </div>
      )}

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
      ) : mode === "gallery" ? (
        <Gallery featured={featured!} rest={galleryRest} filter={filter} onFilter={setFilter} onOpen={setSelected} />
      ) : mode === "deck" ? (
        <DeckView entries={all} onOpen={setSelected} />
      ) : (
        <TypeBoard entries={all} onOpen={setSelected} />
      )}

      {selected && (
        <Viewer entry={selected} position={position} snapshotRef={snapshotRef} onClose={closeViewer} />
      )}
      {statsOpen && (
        <StatsSheet
          total={all.length}
          points={points}
          streak={streak}
          rarityCounts={rarityCounts}
          hexes={hexes}
          earned={earned}
          onClose={closeStats}
        />
      )}
    </div>
  );
}

function Gallery({
  featured,
  rest,
  filter,
  onFilter,
  onOpen,
}: {
  featured: HangarEntry;
  rest: HangarEntry[];
  filter: Filter;
  onFilter: (f: Filter) => void;
  onOpen: (e: HangarEntry) => void;
}) {
  const ident = featured.callsign || featured.reg || featured.hex.toUpperCase();
  const caught = new Date(featured.caughtAt).toLocaleDateString(undefined, { day: "2-digit", month: "short" });
  return (
    <>
      <section className="hangar__hero">
        <CatchCard entry={featured} onOpen={() => onOpen(featured)} />
        <div className="hangar__hero-meta">
          <span className="label">Latest catch</span>
          <h2 className="hangar__hero-type">{featured.typeLabel}</h2>
          <p className="hangar__hero-sub mono">
            {ident} · {RARITY_LABEL[featured.rarity]}
          </p>
          <dl className="hangar__hero-row">
            <HeroStat label="Altitude" value={featured.altFt > 0 ? Math.round(featured.altFt).toLocaleString() : "Ground"} unit={featured.altFt > 0 ? "ft" : ""} />
            <HeroStat label="Range" value={featured.distanceKm.toFixed(1)} unit="km" />
            <HeroStat label="Caught" value={caught} unit="" />
          </dl>
        </div>
      </section>

      <div className="hangar__collbar">
        <span className="label">Collection</span>
        <div className="segmented" role="group" aria-label="Filter collection">
          <button
            className={filter === "all" ? "segmented__opt segmented__opt--on" : "segmented__opt"}
            onClick={() => onFilter("all")}
            aria-pressed={filter === "all"}
          >
            All
          </button>
          <button
            className={filter === "rare" ? "segmented__opt segmented__opt--on" : "segmented__opt"}
            onClick={() => onFilter("rare")}
            aria-pressed={filter === "rare"}
          >
            Rare+
          </button>
        </div>
      </div>

      {rest.length === 0 ? (
        <p className="empty">Nothing else {filter === "rare" ? "rare " : ""}yet. Keep watching the ring.</p>
      ) : (
        <ul className="hangar__grid">
          {rest.map((e, i) => (
            <motion.li
              key={e.id}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: Math.min(i * 0.03, 0.4), duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
            >
              <CatchCard entry={e} onOpen={() => onOpen(e)} />
            </motion.li>
          ))}
        </ul>
      )}
    </>
  );
}

function HeroStat({ label, value, unit }: { label: string; value: string; unit: string }) {
  return (
    <div className="readout">
      <dt className="label">{label}</dt>
      <dd className="readout__value">
        {value} {unit && <span className="unit">{unit}</span>}
      </dd>
    </div>
  );
}

/**
 * The Logbook: collection totals, rarity distribution, badge progress and the
 * live fleet, in an on-demand sheet. Kept off the main view so the collection
 * is the hero — and so the fleet's per-airframe network lookups only fire when
 * the player actually opens this, not on every hangar visit.
 */
function StatsSheet({
  total,
  points,
  streak,
  rarityCounts,
  hexes,
  earned,
  onClose,
}: {
  total: number;
  points: number;
  streak: number;
  rarityCounts: Record<string, number>;
  hexes: string[];
  earned: Set<string>;
  onClose: () => void;
}) {
  const ref = useDialog<HTMLDivElement>(onClose);
  const peak = Math.max(1, ...RARITY_ORDER.map((r) => rarityCounts[r] ?? 0));
  return (
    <div className="sheet-scrim" onClick={onClose}>
      <div
        ref={ref}
        className="sheet"
        role="dialog"
        aria-modal="true"
        aria-label="Logbook"
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="sheet__head">
          <h2 className="sheet__title">Logbook</h2>
          <button className="icon-btn" onClick={onClose} aria-label="Close">
            <IconClose size={18} weight="bold" />
          </button>
        </div>

        <dl className="logbook__tally">
          <div className="readout">
            <dt className="label">Airframes</dt>
            <dd className="readout__value">{total}</dd>
          </div>
          <div className="readout">
            <dt className="label">Points</dt>
            <dd className="readout__value" style={{ color: "var(--amber)" }}>{points}</dd>
          </div>
          <div className="readout">
            <dt className="label">Badges</dt>
            <dd className="readout__value">{earned.size}/{ACHIEVEMENTS.length}</dd>
          </div>
          <div className="readout">
            <dt className="label">Streak</dt>
            <dd className="readout__value">{streak > 0 ? `${streak}d` : "—"}</dd>
          </div>
        </dl>

        <div className="logbook__section">
          <h3 className="label">Rarity mix</h3>
          <ul className="logbook__dist">
            {[...RARITY_ORDER].reverse().map((r) => {
              const n = rarityCounts[r] ?? 0;
              return (
                <li key={r} className="dist" style={{ ["--rarity" as string]: `var(--rarity-${r})` }}>
                  <span className="dist__name">{RARITY_LABEL[r]}</span>
                  <span className="dist__bar" aria-hidden="true">
                    <i style={{ width: `${(n / peak) * 100}%`, opacity: n ? 1 : 0.2 }} />
                  </span>
                  <span className="dist__n mono">{n}</span>
                </li>
              );
            })}
          </ul>
        </div>

        <div className="logbook__section">
          <h3 className="label">Badges</h3>
          <ul className="logbook__badges">
            {ACHIEVEMENTS.map((a) => {
              const has = earned.has(a.id);
              return (
                <li key={a.id} className={has ? "lbadge lbadge--earned" : "lbadge"}>
                  <AchievementIcon name={a.icon} size={18} weight={has ? "fill" : "regular"} />
                  <span className="lbadge__text">
                    <strong>{a.name}</strong>
                    <span>{a.description}</span>
                  </span>
                </li>
              );
            })}
          </ul>
        </div>

        {hexes.length > 0 && <FleetStatus hexes={hexes} />}
      </div>
    </div>
  );
}

/**
 * The full-screen model viewer, as a real modal dialog — focus moves in on
 * open, Tab is trapped, Escape closes, and focus returns to the card that
 * opened it.
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
    <div ref={ref} className="viewer" role="dialog" aria-modal="true" aria-label={entry.typeLabel} tabIndex={-1}>
      {/*
        Suspense covers the chunk *arriving*; it does nothing for a chunk that
        never arrives. A 404 — routine right after a deploy, when a cached page
        asks for a hash that no longer exists — throws straight past it, and
        without this boundary it would reach the app-level one and replace the
        whole interface with the fault screen. The card and its readouts are
        still perfectly usable without the model.
      */}
      <div className="viewer__stage">
        <ErrorBoundary
          label="viewer"
          resetKey={entry.id}
          fallback={<p className="viewer__loading label">Model unavailable offline</p>}
        >
          <Suspense fallback={<p className="viewer__loading label">Building airframe</p>}>
            <Stage typeIcao={entry.typeIcao} callsign={entry.callsign} snapshotRef={snapshotRef} />
          </Suspense>
        </ErrorBoundary>
      </div>
      <div className="viewer__bar">
        <div className="viewer__ident">
          <strong>{entry.typeLabel}</strong>
          <span className="mono">
            {entry.callsign || entry.reg || entry.hex.toUpperCase()} · {RARITY_LABEL[entry.rarity]}
          </span>
          <LiveStatus hex={entry.hex} position={position} />
        </div>
        <ShareCardButton entry={entry} firstSpotter={false} snapshotRef={snapshotRef} className="btn btn--quiet" />
        <button className="icon-btn" onClick={onClose} aria-label="Close viewer">
          <IconClose size={20} weight="bold" />
        </button>
      </div>
    </div>
  );
}
