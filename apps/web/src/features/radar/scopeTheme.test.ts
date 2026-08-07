import { describe, expect, it } from "vitest";
import type { Map as MapLibreMap } from "maplibre-gl";
import { applyScopeTheme, type ScopeDetail } from "./scopeTheme";

/**
 * The layers this basemap actually ships, trimmed to one of each kind. Water is
 * a *fill* here, which is the whole reason the coast ground outlines it rather
 * than hiding it — there is no coastline line layer to keep.
 */
const LAYERS = [
  { id: "background", type: "background" },
  { id: "landcover", type: "fill" },
  { id: "landuse_residential", type: "fill" },
  { id: "water", type: "fill" },
  { id: "water_shadow", type: "fill" },
  { id: "building", type: "fill" },
  { id: "building-top", type: "fill-extrusion" },
  { id: "waterway", type: "line" },
  { id: "boundary_country_outline", type: "line" },
  { id: "road_mot_fill_noramp", type: "line" },
  { id: "aeroway-runway", type: "line" },
  { id: "place_city_r6", type: "symbol" },
  { id: "poi_park", type: "symbol" },
  { id: "roadname_major", type: "symbol" },
].map((l) => (l.type === "background" ? l : { ...l, source: "carto" }));

/** The scope's own overlays, which share the style but must never be themed. */
const OVERLAY_LAYERS = [
  { id: "rings", type: "line", source: "rings" },
  { id: "capture", type: "line", source: "capture" },
  { id: "sweep", type: "line", source: "sweep" },
  { id: "predict", type: "line", source: "predict" },
  { id: "leader", type: "line", source: "leader" },
  { id: "trail", type: "circle", source: "trail" },
  { id: "aircraft", type: "symbol", source: "aircraft" },
];

const SOURCES: Record<string, { type: string }> = {
  carto: { type: "vector" },
  rings: { type: "geojson" },
  capture: { type: "geojson" },
  sweep: { type: "geojson" },
  predict: { type: "geojson" },
  leader: { type: "geojson" },
  trail: { type: "geojson" },
  aircraft: { type: "geojson" },
};

interface FakeMap {
  map: MapLibreMap;
  paint: Map<string, Record<string, unknown>>;
  layout: Map<string, Record<string, unknown>>;
}

/** Records what the theme sets, so both directions can be inspected. */
function fakeMap(layers = LAYERS): FakeMap {
  const paint = new Map<string, Record<string, unknown>>();
  const layout = new Map<string, Record<string, unknown>>();
  const map = {
    getStyle: () => ({ layers, sources: SOURCES }),
    setPaintProperty: (id: string, prop: string, value: unknown) => {
      paint.set(id, { ...(paint.get(id) ?? {}), [prop]: value });
    },
    setLayoutProperty: (id: string, prop: string, value: unknown) => {
      layout.set(id, { ...(layout.get(id) ?? {}), [prop]: value });
    },
  } as unknown as MapLibreMap;
  return { map, paint, layout };
}

const visibility = (f: FakeMap, id: string) => f.layout.get(id)?.visibility;
const paintOf = (f: FakeMap, id: string, prop: string) => f.paint.get(id)?.[prop];

function themed(detail: ScopeDetail): FakeMap {
  const f = fakeMap();
  applyScopeTheme(f.map, detail);
  return f;
}

describe("applyScopeTheme — shared behaviour", () => {
  it.each<ScopeDetail>(["full", "coast"])("drains the background in %s", (detail) => {
    expect(paintOf(themed(detail), "background", "background-color")).toBe("#040706");
  });

  it.each<ScopeDetail>(["full", "coast"])("keeps place labels and hides the rest in %s", (detail) => {
    const f = themed(detail);
    expect(visibility(f, "place_city_r6")).toBe("visible");
    expect(paintOf(f, "place_city_r6", "text-color")).toBe("#4a5c55");
    expect(visibility(f, "poi_park")).toBe("none");
    expect(visibility(f, "roadname_major")).toBe("none");
  });

  it.each<ScopeDetail>(["full", "coast"])("hides building extrusions in %s", (detail) => {
    expect(visibility(themed(detail), "building-top")).toBe("none");
  });
});

