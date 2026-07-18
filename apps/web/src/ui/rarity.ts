import type { Rarity } from "@aloft/shared";

/**
 * Rarity is encoded with real avionics status colour: green is normal,
 * cyan is information, magenta is the active target, amber is caution.
 * Colour alone never carries the meaning — the tier is always spelled out.
 */
export const RARITY_LABEL: Record<Rarity, string> = {
  common: "Common",
  uncommon: "Uncommon",
  rare: "Rare",
  epic: "Epic",
  legendary: "Legendary",
};

export function rarityVar(rarity: Rarity): string {
  return `var(--rarity-${rarity})`;
}
