import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { useEffect, useRef } from "react";
import { CAPTURE_RADIUS_KM, deadReckon, destinationPoint, distanceM } from "@aloft/shared";
import type { PlayerPosition } from "../../lib/useGeolocation";
import { projectedPosition } from "../../lib/project";
import { releaseMapView, serverNow, setMapView, usePlanes } from "../../state/planes";
import { applyScopeTheme, type ScopeDetail } from "./scopeTheme";
import {
  selectBlocks,
  selectPredicted,
  selectTrailed,
  PREDICT_SEC,
  type BlockDatum,
} from "./dataBlocks";
import { clearTracks, recordTracks, trailFor } from "./trackHistory";

const STYLE_URL = "https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json";

/**
 * Screen distance from a mark to its data block. Held constant in pixels by
 * converting to ground distance at the current zoom every frame — a fixed
 * offset in degrees would grow to hundreds of kilometres when zoomed out.
 */
const LEADER_PX = 26;
/** Bearing the leader runs along: up and to the right, as on a real scope. */
const LEADER_BEARING = 55;
/** Footprint a data block needs to stay readable, in screen pixels. */
const BLOCK_W = 62;
const BLOCK_H = 26;

/** Ground metres per screen pixel at this zoom and latitude. */
function metresPerPixel(lat: number, zoom: number): number {
  return (156543.03392 * Math.cos((lat * Math.PI) / 180)) / 2 ** zoom;
}

const TREND_MARK = { up: "↑", down: "↓", level: "·" } as const;

/** Plan-view aircraft silhouette, nose up. Drawn as an SDF so it can be tinted. */
const AIRCRAFT_PATH =
  "M12 1.6 L13.3 5 L13.3 9.1 L22.4 14.2 L22.4 16.3 L13.3 13.7 L13.3 18.6 L15.7 20.4 L15.7 21.9 L12 20.9 L8.3 21.9 L8.3 20.4 L10.7 18.6 L10.7 13.7 L1.6 16.3 L1.6 14.2 L10.7 9.1 L10.7 5 Z";

const ICON_PX = 64;

/** Rasterise the silhouette into ImageData so MapLibre can tint it per feature. */
function aircraftImage(): Promise<ImageData> {
  return new Promise((resolve, reject) => {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${ICON_PX}" height="${ICON_PX}" viewBox="0 0 24 24"><path d="${AIRCRAFT_PATH}" fill="#fff"/></svg>`;
    const img = new Image(ICON_PX, ICON_PX);
    img.onload = () => {
      const canvas = document.createElement("canvas");
      canvas.width = ICON_PX;
      canvas.height = ICON_PX;
      const ctx = canvas.getContext("2d");
      if (!ctx) return reject(new Error("no 2d context"));
      ctx.drawImage(img, 0, 0);
      resolve(ctx.getImageData(0, 0, ICON_PX, ICON_PX));
    };
    img.onerror = () => reject(new Error("icon failed to load"));
    img.src = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg);
  });
}

function ringFeature(lat: number, lon: number, km: number): GeoJSON.Feature<GeoJSON.LineString> {
  const coords: [number, number][] = [];
  for (let i = 0; i <= 96; i++) {
    const [pLat, pLon] = destinationPoint(lat, lon, (i * 360) / 96, km * 1000);
    coords.push([pLon, pLat]);
  }
  return {
    type: "Feature",
    geometry: { type: "LineString", coordinates: coords },
    properties: { km },
  };
}

/** Concentric range rings: two reference rings plus the solid capture ring. */
function rangeRings(lat: number, lon: number): GeoJSON.FeatureCollection {
  return {
    type: "FeatureCollection",
    features: [
      ringFeature(lat, lon, CAPTURE_RADIUS_KM / 3),
      ringFeature(lat, lon, (CAPTURE_RADIUS_KM * 2) / 3),
    ],
  };
}

/** Viewport radius in km — centre to the far corner, so nothing visible is missed. */
function viewRadiusKm(map: maplibregl.Map): number {
  const c = map.getCenter();
  const b = map.getBounds();
  const ne = b.getNorthEast();
  return distanceM(c.lat, c.lng, ne.lat, ne.lng) / 1000;
}