describe("applyScopeTheme — full", () => {
  it("keeps the land and water fills, drained to the deck palette", () => {
    const f = themed("full");
    expect(visibility(f, "landcover")).toBe("visible");
    expect(paintOf(f, "landcover", "fill-color")).toBe("#040706");
    expect(paintOf(f, "landcover", "fill-opacity")).toBe(0.6);
    expect(paintOf(f, "water", "fill-color")).toBe("#080d0b");
    expect(paintOf(f, "water", "fill-opacity")).toBe(1);
  });

  it("keeps roads and aeroways, dimmed", () => {
    const f = themed("full");
    expect(visibility(f, "road_mot_fill_noramp")).toBe("visible");
    expect(visibility(f, "aeroway-runway")).toBe("visible");
    expect(paintOf(f, "road_mot_fill_noramp", "line-color")).toBe("#1a2723");
  });

  it("leads with the borders", () => {
    const f = themed("full");
    expect(paintOf(f, "boundary_country_outline", "line-color")).toBe("#2b433a");
    expect(paintOf(f, "boundary_country_outline", "line-opacity")).toBe(0.8);
  });
});

describe("applyScopeTheme — coast", () => {
  it("outlines the water rather than hiding it", () => {
    // Hiding the fill would delete the coastline with it: there is no separate
    // coastline layer in this basemap.
    const f = themed("coast");
    expect(visibility(f, "water")).toBe("visible");
    expect(paintOf(f, "water", "fill-color")).toBe("#040706");
    expect(paintOf(f, "water", "fill-outline-color")).toBe("#2b433a");
    expect(paintOf(f, "water", "fill-antialias")).toBe(true);
  });

  it("hides the offset shadow copy so the coast is not drawn twice", () => {
    expect(visibility(themed("coast"), "water_shadow")).toBe("none");
  });

  it("hides every land fill", () => {
    const f = themed("coast");
    expect(visibility(f, "landcover")).toBe("none");
    expect(visibility(f, "landuse_residential")).toBe("none");
    expect(visibility(f, "building")).toBe("none");
  });

  it("keeps rivers and borders, hides roads and aeroways", () => {
    const f = themed("coast");
    expect(visibility(f, "waterway")).toBe("visible");
    expect(visibility(f, "boundary_country_outline")).toBe("visible");
    expect(visibility(f, "road_mot_fill_noramp")).toBe("none");
    expect(visibility(f, "aeroway-runway")).toBe("none");
  });

  it("leads with the water, not the borders", () => {
    // Inverted from `full` on purpose: with no land, the water's edge is the
    // only landmark, and a county line must not read as loudly as an estuary.
    const f = themed("coast");
    expect(paintOf(f, "waterway", "line-color")).toBe("#2b433a");
    expect(paintOf(f, "boundary_country_outline", "line-color")).toBe("#1a2723");
  });
});

