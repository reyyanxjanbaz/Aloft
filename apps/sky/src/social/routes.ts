import type { FastifyInstance } from "fastify";
import type { SharedCatch } from "@aloft/shared";
import type { SocialStore } from "./store";

const WEEK_MS = 7 * 86_400_000;

/** Player identity comes from the `x-player-id` header (pre-auth MVP). */
function playerId(headers: Record<string, unknown>): string | null {
  const id = headers["x-player-id"];
  return typeof id === "string" && id.length > 0 ? id : null;
}

export function registerSocialRoutes(app: FastifyInstance, social: SocialStore): void {
  app.post<{ Body: { name?: string; id?: string } }>("/player/register", async (req, reply) => {
    const { name, id } = req.body ?? {};
    if (typeof name !== "string") return reply.code(400).send({ ok: false, reason: "expected {name}" });
    return { ok: true, player: social.register(name, id) };
  });

  app.get("/player/me", async (req, reply) => {
    const id = playerId(req.headers as never);
    const player = id ? social.get(id) : undefined;
    if (!player) return reply.code(404).send({ ok: false, reason: "unknown player" });
    return { ok: true, player: social.profile(player), stats: social.stats(player) };
  });

  app.post<{ Body: { code?: string } }>("/friends/add", async (req, reply) => {
    const id = playerId(req.headers as never);
    if (!id) return reply.code(401).send({ ok: false, reason: "missing x-player-id" });
    const code = req.body?.code;
    if (typeof code !== "string") return reply.code(400).send({ ok: false, reason: "expected {code}" });
    const result = social.addFriendByCode(id, code);
    return reply.code(result.ok ? 200 : 422).send(result);
  });

  app.post<{ Body: { friendId?: string } }>("/friends/remove", async (req, reply) => {
    const id = playerId(req.headers as never);
    if (!id) return reply.code(401).send({ ok: false, reason: "missing x-player-id" });
    if (req.body?.friendId) social.removeFriend(id, req.body.friendId);
    return { ok: true };
  });

  app.get("/friends", async (req, reply) => {
    const id = playerId(req.headers as never);
    if (!id) return reply.code(401).send({ ok: false, reason: "missing x-player-id" });
    return { ok: true, friends: social.friends(id) };
  });

  app.get<{ Params: { targetId: string } }>("/player/:targetId/hangar", async (req, reply) => {
    const id = playerId(req.headers as never);
    if (!id) return reply.code(401).send({ ok: false, reason: "missing x-player-id" });
    const result = social.hangarOf(id, req.params.targetId);
    return reply.code(result.ok ? 200 : 403).send(result);
  });

  app.get("/leaderboard", async (req, reply) => {
    const id = playerId(req.headers as never);
    if (!id) return reply.code(401).send({ ok: false, reason: "missing x-player-id" });
    return { ok: true, rows: social.leaderboard(id, Date.now() - WEEK_MS) };
  });

  app.get("/activity", async (req, reply) => {
    const id = playerId(req.headers as never);
    if (!id) return reply.code(401).send({ ok: false, reason: "missing x-player-id" });
    return { ok: true, items: social.activity(id) };
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
