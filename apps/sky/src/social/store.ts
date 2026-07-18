import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import {
  RARITY_ORDER,
  streakDays,
  evaluateAchievements,
  type ActivityItem,
  type FriendSummary,
  type LeaderboardRow,
  type PlayerProfile,
  type PlayerStats,
  type SharedCatch,
} from "@aloft/shared";

const DATA_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "data");
const FILE = join(DATA_DIR, "social.json");

/** Ambiguous characters (0/O, 1/I) omitted — codes get read aloud and typed by hand. */
const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

interface PlayerRecord extends PlayerProfile {
  /**
   * Bearer secret proving control of this identity, issued once at creation
   * and required (via `x-player-token`) for every mutating request. Never
   * included in any response except the owner's own successful
   * registration/rename — `PlayerProfile` (what friends/leaderboards see)
   * has no token field at all.
   */
  token: string;
  createdAt: number;
  catches: SharedCatch[];
  friendIds: string[];
}

interface Snapshot {
  players: PlayerRecord[];
  /** hex → player id who caught that airframe first, ever. */
  firstSpots: Record<string, string>;
}

/**
 * Safe index into RARITY_ORDER for a string that *should* be a Rarity but
 * may not be (persisted data, a future tier renamed/removed). -1 for unknown
 * values rather than an `as never` cast that silently mis-scores garbage.
 */
function rarityIndex(rarity: string): number {
  return (RARITY_ORDER as readonly string[]).indexOf(rarity);
}

export function rarityPoints(rarity: string): number {
  const idx = rarityIndex(rarity);
  return idx >= 0 ? (idx + 1) ** 2 : 0;
}

/**
 * File-backed social graph — the MVP stand-in for Supabase/Postgres.
 * Mirrors the shape of `supabase/schema.sql` so the migration is a swap of
 * this class's internals, not of the routes above it.
 */
export class SocialStore {
  private players = new Map<string, PlayerRecord>();
  private byCode = new Map<string, string>();
  private firstSpots = new Map<string, string>();

  constructor() {
    if (!existsSync(FILE)) return;
    try {
      const snap = JSON.parse(readFileSync(FILE, "utf8")) as Snapshot;
      for (const p of snap.players) {
        this.players.set(p.id, p);
        this.byCode.set(p.code, p.id);
      }
      for (const [hex, id] of Object.entries(snap.firstSpots ?? {})) this.firstSpots.set(hex, id);
    } catch {
      console.warn("[social] could not parse social.json — starting empty");
    }
  }

  private persistTimer: NodeJS.Timeout | null = null;

  /**
   * Debounced, async, whole-file rewrite. A burst of mutations (several
   * catches, a friend add) collapses into one write instead of one
   * synchronous `writeFileSync` per call — the previous version blocked
   * Node's single event loop, which is also running every cell's poll timer
   * and WS fan-out, on every single mutation.
   */
  private persist(): void {
    if (this.persistTimer) return;
    this.persistTimer = setTimeout(() => {
      this.persistTimer = null;
      void this.writeNow();
    }, 250);
    this.persistTimer.unref?.();
  }

  private async writeNow(): Promise<void> {
    mkdirSync(DATA_DIR, { recursive: true });
    const snap: Snapshot = {
      players: [...this.players.values()],
      firstSpots: Object.fromEntries(this.firstSpots),
    };
    try {
      await writeFile(FILE, JSON.stringify(snap, null, 2));
    } catch (err) {
      // In-memory state is now ahead of disk. Retry on the next mutation
      // (persist() will be called again) rather than losing the write
      // silently; log loudly since this is the only signal an operator gets.
      console.error("[social] failed to persist store — will retry on next change:", err);
    }
  }

  /** Bypasses the debounce and writes immediately — call before process exit. */
  async flush(): Promise<void> {
    if (this.persistTimer) {
      clearTimeout(this.persistTimer);
      this.persistTimer = null;
    }
    await this.writeNow();
  }

