import type { FastifyInstance } from "fastify";
import { requireAuth } from "../auth";
import type { FlightProvider, LiveAirframe } from "../providers/types";
import type { SocialStore } from "../social/store";

/**
 * Live status of collected airframes.
 *
 * Upstream has no batch endpoint — a comma-separated hex list returns only
 * the first match — so every airframe is its own request. That makes the
 * cache and the caps here load-bearing rather than merely polite: they are
 * the difference between this feature and hammering a free service we depend
 * on for the entire game.
 */

const CACHE_TTL_MS = 60_000;
/** Ceiling on remembered airframes; ample for any realistic player base. */
const CACHE_MAX = 500;
/** Most airframes one fleet request may ask about. */
const MAX_BATCH = 12;
/** Simultaneous upstream requests when filling a fleet request. */
const CONCURRENCY = 4;

const HEX_RE = /^[0-9a-f]{6}$/;

interface CacheEntry {
  at: number;
  live: LiveAirframe | null;
}

export function registerAirframeRoutes(
  app: FastifyInstance,
  provider: FlightProvider,
  social: SocialStore
): void {
  const cache = new Map<string, CacheEntry>();
  /** In-flight lookups, so concurrent callers share one upstream request. */
  const inflight = new Map<string, Promise<LiveAirframe | null>>();

  function cached(hex: string): CacheEntry | undefined {
    const entry = cache.get(hex);
    if (!entry) return undefined;
    if (Date.now() - entry.at > CACHE_TTL_MS) {
      cache.delete(hex);
      return undefined;
    }
    return entry;
  }

  function remember(hex: string, live: LiveAirframe | null): void {
    // Map preserves insertion order, so the first key is the oldest write.
    if (cache.size >= CACHE_MAX) {
      const oldest = cache.keys().next().value;
      if (oldest !== undefined) cache.delete(oldest);
    }
    cache.set(hex, { at: Date.now(), live });
  }

  async function lookup(hex: string): Promise<LiveAirframe | null> {
    const hit = cached(hex);
    if (hit) return hit.live;

    const existing = inflight.get(hex);
    if (existing) return existing;

    const request = provider
      .getAirframe(hex)
      .then((live) => {
        remember(hex, live);
        return live;
      })
      .catch((err) => {
        // Not cached: an upstream blip must not read as "off radar" for a
        // whole minute.
        console.warn(`[airframes] lookup for ${hex} failed:`, err);
        return null;
      })
      .finally(() => {
        inflight.delete(hex);
      });

    inflight.set(hex, request);
    return request;
  }

  app.get<{ Params: { hex: string } }>(
    "/airframe/:hex/live",
    { config: { rateLimit: { max: 30, timeWindow: "1 minute" } } },
    async (req, reply) => {
      if (!requireAuth(req, reply, social)) return;
      const hex = req.params.hex.trim().toLowerCase();
      if (!HEX_RE.test(hex)) {
        return reply.code(400).send({ ok: false, reason: "expected a 6-character ICAO hex" });
      }
      return { ok: true, live: await lookup(hex) };
    }
  );

  app.post<{ Body: { hexes?: unknown } }>(
    "/airframes/live",
    { config: { rateLimit: { max: 30, timeWindow: "1 minute" } } },
    async (req, reply) => {
      if (!requireAuth(req, reply, social)) return;

      const raw = req.body?.hexes;
      if (!Array.isArray(raw)) {
        return reply.code(400).send({ ok: false, reason: "expected {hexes: string[]}" });
      }
      const hexes = [...new Set(raw.filter((h): h is string => typeof h === "string").map((h) => h.trim().toLowerCase()))];
      if (hexes.some((h) => !HEX_RE.test(h))) {
        return reply.code(400).send({ ok: false, reason: "every hex must be 6 hex characters" });
      }
      if (hexes.length > MAX_BATCH) {
        return reply.code(400).send({ ok: false, reason: `at most ${MAX_BATCH} airframes per request` });
      }

      // Cached answers are free; only the misses cost an upstream request,
      // and those run a few at a time rather than all at once.
      const live: Record<string, LiveAirframe | null> = {};
      const queue = [...hexes];
      const workers = Array.from({ length: Math.min(CONCURRENCY, queue.length) }, async () => {
        for (let hex = queue.shift(); hex !== undefined; hex = queue.shift()) {
          live[hex] = await lookup(hex);
        }
      });
      await Promise.all(workers);

      return { ok: true, live };
    }
  );
}
