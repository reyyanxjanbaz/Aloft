import webpush from "web-push";
import {
  bearingDeg,
  distanceM,
  NM_TO_KM,
  RARITY_ORDER,
  rarityFor,
  typeName,
  type Rarity,
} from "@aloft/shared";
import type { FlightProvider } from "../providers/types";
import type { PushStore } from "./store";

const CHECK_MS = 60_000;
/** Ping budget: pings must stay exciting, not spammy. */
const PER_SUB_COOLDOWN_MS = 30 * 60_000;
export const PER_HEX_DEDUPE_MS = 2 * 60 * 60_000;
const MIN_RARITY: Rarity = "uncommon";
const MIN_ALT_FT = 500; // ignore taxiing/parked aircraft

const WINDS = ["north", "northeast", "east", "southeast", "south", "southwest", "west", "northwest"];

const TEASER: Record<string, string> = {
  uncommon: "Something interesting is inbound",
  rare: "Something rare is inbound",
  epic: "Something serious just entered your sky",
  legendary: "Drop everything — a legend is overhead",
};

function compassWord(bearing: number): string {
  return WINDS[Math.round(bearing / 45) % 8] ?? "somewhere";
}

/**
 * Every minute, checks each stored subscriber location for notable aircraft
 * inside their radius and sends a rarity-teased Web Push. The aircraft type is
 * deliberately NOT revealed — mystery is the hook that opens the app.
 */
export function startGeofence(provider: FlightProvider, store: PushStore): void {
  const tick = async () => {
    const now = Date.now();
    for (const sub of await store.all()) {
      if (now - sub.lastPingAt < PER_SUB_COOLDOWN_MS) continue;
      try {
        const aircraft = await provider.getAircraftNear(sub.lat, sub.lon, sub.radiusKm / NM_TO_KM);
        const candidates = aircraft
          .filter((ac) => ac.altFt > MIN_ALT_FT)
          .filter((ac) => distanceM(sub.lat, sub.lon, ac.lat, ac.lon) <= sub.radiusKm * 1000)
          .filter((ac) => RARITY_ORDER.indexOf(rarityFor(ac.typeIcao)) >= RARITY_ORDER.indexOf(MIN_RARITY))
          .filter((ac) => now - (sub.pingedHexes[ac.hex] ?? 0) > PER_HEX_DEDUPE_MS)
          .sort((a, b) => RARITY_ORDER.indexOf(rarityFor(b.typeIcao)) - RARITY_ORDER.indexOf(rarityFor(a.typeIcao)));

        const best = candidates[0];
        if (!best) continue;

        const rarity = rarityFor(best.typeIcao);
        const from = compassWord(bearingDeg(sub.lat, sub.lon, best.lat, best.lon));
        const payload = JSON.stringify({
          title: "Aloft",
          body: `${TEASER[rarity]} from the ${from}…`,
          hex: best.hex,
        });

        // Cooldown/dedupe are only spent once the push actually goes out —
        // committing them beforehand meant a single transient send failure
        // (a 429, a timeout) could silently cost the player their next
        // eligible window for this subscriber and this aircraft, with the
        // notification never having arrived.
        try {
          await webpush.sendNotification(sub.subscription, payload, { TTL: 300 });
          console.log(`[push] pinged ${sub.subscription.endpoint.slice(0, 40)}… about ${typeName(best.typeIcao)} (${rarity})`);
          await store.markPinged(sub.subscription.endpoint, best.hex, now);
        } catch (err) {
          const status = (err as { statusCode?: number }).statusCode;
          if (status === 404 || status === 410) {
            await store.remove(sub.subscription.endpoint);
            console.log("[push] removed dead subscription");
          } else {
            console.warn("[push] send failed, will retry next tick:", status ?? err);
          }
        }
      } catch (err) {
        console.warn("[push] geofence check failed:", err);
      }
    }
  };

  setInterval(tick, CHECK_MS).unref?.();
}
