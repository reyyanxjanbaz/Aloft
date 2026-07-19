# Aloft on Railway — deployment design

**Date:** 2026-07-19
**Status:** approved, ready for implementation planning

## Context

Aloft was briefly rearchitected to run fully serverless on Vercel + Supabase, because
an always-on host was unavailable. That work is preserved on the `vercel-serverless`
tag and is live at https://aloft-one.vercel.app. Railway is now available, so the
repository has been reset to `ff19728` — the last commit before the serverless port —
restoring `apps/sky`, the Fastify service with WebSocket fan-out.

This spec covers deploying that restored architecture: the PWA on Vercel, the Fastify
service on Railway, and durable state on Supabase Postgres.

## Constraints

**Railway trial is a runway, not a home.** The trial grant is a one-time $5. A service
of this size running continuously costs roughly $5/month, so the trial buys about a
month before the service stops. Hobby is $5/month for a recurring $5 of usage.

**The service will not sleep.** Railway's App Sleeping is opt-in and off by default,
and triggers only after 10 minutes with no outbound packets. The hub polls ADS-B every
3 seconds and the geofence job runs on a timer, so the service produces continuous
outbound traffic and would not sleep even if the feature were enabled. No keep-warm
mechanism is needed.

**The filesystem is ephemeral.** `SocialStore` and `PushStore` currently persist to
JSON files under `apps/sky/data/`. Railway wipes the container filesystem on every
deploy and restart, so players, friendships, catches, and push subscriptions would be
lost on each deploy. Moving this state to Postgres is the substance of this work.

**Single instance by design.** The hub holds live plane state and position-fix history
in memory and fans out over WebSocket. Running more than one replica would split that
state. This is accepted: one instance is sufficient, and horizontal scaling is out of
scope.

## Architecture

| Component | Host | Responsibility |
| --- | --- | --- |
| `apps/web` | Vercel | Static PWA, served from CDN. Existing project, CLI-linked. |
| `apps/sky` | Railway | Fastify: REST, WebSocket, 3s ADS-B polling, geofence push job |
| Postgres | Supabase | Players, catches, friendships, push subscriptions |

Keeping the database on Supabase rather than Railway is deliberate: it makes the host
disposable. When trial credit runs out, or if Railway is replaced later, only the
service moves.

Radar data flow is unchanged from `ff19728`: the hub polls the ADS-B provider once per
0.5° geo-cell every 3 seconds, fans results out over WebSocket to subscribers in that
cell, and the client dead-reckons between frames. No social or database call sits in
that loop.

## Component changes

### `SocialStore` (`apps/sky/src/social/store.ts`)

Internals move from in-memory `Map`s plus a debounced JSON write to per-operation
Postgres queries via `postgres.js`. The public interface — `register`, `verifyToken`,
`get`, `getByCode`, `profile`, `recordCatch`, `stats`, `addFriendByCode`,
`removeFriend`, `friends`, `hangarOf`, `leaderboard`, `activity` — keeps its shape, so
`social/routes.ts` and the `/catch` handler change only where a method becomes async.

The query logic ports from `api/_lib/social.ts` on the `vercel-serverless` tag rather
than being written fresh. That implementation is already proven against a real
database, including the atomic first-spotter claim (`INSERT ... WHERE NOT EXISTS`
against a partial unique index) and the token gate.

`leaderboard` becomes a SQL aggregate over `catches` instead of an in-memory sort,
which is what `supabase/schema.sql` was designed for.

### Token verification stays synchronous

`verifyToken` is called from three places, one of which is the synchronous
`socket.on("message")` callback in `index.ts`. Making it async would push promise
handling into that callback, where an unhandled rejection would drop the connection
silently.

Instead `SocialStore` keeps an in-memory `playerId → token` map, hydrated on boot and
appended on register. Tokens are immutable once issued and the service is
single-instance, so this cache cannot go stale. `verifyToken` remains synchronous and
all three call sites are untouched. Every other operation goes to Postgres per call.

### `PushStore` (`apps/sky/src/push/store.ts`)

Same treatment: internals become queries against `push_subscriptions`, public
interface unchanged. `upsert`, `remove`, `all`, and `size` are the surface used by
`index.ts` and the geofence job.

### Catch validation after a restart

