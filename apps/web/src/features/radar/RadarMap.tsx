import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { useEffect, useRef } from "react";
import { deadReckon, destinationPoint, DEFAULT_RADIUS_KM } from "@aloft/shared";
import type { PlayerPosition } from "../../lib/useGeolocation";
import { usePlanes } from "../../state/planes";

const MAP_STYLE = "https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json";

const PLANE_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 24 24">
  <path fill="#7dd3fc" stroke="#0b1020" stroke-width="0.6"
    d="M21 16v-2l-8-5V3.5A1.5 1.5 0 0 0 11.5 2 1.5 1.5 0 0 0 10 3.5V9l-8 5v2l8-2.5V19l-2 1.5V22l3.5-1 3.5 1v-1.5L13 19v-5.5Z"/>
</svg>`;

function circlePolygon(lat: number, lon: number, radiusKm: number): GeoJSON.Feature<GeoJSON.Polygon> {
  const ring: [number, number][] = [];
  for (let i = 0; i <= 64; i++) {
    const [pLat, pLon] = destinationPoint(lat, lon, (i * 360) / 64, radiusKm * 1000);
    ring.push([pLon, pLat]);
  }
  return { type: "Feature", geometry: { type: "Polygon", coordinates: [ring] }, properties: {} };
}

export function RadarMap({ position }: { position: PlayerPosition }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const readyRef = useRef(false);

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;

    const map = new maplibregl.Map({
      container: containerRef.current,
      style: MAP_STYLE,
      center: [position.lon, position.lat],
      zoom: 9.5,
      attributionControl: { compact: true },
    });
    mapRef.current = map;

    map.on("load", () => {
      const icon = new Image(48, 48);
      icon.onload = () => {
        map.addImage("plane", icon);

        map.addSource("radius", { type: "geojson", data: circlePolygon(position.lat, position.lon, DEFAULT_RADIUS_KM) });
        map.addLayer({
          id: "radius-fill",
          type: "fill",
          source: "radius",
          paint: { "fill-color": "#38bdf8", "fill-opacity": 0.05 },
        });
        map.addLayer({
          id: "radius-line",
          type: "line",
          source: "radius",
          paint: { "line-color": "#38bdf8", "line-opacity": 0.4, "line-width": 1.5, "line-dasharray": [2, 2] },
        });

        map.addSource("player", {
          type: "geojson",
          data: { type: "Feature", geometry: { type: "Point", coordinates: [position.lon, position.lat] }, properties: {} },
        });
        map.addLayer({
          id: "player-dot",
          type: "circle",
          source: "player",
          paint: {
            "circle-radius": 6,
            "circle-color": "#38bdf8",
            "circle-stroke-color": "#e0f2fe",
            "circle-stroke-width": 2,
          },
        });

        map.addSource("planes", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
        map.addLayer({
          id: "planes",
          type: "symbol",
          source: "planes",
          layout: {
            "icon-image": "plane",
            "icon-size": 0.55,
            "icon-rotate": ["get", "track"],
            "icon-rotation-alignment": "map",
            "icon-allow-overlap": true,
            "text-field": ["get", "label"],
            "text-size": 10,
            "text-offset": [0, 1.4],
            "text-optional": true,
            "text-font": ["Open Sans Regular"],
          },
          paint: {
            "text-color": "#bae6fd",
            "text-halo-color": "#0b1020",
            "text-halo-width": 1,
          },
        });

        map.on("click", "planes", (e) => {
          const hex = e.features?.[0]?.properties?.hex as string | undefined;
          if (hex) usePlanes.getState().select(hex);
        });
        map.on("click", (e) => {
          const hits = map.queryRenderedFeatures(e.point, { layers: ["planes"] });
          if (hits.length === 0) usePlanes.getState().select(null);
        });
        map.on("mouseenter", "planes", () => (map.getCanvas().style.cursor = "pointer"));
        map.on("mouseleave", "planes", () => (map.getCanvas().style.cursor = ""));

        readyRef.current = true;
      };
      icon.src = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(PLANE_SVG);
    });

    return () => {
      readyRef.current = false;
      map.remove();
      mapRef.current = null;
    };
    // The map is created once; position updates flow through the sources below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Keep player dot + radius ring on the current position.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !readyRef.current) return;
    (map.getSource("player") as maplibregl.GeoJSONSource | undefined)?.setData({
      type: "Feature",
      geometry: { type: "Point", coordinates: [position.lon, position.lat] },
      properties: {},
    });
    (map.getSource("radius") as maplibregl.GeoJSONSource | undefined)?.setData(
      circlePolygon(position.lat, position.lon, DEFAULT_RADIUS_KM)
    );
  }, [position.lat, position.lon]);

  // Smooth plane movement: re-render dead-reckoned positions ~5×/s.
  useEffect(() => {
    const timer = setInterval(() => {
      const map = mapRef.current;
      if (!map || !readyRef.current) return;
      const source = map.getSource("planes") as maplibregl.GeoJSONSource | undefined;
      if (!source) return;

      const now = Date.now();
      const features: GeoJSON.Feature[] = [];
      for (const ac of usePlanes.getState().planes.values()) {
        const ageSec = (now - ac.ts) / 1000 + ac.seenPosSec;
        const [lat, lon] = deadReckon(ac.lat, ac.lon, ac.track, ac.gsKt, Math.min(ageSec, 60));
        features.push({
          type: "Feature",
          geometry: { type: "Point", coordinates: [lon, lat] },
          properties: {
            hex: ac.hex,
            track: ac.track,
            label: ac.callsign || ac.reg || "",
          },
        });
      }
      source.setData({ type: "FeatureCollection", features });
    }, 200);
    return () => clearInterval(timer);
  }, []);

  return <div ref={containerRef} className="radar-map" />;
}
