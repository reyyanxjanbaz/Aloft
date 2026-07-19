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
  type Rarity,
  type SharedCatch,
} from "@aloft/shared";
import { sql } from "../db";

/** Ambiguous characters (0/O, 1/I) omitted — codes get read aloud and typed by hand. */
const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const UNIQUE_VIOLATION = "23505";

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

function randomCode(): string {
  return Array.from(
    { length: 6 },
    () => CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)]
  ).join("");
}

interface CatchRow {
  id: string;
  hex: string;
  callsign: string;
  reg: string | null;
  type_icao: string | null;
  type_label: string;
  rarity: string;
  caught_at: Date;
  alt_ft: number;
  distance_km: string; // numeric comes back as string from postgres.js
  first_spotter: boolean;
}

function rowToSharedCatch(r: CatchRow): SharedCatch {
  return {
    id: r.id,
    hex: r.hex,
    callsign: r.callsign,
    reg: r.reg ?? undefined,
    typeIcao: r.type_icao ?? undefined,
    typeLabel: r.type_label,
    rarity: r.rarity as Rarity,
    caughtAt: r.caught_at.getTime(),
    altFt: r.alt_ft,
    distanceKm: Number(r.distance_km),
    firstSpotter: r.first_spotter,
  };
}

/**
 * Postgres-backed social graph. Every operation is a query except token
 * verification, which is served from an in-memory cache — see verifyToken.
 */
export class SocialStore {
  /**
   * playerId → bearer token. Tokens are immutable once issued and this
   * service runs as a single instance, so this cache cannot go stale: the
   * only writer is register(), which updates it in the same call.
   */
  private tokens = new Map<string, string>();

  /** Loads every token into memory. Called at boot, once the DB is up. */
  async hydrateTokens(): Promise<void> {
    const rows = await sql<{ id: string; token: string }[]>`select id, token from players`;
    this.tokens = new Map(rows.map((r) => [r.id, r.token]));
    console.log(`[social] token cache hydrated with ${this.tokens.size} players`);
  }

  /**
   * True when `token` is the bearer secret for `playerId`.
   *
   * Synchronous on purpose: this is called from the synchronous
   * `socket.on("message")` callback in index.ts, where returning a promise
   * would put unhandled rejections on the WebSocket path.
   */
  verifyToken(playerId: string, token: string | undefined): boolean {
    if (!token) return false;
    return this.tokens.get(playerId) === token;
  }

  /** True when this player id exists. Synchronous, same cache. */
  knows(playerId: string): boolean {
    return this.tokens.has(playerId);
  }

  /**
   * Creates a player, or renames/returns the existing one when `id` is known.
   * Returning the bearer `token` requires proving ownership: omit `id`
   * entirely (fresh device — always creates, token returned once) or supply
   * both `id` and the matching `token` (rename / refresh — token echoed
   * back). An `id` with a wrong or missing token gets back the public
   * profile only, with no token and no rename applied — this is the gate
   * that stops anyone who merely knows your id (visible in /friends,
   * /activity) from acting as you.
   */
  async register(
    name: string,
    id?: string,
    token?: string
  ): Promise<{ ok: true; player: PlayerProfile; token?: string } | { ok: false; reason: string }> {
    const clean = name.trim().slice(0, 24) || "Anonymous Spotter";

    if (id) {
      const [existing] = await sql<{ id: string; name: string; code: string; token: string }[]>`
        select id, name, code, token from players where id = ${id}
      `;
      if (existing) {
        this.tokens.set(existing.id, existing.token);
        if (!token) {
          // No proof of ownership offered — hand back the public profile
          // only. Lets a stale/no-token client still see who it is without
          // being able to mutate anything or learn the secret token.
          return { ok: true, player: { id: existing.id, name: existing.name, code: existing.code } };
        }
        if (token !== existing.token) return { ok: false, reason: "invalid token" };
        if (existing.name !== clean) {
          await sql`update players set name = ${clean} where id = ${id}`;
        }
        return {
          ok: true,
          player: { id: existing.id, name: clean, code: existing.code },
          token: existing.token,
        };
      }
      // id given but unknown (e.g. the database was reset): create fresh
      // under that id and issue a new token, same as first-run.
    }

    for (let attempt = 0; attempt < 20; attempt++) {
      const code = attempt < 15 ? randomCode() : randomUUID().replace(/-/g, "").slice(0, 6).toUpperCase();
      try {
        const [created] = id
          ? await sql<{ id: string; name: string; code: string; token: string }[]>`
              insert into players (id, name, code) values (${id}, ${clean}, ${code})
              returning id, name, code, token
            `
          : await sql<{ id: string; name: string; code: string; token: string }[]>`
              insert into players (name, code) values (${clean}, ${code})
              returning id, name, code, token
            `;
        if (!created) continue;
        this.tokens.set(created.id, created.token);
        return {
          ok: true,
          player: { id: created.id, name: created.name, code: created.code },
          token: created.token,
        };
      } catch (err) {
        if ((err as { code?: string }).code === UNIQUE_VIOLATION) continue; // code collision — retry
        throw err;
      }
    }
    return { ok: false, reason: "could not allocate a unique spotter code" };
  }

