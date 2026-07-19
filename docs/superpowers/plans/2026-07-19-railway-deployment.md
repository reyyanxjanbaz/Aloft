# Aloft on Railway Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move Aloft's durable state from ephemeral JSON files to Supabase Postgres so the restored Fastify service can run on Railway without losing data on every deploy.

**Architecture:** The PWA stays on Vercel (static, CDN). `apps/sky` runs on Railway as a single always-on Fastify instance keeping live plane state and position-fix history in memory and fanning out over WebSocket. Supabase Postgres holds players, catches, friendships, and push subscriptions. Keeping the database off Railway makes the host disposable.

**Tech Stack:** Fastify 5, `@fastify/websocket`, `postgres.js` (Supavisor pooler), Supabase Postgres, vitest, Railway, Vercel.

**Spec:** `docs/superpowers/specs/2026-07-19-railway-deployment-design.md`

## Global Constraints

- **Single instance only.** `SkyHub` holds live plane state in memory. Never configure more than one Railway replica.
- **Connect through the Supavisor pooler**, never the direct Supabase URL. The direct endpoint is IPv6-only. On transaction-pooling mode `postgres.js` must be constructed with `prepare: false` or prepared statements fail at runtime.
- **`verifyToken` stays synchronous.** It is called from a sync `socket.on("message")` callback in `index.ts`. Backed by an in-memory `playerId → token` map. Never make it async.
- **Never run `vercel deploy` from this tree.** The Vercel project's Root Directory is `.` and this commit has no `api/` or `vercel.json`; deploying would replace the working serverless build with a broken one.
- **Radar must survive a database outage.** Radar, hunting, and catch *validation* depend on the hub, not Postgres. Only social/push routes may degrade.
- Node 20+. The repo is npm workspaces; `apps/sky` runs TypeScript directly via `tsx`, so there is no build step.
- Existing 31 tests in `packages/shared` must stay green throughout.

---

### Task 1: Schema and apply script

**Files:**
- Modify: `supabase/schema.sql` (replace whole file)
- Create: `scripts/apply-schema.mjs`
- Modify: `package.json` (add `db:schema` script)

**Interfaces:**
- Consumes: nothing
- Produces: tables `players(id, token, name, code, created_at)`, `catches(id, player_id, hex, callsign, reg, type_icao, type_label, rarity, caught_at, alt_ft, distance_km, first_spotter)`, `friendships(player_id, friend_id, created_at)`, `push_subscriptions(endpoint, player_id, keys, lat, lon, radius_km, last_ping_at, pinged_hexes, created_at)`; unique index `catches_first_spotter_unique`.

The current `supabase/schema.sql` predates the security pass: it has no `token` column, references `auth.users` (un-appliable without Supabase Auth), and requires `postgis` (unused — distance math lives in `packages/shared/src/geo.ts`). Replace it.

- [ ] **Step 1: Replace `supabase/schema.sql`**

```sql
-- Aloft — Supabase/Postgres schema.
--
-- Durable state for the always-on Fastify service in apps/sky. Live plane
-- state and position-fix history are deliberately NOT here — they live in
-- memory in SkyHub, which is why the service runs as a single instance.
--
-- Apply with:  npm run db:schema

-- ── Players ────────────────────────────────────────────────────────────
create table if not exists players (
  id          uuid primary key default gen_random_uuid(),
  -- Bearer secret proving control of this identity — required (as
  -- x-player-token) for every mutating request. Pre-auth by design; a real
  -- `auth_id` column can be added later without touching this one.
  token       uuid not null default gen_random_uuid(),
  name        text not null check (char_length(name) between 1 and 24),
  code        text not null unique check (code ~ '^[A-Z2-9]{6}$'),
  created_at  timestamptz not null default now()
);

-- ── Catches ────────────────────────────────────────────────────────────
create table if not exists catches (
  id            text primary key,              -- hex:callsign:yyyymmdd
  player_id     uuid not null references players (id) on delete cascade,
  hex           text not null,
  callsign      text not null default '',
  reg           text,
  type_icao     text,
  type_label    text not null,
  rarity        text not null check (rarity in ('common','uncommon','rare','epic','legendary')),
  caught_at     timestamptz not null,
  alt_ft        int not null default 0,
  distance_km   numeric(6,1) not null default 0,
  first_spotter boolean not null default false
);

create index if not exists catches_player_time on catches (player_id, caught_at desc);
create index if not exists catches_hex on catches (hex);

-- First-ever catch of an airframe wins "First Spotter" — enforced globally
-- and atomically. The INSERT ... NOT EXISTS pattern in social/store.ts
-- relies on this index to make the race safe.
create unique index if not exists catches_first_spotter_unique
  on catches (hex) where first_spotter;

-- ── Friendships (symmetric; one row per direction) ─────────────────────
create table if not exists friendships (
  player_id  uuid not null references players (id) on delete cascade,
  friend_id  uuid not null references players (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (player_id, friend_id),
  check (player_id <> friend_id)
);

-- ── Push subscriptions (sky alerts) ────────────────────────────────────
create table if not exists push_subscriptions (
  endpoint      text primary key,
  player_id     uuid references players (id) on delete cascade,
  keys          jsonb not null,
  lat           double precision not null,
  lon           double precision not null,
  radius_km     int not null default 15,
  last_ping_at  timestamptz,
  -- hex → last-pinged timestamp, so the same airframe isn't announced twice.
  pinged_hexes  jsonb not null default '{}'::jsonb,
  created_at    timestamptz not null default now()
);
```

- [ ] **Step 2: Create `scripts/apply-schema.mjs`**

