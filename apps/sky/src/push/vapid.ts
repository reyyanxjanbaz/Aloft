import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import webpush from "web-push";

const DATA_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "data");
const KEY_FILE = join(DATA_DIR, "vapid.json");

/**
 * VAPID keys from env in production; in dev, generated once and persisted so
 * existing browser subscriptions stay valid across restarts.
 */
export function initVapid(): { publicKey: string } {
  let publicKey = process.env.VAPID_PUBLIC_KEY;
  let privateKey = process.env.VAPID_PRIVATE_KEY;

  if (!publicKey || !privateKey) {
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
