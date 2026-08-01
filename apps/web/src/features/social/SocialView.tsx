import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { RARITY_ORDER } from "@aloft/shared";
import type { ActivityItem, FriendSummary, LeaderboardRow, PlayerProfile, SharedCatch } from "@aloft/shared";
import { share } from "../../lib/platform";
import { usePlayer } from "../../state/player";
import { IconAdd, IconBack, IconCopy, IconRemove, IconShare, IconStar, IconStreak } from "../../ui/icons";
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

const spring = { type: "tween", ease: [0.2, 0.8, 0.2, 1], duration: 0.22 } as const;

function timeAgo(ts: number): string {
  const mins = Math.round((Date.now() - ts) / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

function bestRarity(catches: SharedCatch[]): SharedCatch["rarity"] | null {
  let best = -1;
  for (const c of catches) best = Math.max(best, RARITY_ORDER.indexOf(c.rarity));
  return best < 0 ? null : RARITY_ORDER[best]!;
}

export function SocialView() {
  // Subscribed, not snapshotted: on a fresh install registration is still in
  // flight when this mounts, and a one-off read left the profile blank and
  // dropped any ?invite= code for the rest of the session.
  const player = usePlayer((s) => s.player);
  const auth = usePlayer((s) => s.auth);
  const startFresh = usePlayer((s) => s.startFresh);
  const [tab, setTab] = useState<Tab>("friends");
  const [friends, setFriends] = useState<FriendSummary[]>([]);
  const [board, setBoard] = useState<LeaderboardRow[]>([]);
  const [feed, setFeed] = useState<ActivityItem[]>([]);
  const [code, setCode] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [offline, setOffline] = useState(false);
  const [visiting, setVisiting] = useState<{ player: PlayerProfile; catches: SharedCatch[] } | null>(null);
  // Tracks which friend's hangar was most recently requested, so a slower
  // response for an earlier tap can't overwrite a faster one for a later tap.
  const visitingRequestRef = useRef<string | null>(null);

  const visitFriend = useCallback((friendId: string) => {
    visitingRequestRef.current = friendId;
    void fetchFriendHangar(friendId)
      .then((result) => {
        if (visitingRequestRef.current === friendId) setVisiting(result);
      })
      .catch(() => {
        if (visitingRequestRef.current === friendId) setMessage("Could not open that hangar");
      });
  }, []);

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
    const params = new URLSearchParams(window.location.search);
    const invite = params.get("invite");
    if (!invite || !player) return;
    void addFriend(invite).then((r) => {
      setMessage(r.ok ? `${r.friend?.name ?? "Spotter"} added` : (r.reason ?? "Could not add that code"));
      if (r.ok) void refresh();
    });
    // Consume the invite from the URL so it can't be resubmitted — this
    // effect previously depended on the whole `player` object, so every
    // successful rename (which replaces that object) re-fired it and
    // silently re-sent the same accept-invite request.
    params.delete("invite");
    const rest = params.toString();
    window.history.replaceState(null, "", rest ? `?${rest}` : window.location.pathname);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [player?.id, refresh]);

  const submit = async () => {
    if (!code.trim()) return;
    const r = await addFriend(code.trim().toUpperCase());
    setMessage(r.ok ? `${r.friend?.name ?? "Spotter"} added` : (r.reason ?? "Could not add that code"));
    if (r.ok) {
      setCode("");
      void refresh();
    }
  };

  const copyCode = () => {
    if (!player) return;
    void navigator.clipboard
      ?.writeText(player.code)
      .then(() => setMessage("Code copied"))
      .catch(() => setMessage(`Your code is ${player.code}`));
  };

  // Your own standing, pulled out of the board so it can headline the panel.
  const me = useMemo(() => {
    const idx = board.findIndex((r) => r.isYou);
    return idx < 0 ? null : { rank: idx + 1, row: board[idx]! };
  }, [board]);
  const topScore = useMemo(() => Math.max(1, ...board.map((r) => r.rarityScore)), [board]);

  if (visiting) {
    const best = bestRarity(visiting.catches);
    return (
      <div className="screen">
        <header className="screen__head">
          <button
            className="btn btn--quiet"
            onClick={() => {
              // Also clears the in-flight-request marker, so a slow response
              // that arrives after backing out can't silently reopen this view.
              visitingRequestRef.current = null;
              setVisiting(null);
            }}
          >
            <IconBack size={16} weight="bold" />
            Back
          </button>
          <h1 className="screen__title">{visiting.player.name}</h1>
        </header>
        {visiting.catches.length === 0 ? (
          <p className="sp-empty">Their hangar is empty for now.</p>
        ) : (
          <>
            <div className="sp-visit__sub">
              <div className="readout">
                <span className="label">Airframes</span>
                <span className="readout__value">{visiting.catches.length}</span>
              </div>
              {best && (
                <div className="readout">
                  <span className="label">Best</span>
                  <span className="readout__value" style={{ color: `var(--rarity-${best})` }}>
                    {RARITY_LABEL[best]}
                  </span>
                </div>
              )}
            </div>
            <ul className="sp-visit__grid">
              {visiting.catches.map((c) => (
                <li key={c.id}>
                  <div className="card" style={{ ["--rarity" as string]: `var(--rarity-${c.rarity})` }}>
                    <AircraftGlyph typeIcao={c.typeIcao} />
                    <span className="card__type">{c.typeLabel}</span>
                    <span className="card__ident mono">{c.callsign || c.hex.toUpperCase()}</span>
                    <span className="card__foot">
                      <span className={`tag tag--${c.rarity}`}>{RARITY_LABEL[c.rarity]}</span>
                      {c.firstSpotter && <IconStar size={12} weight="fill" className="card__first" />}
                    </span>
                  </div>
                </li>
              ))}
            </ul>
          </>
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
        <section className="sp-id">
          <div className="sp-id__top">
            <label className="sp-id__name-field">
              <span className="label">Callsign</span>
              <input
                className="sp-id__name"
                defaultValue={player.name}
                maxLength={24}
                aria-label="Your name"
                onBlur={(e) => {
                  const next = e.target.value.trim();
                  if (next && next !== player.name) void usePlayer.getState().rename(next);
                }}
              />
            </label>
            {me && (
              <div className="sp-id__rank readout">
                <span className="label">Rank</span>
                <span className="readout__value">#{me.rank}</span>
              </div>
            )}
          </div>

          <div className="sp-squawk">
            <div className="readout">
              <span className="label">Spotter code</span>
              <span className="sp-squawk__code">{player.code}</span>
            </div>
            <button className="icon-btn" onClick={copyCode} aria-label="Copy your spotter code">
              <IconCopy size={20} />
            </button>
          </div>

          {me && (
            <div className="sp-stats">
              <div className="readout">
                <span className="label">Caught</span>
                <span className="readout__value">{me.row.catches}</span>
              </div>
              <div className="readout">
                <span className="label">Spotters</span>
                <span className="readout__value">{friends.length}</span>
              </div>
              <div className="readout">
                <span className="label">Points</span>
                <span className="readout__value">{me.row.rarityScore}</span>
              </div>
            </div>
          )}

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
            Invite a spotter
          </button>
        </section>
      )}

      <div className="sp-add">
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

      {message && <p className="sp-note sp-note--ok">{message}</p>}
      {/* An identity the tower rejects is not the same as being offline, and
          it needs an action rather than a shrug — previously both showed the
          same "offline" line and the device could never recover. */}
      {auth === "auth-failed" ? (
        <div className="sp-note sp-note--warn">
          <span>This device&apos;s identity check failed, so spotters are read-blocked.</span>
          <button className="btn btn--quiet" onClick={() => void startFresh()}>
            Start a fresh identity
          </button>
        </div>
      ) : (
        offline && <p className="sp-note sp-note--warn">No link to the tower — spotters are offline.</p>
      )}

      <div className="sp-tabs" role="tablist">
        {TABS.map((t) => (
          <button
            key={t.id}
            role="tab"
            aria-selected={tab === t.id}
            className="sp-tabs__tab"
            onClick={() => setTab(t.id)}
          >
            {t.label}
            {tab === t.id && <motion.span layoutId="sp-ink" className="sp-tabs__ink" transition={spring} />}
          </button>
        ))}
      </div>

      <AnimatePresence mode="wait">
        <motion.div
          key={tab}
          className="sp-tabwrap"
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -4 }}
          transition={spring}
        >
          {tab === "friends" && (
            <FriendsTab friends={friends} onVisit={visitFriend} onRemove={(id) => void removeFriend(id).then((r) => (r.ok ? refresh() : setMessage("Could not remove — try again")))} />
          )}
          {tab === "week" && <BoardTab board={board} topScore={topScore} />}
          {tab === "activity" && <ActivityTab feed={feed} />}
        </motion.div>
      </AnimatePresence>
    </div>
  );
}

