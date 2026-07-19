import cors from "@fastify/cors";
import rateLimit from "@fastify/rate-limit";
import websocket from "@fastify/websocket";
import Fastify, { type FastifyInstance } from "fastify";
import { CAPTURE_RADIUS_KM, catchIdUtc, typeName, type CatchRequest, type ClientMessage } from "@aloft/shared";
import { registerAirframeRoutes } from "./airframes/routes";
import { playerId as headerPlayerId, playerToken } from "./auth";
import { dbReady } from "./db";
import type { SkyHub } from "./hub";
import type { FlightProvider } from "./providers/types";
import type { PushStore } from "./push/store";
import { registerSocialRoutes, toSharedCatch } from "./social/routes";
import type { SocialStore } from "./social/store";

/** Postgres foreign_key_violation. */
const FK_VIOLATION = "23503";

export interface AppDeps {
  hub: SkyHub;
  social: SocialStore;
  pushStore: PushStore;
  /** Serves the living-hangar lookups; the hub keeps its own copy for polling. */
  provider: FlightProvider;
  vapidPublicKey: string;
  /** Overridable so tests can trip the limiter without sending 12 requests. */
  rateLimits?: { catchPerMin?: number; globalPerMin?: number };
}

/**
 * Builds the HTTP/WS surface. Split from index.ts so tests can drive real
 * routes through app.inject() instead of booting a listener.
 */
export async function buildApp(deps: AppDeps): Promise<FastifyInstance> {
  const { hub, social, pushStore, vapidPublicKey } = deps;

  // trustProxy: Railway terminates TLS in front of us, so without this every
  // request appears to come from the proxy and per-IP limits would apply to
  // the whole world at once.
  const app = Fastify({ logger: { level: "info" }, trustProxy: true });

  await app.register(cors, { origin: true });
  await app.register(rateLimit, {
    max: deps.rateLimits?.globalPerMin ?? 300,
    timeWindow: "1 minute",
  });
  await app.register(websocket);

  /**
   * Radar, hunting and catch *validation* run off the hub and must keep
   * working through a database outage; only the routes that actually read or
   * write Postgres degrade. /catch is deliberately absent — validation still
   * succeeds, and attribution is already gated behind social.knows(), which
   * is false until the token cache hydrates.
   */
  const DB_ROUTES = ["/player", "/friends", "/leaderboard", "/activity", "/push/subscribe", "/push/unsubscribe"];
  app.addHook("onRequest", async (req, reply) => {
    if (dbReady()) return;
    if (DB_ROUTES.some((prefix) => req.url.startsWith(prefix))) {
      return reply.code(503).send({ ok: false, reason: "database unavailable — try again shortly" });
    }
  });

  app.get("/health", async () => ({
    ok: true,
    ...hub.stats,
    db: dbReady() ? "up" : "down",
    pushSubs: dbReady() ? await pushStore.count() : null,
  }));

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
    await pushStore.upsert({
      subscription: subscription as never,
      lat: lat!,
      lon: lon!,
      radiusKm: Math.min(Math.max(radiusKm ?? CAPTURE_RADIUS_KM, 1), 100),
    });
    return { ok: true };
  });

  app.post<{ Body: { endpoint?: string } }>("/push/unsubscribe", async (req) => {
    if (req.body?.endpoint) await pushStore.remove(req.body.endpoint);
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
  app.post<{ Body: CatchRequest }>(
    "/catch",
    // A player physically cannot capture faster than this. The limit exists
    // because /catch is the one unauthenticated route that can reach upstream.
    { config: { rateLimit: { max: deps.rateLimits?.catchPerMin ?? 12, timeWindow: "1 minute" } } },
    async (req, reply) => {
      const { hex, lat, lon, ts } = req.body ?? ({} as CatchRequest);
      if (
        typeof hex !== "string" ||
        !Number.isFinite(lat) ||
        !Number.isFinite(lon) ||
        !Number.isFinite(ts)
      ) {
        return reply.code(400).send({ ok: false, reason: "expected {hex, lat, lon, ts}" });
      }

      // Identity is optional (an anonymous/offline catch still validates
      // against the aircraft), but if a player id is claimed, the request must
      // prove ownership of it before the catch can be attributed — otherwise
      // anyone who knows another player's id could record catches, and burn
      // their first-spotter credit, under that player's name.
      const playerId = headerPlayerId(req.headers as never) ?? undefined;
      const token = playerToken(req.headers as never);
      if (playerId && !social.verifyToken(playerId, token)) {
        return reply.code(401).send({ ok: false, reason: "invalid or missing player token" });
      }

      const result = await hub.validateCatch(hex, lat, lon, ts, playerId, {
        // Only an authenticated player may cause an upstream fetch.
        allowOnDemandPoll: Boolean(playerId),
      });
      if (!result.ok) return reply.code(422).send(result);

      // Record it against the player so friends' hangars and first-spotter work.
      if (playerId && social.knows(playerId)) {
        const ac = result.catch.aircraft;
        const catchId = catchIdUtc(ac.hex, result.catch.caughtAt);
        try {
          const { firstSpotter } = await social.recordCatch(
            playerId,
            toSharedCatch(catchId, ac, typeName(ac.typeIcao), result.catch.rarity, result.catch.caughtAt, result.catch.distanceKm)
          );
          return reply.send({ ...result, firstSpotter });
        } catch (err) {
          // The token cache can outlive the row it describes (a database
          // restore while this process is up). Attribution is the only thing
          // lost — the catch itself validated, so return it rather than 500.
          if ((err as { code?: string }).code === FK_VIOLATION) {
            console.warn(`[sky] catch attribution skipped — unknown player ${playerId}`);
            return reply.send(result);
          }
          throw err;
        }
      }
      return reply.send(result);
    }
  );

  registerSocialRoutes(app, social);
  registerAirframeRoutes(app, deps.provider, social);

  await app.register(async (instance) => {
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
          // someone else's id and poison their tracked position.
          const verifiedPlayerId = social.verifyToken(msg.playerId ?? "", msg.playerToken)
            ? msg.playerId
            : undefined;
          hub.subscribe({
            id,
            lat: msg.lat,
            lon: msg.lon,
            viewRadiusKm: msg.viewRadiusKm,
            playerLat: msg.playerLat,
            playerLon: msg.playerLon,
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

  return app;
}
