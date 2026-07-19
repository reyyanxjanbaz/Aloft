import { create } from "zustand";
import { useApp } from "../state/app";

interface UpdateState {
  /** A newer build has taken control but the page hasn't reloaded yet. */
  ready: boolean;
}

export const useUpdate = create<UpdateState>(() => ({ ready: false }));

/** Reloading during a capture would throw away a lock the player is holding. */
function midCapture(): boolean {
  const view = useApp.getState().view.name;
  return view === "hunt" || view === "reveal";
}

let reloading = false;

function applyUpdate(): void {
  if (reloading) return;
  reloading = true;
  window.location.reload();
}

export function reloadForUpdate(): void {
  applyUpdate();
}

/**
 * Registers the service worker and makes a new build actually reach the
 * player.
 *
 * Two failure modes to avoid, and they pull in opposite directions:
 *
 * A worker that never self-activates strands everyone. The previous build's
 * worker keeps serving its own precached index.html, so the new bundle — and
 * any in-app update prompt living inside it — is never fetched. No amount of
 * redeploying helps, because the browser is being answered from a cache the
 * old worker controls. That is a deadlock, and it is why this file exists.
 *
 * A worker that activates silently leaves the running page on the old
 * bundle until the next cold launch, which on an installed iOS PWA can be
 * days: the app is frozen, not killed. That was the original "my fix didn't
 * deploy" symptom.
 *
 * So: the worker always takes over (sw.ts calls skipWaiting), and the page
 * reloads the moment it does — except mid-capture, where the toast waits for
 * the player instead.
 */
export function registerServiceWorker(): void {
  if (!("serviceWorker" in navigator)) return;

  // Registering before load competes with the app's own first paint.
  window.addEventListener("load", () => {
    // Whether this page was already being controlled decides whether a
    // controller change is an update (reload) or a first install (don't).
    const hadController = navigator.serviceWorker.controller !== null;

    navigator.serviceWorker.register("/sw.js").catch((err) => {
      console.warn("[sw] registration failed:", err);
    });

    navigator.serviceWorker.addEventListener("controllerchange", () => {
      if (!hadController) return; // first install: nothing to refresh
      if (midCapture()) {
        useUpdate.setState({ ready: true });
        return;
      }
      applyUpdate();
    });
  });
}
