import { openDB, type IDBPDatabase } from "idb";
import type { Rarity, ValidatedCatch } from "@aloft/shared";
import { typeName } from "@aloft/shared";

export interface HangarEntry {
  /** One catch per airframe per flight per day: hex:callsign:yyyymmdd. */
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
  dbPromise ??= openDB("aloft", 2, {
    upgrade(database, oldVersion) {
      if (oldVersion < 1) database.createObjectStore("catches", { keyPath: "id" });
      if (oldVersion < 2) database.createObjectStore("meta");
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

export function entryFromCatch(validated: ValidatedCatch): HangarEntry {
  const ac = validated.aircraft;
  const day = new Date(validated.caughtAt).toISOString().slice(0, 10).replaceAll("-", "");
  return {
    id: `${ac.hex}:${ac.callsign || "----"}:${day}`,
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
  const existing = await database.get("catches", entry.id);
  await database.put("catches", entry);
  return { isNew: !existing };
}

export async function listCatches(): Promise<HangarEntry[]> {
  const database = await db();
  const all = (await database.getAll("catches")) as HangarEntry[];
  return all.sort((a, b) => b.caughtAt - a.caughtAt);
}
