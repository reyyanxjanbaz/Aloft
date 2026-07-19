/**
 * Normalises a service base URL by stripping trailing slashes.
 *
 * Callers build request paths by concatenation (`base + "/ws"`), so a
 * configured value ending in `/` yields `//ws`. Fastify routes `//ws`
 * separately from `/ws` and answers 404, and for the WebSocket that failure
 * is silent — the socket never opens, the client just retries forever. A
 * trailing slash in an environment variable is an easy thing to paste, so it
 * is normalised rather than trusted.
 */
export function normalizeBaseUrl(url: string): string {
  return url.replace(/\/+$/, "");
}