  private newCode(): string {
    // Even the UUID-derived fallback is checked for uniqueness — a raw
    // collision would silently steal an existing player's code out from
    // under them (byCode.set would overwrite the old mapping).
    for (let attempt = 0; attempt < 100; attempt++) {
      const code =
        attempt < 50
          ? Array.from(
              { length: 6 },
              () => CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)]
            ).join("")
          : randomUUID().replace(/-/g, "").slice(0, 6).toUpperCase();
      if (!this.byCode.has(code)) return code;
    }
    throw new Error("[social] could not allocate a unique spotter code");
  }

  /**
   * Creates a player, or renames/returns the existing one when `id` is known.
   * Returning the bearer `token` requires proving ownership: omit `id`
   * entirely (fresh device — always creates, token returned once) or supply
   * both `id` and the matching `token` (rename / refresh — token echoed
   * back). An `id` with a wrong or missing token gets back the public
   * profile only, with no token and no rename applied — this is the gate
   * that stops anyone who merely knows your id (e.g. a friend, since ids
   * are visible in /friends and /activity) from acting as you.
   */
  register(
    name: string,
    id?: string,
    token?: string
  ): { ok: true; player: PlayerProfile; token?: string } | { ok: false; reason: string } {
    const clean = name.trim().slice(0, 24) || "Anonymous Spotter";

    if (id) {
      const existing = this.players.get(id);
      if (existing) {
        if (!token) {
          // No proof of ownership offered — hand back the public profile
          // only. Lets a stale/no-token client still see who it is without
          // being able to mutate anything or learn the secret token.
          return { ok: true, player: this.profile(existing) };
        }
        if (token !== existing.token) {
          return { ok: false, reason: "invalid token" };
        }
        if (existing.name !== clean) {
          existing.name = clean;
          this.persist();
        }
        return { ok: true, player: this.profile(existing), token: existing.token };
      }
      // id given but unknown (e.g. server data was reset): create fresh
      // under that id and issue a new token, same as first-run.
    }

    const record: PlayerRecord = {
      id: id ?? randomUUID(),
      name: clean,
      code: this.newCode(),
      token: randomUUID(),
      createdAt: Date.now(),
      catches: [],
      friendIds: [],
    };
    this.players.set(record.id, record);
    this.byCode.set(record.code, record.id);
    this.persist();
    return { ok: true, player: this.profile(record), token: record.token };
  }

  /** True when `token` is the bearer secret for `playerId`. */
  verifyToken(playerId: string, token: string | undefined): boolean {
    if (!token) return false;
    const player = this.players.get(playerId);
    return player !== undefined && player.token === token;
  }

  get(id: string): PlayerRecord | undefined {
    return this.players.get(id);
  }

  getByCode(code: string): PlayerRecord | undefined {
    const id = this.byCode.get(code.trim().toUpperCase());
    return id ? this.players.get(id) : undefined;
  }

  profile(p: PlayerRecord): PlayerProfile {
    return { id: p.id, name: p.name, code: p.code };
  }

  /**
   * Records a validated catch. Returns whether this player is the first ever
   * to catch this airframe. Idempotent on the client-side catch id.
   */
  recordCatch(playerId: string, entry: Omit<SharedCatch, "firstSpotter">): { firstSpotter: boolean } {
    const player = this.players.get(playerId);
    if (!player) return { firstSpotter: false };

    const already = player.catches.find((c) => c.id === entry.id);
    if (already) return { firstSpotter: already.firstSpotter };

    const hex = entry.hex.toLowerCase();
    const firstSpotter = !this.firstSpots.has(hex);
    if (firstSpotter) this.firstSpots.set(hex, playerId);

    player.catches.push({ ...entry, firstSpotter });
    // Keep the shared hangar bounded; the client keeps the full local history.
    if (player.catches.length > 500) player.catches.shift();
    this.persist();
    return { firstSpotter };
  }

  stats(player: PlayerRecord): PlayerStats {
    const catches = player.catches;
    const best = catches.reduce<string | null>(
      (acc, c) => (acc === null || rarityIndex(c.rarity) > rarityIndex(acc) ? c.rarity : acc),
      null
    );
    return {
      catches: catches.length,
      rarityScore: catches.reduce((sum, c) => sum + rarityPoints(c.rarity), 0),
      streak: streakDays(catches, Date.now()),
      badges: evaluateAchievements(catches).length,
      bestRarity: best as PlayerStats["bestRarity"],
      lastCatchAt: catches.length ? Math.max(...catches.map((c) => c.caughtAt)) : null,
      firstSpots: catches.filter((c) => c.firstSpotter).length,
    };
  }

  /** Mutual friendship — adding is symmetric, matching how players expect it. */
  addFriendByCode(playerId: string, code: string): { ok: true; friend: FriendSummary } | { ok: false; reason: string } {
    const player = this.players.get(playerId);
    if (!player) return { ok: false, reason: "unknown player" };
    const friend = this.getByCode(code);
    if (!friend) return { ok: false, reason: "no spotter with that code" };
    if (friend.id === player.id) return { ok: false, reason: "that's your own code" };

    if (!player.friendIds.includes(friend.id)) player.friendIds.push(friend.id);
    if (!friend.friendIds.includes(player.id)) friend.friendIds.push(player.id);
    this.persist();
    return { ok: true, friend: { ...this.profile(friend), stats: this.stats(friend) } };
  }

  removeFriend(playerId: string, friendId: string): void {
    const player = this.players.get(playerId);
    const friend = this.players.get(friendId);
    if (player) player.friendIds = player.friendIds.filter((f) => f !== friendId);
    if (friend) friend.friendIds = friend.friendIds.filter((f) => f !== playerId);
    this.persist();
  }

  friends(playerId: string): FriendSummary[] {
    const player = this.players.get(playerId);
    if (!player) return [];
    return player.friendIds
      .map((id) => this.players.get(id))
      .filter((p): p is PlayerRecord => Boolean(p))
      .map((p) => ({ ...this.profile(p), stats: this.stats(p) }))
      .sort((a, b) => b.stats.rarityScore - a.stats.rarityScore);
  }

  /** A friend's hangar — visible only to confirmed friends (or yourself). */
  hangarOf(viewerId: string, targetId: string): { ok: true; player: PlayerProfile; catches: SharedCatch[] } | { ok: false; reason: string } {
    const viewer = this.players.get(viewerId);
    const target = this.players.get(targetId);
    if (!viewer || !target) return { ok: false, reason: "unknown player" };
    if (viewer.id !== target.id && !viewer.friendIds.includes(target.id)) {
      return { ok: false, reason: "add them as a friend to see their hangar" };
    }
    return {
      ok: true,
      player: this.profile(target),
      catches: [...target.catches].sort((a, b) => b.caughtAt - a.caughtAt).slice(0, 100),
    };
  }

  /** Weekly leaderboard among you and your friends. */
  leaderboard(playerId: string, sinceMs: number): LeaderboardRow[] {
    const player = this.players.get(playerId);
    if (!player) return [];
    const pool = [player, ...player.friendIds.map((id) => this.players.get(id)).filter((p): p is PlayerRecord => Boolean(p))];
    return pool
      .map((p) => {
        const recent = p.catches.filter((c) => c.caughtAt >= sinceMs);
        return {
          ...this.profile(p),
          catches: recent.length,
          rarityScore: recent.reduce((sum, c) => sum + rarityPoints(c.rarity), 0),
          isYou: p.id === player.id,
        };
      })
      .sort((a, b) => b.rarityScore - a.rarityScore || b.catches - a.catches);
  }

  /** Recent notable catches by friends — the "Maya caught a Legendary" feed. */
  activity(playerId: string, limit = 20): ActivityItem[] {
    const player = this.players.get(playerId);
    if (!player) return [];
    const items: ActivityItem[] = [];
    for (const friendId of player.friendIds) {
      const friend = this.players.get(friendId);
      if (!friend) continue;
      for (const c of friend.catches) {
        if (c.firstSpotter || RARITY_ORDER.indexOf(c.rarity) >= RARITY_ORDER.indexOf("rare")) {
          items.push({ player: this.profile(friend), catch: c });
        }
      }
    }
    return items.sort((a, b) => b.catch.caughtAt - a.catch.caughtAt).slice(0, limit);
  }
}
