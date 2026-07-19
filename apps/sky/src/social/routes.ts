import type { FastifyInstance } from "fastify";
import type { SharedCatch } from "@aloft/shared";
import { requireAuth } from "../auth";
import type { SocialStore } from "./store";

const WEEK_MS = 7 * 86_400_000;

/**
 * Every route here is authenticated, reads included. Player ids are handed
 * out in /friends and /activity payloads, so an id on its own is not a
 * secret and never proved identity — requiring the bearer token on reads is
 * what actually keeps a hangar private to friends.
 */
export function registerSocialRoutes(app: FastifyInstance, social: SocialStore): void {
  app.post<{ Body: { name?: string; id?: string; token?: string } }>(
    "/player/register",
    { config: { rateLimit: { max: 10, timeWindow: "1 minute" } } },
    async (req, reply) => {
      const { name, id, token } = req.body ?? {};
      if (typeof name !== "string") return reply.code(400).send({ ok: false, reason: "expected {name}" });
      const result = await social.register(name, id, token);
      return reply.code(result.ok ? 200 : 401).send(result);
    }
  );

  app.get("/player/me", async (req, reply) => {
    const id = requireAuth(req, reply, social);
    if (!id) return;
    const player = await social.getProfile(id);
    if (!player) return reply.code(404).send({ ok: false, reason: "unknown player" });
    return { ok: true, player, stats: await social.stats(player.id) };
  });

  app.post<{ Body: { code?: string } }>("/friends/add", async (req, reply) => {
    const id = requireAuth(req, reply, social);
    if (!id) return;
    const code = req.body?.code;
    if (typeof code !== "string") return reply.code(400).send({ ok: false, reason: "expected {code}" });
    const result = await social.addFriendByCode(id, code);
    return reply.code(result.ok ? 200 : 422).send(result);
  });

  app.post<{ Body: { friendId?: string } }>("/friends/remove", async (req, reply) => {
    const id = requireAuth(req, reply, social);
    if (!id) return;
    if (req.body?.friendId) await social.removeFriend(id, req.body.friendId);
    return { ok: true };
  });

  app.get("/friends", async (req, reply) => {
    const id = requireAuth(req, reply, social);
    if (!id) return;
    return { ok: true, friends: await social.friends(id) };
  });

  app.get<{ Params: { targetId: string } }>("/player/:targetId/hangar", async (req, reply) => {
    const id = requireAuth(req, reply, social);
    if (!id) return;
    const result = await social.hangarOf(id, req.params.targetId);
    return reply.code(result.ok ? 200 : 403).send(result);
  });

  app.get("/leaderboard", async (req, reply) => {
    const id = requireAuth(req, reply, social);
    if (!id) return;
    return { ok: true, rows: await social.leaderboard(id, Date.now() - WEEK_MS) };
  });

  app.get("/activity", async (req, reply) => {
    const id = requireAuth(req, reply, social);
    if (!id) return;
    return { ok: true, items: await social.activity(id) };
  });
}

/** Shape a validated catch into the record shared with friends. */
export function toSharedCatch(
  id: string,
  ac: { hex: string; callsign: string; reg?: string; typeIcao?: string; altFt: number },
  typeLabel: string,
  rarity: SharedCatch["rarity"],
  caughtAt: number,
  distanceKm: number
): Omit<SharedCatch, "firstSpotter"> {
  return {
    id,
    hex: ac.hex,
    callsign: ac.callsign,
    reg: ac.reg,
    typeIcao: ac.typeIcao,
    typeLabel,
    rarity,
    caughtAt,
    altFt: ac.altFt,
    distanceKm,
  };
}
