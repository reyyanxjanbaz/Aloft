import { CAPTURE_RADIUS_KM } from "@aloft/shared";
import { SKY_URL } from "../state/planes";

export function pushSupported(): boolean {
  return "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
}

export function pushPermission(): NotificationPermission | "unsupported" {
  return pushSupported() ? Notification.permission : "unsupported";
}

function urlBase64ToUint8Array(base64: string): Uint8Array {
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
  if (!pushSupported()) throw new Error("Push is not supported here");
  const permission = await Notification.requestPermission();
  if (permission !== "granted") throw new Error("Notifications were declined");

  const registration = await navigator.serviceWorker.ready;
  const { key } = (await (await fetch(`${SKY_URL}/push/key`)).json()) as { key: string };
  const subscription = await registration.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: urlBase64ToUint8Array(key) as BufferSource,
  });

  const res = await fetch(`${SKY_URL}/push/subscribe`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ subscription: subscription.toJSON(), lat, lon, radiusKm }),
  });
  if (!res.ok) throw new Error("The tower did not accept the subscription");
}
