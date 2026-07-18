import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
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
  createdAt: number;
  catches: SharedCatch[];
  friendIds: string[];
}

interface Snapshot {
  players: PlayerRecord[];
  /** hex → player id who caught that airframe first, ever. */
  firstSpots: Record<string, string>;
}

export function rarityPoints(rarity: string): number {
  return (RARITY_ORDER.indexOf(rarity as never) + 1) ** 2;
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

  private persist(): void {
    mkdirSync(DATA_DIR, { recursive: true });
    const snap: Snapshot = {
      players: [...this.players.values()],
      firstSpots: Object.fromEntries(this.firstSpots),
    };
    writeFileSync(FILE, JSON.stringify(snap, null, 2));
  }

  private newCode(): string {
    for (let attempt = 0; attempt < 50; attempt++) {
      let code = "";
      for (let i = 0; i < 6; i++) {
        code += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)];
      }
      if (!this.byCode.has(code)) return code;
    }
    return randomUUID().slice(0, 6).toUpperCase();
  }

  /** Creates a player, or renames/returns the existing one when `id` is known. */
  register(name: string, id?: string): PlayerProfile {
    const clean = name.trim().slice(0, 24) || "Anonymous Spotter";
    if (id) {
      const existing = this.players.get(id);
      if (existing) {
        if (existing.name !== clean) {
          existing.name = clean;
          this.persist();
        }
        return { id: existing.id, name: existing.name, code: existing.code };
      }
    }
    const record: PlayerRecord = {
      id: id ?? randomUUID(),
      name: clean,
      code: this.newCode(),
      createdAt: Date.now(),
      catches: [],
      friendIds: [],
    };
    this.players.set(record.id, record);
    this.byCode.set(record.code, record.id);
    this.persist();
    return { id: record.id, name: record.name, code: record.code };
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
      (acc, c) => (acc === null || RARITY_ORDER.indexOf(c.rarity) > RARITY_ORDER.indexOf(acc as never) ? c.rarity : acc),
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
