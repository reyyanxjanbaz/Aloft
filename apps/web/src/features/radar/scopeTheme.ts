import type { Map as MapLibreMap } from "maplibre-gl";

/**
 * Repaints the basemap into instrument colours at runtime.
 *
 * The stock dark basemap has blue water, brown landuse and bright POI labels —
 * all noise on a radar scope. Rather than ship a bespoke style file we walk the
 * loaded style once and flatten everything to the deck palette, so the map
 * reads as the background of an instrument rather than a map with a theme.
 *
 * Coastline only. The ground is one flat colour and the scope draws exactly
 * three kinds of line: the land/water edge, rivers, and administrative
 * boundaries. Roads, rail, landuse, parks, buildings and aeroways are hidden
 * outright rather than dimmed — this clears the field for the data blocks and
 * prediction vectors RadarMap draws on top. The cost was accepted with the
 * option: well inland the scope is a near-featureless field with rings on it,
 * which is why the place labels below are kept rather than hidden with the rest
 * of the symbol layers.
 *
 * Water is a *fill* in this basemap, not a line — there is no coastline layer to
 * keep. So the water polygon is painted the same colour as the land and given a
 * hairline `fill-outline-color`, which draws the edge and nothing else. Hiding
 * the fill instead would delete the coastline along with it.
 */
const TOKENS = {
  void: "#040706",
  rule: "#1a2723",
  ruleHot: "#2b433a",
  ink3: "#4a5c55",
};

/** Line layers worth keeping, by id substring. Everything else is clutter. */
const KEEP_LINES = ["waterway", "boundary", "admin"];
/** Fill layers to outline rather than hide. */
const WATER_FILLS = ["water", "ocean", "sea", "lake"];

function matches(kind: string, needles: string[]): boolean {
  return needles.some((n) => kind.includes(n));
}

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

    // Labels: keep only place names, dimmed. With no land fill at all these are
    // the only way to tell one blank area from another, so they earn their place.
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
      // `water_shadow` is an offset copy of the water polygon; outlining it too
      // would draw the coast twice, a pixel apart.
      const isWater = matches(kind, WATER_FILLS) && !kind.includes("shadow");
      if (!isWater) {
        safeSet(() => map.setLayoutProperty(id, "visibility", "none"));
        continue;
      }
      safeSet(() => map.setLayoutProperty(id, "visibility", "visible"));
      safeSet(() => map.setPaintProperty(id, "fill-antialias", true));
      safeSet(() => map.setPaintProperty(id, "fill-color", TOKENS.void));
      safeSet(() => map.setPaintProperty(id, "fill-outline-color", TOKENS.ruleHot));
      safeSet(() => map.setPaintProperty(id, "fill-opacity", 1));
      continue;
    }

    if (layer.type === "fill-extrusion") {
      safeSet(() => map.setLayoutProperty(id, "visibility", "none"));
      continue;
    }

    if (layer.type === "line") {
      if (!matches(kind, KEEP_LINES)) {
        safeSet(() => map.setLayoutProperty(id, "visibility", "none"));
        continue;
      }
      const isBoundary = kind.includes("boundary") || kind.includes("admin");
      safeSet(() => map.setLayoutProperty(id, "visibility", "visible"));
      safeSet(() =>
        map.setPaintProperty(id, "line-color", isBoundary ? TOKENS.rule : TOKENS.ruleHot)
      );
      safeSet(() => map.setPaintProperty(id, "line-opacity", isBoundary ? 0.55 : 0.8));
      safeSet(() => map.setPaintProperty(id, "line-width", 1));
      safeSet(() => map.setPaintProperty(id, "line-dasharray", [1]));
    }
  }
}
