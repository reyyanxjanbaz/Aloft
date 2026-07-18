import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { useEffect, useRef } from "react";
import {
  CAPTURE_RADIUS_KM,
  deadReckon,
  destinationPoint,
  distanceM,
} from "@aloft/shared";
import type { PlayerPosition } from "../../lib/useGeolocation";
import { updateView, usePlanes } from "../../state/planes";
import { applyScopeTheme } from "./scopeTheme";

const STYLE_URL = "https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json";

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
}: {
  position: PlayerPosition;
  recenterSignal: number;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const readyRef = useRef(false);
  const posRef = useRef(position);
  posRef.current = position;

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;

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
      applyScopeTheme(map);

      void aircraftImage()
        .then((image) => {
          if (!map.hasImage("aircraft")) map.addImage("aircraft", image, { sdf: true });
        })
        .catch(() => {
          /* falls back to the circle layer below */
        })
        .finally(() => {
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
          updateView({ lat: map.getCenter().lat, lon: map.getCenter().lng, viewRadiusKm: viewRadiusKm(map) });
        });
    });

    // Re-aim the feed whenever the scope settles on a new area.
    const onMoveEnd = () => {
      const c = map.getCenter();
      updateView({ lat: c.lat, lon: c.lng, viewRadiusKm: viewRadiusKm(map) });
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
      observer.disconnect();
      readyRef.current = false;
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

  // Recenter on demand from the scope control.
  useEffect(() => {
    if (!recenterSignal) return;
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
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

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
      const ts = Date.now();
      const features: GeoJSON.Feature[] = [];

      if (!reducedMotion) {
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

      for (const ac of planes.values()) {
        const ageSec = (ts - ac.ts) / 1000 + ac.seenPosSec;
        const [lat, lon] = deadReckon(ac.lat, ac.lon, ac.track, ac.gsKt, Math.min(ageSec, 60));
        const inRange = distanceM(me.lat, me.lon, lat, lon) <= CAPTURE_RADIUS_KM * 1000;
        const selected = ac.hex === selectedHex;
        features.push({
          type: "Feature",
          geometry: { type: "Point", coordinates: [lon, lat] },
          properties: {
            hex: ac.hex,
            track: ac.track,
            inRange,
            selected,
            // Magenta marks the active target, green marks a capturable contact.
            tint: selected ? "#ff5ce1" : inRange ? "#00e08a" : "#5c7d70",
          },
        });
      }
      source.setData({ type: "FeatureCollection", features });
    };

    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, []);

  return <div ref={containerRef} className="scope__map" />;
}
