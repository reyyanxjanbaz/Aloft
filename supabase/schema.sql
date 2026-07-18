-- Aloft — Supabase/Postgres schema.
--
-- This is the managed migration target for the file-backed store in
-- apps/sky/src/social/store.ts. Apply it to a Supabase project, then swap
-- SocialStore's internals for supabase-js queries; the HTTP routes in
-- apps/sky/src/social/routes.ts stay unchanged.
--
--   psql "$SUPABASE_DB_URL" -f supabase/schema.sql

create extension if not exists postgis;

-- ── Players ────────────────────────────────────────────────────────────
create table if not exists players (
  id          uuid primary key default gen_random_uuid(),
  -- Links to Supabase Auth once auth is wired; null for pre-auth devices.
  auth_id     uuid unique references auth.users (id) on delete cascade,
  name        text not null check (char_length(name) between 1 and 24),
  code        text not null unique check (code ~ '^[A-Z2-9]{6}$'),
  created_at  timestamptz not null default now()
);

-- ── Airframes: one row per real aircraft, seeded from ADS-B enrichment ──
create table if not exists airframes (
  hex         text primary key,
  reg         text,
  type_icao   text,
  type_label  text,
  operator    text,
  updated_at  timestamptz not null default now()
);

-- ── Catches ────────────────────────────────────────────────────────────
create table if not exists catches (
  id           text primary key,              -- hex:callsign:yyyymmdd
  player_id    uuid not null references players (id) on delete cascade,
  hex          text not null,
  callsign     text not null default '',
  type_icao    text,
  type_label   text not null,
  rarity       text not null check (rarity in ('common','uncommon','rare','epic','legendary')),
  caught_at    timestamptz not null,
  alt_ft       int not null default 0,
  distance_km  numeric(6,1) not null default 0,
  -- Where the player stood; enables "catches near me" and geo achievements.
  location     geography(point, 4326),
  first_spotter boolean not null default false
);

create index if not exists catches_player_time on catches (player_id, caught_at desc);
create index if not exists catches_hex on catches (hex);
create index if not exists catches_location on catches using gist (location);

-- First-ever catch of an airframe wins "First Spotter" — enforced globally.
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

-- ── Push subscriptions (M2 geofence pings) ─────────────────────────────
create table if not exists push_subscriptions (
  endpoint     text primary key,
  player_id    uuid references players (id) on delete cascade,
  keys         jsonb not null,
  lat          double precision not null,
  lon          double precision not null,
  radius_km    int not null default 15,
  last_ping_at timestamptz,
  created_at   timestamptz not null default now()
);

-- ── Weekly leaderboard ─────────────────────────────────────────────────
-- Rarity points mirror rarityPoints() in the sky service: (tier index + 1)².
create materialized view if not exists weekly_leaderboard as
select
  c.player_id,
  p.name,
  p.code,
  count(*)::int as catches,
  sum(
    case c.rarity
      when 'common' then 1 when 'uncommon' then 4 when 'rare' then 9
      when 'epic' then 16 when 'legendary' then 25 end
  )::int as rarity_score
from catches c
join players p on p.id = c.player_id
where c.caught_at >= now() - interval '7 days'
group by c.player_id, p.name, p.code;

create unique index if not exists weekly_leaderboard_player on weekly_leaderboard (player_id);
-- Refresh on a schedule (pg_cron): select cron.schedule('refresh-leaderboard', '*/5 * * * *',
--   $$refresh materialized view concurrently weekly_leaderboard$$);

-- ── Row Level Security ─────────────────────────────────────────────────
alter table players enable row level security;
alter table catches enable row level security;
alter table friendships enable row level security;
alter table push_subscriptions enable row level security;

-- Helper: the players row belonging to the current auth user.
create or replace function current_player_id() returns uuid
language sql stable security definer set search_path = public as $$
  select id from players where auth_id = auth.uid()
$$;

-- Anyone signed in can look up a player by code (that's how invites work),
-- but only you can change your own row.
create policy players_read on players for select to authenticated using (true);
create policy players_update on players for update to authenticated
  using (auth_id = auth.uid()) with check (auth_id = auth.uid());
create policy players_insert on players for insert to authenticated
  with check (auth_id = auth.uid());

-- Your catches are yours; friends may read them (hangar visits).
create policy catches_own on catches for all to authenticated
  using (player_id = current_player_id())
  with check (player_id = current_player_id());

create policy catches_friends_read on catches for select to authenticated
  using (exists (
    select 1 from friendships f
    where f.player_id = current_player_id() and f.friend_id = catches.player_id
  ));

create policy friendships_own on friendships for all to authenticated
  using (player_id = current_player_id() or friend_id = current_player_id())
  with check (player_id = current_player_id());

create policy push_own on push_subscriptions for all to authenticated
  using (player_id = current_player_id())
  with check (player_id = current_player_id());