function FriendsTab({
  friends,
  onVisit,
  onRemove,
}: {
  friends: FriendSummary[];
  onVisit: (id: string) => void;
  onRemove: (id: string) => void;
}) {
  if (friends.length === 0)
    return <p className="sp-empty">No spotters yet.<br />Share your code and add theirs to compare hangars.</p>;
  return (
    <ul className="sp-list">
      {friends.map((f, i) => (
        <motion.li
          key={f.id}
          className="sp-friend"
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: Math.min(i * 0.04, 0.3), duration: 0.26, ease: [0.16, 1, 0.3, 1] }}
        >
          <button className="sp-friend__open" onClick={() => onVisit(f.id)}>
            <span className="sp-friend__mark" aria-hidden="true">{f.name.charAt(0).toUpperCase()}</span>
            <span className="sp-friend__body">
              <span className="sp-friend__name">{f.name}</span>
              <span className="sp-friend__chips">
                <span className="chip"><b>{f.stats.catches}</b> caught</span>
                <span className="chip chip--pts"><b>{f.stats.rarityScore}</b> pts</span>
                {f.stats.firstSpots > 0 && (
                  <span className="chip chip--first"><IconStar size={11} weight="fill" /><b>{f.stats.firstSpots}</b> first</span>
                )}
              </span>
            </span>
          </button>
          {f.stats.streak > 1 && (
            <span className="sp-friend__streak"><IconStreak size={12} weight="fill" />{f.stats.streak}d</span>
          )}
          <button className="icon-btn" aria-label={`Remove ${f.name}`} onClick={() => onRemove(f.id)}>
            <IconRemove size={16} />
          </button>
        </motion.li>
      ))}
    </ul>
  );
}

