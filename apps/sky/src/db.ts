import postgres from "postgres";

/**
 * DATABASE_URL is what Railway is configured with; POSTGRES_URL is what the
 * Vercel Supabase integration writes into .env.local, so local runs work
 * without duplicating the variable.
 */
const url = process.env.DATABASE_URL ?? process.env.POSTGRES_URL;

/** False on a fresh clone with no database configured. Checked at boot. */
export const hasDb = Boolean(url);

/**
 * Supavisor (Supabase's pooler) runs in transaction mode, where prepared
 * statements are not safe across pooled connections — postgres.js must be
 * told not to use them. The direct Supabase endpoint is IPv6-only, so the
 * pooler URI on :6543 is the only one that connects from Railway.
 *
 * When no URL is configured this is built against an unroutable placeholder
 * rather than throwing, so importing this module stays side-effect-free:
 * database-backed test suites skip themselves, and the service reports the
 * misconfiguration at boot with a clear message instead of a stack trace at
 * import time.
 */
export const sql = postgres(url ?? "postgres://unset@127.0.0.1:1/unset", {
  prepare: false,
  max: 5,
  idle_timeout: 20,
  onnotice: () => {},
});

let ready = false;
export function dbReady(): boolean {
  return ready;
}

/**
 * Blocks until Postgres answers, retrying with backoff. The service boots
 * the HTTP server first and awaits this in the background, so radar keeps
 * working through a database outage.
 */
export async function waitForDb(): Promise<void> {
  let delayMs = 500;
  for (;;) {
    try {
      await sql`select 1`;
      ready = true;
      console.log("[db] connected");
      return;
    } catch (err) {
      ready = false;
      console.warn(`[db] not reachable, retrying in ${delayMs}ms:`, (err as Error).message);
      await new Promise((r) => setTimeout(r, delayMs));
      delayMs = Math.min(delayMs * 2, 30_000);
    }
  }
}