export function RadarMap({
  position,
  recenterSignal,
  detail,
}: {
  position: PlayerPosition;
  recenterSignal: number;
  detail: ScopeDetail;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const blocksRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const readyRef = useRef(false);
  const posRef = useRef(position);
  posRef.current = position;
  // Read through a ref by the map-creation effect, which runs once and must
  // not be torn down and rebuilt just because the ground changed.
  const detailRef = useRef(detail);
  detailRef.current = detail;

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;

    // Guards the async chain below: aircraftImage() decodes an SVG data URI
    // over a few event-loop turns, and if the component unmounts in that
    // window (a fast tab switch), `map.remove()` in this effect's cleanup
    // has already torn the map down by the time `.finally()` runs — without
    // this flag, addSource/addLayer would throw on the removed instance.
    let cancelled = false;

    const map = new maplibregl.Map({
      container: containerRef.current,
      style: STYLE_URL,
      center: [position.lon, position.lat],
      zoom: 8.6,
      attributionControl: false,
      dragRotate: false,
    });
    mapRef.current = map;

    map.on("load", () => {
      applyScopeTheme(map, detailRef.current);

      void aircraftImage()
        .then((image) => {
          if (!map.hasImage("aircraft")) map.addImage("aircraft", image, { sdf: true });
        })
        .catch(() => {
          /* falls back to the circle layer below */
        })
        .finally(() => {
          if (cancelled) return;
          const { lat, lon } = posRef.current;

          map.addSource("rings", { type: "geojson", data: rangeRings(lat, lon) });
          map.addLayer({
            id: "rings",
            type: "line",
            source: "rings",
            paint: {
              "line-color": "#1a2723",
              "line-width": 1,
              "line-dasharray": [3, 4],
            },
          });

          map.addSource("capture", {
            type: "geojson",
            data: ringFeature(lat, lon, CAPTURE_RADIUS_KM),
          });
          map.addLayer({
            id: "capture",
            type: "line",
            source: "capture",
            paint: { "line-color": "#0c8c59", "line-width": 1.25 },
          });

          // Signature: a sweep arm rotating inside the capture ring. Drawn as a
          // geographic feature so it stays anchored while the scope is panned.
          map.addSource("sweep", {
            type: "geojson",
            data: { type: "FeatureCollection", features: [] },
          });
          map.addLayer({
            id: "sweep",
            type: "line",
            source: "sweep",
            paint: { "line-color": "#00e08a", "line-width": 1, "line-opacity": 0.5 },
          });

          // Trail: where the contact has actually been, decaying backwards.
          // Added before the aircraft layer so marks always draw on top.
          map.addSource("trail", {
            type: "geojson",
            data: { type: "FeatureCollection", features: [] },
          });
          map.addLayer({
            id: "trail",
            type: "circle",
            source: "trail",
            paint: {
              "circle-radius": ["get", "r"],
              "circle-color": ["get", "tint"],
              "circle-opacity": ["get", "fade"],
            },
          });

          // Prediction: where it will be in a minute, if it holds this track.
          // Dashed because it is an extrapolation, not an observation.
          map.addSource("predict", {
            type: "geojson",
            data: { type: "FeatureCollection", features: [] },
          });
          map.addLayer({
            id: "predict",
            type: "line",
            source: "predict",
            filter: ["==", ["geometry-type"], "LineString"],
            paint: {
              "line-color": ["get", "tint"],
              "line-width": 1,
              "line-opacity": 0.55,
              "line-dasharray": [2, 3],
            },
          });
          map.addLayer({
            id: "predict-end",
            type: "circle",
            source: "predict",
            filter: ["==", ["geometry-type"], "Point"],
            paint: {
              "circle-radius": 2.5,
              "circle-color": "rgba(0,0,0,0)",
              "circle-stroke-color": ["get", "tint"],
              "circle-stroke-width": 1,
              "circle-opacity": 0.55,
            },
          });

          // Leader lines for the data blocks. The block's HTML sits at the far
          // end of these, so the two stay glued while the scope is panned.
          map.addSource("leader", {
            type: "geojson",
            data: { type: "FeatureCollection", features: [] },
          });
          map.addLayer({
            id: "leader",
            type: "line",
            source: "leader",
            paint: { "line-color": "#2b433a", "line-width": 1 },
          });

          map.addSource("player", {
            type: "geojson",
            data: {
              type: "Feature",
              geometry: { type: "Point", coordinates: [lon, lat] },
              properties: {},
            },
          });
          map.addLayer({
            id: "player",
            type: "circle",
            source: "player",
            paint: {
              "circle-radius": 4,
              "circle-color": "#00e08a",
              "circle-stroke-color": "#040706",
              "circle-stroke-width": 2,
            },
          });

          map.addSource("aircraft", {
            type: "geojson",
            data: { type: "FeatureCollection", features: [] },
          });

          // Fallback dot layer, drawn only where the SDF icon is unavailable.
          if (!map.hasImage("aircraft")) {
            map.addLayer({
              id: "aircraft",
              type: "circle",
              source: "aircraft",
              paint: {
                "circle-radius": 3.5,
                "circle-color": ["get", "tint"],
              },
            });
          } else {
            map.addLayer({
              id: "aircraft",
              type: "symbol",
              source: "aircraft",
              layout: {
                "icon-image": "aircraft",
                "icon-size": ["case", ["get", "selected"], 0.42, 0.34],
                "icon-rotate": ["get", "track"],
                "icon-rotation-alignment": "map",
                "icon-allow-overlap": true,
                "icon-ignore-placement": true,
              },
              paint: {
                "icon-color": ["get", "tint"],
                "icon-opacity": ["case", ["get", "inRange"], 1, 0.62],
              },
            });
          }

          map.on("click", "aircraft", (e) => {
            const hex = e.features?.[0]?.properties?.hex as string | undefined;
            if (hex) usePlanes.getState().select(hex);
          });
          map.on("click", (e) => {
            if (map.queryRenderedFeatures(e.point, { layers: ["aircraft"] }).length === 0) {
              usePlanes.getState().select(null);
            }
          });
          map.on("mouseenter", "aircraft", () => {
            map.getCanvas().style.cursor = "pointer";
          });
          map.on("mouseleave", "aircraft", () => {
            map.getCanvas().style.cursor = "";
          });

          readyRef.current = true;
          setMapView({ lat: map.getCenter().lat, lon: map.getCenter().lng, viewRadiusKm: viewRadiusKm(map) });
        });
    });

    // Re-aim the feed whenever the scope settles on a new area. While this
    // map is mounted it owns the view; GPS ticks no longer override it.
    const onMoveEnd = () => {
      const c = map.getCenter();
      setMapView({ lat: c.lat, lon: c.lng, viewRadiusKm: viewRadiusKm(map) });
    };
    map.on("moveend", onMoveEnd);

    // The shell lays out after the map is constructed, so the canvas can be
    // created at the wrong size and project the centre incorrectly. Track the
    // container and tell MapLibre whenever it actually changes size.
    const observer = new ResizeObserver(() => map.resize());
    observer.observe(containerRef.current);

    if (import.meta.env.DEV) {
      (window as unknown as { __aloftMap?: maplibregl.Map }).__aloftMap = map;
    }

    return () => {
      cancelled = true;
      observer.disconnect();
      readyRef.current = false;
      // Hand view ownership back so the feed follows the device again while
      // the player is on another tab.
      releaseMapView();
      // Trails are only meaningful for a live session; keeping them across a
      // tab switch would draw a jump from wherever the contact was minutes ago.
      clearTracks();
      map.remove();
      mapRef.current = null;
    };
    // Created once — position and plane updates flow through the sources below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Keep player marker and rings pinned to the current position.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !readyRef.current) return;
    (map.getSource("player") as maplibregl.GeoJSONSource | undefined)?.setData({
      type: "Feature",
      geometry: { type: "Point", coordinates: [position.lon, position.lat] },
      properties: {},
    });
    (map.getSource("rings") as maplibregl.GeoJSONSource | undefined)?.setData(
      rangeRings(position.lat, position.lon)
    );
    (map.getSource("capture") as maplibregl.GeoJSONSource | undefined)?.setData(
      ringFeature(position.lat, position.lon, CAPTURE_RADIUS_KM)
    );
  }, [position.lat, position.lon]);

  /*
   * Switching ground repaints the existing style rather than rebuilding the
   * map. Tearing the map down would drop every source and layer, flash the
   * scope empty, and re-download tiles for a change that is only paint.
   *
   * Skipped until the style has loaded, because the load handler applies the
   * theme itself — running twice would be harmless but pointless.
   */
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !readyRef.current) return;
    applyScopeTheme(map, detail);
  }, [detail]);

  // Recenter on demand from the scope control.
  useEffect(() => {
    if (!recenterSignal || !readyRef.current) return;
    mapRef.current?.easeTo({
      center: [posRef.current.lon, posRef.current.lat],
      zoom: 9,
      duration: 520,
    });
  }, [recenterSignal]);

  // Dead-reckon between server frames so contacts glide instead of stepping.
  useEffect(() => {
    let raf = 0;
    let last = 0;
    // Read live rather than latched at mount, so toggling the OS setting
    // takes effect without reloading the app.
    const motionQuery = window.matchMedia("(prefers-reduced-motion: reduce)");

    const frame = (now: number) => {
      raf = requestAnimationFrame(frame);
      if (now - last < 50) return; // 20 fps keeps the sweep smooth without churn
      last = now;

      const map = mapRef.current;
      if (!map || !readyRef.current) return;
      const source = map.getSource("aircraft") as maplibregl.GeoJSONSource | undefined;
      if (!source) return;

      const { planes, selectedHex } = usePlanes.getState();
      const me = posRef.current;
      const features: GeoJSON.Feature[] = [];

      if (!motionQuery.matches) {
        const bearing = ((now / 5000) * 360) % 360;
        const [tipLat, tipLon] = destinationPoint(
          me.lat,
          me.lon,
          bearing,
          CAPTURE_RADIUS_KM * 1000
        );
        (map.getSource("sweep") as maplibregl.GeoJSONSource | undefined)?.setData({
          type: "Feature",
          geometry: {
            type: "LineString",
            coordinates: [
              [me.lon, me.lat],
              [tipLon, tipLat],
            ],
          },
          properties: {},
        });
      }

      // Record before drawing, so a contact's first frame already has a fix in
      // hand and the trail starts one sample behind rather than two.
      recordTracks(planes.values());

      const tNow = serverNow();
      const trailFeatures: GeoJSON.Feature[] = [];
      const tints = new Map<string, string>();

      for (const ac of planes.values()) {
        const { lat, lon } = projectedPosition(ac, tNow);
        const inRange = distanceM(me.lat, me.lon, lat, lon) <= CAPTURE_RADIUS_KM * 1000;
        const selected = ac.hex === selectedHex;
        // Magenta marks the active target, green marks a capturable contact.
        const tint = selected ? "#ff5ce1" : inRange ? "#00e08a" : "#5c7d70";
        tints.set(ac.hex, tint);
        features.push({
          type: "Feature",
          geometry: { type: "Point", coordinates: [lon, lat] },
          properties: {
            hex: ac.hex,
            // Icon rotation only — a trackless aircraft is drawn nose-north
            // rather than hidden, but it is never *projected* that way.
            track: ac.track ?? 0,
            inRange,
            selected,
            tint,
          },
        });
      }

      // Trails only for the nearest handful. Building them for the whole feed
      // meant thousands of throwaway features per frame on a busy cell, for
      // marks too small and too far away to read a trail on.
      for (const ac of selectTrailed(planes.values(), me, selectedHex, tNow)) {
        const tint = tints.get(ac.hex) ?? "#5c7d70";
        // Oldest fix faintest and smallest, so the trail reads as decay rather
        // than as a dotted line of equal marks.
        const past = trailFor(ac.hex);
        past.forEach((p, i) => {
          const age = (i + 1) / (past.length + 1);
          trailFeatures.push({
            type: "Feature",
            geometry: { type: "Point", coordinates: [p.lon, p.lat] },
            properties: { tint, r: 1 + age * 1.4, fade: 0.12 + age * 0.4 },
          });
        });
      }
      source.setData({ type: "FeatureCollection", features });
      (map.getSource("trail") as maplibregl.GeoJSONSource | undefined)?.setData({
        type: "FeatureCollection",
        features: trailFeatures,
      });

      // Prediction vectors, only for what is actually coming to us.
      const predictFeatures: GeoJSON.Feature[] = [];
      for (const ac of selectPredicted(planes.values(), me, selectedHex, tNow)) {
        const p = projectedPosition(ac, tNow);
        const [endLat, endLon] = deadReckon(p.lat, p.lon, ac.track, ac.gsKt, PREDICT_SEC);
        const tint = tints.get(ac.hex) ?? "#5c7d70";
        predictFeatures.push({
          type: "Feature",
          geometry: {
            type: "LineString",
            coordinates: [
              [p.lon, p.lat],
              [endLon, endLat],
            ],
          },
          properties: { tint },
        });
        predictFeatures.push({
          type: "Feature",
          geometry: { type: "Point", coordinates: [endLon, endLat] },
          properties: { tint },
        });
      }
      (map.getSource("predict") as maplibregl.GeoJSONSource | undefined)?.setData({
        type: "FeatureCollection",
        features: predictFeatures,
      });

      // Data blocks: leader lines are geographic, the text is HTML positioned
      // at the far end of each leader. The block has to be HTML — the basemap's
      // glyph service has no monospaced face, and every readout in this app is
      // mono with tabular numerals.
      const zoom = map.getZoom();
      const blocks = selectBlocks(planes.values(), me, selectedHex, zoom, tNow);
      const offsetM = LEADER_PX * metresPerPixel(me.lat, zoom);
      const leaderFeatures: GeoJSON.Feature[] = [];
      const anchors: Array<{ datum: BlockDatum; x: number; y: number }> = [];

      /*
       * Screen-space decluttering. The cap and the priority sort decide which
       * contacts *deserve* a block; this decides which of them can actually be
       * read. Over a hub the marks are metres apart on screen and the blocks
       * pile into an illegible stack — the option that introduced them said so.
       *
       * Greedy, in priority order, so the result is stable between frames:
       * a block is placed only if it clears every block already placed. Losing
       * a lower-priority block is the correct outcome — it was going to be
       * unreadable anyway, and its mark is still on the scope.
       */
      const canvas = map.getCanvas();
      const viewW = canvas.clientWidth;
      const viewH = canvas.clientHeight;

      for (const datum of blocks) {
        const [aLat, aLon] = destinationPoint(datum.lat, datum.lon, LEADER_BEARING, offsetM);
        const pt = map.project([aLon, aLat]);

        // A block that runs off the edge is a truncated callsign, which is
        // worse than no callsign — the overlay clips rather than wrapping.
        if (pt.x < 0 || pt.y < 0 || pt.x + BLOCK_W > viewW || pt.y + BLOCK_H > viewH) continue;

        const collides = anchors.some(
          (a) => Math.abs(a.x - pt.x) < BLOCK_W && Math.abs(a.y - pt.y) < BLOCK_H
        );
        // The selected contact always gets its block, whatever it overlaps —
        // hiding the readout for the one thing the player just tapped would be
        // the decluttering working against them.
        if (collides && !datum.selected) continue;

        anchors.push({ datum, x: pt.x, y: pt.y });
        leaderFeatures.push({
          type: "Feature",
          geometry: {
            type: "LineString",
            coordinates: [
              [datum.lon, datum.lat],
              [aLon, aLat],
            ],
          },
          properties: {},
        });
      }
      (map.getSource("leader") as maplibregl.GeoJSONSource | undefined)?.setData({
        type: "FeatureCollection",
        features: leaderFeatures,
      });
      paintBlocks(blocksRef.current, anchors);
    };

    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, []);

  return (
    <div className="scope__map" ref={containerRef}>
      <div className="scope__blocks" ref={blocksRef} aria-hidden="true" />
    </div>
  );
}

