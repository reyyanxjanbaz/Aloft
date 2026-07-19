import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import postgres from "postgres";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

/**
 * Connection string, in order of preference: an explicit DATABASE_URL, then
 * POSTGRES_URL from a local `.env.local` (what the Vercel Supabase
 * integration provisions — already the Supavisor pooler on :6543).
 */
function connectionString() {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  if (process.env.POSTGRES_URL) return process.env.POSTGRES_URL;

  const envFile = join(root, ".env.local");
  if (!existsSync(envFile)) return null;
  for (const line of readFileSync(envFile, "utf8").split("\n")) {
    const eq = line.indexOf("=");
    if (eq === -1) continue;
    if (line.slice(0, eq).trim() !== "POSTGRES_URL") continue;
    return line.slice(eq + 1).trim().replace(/^"|"$/g, "");
  }
  return null;
}

const url = connectionString();
if (!url) {
  console.error("No database URL. Set DATABASE_URL, or run `vercel env pull` for .env.local.");
  process.exit(1);
}

// prepare:false — Supavisor runs in transaction mode, where prepared
// statements are not safe across pooled connections.
// onnotice is silenced because `create ... if not exists` emits a NOTICE per
// existing object, which reads alarmingly like a failure on a re-run.
const sql = postgres(url, { prepare: false, max: 1, onnotice: () => {} });
try {
  await sql.unsafe(readFileSync(join(root, "supabase/schema.sql"), "utf8"));
  console.log("schema applied");
} finally {
  await sql.end();
}
