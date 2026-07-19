import { buildApp } from "./app";
import { hasDb, sql, waitForDb } from "./db";
import { SkyHub } from "./hub";
import { AdsbLolProvider } from "./providers/adsbLol";
import { AirplanesLiveProvider } from "./providers/airplanesLive";
import { FailoverProvider } from "./providers/failover";
import { startGeofence } from "./push/geofence";
import { PushStore } from "./push/store";
import { initVapid } from "./push/vapid";
import { SocialStore } from "./social/store";

const PORT = Number(process.env.PORT ?? 8787);

// A missing connection string is a configuration error, not an outage — fail
// immediately and clearly rather than retrying a placeholder forever.
if (!hasDb) {
  console.error("[sky] neither DATABASE_URL nor POSTGRES_URL is set");
  process.exit(1);
}

const provider = new FailoverProvider([new AdsbLolProvider(), new AirplanesLiveProvider()]);
const hub = new SkyHub(provider);
const { publicKey: vapidPublicKey } = initVapid();
const pushStore = new PushStore();
const social = new SocialStore();
startGeofence(provider, pushStore);

const app = await buildApp({ hub, social, pushStore, vapidPublicKey });

await app.listen({ port: PORT, host: "0.0.0.0" });
console.log(`[sky] aloft-sky listening on :${PORT}`);

// Radar and catch validation depend on the hub, not the database, so the
// service serves traffic immediately and connects to Postgres behind it.
// Database-backed routes answer 503 until the token cache is hydrated.
void (async () => {
  await waitForDb();
  await social.hydrateTokens();
})();

async function shutdown(signal: string): Promise<void> {
  console.log(`[sky] ${signal} received, closing`);
  await app.close();
  await sql.end({ timeout: 5 });
  process.exit(0);
}
process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));
