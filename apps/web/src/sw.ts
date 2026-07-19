// Custom service worker: Workbox precache + Web Push handlers.
// Excluded from the app's tsc pass (worker globals vs DOM lib); bundled by vite-plugin-pwa.
import { clientsClaim } from "workbox-core";
import { cleanupOutdatedCaches, precacheAndRoute } from "workbox-precaching";

declare const self: {
  __WB_MANIFEST: Array<{ url: string; revision: string | null }>;
  skipWaiting(): void;
  addEventListener(type: "message", handler: (event: { data?: { type?: string } }) => void): void;
  registration: { showNotification(title: string, opts?: object): Promise<void> };
  clients: {
    matchAll(
      opts?: object
    ): Promise<Array<{ focus(): Promise<unknown>; url: string; postMessage(msg: unknown): void }>>;
    openWindow(url: string): Promise<unknown>;
  };
  addEventListener(type: string, handler: (event: never) => void): void;
};

/**
 * Activation is deliberately NOT automatic.
 *
 * Calling skipWaiting() here swapped the service worker mid-session while a
 * page was still running the previous build, and cleanupOutdatedCaches()
 * then deleted the precache that page's lazy chunks came from — so a later
 * dynamic import could 404. Worse, an installed PWA launched from the old
 * worker got the *precached* index.html and ran a version behind for the
 * whole session, which is exactly how a shipped fix appeared not to deploy.
 *
 * The page now asks (see UpdateToast) and sends SKIP_WAITING when the player
 * accepts, so the swap and the reload happen together.
 */
self.addEventListener("message", (event) => {
  if (event.data?.type === "SKIP_WAITING") self.skipWaiting();
});

clientsClaim();
cleanupOutdatedCaches();
precacheAndRoute(self.__WB_MANIFEST);

interface PushPayload {
  title?: string;
  body?: string;
  hex?: string;
}

self.addEventListener("push", (event: { data?: { json(): PushPayload }; waitUntil(p: Promise<unknown>): void }) => {
  let payload: PushPayload = {};
  try {
    payload = event.data?.json() ?? {};
  } catch {
    /* non-JSON push — show the default */
  }
  event.waitUntil(
    self.registration.showNotification(payload.title ?? "Aloft", {
      body: payload.body ?? "Something is in your sky…",
      icon: "/pwa-192.png",
      badge: "/pwa-192.png",
      tag: "aloft-ping",
      data: payload,
    })
  );
});

self.addEventListener(
  "notificationclick",
  (event: {
    notification: { close(): void; data?: PushPayload };
    waitUntil(p: Promise<unknown>): void;
  }) => {
    // The payload always carries which aircraft triggered the ping — without
    // reading it, tapping "something rare is inbound" just opened whatever
    // screen the app happened to be on, instead of that contact.
    const hex = event.notification.data?.hex;
    event.notification.close();
    event.waitUntil(
      self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clients) => {
        const existing = clients[0];
        if (existing) {
          if (hex) existing.postMessage({ type: "focus-contact", hex });
          return existing.focus();
        }
        return self.clients.openWindow(hex ? `/?focus=${encodeURIComponent(hex)}` : "/");
      })
    );
  }
);
