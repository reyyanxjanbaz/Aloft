import { useCallback, useEffect, useState } from "react";
import { motion } from "framer-motion";
import type { ActivityItem, FriendSummary, LeaderboardRow, PlayerProfile, SharedCatch } from "@aloft/shared";
import { share } from "../../lib/platform";
import { cachedPlayer, renamePlayer } from "../../lib/player";
import { IconAdd, IconBack, IconRemove, IconShare, IconStar, IconStreak } from "../../ui/icons";
import { RARITY_LABEL } from "../../ui/rarity";
import { AircraftGlyph } from "../hangar/AircraftGlyph";
import {
  addFriend,
  fetchActivity,
  fetchFriendHangar,
  fetchFriends,
  fetchLeaderboard,
  removeFriend,
} from "./api";
import "./social.css";

type Tab = "friends" | "week" | "activity";

const TABS: Array<{ id: Tab; label: string }> = [
  { id: "friends", label: "Friends" },
  { id: "week", label: "This week" },
  { id: "activity", label: "Activity" },
];

function timeAgo(ts: number): string {
  const mins = Math.round((Date.now() - ts) / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

export function SocialView() {
  const [player, setPlayer] = useState<PlayerProfile | null>(cachedPlayer());
  const [tab, setTab] = useState<Tab>("friends");
  const [friends, setFriends] = useState<FriendSummary[]>([]);
  const [board, setBoard] = useState<LeaderboardRow[]>([]);
  const [feed, setFeed] = useState<ActivityItem[]>([]);
  const [code, setCode] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [offline, setOffline] = useState(false);
  const [visiting, setVisiting] = useState<{ player: PlayerProfile; catches: SharedCatch[] } | null>(null);

  const refresh = useCallback(async () => {
    try {
      const [f, b, a] = await Promise.all([fetchFriends(), fetchLeaderboard(), fetchActivity()]);
      setFriends(f);
      setBoard(b);
      setFeed(a);
      setOffline(false);
    } catch {
      setOffline(true);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    const invite = new URLSearchParams(window.location.search).get("invite");
    if (!invite || !player) return;
    void addFriend(invite).then((r) => {
      setMessage(r.ok ? `${r.friend?.name ?? "Spotter"} added` : (r.reason ?? "Could not add that code"));
      if (r.ok) void refresh();
    });
  }, [player, refresh]);

  const submit = async () => {
    if (!code.trim()) return;
    const r = await addFriend(code.trim().toUpperCase());
    setMessage(r.ok ? `${r.friend?.name ?? "Spotter"} added` : (r.reason ?? "Could not add that code"));
    if (r.ok) {
      setCode("");
      void refresh();
    }
  };

  if (visiting) {
    return (
      <div className="screen">
        <header className="screen__head">
          <button className="btn btn--quiet" onClick={() => setVisiting(null)}>
            <IconBack size={16} weight="bold" />
            Back
          </button>
          <h1 className="screen__title">{visiting.player.name}</h1>
        </header>
        {visiting.catches.length === 0 ? (
          <p className="empty">Their hangar is empty for now.</p>
        ) : (
          <ul className="hangar__grid">
            {visiting.catches.map((c) => (
              <li key={c.id}>
                <div className="card" style={{ ["--rarity" as string]: `var(--rarity-${c.rarity})` }}>
                  <AircraftGlyph typeIcao={c.typeIcao} />
                  <span className="card__type">{c.typeLabel}</span>
                  <span className="card__ident mono">{c.callsign || c.hex.toUpperCase()}</span>
                  <span className="card__foot">
                    <span className="card__rarity">{RARITY_LABEL[c.rarity]}</span>
                    {c.firstSpotter && <IconStar size={12} weight="fill" className="card__first" />}
                  </span>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    );
  }

  return (
    <div className="screen">
      <header className="screen__head">
        <h1 className="screen__title">Spotters</h1>
      </header>

      {player && (
        <section className="me">
          <div className="me__row">
            <label className="label" htmlFor="spotter-name">
              Your name
            </label>
            <input
              id="spotter-name"
              className="me__name"
              defaultValue={player.name}
              maxLength={24}
              onBlur={(e) => {
                const next = e.target.value.trim();
                if (next && next !== player.name) {
                  void renamePlayer(next).then((p) => p && setPlayer(p));
                }
              }}
            />
          </div>
          <div className="me__row me__row--code">
            <span className="label">Spotter code</span>
            <strong className="me__code">{player.code}</strong>
          </div>
          <button
            className="btn btn--primary btn--block"
            onClick={() =>
              void share(
                "Aloft",
                `Add me on Aloft — my spotter code is ${player.code}`,
                `${window.location.origin}/?invite=${player.code}`
              ).then((r) => {
                if (r === "copied") setMessage("Invite link copied");
                if (r === "failed") setMessage(`Share your code: ${player.code}`);
              })
            }
          >
            <IconShare size={16} weight="bold" />
            Invite a friend
          </button>
        </section>
      )}

      <div className="add">
        <input
          className="field"
          placeholder="ENTER CODE"
          value={code}
          maxLength={6}
          aria-label="Friend's spotter code"
          onChange={(e) => setCode(e.target.value.toUpperCase())}
          onKeyDown={(e) => e.key === "Enter" && void submit()}
        />
        <button className="btn" onClick={() => void submit()} disabled={code.length < 6}>
          <IconAdd size={16} weight="bold" />
          Add
        </button>
      </div>

      {message && <p className="note note--ok">{message}</p>}
      {offline && <p className="note note--warn">No link to the tower — spotters are offline.</p>}

      <div className="tabs" role="tablist">
        {TABS.map((t) => (
          <button
            key={t.id}
            role="tab"
            aria-selected={tab === t.id}
            className={tab === t.id ? "tabs__tab tabs__tab--on" : "tabs__tab"}
            onClick={() => setTab(t.id)}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === "friends" && (
        <ul className="rows">
          {friends.length === 0 && <p className="empty">No friends yet. Share your code above.</p>}
          {friends.map((f, i) => (
            <motion.li
              key={f.id}
              className="row"
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.04, duration: 0.28 }}
            >
              <button
                className="row__main"
                onClick={() =>
                  void fetchFriendHangar(f.id)
                    .then(setVisiting)
                    .catch(() => setMessage("Could not open that hangar"))
                }
              >
                <strong>{f.name}</strong>
                <span className="row__meta mono">
                  {f.stats.catches} caught · {f.stats.rarityScore} pts
                  {f.stats.firstSpots > 0 && ` · ${f.stats.firstSpots} first`}
                </span>
              </button>
              {f.stats.streak > 1 && (
                <span className="row__streak">
                  <IconStreak size={12} weight="fill" />
                  <span className="mono">{f.stats.streak}</span>
                </span>
              )}
              <button
                className="icon-btn"
                aria-label={`Remove ${f.name}`}
                onClick={() => void removeFriend(f.id).then(refresh)}
              >
                <IconRemove size={16} />
              </button>
            </motion.li>
          ))}
        </ul>
      )}

      {tab === "week" && (
        <ul className="rows">
          {board.length <= 1 && <p className="empty">Add friends to race them each week.</p>}
          {board.map((row, i) => (
            <li key={row.id} className={row.isYou ? "row row--you" : "row"}>
              <span className="row__rank mono">{String(i + 1).padStart(2, "0")}</span>
              <span className="row__main">
                <strong>
                  {row.name}
                  {row.isYou && <span className="row__you"> you</span>}
                </strong>
                <span className="row__meta mono">{row.catches} caught this week</span>
              </span>
              <span className="row__points mono">{row.rarityScore}</span>
            </li>
          ))}
        </ul>
      )}

      {tab === "activity" && (
        <ul className="rows">
          {feed.length === 0 && <p className="empty">Rare catches by your friends show up here.</p>}
          {feed.map((item) => (
            <li
              key={`${item.player.id}:${item.catch.id}`}
              className="row row--feed"
              style={{ ["--rarity" as string]: `var(--rarity-${item.catch.rarity})` }}
            >
              <AircraftGlyph typeIcao={item.catch.typeIcao} />
              <span className="row__main">
                <strong>
                  {item.player.name} caught a {item.catch.typeLabel}
                </strong>
                <span className="row__meta mono">
                  {RARITY_LABEL[item.catch.rarity]}
                  {item.catch.firstSpotter && " · first spot"} · {timeAgo(item.catch.caughtAt)}
                </span>
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