`SkyHub` holds position-fix history in memory, and every deploy starts a fresh
instance with an empty history. For the first poll cycle after a restart, `/catch`
would reject every submission with 422 "unverifiable" — a real if brief window, since
deploys are routine.

Fix: when `validateCatch` finds no history for the submitted hex, poll that cell once
on demand before deciding, instead of rejecting outright. `validateCatch` becomes
async; its only caller is the already-async `/catch` route handler.

### Database connection

Connect through the Supabase **Supavisor pooler**, not the direct connection string.
The direct endpoint is IPv6-only, and on transaction-pooling mode `postgres.js`
requires `prepare: false` or prepared statements fail at runtime. Both are production-
only failure modes, so they are specified here rather than discovered later.

### Schema (`supabase/schema.sql`)

The existing file targets this exact migration but predates the security pass and
assumes Supabase Auth. Three changes:

1. Drop the `auth_id` foreign key to `auth.users` — identity is device-local, and the
   reference makes the schema un-appliable outside Supabase Auth.
2. Drop `create extension postgis` — no geography column is used; distance math lives
   in `packages/shared/src/geo.ts`.
3. Add the `token` column to `players`, and the partial unique index on `catches` that
   makes the first-spotter claim atomic.

### Client (`apps/web`)

`VITE_SKY_URL` points at the Railway service. `SKY_URL.replace(/^http/, "ws")` already
derives `wss://` from `https://`, and `planes.ts` already reconnects with exponential
backoff capped at 15 seconds, reset on open. No client changes beyond the environment
variable.

CORS is already registered with `origin: true` in `index.ts`, which permits the Vercel
origin.

## Error handling

The service must boot and serve radar even when Postgres is unreachable. Today both
stores load their state in the constructor, so a database outage at boot would crash
the process. The connection gets retry-with-backoff, and social and push routes return
503 while it is down.

Precisely what survives an outage: radar, hunting, and the *validation* half of
`/catch` all depend on the hub rather than the database, so they keep working.
Recording a catch against a player does not — `recordCatch` writes to Postgres — so a
catch validates and returns its rarity and 3D reveal, but attribution, first-spotter,
and the hangar entry fail until the database returns. The client already queues catches
offline in IndexedDB, so this degrades rather than loses.

One coupling worth stating: the token cache is hydrated from Postgres on boot. If the
database is unreachable at startup the cache is empty, so `verifyToken` rejects every
claimed identity and authenticated routes return 401 rather than 503. Anonymous catch
validation still works. Hydration therefore retries until it succeeds, and the service
reports itself unhealthy until it does.

ADS-B provider outages are already covered by `FailoverProvider`.

## Testing

The 31 existing unit tests in `packages/shared` cover pure geo, rarity, and achievement
logic. They are unaffected and must stay green.

New coverage targets the migration:

- Store operations against a real Postgres, one transaction per test.
- First-spotter concurrency: two simultaneous catches of the same airframe, exactly one
  winner.
- Token gate: registration issues a token; a mismatched token is rejected.
- `validateCatch` with empty history triggers exactly one on-demand poll.

Live verification after deploy, matching what was verified on the serverless build:
registration issues a token, WebSocket connects and streams contacts, a real aircraft
is caught, an impersonation attempt returns 401, and a spoofed position returns 422.

## Cutover and rollback

The Vercel serverless deployment stays live until the Railway service is verified, so
there is no window where nothing works. The `vercel-serverless` tag preserves that
architecture in full.

Do not run `vercel deploy` from this tree. The Vercel project's Root Directory is `.`,
and this commit contains no `api/` or `vercel.json`; deploying would replace the
working serverless build with a broken one. The project is CLI-linked with no GitHub
integration, so pushing this branch will not trigger a deploy on its own.

## What the user must do

1. Create the Railway project and connect the repo.
2. Set environment variables on Railway: `DATABASE_URL` (Supavisor pooler URI),
   `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT`.
3. Set `VITE_SKY_URL` on Vercel to the Railway public URL and redeploy the PWA.
4. Decide on Hobby before trial credit runs out, or accept that the service stops.

## Out of scope

- Horizontal scaling and multi-replica state sharing.
- Rate limiting (flagged in the earlier code review, deliberately deferred).
- Migrating existing data from the serverless Supabase tables; the player base is test
  data and starts fresh.
- Redis. The hub's in-memory state is correct for a single instance.
