export type Rarity = "common" | "uncommon" | "rare" | "epic" | "legendary";

export const RARITY_ORDER: Rarity[] = ["common", "uncommon", "rare", "epic", "legendary"];

const LEGENDARY = new Set(["A124", "A225", "BLCF", "A3ST", "A337", "VC25"]);
const EPIC = new Set(["C17", "C5M", "K35R", "KC46", "A400", "C30J", "C130", "B52", "E3TF", "P8", "R135"]);
const RARE = new Set([
  "B744", "B748", "B74S", "A388", "A345", "A346", "A35K", "B77L",
  "MD11", "IL76", "C5", "CONC",
  "GLF4", "GLF5", "GLF6", "GL7T", "GLEX", "FA7X", "FA8X", "F900", "CL60",
]);
const UNCOMMON = new Set([
  "A332", "A333", "A339", "A359", "B762", "B763", "B764", "B772", "B773", "B77W",
  "B788", "B789", "B78X", "B752", "B753", "BCS1", "BCS3", "A306", "A310", "B741", "B742", "B743",
]);

/**
 * Rarity grounded in real-world scarcity, keyed by ICAO type designator.
 * Unknown types default to common (most unknowns are GA/light aircraft).
 * Server-side authority; the client only displays it.
 */
export function rarityFor(typeIcao: string | undefined): Rarity {
  if (!typeIcao) return "common";
  const t = typeIcao.toUpperCase();
  if (LEGENDARY.has(t)) return "legendary";
  if (EPIC.has(t)) return "epic";
  if (RARE.has(t)) return "rare";
  if (UNCOMMON.has(t)) return "uncommon";
  return "common";
}

/** Friendly display names for the most common ICAO type designators. */
const TYPE_NAMES: Record<string, string> = {
  A19N: "Airbus A319neo", A20N: "Airbus A320neo", A21N: "Airbus A321neo",
  A318: "Airbus A318", A319: "Airbus A319", A320: "Airbus A320", A321: "Airbus A321",
  A332: "Airbus A330-200", A333: "Airbus A330-300", A339: "Airbus A330-900neo",
  A359: "Airbus A350-900", A35K: "Airbus A350-1000",
  A388: "Airbus A380", A124: "Antonov An-124", A225: "Antonov An-225",
  A3ST: "Airbus Beluga", A337: "Airbus BelugaXL",
  B37M: "Boeing 737 MAX 7", B38M: "Boeing 737 MAX 8", B39M: "Boeing 737 MAX 9",
  B737: "Boeing 737-700", B738: "Boeing 737-800", B739: "Boeing 737-900",
  B744: "Boeing 747-400", B748: "Boeing 747-8", BLCF: "Boeing Dreamlifter",
  B752: "Boeing 757-200", B753: "Boeing 757-300",
  B762: "Boeing 767-200", B763: "Boeing 767-300", B764: "Boeing 767-400",
  B772: "Boeing 777-200", B77L: "Boeing 777-200LR/F", B773: "Boeing 777-300", B77W: "Boeing 777-300ER",
  B788: "Boeing 787-8", B789: "Boeing 787-9", B78X: "Boeing 787-10",
  BCS1: "Airbus A220-100", BCS3: "Airbus A220-300",
  E170: "Embraer E170", E75L: "Embraer E175", E190: "Embraer E190", E195: "Embraer E195",
  E290: "Embraer E190-E2", E295: "Embraer E195-E2",
  CRJ2: "Bombardier CRJ200", CRJ7: "Bombardier CRJ700", CRJ9: "Bombardier CRJ900",
  AT72: "ATR 72", AT75: "ATR 72-500", AT76: "ATR 72-600", DH8D: "Dash 8 Q400",
  MD11: "MD-11", C17: "Boeing C-17 Globemaster",
  P28A: "Piper Cherokee", C172: "Cessna 172", C152: "Cessna 152", SR22: "Cirrus SR22",
  DA40: "Diamond DA40", PA34: "Piper Seneca",
};

export function typeName(typeIcao: string | undefined): string {
  if (!typeIcao) return "Mystery aircraft";
  return TYPE_NAMES[typeIcao.toUpperCase()] ?? typeIcao.toUpperCase();
}

/**
 * Every ICAO type the app knows by name or by rarity — its actual catalogue,
 * and the board the Hangar draws.
 *
 * Sorted rarest first so the board reads as a ladder rather than an alphabet.
 * Note this is a list of what Aloft can *recognise*, not of what anyone can
 * realistically catch: an An-225 no longer exists and a VC-25 will not fly over
 * most people. The board is deliberately not framed as completable.
 */
export const KNOWN_TYPES: string[] = (() => {
  const all = new Set<string>([
    ...Object.keys(TYPE_NAMES),
    ...LEGENDARY,
    ...EPIC,
    ...RARE,
    ...UNCOMMON,
  ]);
  return [...all].sort((a, b) => {
    const byRarity = RARITY_ORDER.indexOf(rarityFor(b)) - RARITY_ORDER.indexOf(rarityFor(a));
    return byRarity !== 0 ? byRarity : a.localeCompare(b);
  });
})();