```js
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import postgres from "postgres";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL is not set. Export the Supavisor pooler URI first.");
  process.exit(1);
}

const sql = postgres(url, { prepare: false, max: 1 });
try {
  await sql.unsafe(readFileSync(join(root, "supabase/schema.sql"), "utf8"));
  console.log("schema applied");
} finally {
  await sql.end();
}
```

- [ ] **Step 3: Add the script and dependency to the root `package.json`**

Add to `"scripts"`:

```json
"db:schema": "node scripts/apply-schema.mjs"
```

Then install the driver at the root so both the script and `apps/sky` resolve it:

```bash
npm install postgres --workspace apps/sky
npm install postgres
```

- [ ] **Step 4: Apply against Supabase and verify**

```bash
export DATABASE_URL='<Supavisor pooler URI from Supabase → Settings → Database → Connection pooling>'
npm run db:schema
```

Expected: `schema applied`

Verify the tables and the critical index exist:

```bash
node -e "
import('postgres').then(async ({default:pg})=>{
  const sql=pg(process.env.DATABASE_URL,{prepare:false,max:1});
  console.log(await sql\`select tablename from pg_tables where schemaname='public' order by tablename\`);
  console.log(await sql\`select indexname from pg_indexes where indexname='catches_first_spotter_unique'\`);
  await sql.end();
});"
```

Expected: `catches`, `friendships`, `players`, `push_subscriptions`, and one row for `catches_first_spotter_unique`.

- [ ] **Step 5: Commit**

```bash
git add supabase/schema.sql scripts/apply-schema.mjs package.json package-lock.json
git commit -m "Add standalone Postgres schema and apply script"
```

---

### Task 2: Database connection module and test harness

**Files:**
- Create: `apps/sky/src/db.ts`
- Create: `apps/sky/vitest.config.ts`
- Create: `apps/sky/src/testing/db.ts`
- Modify: `apps/sky/package.json`

**Interfaces:**
- Consumes: `DATABASE_URL` env var
- Produces: `sql` (a `postgres.js` instance), `waitForDb(): Promise<void>`, `dbReady(): boolean`; test helper `withCleanDb(fn)` and `describeIfDb` from `src/testing/db.ts`

- [ ] **Step 1: Create `apps/sky/src/db.ts`**

`prepare: false` is mandatory — see Global Constraints.

```ts
import postgres from "postgres";

const url = process.env.DATABASE_URL;
if (!url) throw new Error("[db] DATABASE_URL is not set");

/**
 * Supavisor (Supabase's pooler) runs in transaction mode, where prepared
 * statements are not safe across pooled connections — postgres.js must be
 * told not to use them. The direct Supabase endpoint is IPv6-only, so the
 * pooler URI is the only one that works from Railway.
 */
export const sql = postgres(url, { prepare: false, max: 5, idle_timeout: 20 });

let ready = false;
export function dbReady(): boolean {
  return ready;
}

/**
 * Blocks until Postgres answers, retrying with backoff. Callers boot the
 * HTTP server first and await this in the background, so radar keeps
 * working through a database outage.
 */
export async function waitForDb(): Promise<void> {
  let delayMs = 500;
  for (;;) {
    try {
      await sql`select 1`;
      ready = true;
      console.log("[db] connected");
      return;
    } catch (err) {
      ready = false;
      console.warn(`[db] not reachable, retrying in ${delayMs}ms:`, (err as Error).message);
      await new Promise((r) => setTimeout(r, delayMs));
      delayMs = Math.min(delayMs * 2, 30_000);
    }
  }
}
```

- [ ] **Step 2: Create `apps/sky/vitest.config.ts`**

```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Postgres-backed tests share one database; parallel files would race on
    // the truncate in withCleanDb.
    fileParallelism: false,
    testTimeout: 20_000,
  },
});
```

- [ ] **Step 3: Create `apps/sky/src/testing/db.ts`**

Tests need a real Postgres. They skip cleanly when `DATABASE_URL` is absent so the suite still runs on a fresh clone.

```ts
import { describe } from "vitest";
import { sql } from "../db";

/** Postgres-backed suites skip when no database is configured. */
export const describeIfDb = process.env.DATABASE_URL ? describe : describe.skip;

/** Empties every table, runs the test body. `players` cascades to the rest. */
export async function withCleanDb(fn: () => Promise<void>): Promise<void> {
  await sql`truncate players, catches, friendships, push_subscriptions cascade`;
  await fn();
}
```

- [ ] **Step 4: Add test scripts to `apps/sky/package.json`**

Add to `"scripts"`:

```json
"test": "vitest run",
"typecheck": "tsc --noEmit"
```

Add to `"devDependencies"`:

```json
"vitest": "^3.2.7"
```

Then:

```bash
npm install
```

- [ ] **Step 5: Verify the harness connects**

Create `apps/sky/src/db.test.ts`:

```ts
import { expect, it } from "vitest";
import { sql } from "./db";
import { describeIfDb } from "./testing/db";

describeIfDb("db", () => {
  it("answers a trivial query", async () => {
    const [row] = await sql<{ n: number }[]>`select 1 as n`;
    expect(row?.n).toBe(1);
  });
});
```

Run: `DATABASE_URL=$DATABASE_URL npm test --workspace apps/sky`
Expected: PASS, 1 test.

- [ ] **Step 6: Commit**

```bash
git add apps/sky/src/db.ts apps/sky/src/db.test.ts apps/sky/src/testing/db.ts apps/sky/vitest.config.ts apps/sky/package.json package-lock.json
git commit -m "Add pooled Postgres connection and test harness to the sky service"
```

---

