import { describe } from "vitest";
import { hasDb, sql } from "../db";

/** Postgres-backed suites skip when no database is configured. */
export const describeIfDb = hasDb ? describe : describe.skip;

/** Empties every table, then runs the test body. `players` cascades. */
export async function withCleanDb(fn: () => Promise<void>): Promise<void> {
  await sql`truncate players, catches, friendships, push_subscriptions cascade`;
  await fn();
}
