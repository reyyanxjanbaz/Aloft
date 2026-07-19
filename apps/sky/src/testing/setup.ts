import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Loads the repo-root .env.local into process.env before any test module is
 * imported, so `npm test --workspace apps/sky` picks up the Supabase
 * connection string the Vercel integration already provisioned without the
 * caller having to export anything.
 */
const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..");
const envFile = join(repoRoot, ".env.local");

if (existsSync(envFile)) {
  for (const line of readFileSync(envFile, "utf8").split("\n")) {
    const eq = line.indexOf("=");
    if (eq === -1 || line.trimStart().startsWith("#")) continue;
    const key = line.slice(0, eq).trim();
    if (process.env[key]) continue; // a real environment variable always wins
    process.env[key] = line.slice(eq + 1).trim().replace(/^"|"$/g, "");
  }
}
