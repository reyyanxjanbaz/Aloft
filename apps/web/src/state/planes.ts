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
let view: View | null = null;
let skyPlayerId: string | undefined;
let skyPlayerToken: string | undefined;

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
  if (socket?.readyState === WebSocket.OPEN && view) {
    socket.send(
      JSON.stringify({ type: "sub", ...view, playerId: skyPlayerId, playerToken: skyPlayerToken })
    );
  }
}

/** Opens the scope feed. Safe to call repeatedly; only one socket is kept. */
export function connectSky(next: View): void {
  view = clampView(next);
  if (socket && socket.readyState <= WebSocket.OPEN) {
    sendSub();
    return;
  }
  open();
}

/**
 * Re-aims the feed as the map moves. Reuses the open socket — panning the
 * scope must never drop the connection.
 */
export function updateView(next: View): void {
  const clamped = clampView(next);
  if (view && sameView(view, clamped)) return;
  view = clamped;
  sendSub();
}

function clampView(v: View): View {
  return {
    ...v,
    viewRadiusKm: Math.min(Math.max(v.viewRadiusKm, MIN_VIEW_RADIUS_KM), MAX_VIEW_RADIUS_KM),
  };
}

/** Ignore sub-kilometre jitter so a resting map doesn't spam the tower. */
function sameView(a: View, b: View): boolean {
  return (
    Math.abs(a.lat - b.lat) < 0.01 &&
    Math.abs(a.lon - b.lon) < 0.01 &&
    Math.abs(a.viewRadiusKm - b.viewRadiusKm) < 2
  );
}

function open(): void {
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
    if (msg.type === "planes") {
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
    setTimeout(open, retryMs);
    retryMs = Math.min(retryMs * 2, 15_000);
  };
}

export function disconnectSky(): void {
  const ws = socket;
  socket = null; // stops the onclose handler from scheduling a reconnect
  ws?.close();
  usePlanes.setState({ link: "offline", planes: new Map() });
}
