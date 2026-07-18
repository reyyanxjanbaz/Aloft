// Custom service worker: Workbox precache + Web Push handlers.
// Excluded from the app's tsc pass (worker globals vs DOM lib); bundled by vite-plugin-pwa.
import { clientsClaim } from "workbox-core";
import { cleanupOutdatedCaches, precacheAndRoute } from "workbox-precaching";

declare const self: {
  __WB_MANIFEST: Array<{ url: string; revision: string | null }>;
  skipWaiting(): void;
  registration: { showNotification(title: string, opts?: object): Promise<void> };
  clients: {
    matchAll(opts?: object): Promise<Array<{ focus(): Promise<unknown>; url: string }>>;
    openWindow(url: string): Promise<unknown>;
  };
  addEventListener(type: string, handler: (event: never) => void): void;
};

self.skipWaiting();
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
  (event: { notification: { close(): void }; waitUntil(p: Promise<unknown>): void }) => {
    event.notification.close();
    event.waitUntil(
      self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clients) => {
        const existing = clients[0];
        if (existing) return existing.focus();
        return self.clients.openWindow("/");
      })
    );
  }
);