### Task 3: Move SocialStore onto Postgres

**Files:**
- Modify: `apps/sky/src/social/store.ts` (replace internals; keep the class and `rarityPoints` export)
- Create: `apps/sky/src/social/store.test.ts`

**Interfaces:**
- Consumes: `sql` from `../db`
- Produces: class `SocialStore` with
  - `hydrateTokens(): Promise<void>`
  - `verifyToken(playerId: string, token: string | undefined): boolean` — **synchronous**
  - `knows(playerId: string): boolean` — synchronous, true when the id is in the token cache
  - `register(name: string, id?: string, token?: string): Promise<{ok:true; player:PlayerProfile; token?:string} | {ok:false; reason:string}>`
  - `getProfile(id: string): Promise<PlayerProfile | undefined>`
  - `stats(playerId: string): Promise<PlayerStats>`
  - `recordCatch(playerId: string, entry: Omit<SharedCatch,"firstSpotter">): Promise<{firstSpotter: boolean}>`
  - `addFriendByCode(playerId: string, code: string): Promise<{ok:true; friend:FriendSummary} | {ok:false; reason:string}>`
  - `removeFriend(playerId: string, friendId: string): Promise<void>`
  - `friends(playerId: string): Promise<FriendSummary[]>`
  - `hangarOf(viewerId: string, targetId: string): Promise<{ok:true; player:PlayerProfile; catches:SharedCatch[]} | {ok:false; reason:string}>`
  - `leaderboard(playerId: string, sinceMs: number): Promise<LeaderboardRow[]>`
  - `activity(playerId: string, limit?: number): Promise<ActivityItem[]>`
  - `rarityPoints(rarity: string): number` (module-level export, unchanged)

The old `get()`/`profile()` pair is gone: `get` returned a `PlayerRecord` carrying the player's whole catch array, which does not exist as a row. Callers use `getProfile` + `stats` instead.

- [ ] **Step 1: Write the failing tests**

Create `apps/sky/src/social/store.test.ts`:

```ts
import { beforeEach, expect, it } from "vitest";
import { SocialStore } from "./store";
import { describeIfDb, withCleanDb } from "../testing/db";

function catchEntry(over: Partial<Parameters<SocialStore["recordCatch"]>[1]> = {}) {
  return {
    id: "abc123:BAW1:20260719",
    hex: "abc123",
    callsign: "BAW1",
    reg: "G-EUUU",
    typeIcao: "A320",
    typeLabel: "Airbus A320",
    rarity: "common" as const,
    caughtAt: Date.now(),
    altFt: 30_000,
    distanceKm: 4.2,
    ...over,
  };
}

describeIfDb("SocialStore", () => {
  let store: SocialStore;
  beforeEach(() => {
    store = new SocialStore();
  });

  it("issues a token on registration and verifies it synchronously", async () => {
    await withCleanDb(async () => {
      const res = await store.register("Reyyan");
      if (!res.ok) throw new Error(res.reason);
      expect(res.token).toBeTruthy();
      // Synchronous by design — called from the WebSocket message callback.
      expect(store.verifyToken(res.player.id, res.token)).toBe(true);
      expect(store.verifyToken(res.player.id, "wrong-token")).toBe(false);
      expect(store.verifyToken(res.player.id, undefined)).toBe(false);
    });
  });

  it("withholds the token when an id is supplied without proof of ownership", async () => {
    await withCleanDb(async () => {
      const first = await store.register("Reyyan");
      if (!first.ok) throw new Error(first.reason);
      const impostor = await store.register("Hacker", first.player.id);
      if (!impostor.ok) throw new Error("expected the public profile");
      expect(impostor.token).toBeUndefined();
      // The rename must not have been applied.
      expect(impostor.player.name).toBe("Reyyan");
    });
  });

  it("rebuilds the token cache from Postgres on hydrate", async () => {
    await withCleanDb(async () => {
      const res = await store.register("Reyyan");
      if (!res.ok) throw new Error(res.reason);
      // A fresh instance, as after a Railway restart.
      const restarted = new SocialStore();
      expect(restarted.verifyToken(res.player.id, res.token)).toBe(false);
      await restarted.hydrateTokens();
      expect(restarted.verifyToken(res.player.id, res.token)).toBe(true);
    });
  });

  it("awards first spotter once, to exactly one of two concurrent catchers", async () => {
    await withCleanDb(async () => {
      const a = await store.register("A");
      const b = await store.register("B");
      if (!a.ok || !b.ok) throw new Error("registration failed");

      const [ra, rb] = await Promise.all([
        store.recordCatch(a.player.id, catchEntry({ id: "abc123:BAW1:20260719" })),
        store.recordCatch(b.player.id, catchEntry({ id: "abc123:BAW2:20260719" })),
      ]);
      expect([ra.firstSpotter, rb.firstSpotter].filter(Boolean)).toHaveLength(1);
    });
  });

  it("is idempotent on the client-side catch id", async () => {
    await withCleanDb(async () => {
      const p = await store.register("A");
      if (!p.ok) throw new Error("registration failed");
      const first = await store.recordCatch(p.player.id, catchEntry());
      const again = await store.recordCatch(p.player.id, catchEntry());
      expect(first.firstSpotter).toBe(true);
      expect(again.firstSpotter).toBe(true);
      const s = await store.stats(p.player.id);
      expect(s.catches).toBe(1);
    });
  });

  it("keeps hangars private until friendship is mutual", async () => {
    await withCleanDb(async () => {
      const a = await store.register("A");
      const b = await store.register("B");
      if (!a.ok || !b.ok) throw new Error("registration failed");
      await store.recordCatch(b.player.id, catchEntry());

      const denied = await store.hangarOf(a.player.id, b.player.id);
      expect(denied.ok).toBe(false);

      await store.addFriendByCode(a.player.id, b.player.code);
      const allowed = await store.hangarOf(a.player.id, b.player.id);
      expect(allowed.ok).toBe(true);
      // Friendship is symmetric — B can see A too.
      const reverse = await store.hangarOf(b.player.id, a.player.id);
      expect(reverse.ok).toBe(true);
    });
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `DATABASE_URL=$DATABASE_URL npm test --workspace apps/sky`
Expected: FAIL — `store.hydrateTokens is not a function` and `store.register(...)` returning a non-promise.

- [ ] **Step 3: Replace `apps/sky/src/social/store.ts`**

The query bodies port from `api/_lib/social.ts` on the `vercel-serverless` tag (`git show vercel-serverless:api/_lib/social.ts`), reshaped into the class the routes already consume, plus the synchronous token cache.

```ts
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

  /** Loads every token into memory. Called at boot, after the DB is up. */
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
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `DATABASE_URL=$DATABASE_URL npm test --workspace apps/sky`
Expected: PASS, 7 tests (6 store + 1 db).

