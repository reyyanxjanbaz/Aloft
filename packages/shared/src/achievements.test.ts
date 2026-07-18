import { describe, expect, it } from "vitest";
import { evaluateAchievements, streakDays, type CatchLike } from "./achievements";
import { familyOf } from "./aircraft";

const DAY = 86_400_000;
const NOW = new Date("2026-07-18T15:00:00").getTime();

function mk(over: Partial<CatchLike> = {}): CatchLike {
  return { typeIcao: "A320", rarity: "common", caughtAt: NOW, altFt: 35_000, distanceKm: 8, ...over };
}

describe("familyOf", () => {
  it("distinguishes the Globemaster from Cessnas", () => {
    expect(familyOf("C17")).toBe("quad");
    expect(familyOf("C172")).toBe("ga");
  });
  it("classifies families", () => {
    expect(familyOf("B77W")).toBe("widebody");
    expect(familyOf("A388")).toBe("quad");
    expect(familyOf("AT76")).toBe("turboprop");
    expect(familyOf("B738")).toBe("narrowbody");
  });
});

describe("evaluateAchievements", () => {
  it("empty hangar unlocks nothing", () => {
    expect(evaluateAchievements([], NOW)).toEqual([]);
  });

  it("first catch unlocks Wheels Up only (common, mid-altitude, daytime)", () => {
    const ids = evaluateAchievements([mk({ caughtAt: new Date("2026-07-18T12:00:00").getTime() })], NOW);
    expect(ids).toEqual(["first-catch"]);
  });

  it("rarity ladder cascades: legendary also satisfies rare and epic", () => {
    const ids = evaluateAchievements([mk({ rarity: "legendary" })], NOW);
    expect(ids).toContain("first-rare");
    expect(ids).toContain("first-epic");
    expect(ids).toContain("first-legendary");
  });

  it("widebody warrior needs 5 wide/jumbo catches", () => {
    const four = Array.from({ length: 4 }, () => mk({ typeIcao: "B789" }));
    expect(evaluateAchievements(four, NOW)).not.toContain("widebody-5");
    expect(evaluateAchievements([...four, mk({ typeIcao: "A388" })], NOW)).toContain("widebody-5");
  });

  it("situational: high altitude, night, overhead", () => {
    const ids = evaluateAchievements(
      [
        mk({ altFt: 41_000 }),
        mk({ caughtAt: new Date("2026-07-18T03:30:00").getTime() }),
        mk({ distanceKm: 1.2 }),
      ],
      NOW
    );
    expect(ids).toContain("high-roller");
    expect(ids).toContain("red-eye");
    expect(ids).toContain("overhead");
  });
});

describe("streakDays", () => {
  it("counts consecutive days ending today", () => {
    const catches = [mk(), mk({ caughtAt: NOW - DAY }), mk({ caughtAt: NOW - 2 * DAY })];
    expect(streakDays(catches, NOW)).toBe(3);
  });

  it("a streak ending yesterday still counts (grace day)", () => {
    const catches = [mk({ caughtAt: NOW - DAY }), mk({ caughtAt: NOW - 2 * DAY })];
    expect(streakDays(catches, NOW)).toBe(2);
  });

  it("a gap breaks the streak", () => {
    const catches = [mk(), mk({ caughtAt: NOW - 3 * DAY })];
    expect(streakDays(catches, NOW)).toBe(1);
  });

  it("empty is zero", () => {
    expect(streakDays([], NOW)).toBe(0);
  });
});
