import type { SocialStore } from "./social/store";

/** Identity claim from the `x-player-id` header (pre-auth MVP). */
export function playerId(headers: Record<string, unknown>): string | null {
  const id = headers["x-player-id"];
  return typeof id === "string" && id.length > 0 ? id : null;
}

export function playerToken(headers: Record<string, unknown>): string | undefined {
  const token = headers["x-player-token"];
  return typeof token === "string" && token.length > 0 ? token : undefined;
}

/**
 * Requires both an id and its matching bearer token.
 *
 * Applies to reads as well as writes. Player ids are handed out in /friends
 * and /activity responses, so an id alone proves nothing — treating it as
 * identity let anyone who had seen a friend's id read that player's private
 * hangar, friend list and activity.
 *
 * Returns the verified id, or null after sending 401 (callers must return).
 */
export function requireAuth(
  req: { headers: Record<string, unknown> },
  reply: { code(n: number): { send(body: unknown): unknown } },
  social: SocialStore
): string | null {
  const id = playerId(req.headers);
  if (!id) {
    reply.code(401).send({ ok: false, reason: "missing x-player-id" });
    return null;
  }
  if (!social.verifyToken(id, playerToken(req.headers))) {
    reply.code(401).send({ ok: false, reason: "invalid or missing player token" });
    return null;
  }
  return id;
}
