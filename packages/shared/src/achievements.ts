import { familyOf } from "./aircraft";
import { RARITY_ORDER, type Rarity } from "./rarity";

/** The slice of a hangar entry the achievement engine needs. */
export interface CatchLike {
  typeIcao?: string;
  rarity: Rarity;
  caughtAt: number;
  altFt: number;
  distanceKm: number;
}

/** Semantic icon key — the UI layer maps these to its icon set. */
export type AchievementIcon =
  | "departure"
  | "aircraft"
  | "world"
  | "inflight"
  | "star"
  | "medal"
  | "trophy"
  | "altitude"
  | "night"
  | "pin"
  | "streak"
  | "timer";

export interface AchievementDef {
  id: string;
  name: string;
  description: string;
  icon: AchievementIcon;
  check: (catches: CatchLike[], now: number) => boolean;
}

const atLeastRarity = (c: CatchLike, r: Rarity) =>
  RARITY_ORDER.indexOf(c.rarity) >= RARITY_ORDER.indexOf(r);

const isWide = (c: CatchLike) => {
  const f = familyOf(c.typeIcao);
  return f === "widebody" || f === "quad";
};

/**
 * Consecutive-day catch streak ending today or yesterday (local time),
 * so an unbroken streak survives until the end of the following day.
 *
 * Walks calendar days via `setDate`, not by subtracting a fixed 24h in
 * milliseconds — a fixed-ms step skips or double-counts a day across a DST
 * transition, since one local calendar day isn't always exactly 86,400,000ms.
 *
 * Note: this runs both server-side (Node, typically UTC) and client-side
 * (the browser's local zone) against the same catch data, so the same
 * player can see a slightly different streak from each — a known tradeoff
 * of the pre-auth, no-timezone-negotiation MVP, not something this
 * function can resolve on its own.
 */
export function streakDays(catches: CatchLike[], now: number): number {
  if (catches.length === 0 || !Number.isFinite(now)) return 0;
  const days = new Set(catches.map((c) => new Date(c.caughtAt).toDateString()));
  const cursor = new Date(now);
  if (!days.has(cursor.toDateString())) cursor.setDate(cursor.getDate() - 1); // grace: yesterday may start it
  let streak = 0;
  while (days.has(cursor.toDateString())) {
    streak++;
    cursor.setDate(cursor.getDate() - 1);
  }
  return streak;
}

export const ACHIEVEMENTS: AchievementDef[] = [
  { id: "first-catch", name: "Wheels Up", description: "Catch your first aircraft", icon: "departure",
    check: (c) => c.length >= 1 },
  { id: "ten-catches", name: "Frequent Flyer", description: "Catch 10 aircraft", icon: "aircraft",
    check: (c) => c.length >= 10 },
  { id: "fifty-catches", name: "Squadron Leader", description: "Catch 50 aircraft", icon: "world",
    check: (c) => c.length >= 50 },
  { id: "widebody-5", name: "Widebody Warrior", description: "Catch 5 widebody or jumbo aircraft", icon: "inflight",
    check: (c) => c.filter(isWide).length >= 5 },
  { id: "first-rare", name: "Shiny", description: "Catch a rare aircraft", icon: "star",
    check: (c) => c.some((x) => atLeastRarity(x, "rare")) },
  { id: "first-epic", name: "Top Brass", description: "Catch an epic aircraft", icon: "medal",
    check: (c) => c.some((x) => atLeastRarity(x, "epic")) },
  { id: "first-legendary", name: "Once in a Lifetime", description: "Catch a legendary aircraft", icon: "trophy",
    check: (c) => c.some((x) => atLeastRarity(x, "legendary")) },
  { id: "high-roller", name: "High Roller", description: "Catch a plane above 40,000 ft", icon: "altitude",
    check: (c) => c.some((x) => x.altFt >= 40_000) },
  { id: "red-eye", name: "Red-Eye", description: "Catch a plane between midnight and 5 am", icon: "night",
    check: (c) => c.some((x) => { const h = new Date(x.caughtAt).getHours(); return h >= 0 && h < 5; }) },
  { id: "overhead", name: "Right Overhead", description: "Catch a plane within 2 km of you", icon: "pin",
    check: (c) => c.some((x) => x.distanceKm < 2) },
  { id: "streak-3", name: "Hat Trick", description: "Catch planes 3 days in a row", icon: "streak",
    check: (c, now) => streakDays(c, now) >= 3 },
  { id: "streak-7", name: "Week Aloft", description: "Catch planes 7 days in a row", icon: "timer",
    check: (c, now) => streakDays(c, now) >= 7 },
];

/** IDs of every achievement the catch list currently satisfies. */
export function evaluateAchievements(catches: CatchLike[], now = Date.now()): string[] {
  return ACHIEVEMENTS.filter((a) => a.check(catches, now)).map((a) => a.id);
}
