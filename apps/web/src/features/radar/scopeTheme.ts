import type { Map as MapLibreMap } from "maplibre-gl";

/**
 * Repaints the basemap into instrument colours at runtime.
 *
 * The stock dark basemap has blue water, brown landuse and bright POI labels —
 * all noise on a radar scope. Rather than ship a bespoke style file we walk the
 * loaded style once and flatten everything to the deck palette, so the map
 * reads as the background of an instrument rather than a map with a theme.
 *
 * Two grounds, switchable from the scope's declutter key:
 *
 * - `full` — the flattened basemap. Land, water and every line kept but
 *   drained to the deck palette. You can see where a contact is relative to a
 *   town, a motorway, a river.
 * - `coast` — the land/water edge, rivers and borders, and nothing else.
 *   What an actual radar display shows. Clears the field for the data blocks
 *   and prediction vectors RadarMap draws on top, at the cost of being close
 *   to featureless well inland.
 *
 * Both modes set every property they touch, in both directions. That is what
 * makes switching reversible: `coast` hides layers, so `full` has to put their
 * visibility back rather than trusting the style's defaults. Anything a mode
 * cannot restore — line widths, dash patterns, the zoom expressions the style
 * ships for roads — is deliberately never overwritten by either.
 */
export type ScopeDetail = "full" | "coast";

const TOKENS = {
  void: "#040706",
  deck: "#080d0b",
  rule: "#1a2723",
  ruleHot: "#2b433a",
  ink3: "#4a5c55",
};

/** Fill layers that represent water, by id substring. */
const WATER = ["water", "ocean", "sea", "lake"];
/** Line layers `coast` keeps: the water's edge and administrative borders. */
const COAST_LINES = ["waterway", "boundary", "admin"];

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

export function applyScopeTheme(map: MapLibreMap, detail: ScopeDetail = "full"): void {
  const style = map.getStyle();
  if (!style?.layers) return;
  const sources: Record<string, { type?: string } | undefined> = style.sources ?? {};

  /*
   * Only the basemap gets repainted. The scope's own overlays — the rings, the
   * sweep, the trails, the prediction vectors, the leader lines, the aircraft
   * themselves — live in this same style, and every one of them would be caught
   * by the rules below: the aircraft layer is a `symbol`, so it is not a place
   * label and would be hidden; the rings and vectors are `line` layers that
   * match nothing the coast ground keeps.
   *
   * This never bit before because the theme was applied once, on style load,
   * before any of those layers had been added. Re-applying it to switch ground
   * runs it against the finished style, and the first toggle wiped the scope.
   *
   * Keyed on the source's type rather than a list of ids so it cannot drift:
   * the basemap is a vector source, and everything this app draws is GeoJSON.
   */
  const isBasemap = (layer: { type: string; source?: string }): boolean => {
    if (layer.type === "background") return true;
    if (!layer.source) return false;
    const type = sources[layer.source]?.type;
    return type === "vector" || type === "raster";
  };

  for (const layer of style.layers) {
    if (!isBasemap(layer as { type: string; source?: string })) continue;
    const id = layer.id;
    const kind = id.toLowerCase();

    if (layer.type === "background") {
      safeSet(() => map.setPaintProperty(id, "background-color", TOKENS.void));
      continue;
    }

    // Labels are identical in both modes. Place names only, dimmed — and in
    // `coast` they carry more weight than usual, because with no land fill at
    // all they are the only way to tell one blank area from another.
    if (layer.type === "symbol") {
      const isPlace = kind.includes("place") || kind.includes("country") || kind.includes("state");
      if (!isPlace) {
        safeSet(() => map.setLayoutProperty(id, "visibility", "none"));
        continue;
      }
      safeSet(() => map.setLayoutProperty(id, "visibility", "visible"));
      safeSet(() => map.setPaintProperty(id, "text-color", TOKENS.ink3));
      safeSet(() => map.setPaintProperty(id, "text-halo-color", TOKENS.void));
      safeSet(() => map.setPaintProperty(id, "text-halo-width", 1.5));
      continue;
    }

    if (layer.type === "fill") {
      const isWater = matches(kind, WATER);
      // `water_shadow` is an offset copy of the water polygon. The coast ground
      // must not outline it as well or the coastline is drawn twice, a pixel
      // apart — but the full ground still paints it with the water it belongs
      // to, which is what the original flattened basemap did.
      const isCoastEdge = isWater && !kind.includes("shadow");

      if (detail === "coast") {
        if (!isCoastEdge) {
          safeSet(() => map.setLayoutProperty(id, "visibility", "none"));
          continue;
        }
        // Water is a *fill* in this basemap; there is no coastline layer to
        // keep. Painting the polygon the same colour as the land and giving it
        // a hairline outline draws the edge and nothing else. Hiding the fill
        // instead would delete the coastline along with it.
        safeSet(() => map.setLayoutProperty(id, "visibility", "visible"));
        safeSet(() => map.setPaintProperty(id, "fill-antialias", true));
        safeSet(() => map.setPaintProperty(id, "fill-color", TOKENS.void));
        safeSet(() => map.setPaintProperty(id, "fill-outline-color", TOKENS.ruleHot));
        safeSet(() => map.setPaintProperty(id, "fill-opacity", 1));
        continue;
      }

      safeSet(() => map.setLayoutProperty(id, "visibility", "visible"));
      safeSet(() => map.setPaintProperty(id, "fill-color", isWater ? TOKENS.deck : TOKENS.void));
      // Matching the fill hides the outline `coast` turned on, which is the
      // only way back — an outline colour cannot be unset.
      safeSet(() =>
        map.setPaintProperty(id, "fill-outline-color", isWater ? TOKENS.deck : TOKENS.void)
      );
      safeSet(() => map.setPaintProperty(id, "fill-opacity", isWater ? 1 : 0.6));
      continue;
    }

    // Extrusions are hidden in both modes: buildings only appear past a zoom
    // the scope never reaches, and they are pure clutter when they do.
    if (layer.type === "fill-extrusion") {
      safeSet(() => map.setLayoutProperty(id, "visibility", "none"));
      continue;
    }

    if (layer.type === "line") {
      const isBoundary = kind.includes("boundary") || kind.includes("admin");

      if (detail === "coast" && !matches(kind, COAST_LINES)) {
        // Roads, rail, landuse edges and aeroways are clutter on a scope.
        safeSet(() => map.setLayoutProperty(id, "visibility", "none"));
        continue;
      }

      /*
       * Which line leads differs by mode, because the two grounds are read for
       * different things. On the full basemap the borders are the structure
       * and everything else is texture behind it. On the coast ground the
       * water's edge is the only real landmark, so rivers take the strong ink
       * and borders drop back — otherwise a county line would read as loudly as
       * an estuary.
       */
      const lead = detail === "coast" ? !isBoundary : isBoundary;
      safeSet(() => map.setLayoutProperty(id, "visibility", "visible"));
      safeSet(() => map.setPaintProperty(id, "line-color", lead ? TOKENS.ruleHot : TOKENS.rule));
      safeSet(() => map.setPaintProperty(id, "line-opacity", lead ? 0.8 : 0.5));
    }
  }
}
