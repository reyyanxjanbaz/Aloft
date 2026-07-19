import { CAPTURE_RADIUS_KM } from "@aloft/shared";
import { SKY_URL } from "../state/planes";

export function pushSupported(): boolean {
  return "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
}

export function pushPermission(): NotificationPermission | "unsupported" {
  return pushSupported() ? Notification.permission : "unsupported";
}

/** Why enabling failed, so callers can say something true about it. */
export class PushError extends Error {
  constructor(public readonly kind: "unsupported" | "denied" | "tower-unavailable") {
    super(kind);
  }
}

export type SkyPingsState = "on" | "off" | "blocked" | "unsupported";

/**
 * Whether alerts are actually armed — from the browser's subscription, not
 * from Notification.permission.
 *
 * Permission is per-origin and permanent once granted, so deriving state from
 * it claimed alerts were on for a player who had granted permission once at a
 * different location and no longer had a server subscription at all. They saw
 * "on" and were never offered a re-subscribe.
 */
export async function skyPingsState(): Promise<SkyPingsState> {
  if (!pushSupported()) return "unsupported";
  if (Notification.permission === "denied") return "blocked";
  try {
    const registration = await navigator.serviceWorker.ready;
    const subscription = await registration.pushManager.getSubscription();
    return subscription ? "on" : "off";
  } catch {
    return "off";
  }
}

/** Turns alerts off on this device and tells the tower to stop watching. */
export async function disableSkyPings(): Promise<void> {
  if (!pushSupported()) return;
  const registration = await navigator.serviceWorker.ready;
  const subscription = await registration.pushManager.getSubscription();
  if (!subscription) return;
  const { endpoint } = subscription;
  await subscription.unsubscribe();
  // Best-effort: the local subscription is already gone, so a failure here
  // only means the tower prunes it on its next failed send.
  await fetch(`${SKY_URL}/push/unsubscribe`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ endpoint }),
  }).catch(() => {});
}

/**
 * VAPID keys arrive base64url-encoded; the subscription API needs raw bytes.
 * Exported for tests — a padding error here is silent, producing a key the
 * push service rejects only at send time.
 */
export function urlBase64ToUint8Array(base64: string): Uint8Array {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const b64 = (base64 + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(b64);
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}

/**
 * Full opt-in flow: permission → VAPID key → browser subscription → register
 * the player's location with the sky geofence. Call from a user gesture.
 */
export async function enableSkyPings(lat: number, lon: number, radiusKm = CAPTURE_RADIUS_KM): Promise<void> {
  if (!pushSupported()) throw new PushError("unsupported");
  const permission = await Notification.requestPermission();
  if (permission !== "granted") throw new PushError("denied");

  const registration = await navigator.serviceWorker.ready;
  // Unchecked, a 503 from the tower returned an HTML body, .json() threw, and
  // the UI told the player their browser had blocked notifications — which
  // they had just granted.
  const keyRes = await fetch(`${SKY_URL}/push/key`);
  if (!keyRes.ok) throw new PushError("tower-unavailable");
  const { key } = (await keyRes.json()) as { key: string };
  const subscription = await registration.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: urlBase64ToUint8Array(key) as BufferSource,
  });

  const res = await fetch(`${SKY_URL}/push/subscribe`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ subscription: subscription.toJSON(), lat, lon, radiusKm }),
  });
  if (!res.ok) throw new PushError("tower-unavailable");
}
