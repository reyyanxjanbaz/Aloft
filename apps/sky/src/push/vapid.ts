import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import webpush from "web-push";

const DATA_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "data");
const KEY_FILE = join(DATA_DIR, "vapid.json");

/**
 * True when the filesystem is ephemeral — Railway (and any container host)
 * wipes it on every deploy and restart.
 */
function ephemeralFilesystem(): boolean {
  return process.env.NODE_ENV === "production" || Boolean(process.env.RAILWAY_ENVIRONMENT);
}

/**
 * VAPID keys from env in production; in dev, generated once and persisted so
 * existing browser subscriptions stay valid across restarts.
 */
export function initVapid(): { publicKey: string } {
  let publicKey = process.env.VAPID_PUBLIC_KEY;
  let privateKey = process.env.VAPID_PRIVATE_KEY;

  if (!publicKey || !privateKey) {
    // The generate-and-persist fallback below is a dev convenience that
    // depends on the key file surviving a restart. On an ephemeral
    // filesystem it would instead mint fresh keys on every deploy, silently
    // making every existing browser subscription permanently undeliverable —
    // a failure nobody would notice until players stopped getting alerts.
    // Refuse to start instead.
    if (ephemeralFilesystem()) {
      throw new Error(
        "[push] VAPID_PUBLIC_KEY and VAPID_PRIVATE_KEY must be set in a deployed environment — " +
          "generated keys would not survive a restart and would invalidate every push subscription"
      );
    }
    if (existsSync(KEY_FILE)) {
      ({ publicKey, privateKey } = JSON.parse(readFileSync(KEY_FILE, "utf8")));
    } else {
      const keys = webpush.generateVAPIDKeys();
      publicKey = keys.publicKey;
      privateKey = keys.privateKey;
      mkdirSync(DATA_DIR, { recursive: true });
      writeFileSync(KEY_FILE, JSON.stringify({ publicKey, privateKey }, null, 2));
      console.log("[push] generated new VAPID keys → data/vapid.json");
    }
  }

  webpush.setVapidDetails(
    process.env.VAPID_SUBJECT ?? "mailto:dev@aloft.example",
    publicKey!,
    privateKey!
  );
  return { publicKey: publicKey! };
}
