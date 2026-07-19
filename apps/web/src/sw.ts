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
 * This worker MUST take over as soon as it installs.
 *
 * A worker that waits for the page to invite it in cannot ever be invited:
 * the previous build's worker keeps answering navigations from its own
 * precached index.html, so the new bundle — and any in-app prompt inside it
 * — is never fetched. Every future deploy is then invisible, and no redeploy
 * can break the loop. Do not "improve" this into a waiting worker.
 *
 * Taking over silently would leave the running page on the old bundle, so
 * lib/swUpdate.ts reloads on controllerchange to finish the job.
 */
self.skipWaiting();

// Kept so a page can still ask explicitly; harmless alongside the above.
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