Note: `apps/sky` will not typecheck yet — `index.ts` and `routes.ts` still call the removed `get()`/`profile()`. Task 5 fixes that.

- [ ] **Step 5: Commit**

```bash
git add apps/sky/src/social/store.ts apps/sky/src/social/store.test.ts
git commit -m "Back SocialStore with Postgres, keeping token checks in memory"
```

---

### Task 4: Move PushStore onto Postgres

**Files:**
- Modify: `apps/sky/src/push/store.ts` (replace whole file)
- Modify: `apps/sky/src/push/geofence.ts:42,72-74`
- Create: `apps/sky/src/push/store.test.ts`

**Interfaces:**
- Consumes: `sql` from `../db`
- Produces: class `PushStore` with
  - `upsert(sub: {subscription: PushSubscription; lat: number; lon: number; radiusKm: number}): Promise<void>`
  - `remove(endpoint: string): Promise<void>`
  - `all(): Promise<StoredSub[]>`
  - `count(): Promise<number>`
  - `markPinged(endpoint: string, hex: string, at: number): Promise<void>`
  - interface `StoredSub` (unchanged shape: `subscription`, `lat`, `lon`, `radiusKm`, `lastPingAt`, `pingedHexes`)

`size` (a synchronous getter) becomes `count()`, and the `persist()` call in the geofence becomes `markPinged()`. The geofence currently mutates `sub.lastPingAt` and `sub.pingedHexes` in place and then persists the whole store; against Postgres that in-place mutation would write nothing, so the update must be explicit.

- [ ] **Step 1: Write the failing tests**

Create `apps/sky/src/push/store.test.ts`:

```ts
import { beforeEach, expect, it } from "vitest";
import { PushStore } from "./store";
import { describeIfDb, withCleanDb } from "../testing/db";

const sub = {
  subscription: {
    endpoint: "https://push.example.com/abc",
    keys: { p256dh: "p256dh-key", auth: "auth-key" },
  },
  lat: 51.47,
  lon: -0.45,
  radiusKm: 15,
};

describeIfDb("PushStore", () => {
  let store: PushStore;
  beforeEach(() => {
    store = new PushStore();
  });

  it("stores a subscription and reads it back", async () => {
    await withCleanDb(async () => {
      await store.upsert(sub);
      const all = await store.all();
      expect(all).toHaveLength(1);
      expect(all[0]?.subscription.endpoint).toBe(sub.subscription.endpoint);
      expect(all[0]?.subscription.keys.auth).toBe("auth-key");
      expect(all[0]?.lastPingAt).toBe(0);
      expect(all[0]?.pingedHexes).toEqual({});
      expect(await store.count()).toBe(1);
    });
  });

  it("preserves ping history when a subscription is re-upserted", async () => {
    await withCleanDb(async () => {
      await store.upsert(sub);
      await store.markPinged(sub.subscription.endpoint, "abc123", 1_700_000_000_000);
      // The client re-subscribes from a new location.
      await store.upsert({ ...sub, lat: 40.6, lon: -73.8 });

      const [row] = await store.all();
      expect(row?.lat).toBe(40.6);
      expect(row?.lastPingAt).toBe(1_700_000_000_000);
      expect(row?.pingedHexes).toEqual({ abc123: 1_700_000_000_000 });
    });
  });

  it("removes a dead subscription", async () => {
    await withCleanDb(async () => {
      await store.upsert(sub);
      await store.remove(sub.subscription.endpoint);
      expect(await store.count()).toBe(0);
    });
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `DATABASE_URL=$DATABASE_URL npm test --workspace apps/sky -- store.test`
Expected: FAIL — `store.count is not a function`, `store.markPinged is not a function`.

- [ ] **Step 3: Replace `apps/sky/src/push/store.ts`**

```ts
import type { PushSubscription } from "web-push";
import { sql } from "../db";

export interface StoredSub {
  subscription: PushSubscription;
  lat: number;
  lon: number;
  radiusKm: number;
  /** Last time we pinged this subscriber (ping-budget cooldown). */
  lastPingAt: number;
  /** hex → last ping ts, so the same airframe isn't announced twice. */
  pingedHexes: Record<string, number>;
}

interface SubRow {
  endpoint: string;
  keys: PushSubscription["keys"];
  lat: number;
  lon: number;
  radius_km: number;
  last_ping_at: Date | null;
  pinged_hexes: Record<string, number>;
}