describe("applyScopeTheme — switching back and forth", () => {
  it("restores everything coast hid", () => {
    // The map is repainted in place rather than rebuilt, so `full` has to put
    // back every layer `coast` turned off. Trusting the style's own defaults
    // would leave the land permanently missing after one toggle.
    const f = fakeMap();
    applyScopeTheme(f.map, "full");
    applyScopeTheme(f.map, "coast");
    applyScopeTheme(f.map, "full");

    for (const id of ["landcover", "landuse_residential", "building"]) {
      expect(visibility(f, id), `${id} should be back`).toBe("visible");
    }
    for (const id of ["road_mot_fill_noramp", "aeroway-runway", "waterway"]) {
      expect(visibility(f, id), `${id} should be back`).toBe("visible");
    }
    expect(paintOf(f, "landcover", "fill-color")).toBe("#040706");
  });

  it("clears the coastline outline when the fills come back", () => {
    // An outline colour cannot be unset, so `full` has to match it to the fill.
    // Otherwise a hairline coast stayed drawn over the filled water forever.
    const f = fakeMap();
    applyScopeTheme(f.map, "coast");
    applyScopeTheme(f.map, "full");
    expect(paintOf(f, "water", "fill-outline-color")).toBe(paintOf(f, "water", "fill-color"));
  });

  it("settles to the same result however many times it is toggled", () => {
    const once = fakeMap();
    applyScopeTheme(once.map, "coast");

    const many = fakeMap();
    for (const d of ["full", "coast", "full", "coast"] as ScopeDetail[]) {
      applyScopeTheme(many.map, d);
    }

    // Every layer must end up in the same shown/hidden state...
    expect(Object.fromEntries(many.layout)).toEqual(Object.fromEntries(once.layout));

    // ...and every layer that is actually drawn must look identical. Hidden
    // layers are allowed to carry stale paint from the other ground: it costs
    // nothing, and clearing it would mean tracking what each mode had set.
    for (const { id } of LAYERS) {
      if (visibility(many, id) === "none") continue;
      expect(many.paint.get(id) ?? {}, `${id} paint`).toEqual(once.paint.get(id) ?? {});
    }
  });
});

describe("applyScopeTheme — the scope's own overlays", () => {
  /*
   * The regression this exists to prevent: the theme used to run once, on
   * style load, before the scope had added any of its own layers. Re-applying
   * it to switch ground runs it against the finished style — and the very
   * first toggle hid the aircraft, the rings, the capture ring and the sweep,
   * because a `symbol` layer that is not a place label gets hidden and a
   * `line` layer that is not a river or a border gets hidden.
   */
  const withOverlays = () => {
    const f = fakeMap([...LAYERS, ...OVERLAY_LAYERS]);
    return f;
  };

  it.each<ScopeDetail>(["full", "coast"])("never touches them in %s", (detail) => {
    const f = withOverlays();
    applyScopeTheme(f.map, detail);
    for (const { id } of OVERLAY_LAYERS) {
      expect(f.layout.get(id), `${id} layout`).toBeUndefined();
      expect(f.paint.get(id), `${id} paint`).toBeUndefined();
    }
  });

  it("leaves the aircraft visible through repeated toggles", () => {
    const f = withOverlays();
    for (const d of ["full", "coast", "full", "coast"] as ScopeDetail[]) {
      applyScopeTheme(f.map, d);
    }
    expect(visibility(f, "aircraft")).toBeUndefined();
    expect(visibility(f, "capture")).toBeUndefined();
    expect(visibility(f, "sweep")).toBeUndefined();
    // ...while the basemap around them still switched.
    expect(visibility(f, "landcover")).toBe("none");
  });

  it("still themes the basemap when overlays are interleaved", () => {
    const f = withOverlays();
    applyScopeTheme(f.map, "coast");
    expect(visibility(f, "road_mot_fill_noramp")).toBe("none");
    expect(paintOf(f, "water", "fill-outline-color")).toBe("#2b433a");
  });
});

describe("applyScopeTheme — resilience", () => {
  it("does nothing when the style has not loaded", () => {
    const map = { getStyle: () => undefined } as unknown as MapLibreMap;
    expect(() => applyScopeTheme(map, "coast")).not.toThrow();
  });

  it("survives a layer that rejects a property", () => {
    // Layers and properties come and go between basemap versions; one refusal
    // must not abandon the rest of the style half-themed.
    const f = fakeMap();
    const original = f.map.setPaintProperty.bind(f.map);
    f.map.setPaintProperty = ((id: string, prop: string, value: unknown) => {
      if (id === "water") throw new Error("no such property in this style version");
      return original(id, prop, value);
    }) as MapLibreMap["setPaintProperty"];

    expect(() => applyScopeTheme(f.map, "coast")).not.toThrow();
    expect(visibility(f, "landcover")).toBe("none");
    expect(visibility(f, "waterway")).toBe("visible");
  });
});
