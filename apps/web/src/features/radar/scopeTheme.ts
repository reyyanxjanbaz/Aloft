import type { Map as MapLibreMap } from "maplibre-gl";

/**
 * Repaints the basemap into instrument colours at runtime.
 *
 * The stock dark basemap has blue water, brown landuse and bright POI labels —
 * all noise on a radar scope. Rather than ship a bespoke style file we walk the
 * loaded style once and flatten everything to the deck palette, so the map
 * reads as the background of an instrument rather than a map with a theme.
 */
const TOKENS = {
  void: "#040706",
  deck: "#080d0b",
  rule: "#1a2723",
  ruleHot: "#2b433a",
  ink3: "#4a5c55",
};

function safeSet(fn: () => void): void {
  try {
    fn();
  } catch {
    /* layer or property absent in this style version — ignore */
  }
}

export function applyScopeTheme(map: MapLibreMap): void {
  const style = map.getStyle();
  if (!style?.layers) return;

  for (const layer of style.layers) {
    const id = layer.id;
    const kind = id.toLowerCase();

    if (layer.type === "background") {
      safeSet(() => map.setPaintProperty(id, "background-color", TOKENS.void));
      continue;
    }

    // Labels: keep only place names, dimmed. Everything else is clutter.
    if (layer.type === "symbol") {
      const isPlace = kind.includes("place") || kind.includes("country") || kind.includes("state");
      if (!isPlace) {
        safeSet(() => map.setLayoutProperty(id, "visibility", "none"));
        continue;
      }
      safeSet(() => map.setPaintProperty(id, "text-color", TOKENS.ink3));
      safeSet(() => map.setPaintProperty(id, "text-halo-color", TOKENS.void));
      safeSet(() => map.setPaintProperty(id, "text-halo-width", 1.5));
      continue;
    }

    if (layer.type === "fill") {
      const isWater = kind.includes("water") || kind.includes("ocean") || kind.includes("sea");
      safeSet(() => map.setPaintProperty(id, "fill-color", isWater ? TOKENS.deck : TOKENS.void));
      safeSet(() => map.setPaintProperty(id, "fill-opacity", isWater ? 1 : 0.6));
      continue;
    }

    if (layer.type === "line") {
      const isBoundary = kind.includes("boundary") || kind.includes("admin");
      safeSet(() =>
        map.setPaintProperty(id, "line-color", isBoundary ? TOKENS.ruleHot : TOKENS.rule)
      );
      safeSet(() => map.setPaintProperty(id, "line-opacity", isBoundary ? 0.8 : 0.5));
      continue;
    }

    if (layer.type === "fill-extrusion") {
      safeSet(() => map.setLayoutProperty(id, "visibility", "none"));
    }
  }
}
