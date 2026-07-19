import type { PushSubscription } from "web-push";
import { sql } from "../db";
import { PER_HEX_DEDUPE_MS } from "./geofence";

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
  pinged_hexes: Record<string, number> | null;
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
   *
   * Entries older than the dedupe window are dropped in the same statement.
   * They can never suppress a future ping, so keeping them only grew the
   * jsonb without bound — one key per distinct airframe, forever — and every
   * geofence tick reads this column for every subscription.
   */
  async markPinged(endpoint: string, hex: string, at: number): Promise<void> {
    const keepAfter = at - PER_HEX_DEDUPE_MS;
    await sql`
      update push_subscriptions
      set last_ping_at = ${new Date(at)},
          pinged_hexes = (
            select coalesce(jsonb_object_agg(key, value), '{}'::jsonb)
            from jsonb_each(coalesce(pinged_hexes, '{}'::jsonb))
            where (value #>> '{}')::numeric > ${keepAfter}
          ) || ${sql.json({ [hex]: at })}
      where endpoint = ${endpoint}
    `;
  }
}
