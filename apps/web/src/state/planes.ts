import { create } from "zustand";
import {
  MAX_VIEW_RADIUS_KM,
  MIN_VIEW_RADIUS_KM,
  normalizeBaseUrl,
  type AircraftState,
  type ServerMessage,
} from "@aloft/shared";

export type LinkState = "connecting" | "live" | "offline";

interface PlanesState {
  link: LinkState;
  /** hex → latest state from the server. */
  planes: Map<string, AircraftState>;
  selectedHex: string | null;
  /** Timestamp of the last frame received, for the scope's freshness readout. */
  lastFrameAt: number | null;
  select: (hex: string | null) => void;
}

export const usePlanes = create<PlanesState>((set) => ({
  link: "connecting",
  planes: new Map(),
  selectedHex: null,
  lastFrameAt: null,
  select: (hex) => set({ selectedHex: hex }),
}));

/**
 * Base URL of the sky service, always without a trailing slash — every caller
 * appends a rooted path (`/ws`, `/catch`, `/player/register`).
 */
export const SKY_URL = normalizeBaseUrl(
  (import.meta.env.VITE_SKY_URL as string | undefined) ?? "http://localhost:8787"
);

interface View {
  lat: number;
  lon: number;
  viewRadiusKm: number;
}

let socket: WebSocket | null = null;
let retryMs = 1000;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let skyPlayerId: string | undefined;
let skyPlayerToken: string | undefined;

/**
 * The feed view has two possible owners and they must not fight.
 *
 * `gpsPos` is where the device says it is; `mapView` is what the player has
 * panned the scope to. When the map is driving, it wins — otherwise every GPS
 * tick (roughly once a second) re-aimed the feed at the player and snapped a
 * deliberate pan straight back, while also clamping the stream to the default
 * radius so contacts the player had zoomed out to see vanished.
 *
 * The device position is still sent separately as `playerLat/playerLon`, so
 * panning the map never disturbs the server's anti-cheat position check.
 */
let gpsPos: { lat: number; lon: number } | null = null;
let mapView: View | null = null;

/** Default feed radius when the map isn't driving the view. */
const FOLLOW_RADIUS_KM = 60;

/**
 * Offset between this device's clock and the server's, smoothed across
 * frames. Aircraft timestamps are stamped server-side, so a phone whose clock
 * is minutes off would otherwise mis-age every position (projecting aircraft
 * far from where they are) and have every catch rejected as "timestamp too
 * far from server time".
 */
let serverSkewMs: number | null = null;

/** Best estimate of the server's current clock. */
export function serverNow(): number {
  return Date.now() + (serverSkewMs ?? 0);
}

function currentView(): View | null {
  if (mapView) return mapView;
  if (gpsPos) return clampView({ ...gpsPos, viewRadiusKm: FOLLOW_RADIUS_KM });
  return null;
}

/**
 * Attaches this device's player identity to the live feed, so the server can
 * track a verified last-known position for the anti-cheat catch check. Call
 * once the player is known (after `ensurePlayer()` resolves); safe to call
 * again if the identity changes.
 */
export function setSkyIdentity(playerId: string | undefined, playerToken: string | undefined): void {
  skyPlayerId = playerId;
  skyPlayerToken = playerToken;
  sendSub();
}

function sendSub(): void {
  const view = currentView();
  if (socket?.readyState === WebSocket.OPEN && view) {
    socket.send(
      JSON.stringify({
        type: "sub",
        ...view,
        playerLat: gpsPos?.lat,
        playerLon: gpsPos?.lon,
        playerId: skyPlayerId,
        playerToken: skyPlayerToken,
      })
    );
  }
}

/** Opens the scope feed. Safe to call repeatedly; only one socket is kept. */
export function connectSky(next: { lat: number; lon: number }): void {
  gpsPos = { lat: next.lat, lon: next.lon };
  if (socket && socket.readyState <= WebSocket.OPEN) {
    sendSub();
    return;
  }
  open();
}

