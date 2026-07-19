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

/**
 * The same colours as literal hex, for canvas, which cannot resolve CSS
 * custom properties. Mirrors --rarity-* in styles/tokens.css; change both
 * together or a shared card stops matching the app it came from.
 */
export const RARITY_HEX: Record<Rarity, string> = {
  common: "#7e958c",
  uncommon: "#00e08a",
  rare: "#35d6ff",
  epic: "#ff5ce1",
  legendary: "#ffb627",
};

/** Flight-deck surface colours needed by canvas. Mirrors tokens.css. */
export const DECK_HEX = {
  void: "#040706",
  deck: "#080d0b",
  rule: "#1a2723",
  ruleHot: "#2b433a",
  ink: "#dcede6",
  ink2: "#7e958c",
  ink3: "#4a5c55",
  phos: "#00e08a",
  amber: "#ffb627",
} as const;
