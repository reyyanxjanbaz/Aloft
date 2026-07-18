import cors from "@fastify/cors";
import websocket from "@fastify/websocket";
import Fastify from "fastify";
import { CAPTURE_RADIUS_KM, typeName, type CatchRequest, type ClientMessage } from "@aloft/shared";
import { SkyHub } from "./hub";
import { AdsbLolProvider } from "./providers/adsbLol";
import { AirplanesLiveProvider } from "./providers/airplanesLive";
import { FailoverProvider } from "./providers/failover";
import { startGeofence } from "./push/geofence";
import { PushStore } from "./push/store";
import { initVapid } from "./push/vapid";
import { registerSocialRoutes, toSharedCatch } from "./social/routes";
import { SocialStore } from "./social/store";

const PORT = Number(process.env.PORT ?? 8787);

const provider = new FailoverProvider([new AdsbLolProvider(), new AirplanesLiveProvider()]);
const hub = new SkyHub(provider);
const { publicKey: vapidPublicKey } = initVapid();
const pushStore = new PushStore();
const social = new SocialStore();
startGeofence(provider, pushStore);

const app = Fastify({ logger: { level: "info" } });
await app.register(cors, { origin: true });
await app.register(websocket);

app.get("/health", async () => ({ ok: true, ...hub.stats, pushSubs: pushStore.size }));

app.get("/push/key", async () => ({ key: vapidPublicKey }));

interface SubscribeBody {
  subscription?: { endpoint?: string; keys?: { p256dh?: string; auth?: string } };
  lat?: number;
  lon?: number;
  radiusKm?: number;
}

app.post<{ Body: SubscribeBody }>("/push/subscribe", async (req, reply) => {
  const { subscription, lat, lon, radiusKm } = req.body ?? {};
  if (
    !subscription?.endpoint ||
    !subscription.keys?.p256dh ||
    !subscription.keys?.auth ||
    !Number.isFinite(lat) ||
    !Number.isFinite(lon) ||
    (radiusKm !== undefined && !Number.isFinite(radiusKm))
  ) {
    return reply.code(400).send({ ok: false, reason: "expected {subscription, lat, lon}" });
  }
  pushStore.upsert({
    subscription: subscription as never,
    lat: lat!,
    lon: lon!,
    radiusKm: Math.min(Math.max(radiusKm ?? CAPTURE_RADIUS_KM, 1), 100),
  });
  return { ok: true };
});

app.post<{ Body: { endpoint?: string } }>("/push/unsubscribe", async (req) => {
  if (req.body?.endpoint) pushStore.remove(req.body.endpoint);
  return { ok: true };
});

// Debug/testing endpoint: GET /planes?lat=..&lon=..&radiusKm=..
app.get<{ Querystring: { lat?: string; lon?: string; radiusKm?: string } }>(
  "/planes",
  async (req, reply) => {
    const lat = Number(req.query.lat);
    const lon = Number(req.query.lon);
    const radiusKm = Number(req.query.radiusKm ?? CAPTURE_RADIUS_KM);
    if (!Number.isFinite(lat) || !Number.isFinite(lon) || !Number.isFinite(radiusKm) || radiusKm <= 0) {
      return reply.code(400).send({ error: "lat, lon and radiusKm must be finite numbers, radiusKm > 0" });
    }
    const aircraft = await hub.query(lat, lon, radiusKm);
    return { now: Date.now(), count: aircraft.length, aircraft };
  }
);

// Server-authoritative catch validation: the plane must have really been there.
app.post<{ Body: CatchRequest }>("/catch", async (req, reply) => {
  const { hex, lat, lon, ts } = req.body ?? ({} as CatchRequest);
  if (
    typeof hex !== "string" ||
    !Number.isFinite(lat) ||
    !Number.isFinite(lon) ||
    !Number.isFinite(ts)
  ) {
    return reply.code(400).send({ ok: false, reason: "expected {hex, lat, lon, ts}" });
  }

  // Identity is optional (an anonymous/offline catch still validates against
  // the aircraft), but if a player id is claimed, the request must prove
  // ownership of it before the catch can be attributed — otherwise anyone
  // who knows another player's id (visible to friends via /friends,
  // /activity) could record catches, and burn their first-spotter credit,
  // under that player's name.
  const playerIdHeader = req.headers["x-player-id"];
  const tokenHeader = req.headers["x-player-token"];
  const playerId = typeof playerIdHeader === "string" ? playerIdHeader : undefined;
  const token = typeof tokenHeader === "string" ? tokenHeader : undefined;
  if (playerId && !social.verifyToken(playerId, token)) {
    return reply.code(401).send({ ok: false, reason: "invalid or missing player token" });
  }

  const result = hub.validateCatch(hex, lat, lon, ts, playerId);
  if (!result.ok) return reply.code(422).send(result);

  // Record it against the player so friends' hangars and first-spotter work.
  if (playerId && social.get(playerId)) {
    const ac = result.catch.aircraft;
    const day = new Date(result.catch.caughtAt).toISOString().slice(0, 10).replaceAll("-", "");
    const catchId = `${ac.hex}:${ac.callsign || "----"}:${day}`;
    const { firstSpotter } = social.recordCatch(
      playerId,
      toSharedCatch(catchId, ac, typeName(ac.typeIcao), result.catch.rarity, result.catch.caughtAt, result.catch.distanceKm)
    );
    return reply.send({ ...result, firstSpotter });
  }
  return reply.send(result);
});

registerSocialRoutes(app, social);

app.register(async (instance) => {
  instance.get("/ws", { websocket: true }, (socket) => {
    const id = hub.allocateId();

    socket.on("message", (raw: Buffer) => {
      let msg: ClientMessage;
      try {
        msg = JSON.parse(raw.toString());
      } catch {
        socket.send(JSON.stringify({ type: "error", message: "invalid JSON" }));
        return;
      }
      if (
        msg.type === "sub" &&
        Number.isFinite(msg.lat) &&
        Number.isFinite(msg.lon) &&
        Number.isFinite(msg.viewRadiusKm)
      ) {
        // Only trust the claimed playerId for position-tracking once the
        // matching token proves it — otherwise anyone could send a "sub" for
        // someone else's id and poison their tracked position (see the
        // ClientMessage.playerToken doc comment).
        const verifiedPlayerId = social.verifyToken(msg.playerId ?? "", msg.playerToken)
          ? msg.playerId
          : undefined;
        hub.subscribe({
          id,
          lat: msg.lat,
          lon: msg.lon,
          viewRadiusKm: msg.viewRadiusKm,
          playerId: verifiedPlayerId,
          send: (m) => {
            if (socket.readyState === socket.OPEN) socket.send(JSON.stringify(m));
          },
        });
      } else {
        socket.send(
          JSON.stringify({ type: "error", message: "expected {type:'sub',lat,lon,viewRadiusKm}" })
        );
      }
    });

    socket.on("close", () => hub.unsubscribe(id));
    socket.on("error", () => hub.unsubscribe(id));
  });
});

app.listen({ port: PORT, host: "0.0.0.0" }).then(() => {
  console.log(`[sky] aloft-sky listening on :${PORT}`);
});

// The file stores debounce their writes (see SocialStore/PushStore.persist);
// without this, a mutation just before a deploy/restart could be lost.
async function shutdown(signal: string): Promise<void> {
  console.log(`[sky] ${signal} received, flushing stores before exit`);
  await Promise.allSettled([social.flush(), pushStore.flush()]);
  await app.close();
  process.exit(0);
}
process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));