/**
 * Reports the device's own position. Only re-aims the feed when the map isn't
 * driving it, but always refreshes the position the server tracks for the
 * anti-cheat check.
 */
export function setGpsPosition(lat: number, lon: number): void {
  const prev = gpsPos;
  gpsPos = { lat, lon };
  if (mapView) {
    // Map owns the view; still resend so the server's idea of where this
    // player is stays current, but only when it has meaningfully moved.
    if (!prev || !sameView({ ...prev, viewRadiusKm: 0 }, { lat, lon, viewRadiusKm: 0 })) sendSub();
    return;
  }
  const next = currentView();
  if (prev && next && sameView(clampView({ ...prev, viewRadiusKm: FOLLOW_RADIUS_KM }), next)) return;
  sendSub();
}

/**
 * Hands view ownership to the map as the player pans or zooms. Reuses the
 * open socket — moving the scope must never drop the connection.
 */
export function setMapView(next: View): void {
  const clamped = clampView(next);
  if (mapView && sameView(mapView, clamped)) return;
  mapView = clamped;
  sendSub();
}

/** The map is gone (tab switched away); fall back to following the device. */
export function releaseMapView(): void {
  if (!mapView) return;
  mapView = null;
  sendSub();
}

/** Exported for tests — the bounds must match what the server will accept. */
export function clampView(v: View): View {
  return {
    ...v,
    viewRadiusKm: Math.min(Math.max(v.viewRadiusKm, MIN_VIEW_RADIUS_KM), MAX_VIEW_RADIUS_KM),
  };
}

/** Ignore sub-kilometre jitter so a resting map doesn't spam the tower. */
export function sameView(a: View, b: View): boolean {
  return (
    Math.abs(a.lat - b.lat) < 0.01 &&
    Math.abs(a.lon - b.lon) < 0.01 &&
    Math.abs(a.viewRadiusKm - b.viewRadiusKm) < 2
  );
}

function open(): void {
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
  const ws = new WebSocket(SKY_URL.replace(/^http/, "ws") + "/ws");
  socket = ws;
  usePlanes.setState({ link: "connecting" });

  ws.onopen = () => {
    retryMs = 1000;
    usePlanes.setState({ link: "live" });
    sendSub();
  };

  ws.onmessage = (ev) => {
    if (socket !== ws) return; // a frame from a socket we've since superseded
    let msg: ServerMessage;
    try {
      msg = JSON.parse(ev.data);
    } catch {
      return; // one malformed frame shouldn't take down the feed
    }
    if (msg.type === "planes" && Array.isArray(msg.aircraft)) {
      // Aircraft timestamps come from the server's clock, so track the offset
      // rather than trusting this device's. Smoothed so one delayed frame
      // doesn't yank the estimate around.
      const sample = msg.now - Date.now();
      serverSkewMs = serverSkewMs === null ? sample : serverSkewMs * 0.7 + sample * 0.3;

      const planes = new Map<string, AircraftState>();
      for (const ac of msg.aircraft) planes.set(ac.hex, ac);
      usePlanes.setState({ planes, link: "live", lastFrameAt: Date.now() });
    }
  };

  ws.onerror = () => {
    if (socket !== ws) return; // superseded by a newer socket
    usePlanes.setState({ link: "offline" });
  };

  ws.onclose = () => {
    if (socket !== ws) return; // superseded by a newer socket
    usePlanes.setState({ link: "offline" });
    reconnectTimer = setTimeout(open, retryMs);
    retryMs = Math.min(retryMs * 2, 15_000);
  };
}

export function disconnectSky(): void {
  const ws = socket;
  socket = null; // stops the onclose handler from scheduling a reconnect
  // A reconnect scheduled *before* this call would otherwise still fire and
  // resurrect a live socket that keeps writing to a torn-down app.
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
  ws?.close();
  mapView = null;
  usePlanes.setState({ link: "offline", planes: new Map() });
}