  async getProfile(id: string): Promise<PlayerProfile | undefined> {
    const [row] = await sql<PlayerProfile[]>`select id, name, code from players where id = ${id}`;
    return row;
  }

  private async getByCode(code: string): Promise<PlayerProfile | undefined> {
    const [row] = await sql<PlayerProfile[]>`
      select id, name, code from players where code = ${code.trim().toUpperCase()}
    `;
    return row;
  }

  /**
   * Records a validated catch. Returns whether this player is the first ever
   * to catch this airframe. Idempotent on the client-side catch id; the
   * first-spotter flag is decided and enforced atomically in SQL so two
   * players catching the same brand-new-to-Aloft aircraft in the same instant
   * can't both win it.
   */
  async recordCatch(
    playerId: string,
    entry: Omit<SharedCatch, "firstSpotter">
  ): Promise<{ firstSpotter: boolean }> {
    const caughtAt = new Date(entry.caughtAt);
    const insertOnce = (firstSpotterExpr: ReturnType<typeof sql>) => sql<{ first_spotter: boolean }[]>`
      insert into catches (id, player_id, hex, callsign, reg, type_icao, type_label, rarity, caught_at, alt_ft, distance_km, first_spotter)
      values (${entry.id}, ${playerId}, ${entry.hex}, ${entry.callsign}, ${entry.reg ?? null}, ${entry.typeIcao ?? null},
              ${entry.typeLabel}, ${entry.rarity}, ${caughtAt}, ${entry.altFt}, ${entry.distanceKm}, ${firstSpotterExpr})
      on conflict (id) do nothing
      returning first_spotter
    `;

    try {
      const inserted = await insertOnce(
        sql`not exists (select 1 from catches where hex = ${entry.hex} and first_spotter)`
      );
      if (inserted[0]) return { firstSpotter: inserted[0].first_spotter };
      const [existing] = await sql<{ first_spotter: boolean }[]>`
        select first_spotter from catches where id = ${entry.id}
      `;
      return { firstSpotter: existing?.first_spotter ?? false };
    } catch (err) {
      const pgErr = err as { code?: string; constraint_name?: string };
      if (pgErr.code === UNIQUE_VIOLATION && pgErr.constraint_name === "catches_first_spotter_unique") {
        // Lost the first-spotter race to a concurrent catch of the same hex.
        await insertOnce(sql`false`);
        return { firstSpotter: false };
      }
      throw err;
    }
  }

  async stats(playerId: string): Promise<PlayerStats> {
    const rows = await sql<
      Array<{
        rarity: string;
        caught_at: Date;
        alt_ft: number;
        distance_km: string;
        type_icao: string | null;
        first_spotter: boolean;
      }>
    >`
      select rarity, caught_at, alt_ft, distance_km, type_icao, first_spotter
      from catches where player_id = ${playerId}
      order by caught_at desc limit 500
    `;
    const catchLikes = rows.map((r) => ({
      rarity: r.rarity as Rarity,
      caughtAt: r.caught_at.getTime(),
      altFt: r.alt_ft,
      distanceKm: Number(r.distance_km),
      typeIcao: r.type_icao ?? undefined,
    }));
    const best = rows.reduce<string | null>(
      (acc, r) => (acc === null || rarityIndex(r.rarity) > rarityIndex(acc) ? r.rarity : acc),
      null
    );
    return {
      catches: rows.length,
      rarityScore: rows.reduce((sum, r) => sum + rarityPoints(r.rarity), 0),
      streak: streakDays(catchLikes, Date.now()),
      badges: evaluateAchievements(catchLikes).length,
      bestRarity: best as PlayerStats["bestRarity"],
      lastCatchAt: rows.length ? Math.max(...rows.map((r) => r.caught_at.getTime())) : null,
      firstSpots: rows.filter((r) => r.first_spotter).length,
    };
  }