function BoardTab({ board, topScore }: { board: LeaderboardRow[]; topScore: number }) {
  if (board.length <= 1)
    return <p className="sp-empty">Add spotters to race them.<br />Every rare catch this week counts toward points.</p>;
  return (
    <ul className="sp-board">
      {board.map((row, i) => (
        <li
          key={row.id}
          className={`sp-board__row${row.isYou ? " sp-board__row--you" : ""}${i === 0 ? " sp-board__row--lead" : ""}`}
        >
          <span className="sp-rank">{String(i + 1).padStart(2, "0")}</span>
          <span className="sp-board__who">
            <span className="sp-board__name">
              {row.name}
              {row.isYou && <span className="sp-board__you-tag">you</span>}
            </span>
            <span className="sp-board__meter" aria-hidden="true">
              <i style={{ width: `${Math.max(6, (row.rarityScore / topScore) * 100)}%` }} />
            </span>
          </span>
          <span className="sp-board__pts">
            {row.rarityScore}
            <small>{row.catches} caught</small>
          </span>
        </li>
      ))}
    </ul>
  );
}

function ActivityTab({ feed }: { feed: ActivityItem[] }) {
  if (feed.length === 0)
    return <p className="sp-empty">Quiet skies.<br />Rare catches by your spotters will land here.</p>;
  return (
    <ul className="sp-feed">
      {feed.map((item) => (
        <li
          key={`${item.player.id}:${item.catch.id}`}
          className="sp-feed__item"
          style={{ ["--rarity" as string]: `var(--rarity-${item.catch.rarity})` }}
        >
          <span className="sp-feed__rail" aria-hidden="true">
            <span className="sp-feed__dot" />
          </span>
          <span className="sp-feed__body">
            <AircraftGlyph typeIcao={item.catch.typeIcao} />
            <span className="sp-feed__text">
              <strong>
                {item.player.name} caught a {item.catch.typeLabel}
              </strong>
              <span className="sp-feed__meta">
                <span className="r">{RARITY_LABEL[item.catch.rarity]}</span>
                {item.catch.firstSpotter && " · first spot"} · {timeAgo(item.catch.caughtAt)}
              </span>
            </span>
          </span>
        </li>
      ))}
    </ul>
  );
}