function rowToStoredSub(r: SubRow): StoredSub {
  return {
    subscription: { endpoint: r.endpoint, keys: r.keys } as PushSubscription,
    lat: r.lat,
    lon: r.lon,
    radiusKm: r.radius_km,
    lastPingAt: r.last_ping_at ? r.last_ping_at.getTime() : 0,
    pingedHexes: r.pinged_hexes ?? {},
  };
}

/** Postgres-backed push subscription store. */
export class PushStore {
  /**
   * Upserting must not clear ping history — a client re-subscribing from a
   * new location would otherwise reset its cooldown and get spammed.
   */
  async upsert(sub: Omit<StoredSub, "lastPingAt" | "pingedHexes">): Promise<void> {
    await sql`
      insert into push_subscriptions (endpoint, keys, lat, lon, radius_km)
      values (${sub.subscription.endpoint}, ${sql.json(sub.subscription.keys as never)},
              ${sub.lat}, ${sub.lon}, ${Math.round(sub.radiusKm)})
      on conflict (endpoint) do update
        set keys = excluded.keys, lat = excluded.lat, lon = excluded.lon, radius_km = excluded.radius_km
    `;
  }

  async remove(endpoint: string): Promise<void> {
    await sql`delete from push_subscriptions where endpoint = ${endpoint}`;
  }

  async all(): Promise<StoredSub[]> {
    const rows = await sql<SubRow[]>`
      select endpoint, keys, lat, lon, radius_km, last_ping_at, pinged_hexes from push_subscriptions
    `;
    return rows.map(rowToStoredSub);
  }

  async count(): Promise<number> {
    const [row] = await sql<{ n: string }[]>`select count(*) as n from push_subscriptions`;
    return Number(row?.n ?? 0);
  }

  /**
   * Spends the cooldown and dedupe budget for one delivered ping. Called
   * only after the push actually goes out, so a transient send failure
   * doesn't silently cost the player their next eligible window.
   */
  async markPinged(endpoint: string, hex: string, at: number): Promise<void> {
    await sql`
      update push_subscriptions
      set last_ping_at = ${new Date(at)},
          pinged_hexes = pinged_hexes || ${sql.json({ [hex]: at })}
      where endpoint = ${endpoint}
    `;
  }
}
```

- [ ] **Step 4: Update the geofence to match**

In `apps/sky/src/push/geofence.ts`, change line 42 from:

```ts
    for (const sub of store.all()) {
```

to:

```ts
    for (const sub of await store.all()) {
```

and replace the success block (lines 72-74) from:

```ts
          sub.lastPingAt = now;
          sub.pingedHexes[best.hex] = now;
          store.persist();
```

to:

```ts
          await store.markPinged(sub.subscription.endpoint, best.hex, now);
```

Then change the `store.remove(...)` call on line 78 to `await store.remove(...)`.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `DATABASE_URL=$DATABASE_URL npm test --workspace apps/sky`
Expected: PASS, 10 tests.

- [ ] **Step 6: Commit**

```bash
git add apps/sky/src/push/store.ts apps/sky/src/push/store.test.ts apps/sky/src/push/geofence.ts
git commit -m "Back PushStore with Postgres and make ping accounting explicit"
```

---

### Task 5: Wire the service to the new stores

**Files:**
- Modify: `apps/sky/src/index.ts`
- Modify: `apps/sky/src/social/routes.ts:33,46,51-56,63,70,77,83,90,96`

**Interfaces:**
- Consumes: `SocialStore` and `PushStore` from Tasks 3 and 4, `waitForDb`/`dbReady` from Task 2
- Produces: a service that boots and serves radar before Postgres is reachable

Every handler in `routes.ts` is already `async`, so these are mechanical `await`s. `verifyToken` is unchanged — that is the whole point of the token cache.

- [ ] **Step 1: Update `apps/sky/src/social/routes.ts`**

`requireAuth` stays synchronous (line 33 unchanged). Replace the six handler bodies:

```ts
  app.post<{ Body: { name?: string; id?: string; token?: string } }>(
    "/player/register",
    async (req, reply) => {
      const { name, id, token } = req.body ?? {};
      if (typeof name !== "string") return reply.code(400).send({ ok: false, reason: "expected {name}" });
      const result = await social.register(name, id, token);
      return reply.code(result.ok ? 200 : 401).send(result);
    }
  );

  app.get("/player/me", async (req, reply) => {
    const id = playerId(req.headers as never);
    const player = id ? await social.getProfile(id) : undefined;
    if (!player) return reply.code(404).send({ ok: false, reason: "unknown player" });
    return { ok: true, player, stats: await social.stats(player.id) };
  });

  app.post<{ Body: { code?: string } }>("/friends/add", async (req, reply) => {
    const id = requireAuth(req, reply, social);
    if (!id) return;
    const code = req.body?.code;
    if (typeof code !== "string") return reply.code(400).send({ ok: false, reason: "expected {code}" });
    const result = await social.addFriendByCode(id, code);
    return reply.code(result.ok ? 200 : 422).send(result);
  });

  app.post<{ Body: { friendId?: string } }>("/friends/remove", async (req, reply) => {
    const id = requireAuth(req, reply, social);
    if (!id) return;
    if (req.body?.friendId) await social.removeFriend(id, req.body.friendId);
    return { ok: true };
  });

  app.get("/friends", async (req, reply) => {
    const id = playerId(req.headers as never);
    if (!id) return reply.code(401).send({ ok: false, reason: "missing x-player-id" });
    return { ok: true, friends: await social.friends(id) };
  });

  app.get<{ Params: { targetId: string } }>("/player/:targetId/hangar", async (req, reply) => {
    const id = playerId(req.headers as never);
    if (!id) return reply.code(401).send({ ok: false, reason: "missing x-player-id" });
    const result = await social.hangarOf(id, req.params.targetId);
    return reply.code(result.ok ? 200 : 403).send(result);
  });

  app.get("/leaderboard", async (req, reply) => {
    const id = playerId(req.headers as never);
    if (!id) return reply.code(401).send({ ok: false, reason: "missing x-player-id" });
    return { ok: true, rows: await social.leaderboard(id, Date.now() - WEEK_MS) };
  });

  app.get("/activity", async (req, reply) => {
    const id = playerId(req.headers as never);
    if (!id) return reply.code(401).send({ ok: false, reason: "missing x-player-id" });
    return { ok: true, items: await social.activity(id) };
  });
```

- [ ] **Step 2: Update `apps/sky/src/index.ts`**

Add the import near the other local imports:

```ts
import { dbReady, sql, waitForDb } from "./db";
```

Replace the `/health` route so it no longer reads a synchronous `size`:

```ts
app.get("/health", async () => ({
  ok: true,
  ...hub.stats,
  db: dbReady() ? "up" : "down",
  pushSubs: dbReady() ? await pushStore.count() : null,
}));
```

Make the push subscribe/unsubscribe handlers await their store calls — change `pushStore.upsert({...})` to `await pushStore.upsert({...})` and `pushStore.remove(req.body.endpoint)` to `await pushStore.remove(req.body.endpoint)`.

In the `/catch` handler, the `social.get(playerId)` existence check becomes the synchronous `knows`, and `recordCatch` is awaited:

```ts
  // Record it against the player so friends' hangars and first-spotter work.
  if (playerId && social.knows(playerId)) {
    const ac = result.catch.aircraft;
    const day = new Date(result.catch.caughtAt).toISOString().slice(0, 10).replaceAll("-", "");
    const catchId = `${ac.hex}:${ac.callsign || "----"}:${day}`;
    const { firstSpotter } = await social.recordCatch(
      playerId,
      toSharedCatch(catchId, ac, typeName(ac.typeIcao), result.catch.rarity, result.catch.caughtAt, result.catch.distanceKm)
    );
    return reply.send({ ...result, firstSpotter });
  }
  return reply.send(result);
```

Replace the `listen` call so the server accepts traffic before Postgres is confirmed, then hydrates in the background:

```ts
await app.listen({ port: PORT, host: "0.0.0.0" });
console.log(`[sky] aloft-sky listening on :${PORT}`);

// Radar and catch validation depend on the hub, not the database, so the
// service serves traffic immediately and connects to Postgres behind it.
// Social routes return their own errors until the token cache is hydrated.
void (async () => {
  await waitForDb();
  await social.hydrateTokens();
})();
```

Replace the shutdown handler — there are no debounced file writes left to flush, but the pool must close:

```ts
async function shutdown(signal: string): Promise<void> {
  console.log(`[sky] ${signal} received, closing`);
  await app.close();
  await sql.end({ timeout: 5 });
  process.exit(0);
}
process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));
```

- [ ] **Step 3: Return 503 from database-dependent routes while Postgres is down**

Without this, a database outage surfaces as an unhandled `postgres.js` rejection and Fastify returns a bare 500. Add this hook in `index.ts`, immediately after the `websocket` plugin registration and **before** any route is declared:

```ts
/**
 * Radar, hunting and catch *validation* run off the hub and must keep
 * working through a database outage; only the routes that actually read or
 * write Postgres degrade. /catch is deliberately absent — validation still
 * succeeds, and attribution is already gated behind social.knows(), which
 * is false until the token cache hydrates.
 */
