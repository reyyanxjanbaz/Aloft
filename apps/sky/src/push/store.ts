import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { PushSubscription } from "web-push";

export interface StoredSub {
  subscription: PushSubscription;
  lat: number;
  lon: number;
  radiusKm: number;
  /** Last time we pinged this subscriber (ping-budget cooldown). */
  lastPingAt: number;
  /** hex → last ping ts, so the same airframe isn't announced twice. */
  pingedHexes: Record<string, number>;
}

const DATA_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "data");
const SUBS_FILE = join(DATA_DIR, "push-subs.json");

/** File-backed subscription store — MVP stand-in for Postgres. */
export class PushStore {
  private subs = new Map<string, StoredSub>();

  constructor() {
    if (existsSync(SUBS_FILE)) {
      try {
        const list = JSON.parse(readFileSync(SUBS_FILE, "utf8")) as StoredSub[];
        for (const s of list) this.subs.set(s.subscription.endpoint, s);
      } catch {
        console.warn("[push] could not parse push-subs.json — starting empty");
      }
    }
  }

  upsert(sub: Omit<StoredSub, "lastPingAt" | "pingedHexes">): void {
    const existing = this.subs.get(sub.subscription.endpoint);
    this.subs.set(sub.subscription.endpoint, {
      ...sub,
      lastPingAt: existing?.lastPingAt ?? 0,
      pingedHexes: existing?.pingedHexes ?? {},
    });
    this.persist();
  }

  remove(endpoint: string): void {
    if (this.subs.delete(endpoint)) this.persist();
  }

  all(): StoredSub[] {
    return [...this.subs.values()];
  }

  get size(): number {
    return this.subs.size;
  }

  persist(): void {
    mkdirSync(DATA_DIR, { recursive: true });
    writeFileSync(SUBS_FILE, JSON.stringify(this.all(), null, 2));
  }
}
