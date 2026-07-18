import { useCallback, useEffect, useState } from "react";
import type { ActivityItem, FriendSummary, LeaderboardRow, PlayerProfile, SharedCatch } from "@aloft/shared";
import { share } from "../../lib/platform";
import { cachedPlayer, renamePlayer } from "../../lib/player";
import { useApp } from "../../state/app";
import { addFriend, fetchActivity, fetchFriendHangar, fetchFriends, fetchLeaderboard, removeFriend } from "./api";

type Tab = "friends" | "board" | "feed";

const RARITY_EMOJI: Record<string, string> = {
  common: "⚪", uncommon: "🟢", rare: "🔵", epic: "🟣", legendary: "🟡",
};

function timeAgo(ts: number): string {
  const mins = Math.round((Date.now() - ts) / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

export function SocialView() {
  const go = useApp((s) => s.go);
  const [player, setPlayer] = useState<PlayerProfile | null>(cachedPlayer());
  const [tab, setTab] = useState<Tab>("friends");
  const [friends, setFriends] = useState<FriendSummary[]>([]);
  const [board, setBoard] = useState<LeaderboardRow[]>([]);
  const [feed, setFeed] = useState<ActivityItem[]>([]);
  const [code, setCode] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [offline, setOffline] = useState(false);
  const [viewing, setViewing] = useState<{ player: PlayerProfile; catches: SharedCatch[] } | null>(null);

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

  // Accept invite links: /?invite=ABC123
  useEffect(() => {
    const invite = new URLSearchParams(window.location.search).get("invite");
    if (!invite || !player) return;
    void addFriend(invite).then((r) => {
      setMessage(r.ok ? `Added ${r.friend?.name ?? "spotter"}!` : (r.reason ?? "Could not add"));
      if (r.ok) void refresh();
    });
  }, [player, refresh]);

  const submitCode = async () => {
    if (!code.trim()) return;
    const r = await addFriend(code.trim().toUpperCase());
    setMessage(r.ok ? `Added ${r.friend?.name ?? "spotter"}!` : (r.reason ?? "Could not add"));
    if (r.ok) {
      setCode("");
      void refresh();
    }
  };

  const shareInvite = async () => {
    if (!player) return;
    const url = `${window.location.origin}/?invite=${player.code}`;
    const result = await share("Aloft", `Add me on Aloft — my spotter code is ${player.code}`, url);
    if (result === "copied") setMessage("Invite link copied to clipboard");
    if (result === "failed") setMessage(`Share your code: ${player.code}`);
  };

  if (viewing) {
    return (
      <div className="social">
        <header className="hangar__header">
          <button className="btn" onClick={() => setViewing(null)}>← Back</button>
          <h1>{viewing.player.name}</h1>
          <span className="hangar__score">{viewing.catches.length} shown</span>
        </header>
        {viewing.catches.length === 0 && <p className="hangar__empty">Their hangar is still empty.</p>}
        <div className="hangar__grid">
          {viewing.catches.map((c) => (
            <div key={c.id} className={`hangar__card hangar__card--${c.rarity}`}>
              <span className="hangar__card-type">{c.typeLabel}</span>
              <span className="hangar__card-id">{c.callsign || c.reg || c.hex.toUpperCase()}</span>
              <span className="hangar__card-rarity">
                {c.rarity}{c.firstSpotter ? " · 🥇 first" : ""}
              </span>
              <span className="hangar__card-date">{new Date(c.caughtAt).toLocaleDateString()}</span>
            </div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="social">
      <header className="hangar__header">
        <button className="btn" onClick={() => go({ name: "radar" })}>← Radar</button>
        <h1>Spotters</h1>
      </header>

      {player && (
        <div className="social__me">
          <div>
            <span className="social__label">You are</span>
            <input
              className="social__name"
              defaultValue={player.name}
              maxLength={24}
              onBlur={(e) => {
                const next = e.target.value.trim();
                if (next && next !== player.name) void renamePlayer(next).then((p) => p && setPlayer(p));
              }}
            />
          </div>
          <div className="social__code-box">
            <span className="social__label">Your code</span>
            <strong className="social__code">{player.code}</strong>
          </div>
          <button className="btn btn--primary" onClick={() => void shareInvite()}>Invite a friend</button>
        </div>
      )}

      <div className="social__add">
        <input
          className="social__input"
          placeholder="Enter a friend's code"
          value={code}
          maxLength={6}
          onChange={(e) => setCode(e.target.value.toUpperCase())}
          onKeyDown={(e) => e.key === "Enter" && void submitCode()}
        />
        <button className="btn" onClick={() => void submitCode()}>Add</button>
      </div>
      {message && <p className="social__message">{message}</p>}
      {offline && <p className="social__message">Can't reach the tower — social is offline.</p>}

      <div className="social__tabs">
        {(["friends", "board", "feed"] as Tab[]).map((t) => (
          <button
            key={t}
            className={tab === t ? "social__tab social__tab--on" : "social__tab"}
            onClick={() => setTab(t)}
          >
            {t === "friends" ? "Friends" : t === "board" ? "This week" : "Activity"}
          </button>
        ))}
      </div>

      {tab === "friends" && (
        <div className="social__list">
          {friends.length === 0 && <p className="hangar__empty">No friends yet — share your code above.</p>}
          {friends.map((f) => (
            <div key={f.id} className="social__row">
              <button
                className="social__row-main"
                onClick={() =>
                  void fetchFriendHangar(f.id)
                    .then(setViewing)
                    .catch(() => setMessage("Could not open that hangar"))
                }
              >
                <strong>{f.name}</strong>
                <span className="social__row-stats">
                  {f.stats.catches} caught · {f.stats.rarityScore} pts
                  {f.stats.streak > 1 ? ` · 🔥 ${f.stats.streak}d` : ""}
                  {f.stats.bestRarity ? ` · best ${RARITY_EMOJI[f.stats.bestRarity]}` : ""}
                </span>
              </button>
              <button
                className="social__remove"
                title="Remove friend"
                onClick={() => void removeFriend(f.id).then(refresh)}
              >
                ✕
              </button>
            </div>
          ))}
        </div>
      )}

      {tab === "board" && (
        <div className="social__list">
          {board.map((row, i) => (
            <div key={row.id} className={row.isYou ? "social__row social__row--you" : "social__row"}>
              <span className="social__rank">{i + 1}</span>
              <span className="social__row-main">
                <strong>{row.name}{row.isYou ? " (you)" : ""}</strong>
                <span className="social__row-stats">{row.catches} caught this week</span>
              </span>
              <span className="social__points">{row.rarityScore}</span>
            </div>
          ))}
          {board.length <= 1 && <p className="hangar__empty">Add friends to race them each week.</p>}
        </div>
      )}

      {tab === "feed" && (
        <div className="social__list">
          {feed.length === 0 && <p className="hangar__empty">Nothing notable yet — rare catches show up here.</p>}
          {feed.map((item) => (
            <div key={`${item.player.id}:${item.catch.id}`} className="social__feed-item">
              <span className="social__feed-emoji">{RARITY_EMOJI[item.catch.rarity]}</span>
              <span>
                <strong>{item.player.name}</strong> caught a {item.catch.typeLabel}
                {item.catch.firstSpotter && <span className="social__first"> 🥇 first spot</span>}
                <small>{timeAgo(item.catch.caughtAt)}</small>
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
