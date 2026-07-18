import { describe, expect, it } from "vitest";
import { angleDiffDeg } from "./geo";
import { rarityFor, typeName } from "./rarity";

describe("rarityFor", () => {
  it("classifies the ladder", () => {
    expect(rarityFor("A320")).toBe("common");
    expect(rarityFor("B77W")).toBe("uncommon");
    expect(rarityFor("A388")).toBe("rare");
    expect(rarityFor("C17")).toBe("epic");
    expect(rarityFor("A124")).toBe("legendary");
  });

  it("is case-insensitive and defaults unknowns to common", () => {
    expect(rarityFor("a388")).toBe("rare");
    expect(rarityFor("ZZZZ")).toBe("common");
    expect(rarityFor(undefined)).toBe("common");
  });
});

describe("typeName", () => {
  it("maps known designators", () => {
    expect(typeName("B789")).toBe("Boeing 787-9");
  });
  it("falls back to the raw designator", () => {
    expect(typeName("X999")).toBe("X999");
  });
});

describe("angleDiffDeg", () => {
  it("wraps across north", () => {
    expect(angleDiffDeg(350, 10)).toBe(20);
    expect(angleDiffDeg(10, 350)).toBe(-20);
  });
  it("zero for equal angles", () => {
    expect(angleDiffDeg(123, 123)).toBe(0);
  });
  it("180 for opposite", () => {
    expect(angleDiffDeg(0, 180)).toBe(180);
  });
});