/**
 * Writes the data blocks into the overlay, reusing elements between frames.
 *
 * Rebuilding twelve nodes twenty times a second would churn the DOM for no
 * reason, so the pool only grows and surplus elements are hidden rather than
 * removed. Text is only assigned when it has actually changed — at 20fps the
 * ident and level are identical on almost every frame, and only the transform
 * really moves.
 */
function paintBlocks(
  host: HTMLDivElement | null,
  anchors: Array<{ datum: BlockDatum; x: number; y: number }>
): void {
  if (!host) return;

  while (host.childElementCount < anchors.length) {
    const el = document.createElement("div");
    el.className = "dblk";
    el.innerHTML = '<b class="dblk__id"></b><span class="dblk__row"></span>';
    host.appendChild(el);
  }

  const children = host.children;
  for (let i = 0; i < children.length; i++) {
    const el = children[i] as HTMLDivElement;
    const anchor = anchors[i];
    if (!anchor) {
      el.style.display = "none";
      continue;
    }
    const { datum, x, y } = anchor;
    el.style.display = "";
    el.style.transform = `translate3d(${Math.round(x)}px, ${Math.round(y)}px, 0)`;
    // Only the selection is styled — the mark's own colour already says
    // whether a contact is in range, and lighting the block too meant every
    // readout over a hub was full phosphor at once.
    const state = datum.selected ? "sel" : "";
    if (el.dataset.state !== state) {
      el.dataset.state = state;
      el.className = state ? `dblk dblk--${state}` : "dblk";
    }
    const ident = el.firstElementChild as HTMLElement;
    if (ident.textContent !== datum.ident) ident.textContent = datum.ident;
    const row = el.lastElementChild as HTMLElement;
    const text = `${datum.level} ${TREND_MARK[datum.trend]} ${datum.gs}`;
    if (row.textContent !== text) row.textContent = text;
  }
}
