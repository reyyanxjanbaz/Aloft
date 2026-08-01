import { openDB, type IDBPDatabase } from "idb";
import type { Rarity, ValidatedCatch } from "@aloft/shared";
import { typeName } from "@aloft/shared";

export interface HangarEntry {
  /** One catch per airframe per local day: hex:yyyymmdd. */
  id: string;
  hex: string;
  callsign: string;
  reg?: string;
  typeIcao?: string;
  typeLabel: string;
  rarity: Rarity;
  caughtAt: number;
  lat: number;
  lon: number;
  altFt: number;
  gsKt: number;
  distanceKm: number;
}

let dbPromise: Promise<IDBPDatabase> | null = null;

function db(): Promise<IDBPDatabase> {
  dbPromise ??= openDB("aloft", 3, {
    upgrade(database, oldVersion) {
      if (oldVersion < 1) database.createObjectStore("catches", { keyPath: "id" });
      if (oldVersion < 2) database.createObjectStore("meta");
      // Pending catches were a single slot at meta/pendingCatch, so a second
      // offline catch overwrote the first. They now live in their own keyed
      // store — one entry per airframe per local day — so nothing is lost.
      if (oldVersion < 3) database.createObjectStore("pendingCatches", { keyPath: "id" });
    },
  });
  return dbPromise;
}

/** Achievement ids already celebrated, so unlock toasts fire exactly once. */
export async function getSeenAchievements(): Promise<Set<string>> {
  const database = await db();
  const ids = (await database.get("meta", "seenAchievements")) as string[] | undefined;
  return new Set(ids ?? []);
}

export async function setSeenAchievements(ids: Set<string>): Promise<void> {
  const database = await db();
  await database.put("meta", [...ids], "seenAchievements");
}

/**
 * Local calendar day as yyyymmdd — matches how `streakDays` (also local-time)
 * groups catches into days, so the hangar's dedup key and the streak badge
 * agree on what "today" means. A UTC-based key here previously disagreed
 * with the local-time streak calculation for any player not in UTC+0,
 * letting the same real-world day double-count near local midnight.
 */
function localDayKey(ts: number): string {
  const d = new Date(ts);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}${m}${day}`;
}

export function entryFromCatch(validated: ValidatedCatch): HangarEntry {
  const ac = validated.aircraft;
  const day = localDayKey(validated.caughtAt);
  return {
    // Airframe + day only. The callsign used to be part of this key, but it
    // is absent on some fixes and changes mid-flight on others, so one flight
    // could be logged twice.
    id: `${ac.hex.toLowerCase()}:${day}`,
    hex: ac.hex,
    callsign: ac.callsign,
    reg: ac.reg,
    typeIcao: ac.typeIcao,
    typeLabel: typeName(ac.typeIcao),
    rarity: validated.rarity,
    caughtAt: validated.caughtAt,
    lat: ac.lat,
    lon: ac.lon,
    altFt: ac.altFt,
    gsKt: ac.gsKt,
    distanceKm: validated.distanceKm,
  };
}

/** Returns isNew=false when this airframe+flight+day was already in the hangar. */
export async function saveCatch(entry: HangarEntry): Promise<{ isNew: boolean }> {
  const database = await db();
  // One transaction spans the read and the write. Two separate `db.get`
  // then `db.put` calls each open their own transaction, leaving a gap where
  // an overlapping saveCatch() (e.g. two tabs on the same catch) could both
  // observe "not found" and both report isNew:true. IndexedDB serializes
  // readwrite transactions against the same store, so this read+write pair
  // is atomic relative to any other transaction touching "catches".
  const tx = database.transaction("catches", "readwrite");
  const existing = await tx.store.get(entry.id);
  await tx.store.put(entry);
  await tx.done;
  return { isNew: !existing };
}

/**
 * A capture the player earned but the tower never confirmed — offline, or a
 * dropped request. Held so a successful lock is never silently thrown away;
 * flushed on next launch or when the network returns.
 */
export interface PendingCatch {
  hex: string;
  lat: number;
  lon: number;
  ts: number;
}

interface PendingRecord extends PendingCatch {
  /** hex:yyyymmdd — matches the hangar dedup key, so one airframe/day queues once. */
  id: string;
}

/** Stable identity for a pending catch: the same airframe on the same local day. */
export function pendingId(pending: PendingCatch): string {
  return `${pending.hex.toLowerCase()}:${localDayKey(pending.ts)}`;
}

/**
 * Persists a capture the tower hasn't confirmed yet. Keyed by airframe+day, so
 * a burst of offline catches all survive and a retry of the same one doesn't
 * pile up duplicates.
 */
export async function enqueuePendingCatch(pending: PendingCatch): Promise<void> {
  const database = await db();
  const record: PendingRecord = { ...pending, id: pendingId(pending) };
  await database.put("pendingCatches", record);
}

export async function listPendingCatches(): Promise<PendingCatch[]> {
  const database = await db();
  // Migrate a legacy single-slot pending catch, if one survived an upgrade,
  // into the queue so it flushes like any other.
  const legacy = (await database.get("meta", "pendingCatch")) as PendingCatch | undefined;
  if (legacy) {
    await database.put("pendingCatches", { ...legacy, id: pendingId(legacy) } satisfies PendingRecord);
    await database.delete("meta", "pendingCatch");
  }
  const all = (await database.getAll("pendingCatches")) as PendingRecord[];
  return all.map(({ id: _id, ...pending }) => pending);
}

export async function removePendingCatch(pending: PendingCatch): Promise<void> {
  const database = await db();
  await database.delete("pendingCatches", pendingId(pending));
}

export async function listCatches(): Promise<HangarEntry[]> {
  const database = await db();
  const all = (await database.getAll("catches")) as HangarEntry[];
  return all.sort((a, b) => b.caughtAt - a.caughtAt);
}