const DB_ROUTES = ["/player", "/friends", "/leaderboard", "/activity", "/push/subscribe", "/push/unsubscribe"];
app.addHook("onRequest", async (req, reply) => {
  if (dbReady()) return;
  if (DB_ROUTES.some((prefix) => req.url.startsWith(prefix))) {
    return reply.code(503).send({ ok: false, reason: "database unavailable — try again shortly" });
  }
});
```

- [ ] **Step 4: Typecheck**

Run: `npm run typecheck --workspace apps/sky`
Expected: no output (exit 0). If it reports `Property 'get' does not exist on type 'SocialStore'`, a caller of the removed `get()`/`profile()`/`flush()` was missed.

- [ ] **Step 5: Verify the degraded path**

Start the service pointed at a database that does not exist:

```bash
DATABASE_URL='postgres://nobody:nobody@127.0.0.1:1/none' npm run dev --workspace apps/sky
```

Expected: the service still starts and logs `[db] not reachable, retrying in 500ms`, then keeps retrying with growing backoff.

```bash
curl -s -o /dev/null -w '%{http_code}\n' 'localhost:8787/planes?lat=51.47&lon=-0.45&radiusKm=15'
curl -s -o /dev/null -w '%{http_code}\n' localhost:8787/friends -H 'x-player-id: anything'
```

Expected: `200` for `/planes` (radar unaffected) and `503` for `/friends`. Stop the service and continue with the real `DATABASE_URL`.

- [ ] **Step 6: Run the service end to end locally**

```bash
DATABASE_URL=$DATABASE_URL npm run dev --workspace apps/sky
```

In a second terminal:

```bash
curl -s localhost:8787/health
```

Expected: `{"ok":true,...,"db":"up","pushSubs":0}`

```bash
curl -s -XPOST localhost:8787/player/register -H 'content-type: application/json' -d '{"name":"Test Spotter"}'
```

Expected: `{"ok":true,"player":{"id":"...","name":"Test Spotter","code":"XXXXXX"},"token":"..."}`

Confirm the impersonation gate still holds — re-register with the id but no token:

```bash
curl -s -XPOST localhost:8787/player/register -H 'content-type: application/json' -d '{"name":"Impostor","id":"<id from above>"}'
```

Expected: the original name back, and **no `token` field**.

- [ ] **Step 7: Commit**

```bash
git add apps/sky/src/index.ts apps/sky/src/social/routes.ts
git commit -m "Wire the sky service to the Postgres-backed stores"
```

---

### Task 6: Validate catches after a restart

**Files:**
- Modify: `apps/sky/src/hub.ts` (`validateCatch`)
- Modify: `apps/sky/src/index.ts` (`/catch` handler — await `validateCatch`)

**Interfaces:**
- Consumes: `SkyHub`'s existing `history` map and cell polling
- Produces: `validateCatch(hex, lat, lon, ts, playerId?): Promise<ValidatedCatch | {ok:false; reason:string}>` — same result shape, now async

Every deploy starts a fresh instance with an empty position-fix history, so for the first poll cycle after a restart `/catch` rejects every submission as unverifiable. Deploys are routine, so this window is worth closing.

- [ ] **Step 1: Write the failing test**

Create `apps/sky/src/hub.test.ts`:

```ts
import { expect, it, describe } from "vitest";
import { SkyHub } from "./hub";
import type { AircraftState } from "@aloft/shared";
import type { FlightProvider } from "./providers/types";

