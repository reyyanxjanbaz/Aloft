export type Family = "quad" | "widebody" | "narrowbody" | "turboprop" | "ga";

const QUADS = new Set([
  "A388", "B744", "B748", "B741", "B742", "B743", "B74S", "A345", "A346",
  "A124", "A225", "C17", "C5M", "A400", "BLCF",
]);
const WIDEBODIES = new Set([
  "A332", "A333", "A339", "A359", "A35K", "A306", "A310", "A3ST", "A337",
  "B762", "B763", "B764", "B772", "B773", "B77W", "B77L", "B788", "B789", "B78X",
  "MD11", "IL76",
]);
const TURBOPROP_PREFIXES = ["AT4", "AT7", "DH8", "SF3", "SW4", "F50", "E110"];
// "C17" the prefix matches Cessna 172/177. The Globemaster (exact designator
// "C17") never reaches this check — it's already returned as "quad" above —
// but the prefix match is kept explicit in case QUADS is ever edited.
const GA_PREFIXES = ["P28", "C15", "C16", "C17", "C18", "C20", "C21", "SR2", "DA4", "DA2", "PA2", "PA3", "BE3", "BE5", "RV", "GLID"];

export function familyOf(typeIcao?: string): Family {
  const t = (typeIcao ?? "").toUpperCase();
  if (!t) return "narrowbody";
  if (QUADS.has(t)) return "quad";
  if (WIDEBODIES.has(t)) return "widebody";
  if (TURBOPROP_PREFIXES.some((p) => t.startsWith(p))) return "turboprop";
  if (t !== "C17" && GA_PREFIXES.some((p) => t.startsWith(p))) return "ga";
  return "narrowbody";
}
