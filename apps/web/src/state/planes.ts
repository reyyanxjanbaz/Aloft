import { create } from "zustand";
import type { AircraftState, ServerMessage } from "@aloft/shared";

interface PlanesState {
  connected: boolean;
  /** hex → latest state from the server. */
  planes: Map<string, AircraftState>;
  selectedHex: string | null;
  select: (hex: string | null) => void;
}

export const usePlanes = create<PlanesState>((set) => ({
  connected: false,
  planes: new Map(),
  selectedHex: null,
  select: (hex) => set({ selectedHex: hex }),
}));

export const SKY_URL = (import.meta.env.VITE_SKY_URL as string | undefined) ?? "http://localhost:8787";

let socket: WebSocket | null = null;
let retryMs = 1000;

export function connectSky(lat: number, lon: number, radiusKm: number): void {
  const wsUrl = SKY_URL.replace(/^http/, "ws") + "/ws";
  socket?.close();
  const ws = new WebSocket(wsUrl);
  socket = ws;

  ws.onopen = () => {
    retryMs = 1000;
    usePlanes.setState({ connected: true });
    ws.send(JSON.stringify({ type: "sub", lat, lon, radiusKm }));
  };

  ws.onmessage = (ev) => {
    const msg = JSON.parse(ev.data) as ServerMessage;
    if (msg.type === "planes") {
      const planes = new Map<string, AircraftState>();
      for (const ac of msg.aircraft) planes.set(ac.hex, ac);
      usePlanes.setState({ planes });
    }
  };

  ws.onclose = () => {
    usePlanes.setState({ connected: false });
    if (socket === ws) {
      setTimeout(() => connectSky(lat, lon, radiusKm), retryMs);
      retryMs = Math.min(retryMs * 2, 15_000);
    }
  };
}

export function disconnectSky(): void {
  const ws = socket;
  socket = null; // prevents the onclose handler from scheduling a reconnect
  ws?.close();
}