function aircraftAt(lat: number, lon: number): AircraftState {
  return {
    hex: "abc123",
    callsign: "BAW1",
    lat,
    lon,
    altFt: 30_000,
    track: 90,
    gsKt: 450,
    seenPosSec: 0,
    ts: Date.now(),
  } as AircraftState;
}

describe("SkyHub.validateCatch", () => {
  it("polls on demand when history is empty, as after a restart", async () => {
    let calls = 0;
    const provider: FlightProvider = {
      async getAircraftNear(lat, lon) {
        calls++;
        return [aircraftAt(lat + 0.01, lon)];
      },
    };
    const hub = new SkyHub(provider);

    // Fresh hub: no history for this hex at all.
    const result = await hub.validateCatch("abc123", 51.47, -0.45, Date.now());
    expect(calls).toBe(1);
    expect(result.ok).toBe(true);
  });

  it("does not poll when history already covers the hex", async () => {
    let calls = 0;
    const provider: FlightProvider = {
      async getAircraftNear(lat, lon) {
        calls++;
        return [aircraftAt(lat + 0.01, lon)];
      },
    };
    const hub = new SkyHub(provider);
    await hub.validateCatch("abc123", 51.47, -0.45, Date.now()); // seeds history
    calls = 0;
    await hub.validateCatch("abc123", 51.47, -0.45, Date.now());
    expect(calls).toBe(0);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test --workspace apps/sky -- hub.test`
Expected: FAIL — `validateCatch` returns `{ok:false}` synchronously without calling the provider.

- [ ] **Step 3: Make `validateCatch` async with an on-demand poll**

In `apps/sky/src/hub.ts`, change the signature to `async validateCatch(...): Promise<...>` and insert an on-demand poll before the existing "no history" rejection. The lookup currently reads:

```ts
    const entry = this.history.get(hex.toLowerCase());
```

Replace it with:

```ts
    let entry = this.history.get(hex.toLowerCase());
    if (!entry) {
      // A fresh instance (every deploy) has no history yet, which would
      // reject every catch for a full poll cycle. Poll the claimed position
      // once so a legitimate catch immediately after a restart still lands.
      try {
        const aircraft = await this.provider.getAircraftNear(lat, lon, MAX_VIEW_RADIUS_KM / NM_TO_KM);
        this.recordHistory(aircraft);
        entry = this.history.get(hex.toLowerCase());
      } catch (err) {
        console.warn("[hub] on-demand poll for catch validation failed:", err);
      }
    }
```

No new imports are needed: `MAX_VIEW_RADIUS_KM` and `NM_TO_KM` are already imported at the top of `hub.ts`, the provider is already held as `this.provider` (declared via `constructor(private provider: FlightProvider)`), and `recordHistory` is the existing private method that writes into `this.history`.

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test --workspace apps/sky -- hub.test`
Expected: PASS, 2 tests.

- [ ] **Step 5: Await the call in `index.ts`**

In the `/catch` handler change:

```ts
  const result = hub.validateCatch(hex, lat, lon, ts, playerId);
```

to:

```ts
  const result = await hub.validateCatch(hex, lat, lon, ts, playerId);
```

Run: `npm run typecheck --workspace apps/sky`
Expected: no output (exit 0).

- [ ] **Step 6: Commit**

```bash
git add apps/sky/src/hub.ts apps/sky/src/hub.test.ts apps/sky/src/index.ts
git commit -m "Poll on demand when catch validation has no history yet"
```

---

### Task 7: Deploy to Railway and point the PWA at it

**Files:**
- Create: `railway.json`
- Modify: `README.md` (Structure, Run it, Environment sections)

**Interfaces:**
- Consumes: everything above
- Produces: a live service URL

- [ ] **Step 1: Create `railway.json`**

Railway's Nixpacks builder detects the npm workspace. The start command must run the sky workspace from the repo root so `@aloft/shared` resolves.

```json
{
  "$schema": "https://railway.app/railway.schema.json",
  "build": {
    "builder": "NIXPACKS",
    "buildCommand": "npm ci"
  },
  "deploy": {
    "startCommand": "npm run start --workspace apps/sky",
    "healthcheckPath": "/health",
    "healthcheckTimeout": 30,
    "restartPolicyType": "ON_FAILURE",
    "numReplicas": 1
  }
}
```

`numReplicas` must stay 1 — see Global Constraints.

- [ ] **Step 2: Create the Railway project and set variables**

```bash
npm i -g @railway/cli
railway login
railway init
```

Set the variables (paste the Supavisor pooler URI, not the direct one):

```bash
railway variables --set "DATABASE_URL=<supavisor pooler URI>"
railway variables --set "VAPID_PUBLIC_KEY=<from .env.local>"
railway variables --set "VAPID_PRIVATE_KEY=<from .env.local>"
railway variables --set "VAPID_SUBJECT=mailto:reyyanjanbazstudy@gmail.com"
```

`PORT` is injected by Railway; `index.ts` already reads it.

- [ ] **Step 3: Deploy and verify**

```bash
railway up
railway domain    # generates the public URL
```

Then, against the generated URL:

```bash
curl -s https://<railway-url>/health
```

Expected: `{"ok":true,...,"db":"up","pushSubs":0}` — `"db":"up"` is the check that the pooler URI and `prepare:false` are right.

```bash
curl -s 'https://<railway-url>/planes?lat=51.47&lon=-0.45&radiusKm=15'
```

Expected: `{"now":...,"count":<non-zero>,"aircraft":[...]}` — non-zero confirms the ADS-B providers work from Railway.

Confirm the WebSocket accepts a subscription:

```bash
npx wscat -c wss://<railway-url>/ws -x '{"type":"sub","lat":51.47,"lon":-0.45,"viewRadiusKm":50}'
```

Expected: a `{"type":"planes","aircraft":[...]}` frame.

- [ ] **Step 4: Point the PWA at Railway**

```bash
npx vercel env add VITE_SKY_URL production   # paste https://<railway-url>
npx vercel env add VITE_SKY_URL preview
```

Do **not** run `vercel deploy` from this tree (see Global Constraints). Rebuild the PWA from the Vercel dashboard, or from a tree that still has `api/`.

Then open the deployed PWA with `?lat=51.47&lon=-0.45` and confirm the HUD shows a live contact count and the link indicator reads "live".

- [ ] **Step 5: Verify the security behaviour survived the port**

Register a player and capture its id and token, then confirm impersonation is rejected:

```bash
curl -s -XPOST https://<railway-url>/friends/add \
  -H 'content-type: application/json' \
  -H 'x-player-id: <a real player id>' \
  -H 'x-player-token: wrong-token' \
  -d '{"code":"ABC234"}'
```

Expected: HTTP 401, `{"ok":false,"reason":"invalid or missing player token"}`

Confirm a spoofed catch is rejected:

```bash
curl -s -XPOST https://<railway-url>/catch \
  -H 'content-type: application/json' \
  -d '{"hex":"abc123","lat":0,"lon":0,"ts":'"$(date +%s000)"'}'
```

Expected: HTTP 422 with a rejection reason.

- [ ] **Step 6: Update the README**

Replace the `## Structure` body with:

```markdown
- `apps/web` — the PWA: React + Vite + MapLibre dark radar, installable on Android & iOS. Hosted on Vercel.
- `apps/sky` — the always-on Fastify service: ADS-B polling, WebSocket fan-out, catch validation, sky-alert push. Hosted on Railway.
- `packages/shared` — types + geo math (bearing, elevation, dead reckoning) used by both.
- `supabase/schema.sql` — durable state (players, catches, friendships, push subscriptions). Apply with `npm run db:schema`.

Live plane state and position-fix history live in memory in `SkyHub`, so the service runs as a **single instance** — never scale it to more than one replica.
```

Replace the `## Run it` body with:

```markdown
```bash
npm install
npm run gen:icons                  # once: generates placeholder PWA icons
export DATABASE_URL='<supavisor pooler URI>'
npm run db:schema                  # once: applies supabase/schema.sql
npm run dev                        # sky on :8787 + web on :5173
```
```

Replace the `## Environment` body with:

```markdown
`apps/sky` (set on Railway): `DATABASE_URL` (Supabase **Supavisor pooler** URI — the direct endpoint is IPv6-only and will not connect), `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT`. `PORT` is injected by Railway.

`apps/web` (set on Vercel): `VITE_SKY_URL` — the public Railway URL.
```

- [ ] **Step 7: Full verification and commit**

```bash
npm test --workspace packages/shared
DATABASE_URL=$DATABASE_URL npm test --workspace apps/sky
npm run typecheck --workspace apps/sky
npm run build
```

Expected: 31 shared tests pass, 12 sky tests pass, typecheck clean, build succeeds.

```bash
git add railway.json README.md
git commit -m "Deploy the sky service to Railway"
git push origin main
```

---

## Notes for the implementer

**Where the risk actually is.** The `verifyToken` token cache is what keeps the WebSocket `sub` path synchronous. If you find yourself adding `await` in `socket.on("message")`, stop — that is the failure mode this design exists to avoid.

**The pooler.** If `/health` reports `"db":"down"` while `psql` works from your laptop, you are almost certainly using the direct Supabase connection string (IPv6-only) rather than the Supavisor pooler URI, or you dropped `prepare: false`.

**Rollback.** The Vercel serverless architecture is preserved in full on the `vercel-serverless` tag and stays live at https://aloft-one.vercel.app until you choose to retire it.

**Cost.** Railway's trial grant is a one-time $5 and this service costs roughly $5/month to run continuously — about a month of runway. Because Postgres lives on Supabase, moving hosts later costs a redeploy, not a migration.
