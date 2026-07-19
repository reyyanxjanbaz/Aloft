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

-- ── Retired tables ──────────────────────────────────────────────────────
-- These backed the short-lived fully-serverless architecture (preserved on
-- the `vercel-serverless` tag), where there was no long-running process to
-- hold state. The always-on service keeps all three in memory in SkyHub:
-- viewports are WebSocket subscriptions, fixes are the history Map, and the
-- per-cell ADS-B cache is the hub's own poll loop.
drop table if exists active_viewports;
drop table if exists airframe_fixes;
drop table if exists cell_cache;
