import { describe, expect, it } from "vitest";
import type { HangarEntry } from "../hangar/db";
import { composeCardLayout } from "./catchCard";

function entry(over: Partial<HangarEntry> = {}): HangarEntry {
  return {
    id: "abc123:20260720",
    hex: "abc123",
    callsign: "BAW117",
    reg: "G-STBA",
    typeIcao: "B77W",
    typeLabel: "Boeing 777-300ER",
    rarity: "rare",
    caughtAt: Date.UTC(2026, 6, 20, 12, 0, 0),
    lat: 51.47,
    lon: -0.45,
    altFt: 36_000,
    gsKt: 470,
    distanceKm: 8.4,
    ...over,
  };
}

describe("composeCardLayout", () => {
  it("leads with the type and the flight identity", () => {
    const card = composeCardLayout({ entry: entry(), firstSpotter: false });
    expect(card.type).toBe("Boeing 777-300ER");
    expect(card.ident).toBe("BAW117");
    expect(card.rarityLabel).toBe("Rare");
  });

  it("uses the rarity colour from the design tokens", () => {
    expect(composeCardLayout({ entry: entry({ rarity: "legendary" }), firstSpotter: false }).rarityHex)
      .toBe("#ffb627");
    expect(composeCardLayout({ entry: entry({ rarity: "common" }), firstSpotter: false }).rarityHex)
      .toBe("#7e958c");
  });

  it("falls back through callsign, registration, then hex", () => {
    expect(composeCardLayout({ entry: entry({ callsign: "" }), firstSpotter: false }).ident).toBe("G-STBA");
    expect(
      composeCardLayout({ entry: entry({ callsign: "", reg: undefined }), firstSpotter: false }).ident
    ).toBe("ABC123");
  });

  it("reads out altitude, range and date", () => {
    const card = composeCardLayout({ entry: entry(), firstSpotter: false });
    expect(card.readouts[0]).toBe("36,000 ft");
    expect(card.readouts[1]).toBe("8.4 km");
    expect(card.readouts[2]).toContain("2026");
  });

  it("says so plainly when the aircraft was on the ground", () => {
    const card = composeCardLayout({ entry: entry({ altFt: 0 }), firstSpotter: false });
    expect(card.readouts[0]).toBe("On the ground");
  });

  it("carries the first-spotter mark only when earned", () => {
    expect(composeCardLayout({ entry: entry(), firstSpotter: true }).firstSpotter).toBe(true);
    expect(composeCardLayout({ entry: entry(), firstSpotter: false }).firstSpotter).toBe(false);
  });

  it("footers the spotter code when there is one, else the site", () => {
    expect(composeCardLayout({ entry: entry(), firstSpotter: false, spotterCode: "BWGBQA" }).footer)
      .toBe("Spotter BWGBQA");
    expect(composeCardLayout({ entry: entry(), firstSpotter: false }).footer)
      .toBe("aloft-one.vercel.app");
  });
});