  /** Mutual friendship — adding is symmetric, matching how players expect it. */
  async addFriendByCode(
    playerId: string,
    code: string
  ): Promise<{ ok: true; friend: FriendSummary } | { ok: false; reason: string }> {
    const friend = await this.getByCode(code);
    if (!friend) return { ok: false, reason: "no spotter with that code" };
    if (friend.id === playerId) return { ok: false, reason: "that's your own code" };

    await sql.begin(async (tx) => {
      await tx`insert into friendships (player_id, friend_id) values (${playerId}, ${friend.id}) on conflict do nothing`;
      await tx`insert into friendships (player_id, friend_id) values (${friend.id}, ${playerId}) on conflict do nothing`;
    });
    return { ok: true, friend: { ...friend, stats: await this.stats(friend.id) } };
  }

  async removeFriend(playerId: string, friendId: string): Promise<void> {
    await sql.begin(async (tx) => {
      await tx`delete from friendships where player_id = ${playerId} and friend_id = ${friendId}`;
      await tx`delete from friendships where player_id = ${friendId} and friend_id = ${playerId}`;
    });
  }

  async friends(playerId: string): Promise<FriendSummary[]> {
    const rows = await sql<PlayerProfile[]>`
      select p.id, p.name, p.code from friendships f
      join players p on p.id = f.friend_id
      where f.player_id = ${playerId}
    `;
    const withStats = await Promise.all(rows.map(async (p) => ({ ...p, stats: await this.stats(p.id) })));
    return withStats.sort((a, b) => b.stats.rarityScore - a.stats.rarityScore);
  }

  /** A friend's hangar — visible only to confirmed friends (or yourself). */
  async hangarOf(
    viewerId: string,
    targetId: string
  ): Promise<{ ok: true; player: PlayerProfile; catches: SharedCatch[] } | { ok: false; reason: string }> {
    const target = await this.getProfile(targetId);
    if (!target) return { ok: false, reason: "unknown player" };
    if (viewerId !== targetId) {
      const [isFriend] = await sql`
        select 1 from friendships where player_id = ${viewerId} and friend_id = ${targetId}
      `;
      if (!isFriend) return { ok: false, reason: "add them as a friend to see their hangar" };
    }
    const rows = await sql<CatchRow[]>`
      select * from catches where player_id = ${targetId} order by caught_at desc limit 100
    `;
    return { ok: true, player: target, catches: rows.map(rowToSharedCatch) };
  }

  /** Weekly leaderboard among you and your friends. */
  async leaderboard(playerId: string, sinceMs: number): Promise<LeaderboardRow[]> {
    const pool = await sql<PlayerProfile[]>`
      select id, name, code from players where id = ${playerId}
      union
      select p.id, p.name, p.code from friendships f join players p on p.id = f.friend_id where f.player_id = ${playerId}
    `;
    const since = new Date(sinceMs);
    const rows = await Promise.all(
      pool.map(async (p) => {
        const recent = await sql<{ rarity: string }[]>`
          select rarity from catches where player_id = ${p.id} and caught_at >= ${since}
        `;
        return {
          ...p,
          catches: recent.length,
          rarityScore: recent.reduce((sum, r) => sum + rarityPoints(r.rarity), 0),
          isYou: p.id === playerId,
        };
      })
    );
    return rows.sort((a, b) => b.rarityScore - a.rarityScore || b.catches - a.catches);
  }

  /** Recent notable catches by friends — the "Maya caught a Legendary" feed. */
  async activity(playerId: string, limit = 20): Promise<ActivityItem[]> {
    const rows = await sql<Array<CatchRow & { player_id: string; player_name: string; player_code: string }>>`
      select c.*, p.id as player_id, p.name as player_name, p.code as player_code
      from friendships f
      join players p on p.id = f.friend_id
      join catches c on c.player_id = f.friend_id
      where f.player_id = ${playerId} and (c.first_spotter or c.rarity in ('rare','epic','legendary'))
      order by c.caught_at desc
      limit ${limit}
    `;
    return rows.map((r) => ({
      player: { id: r.player_id, name: r.player_name, code: r.player_code },
      catch: rowToSharedCatch(r),
    }));
  }
}
