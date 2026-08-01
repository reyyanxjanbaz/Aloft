/**
 * Access to the device orientation sensor, which iOS gates behind a permission
 * that can only be requested from a genuine user gesture.
 *
 * Why this lives at app level rather than inside the Hangar: the permission
 * used to be requested on the first tap *after* the Hangar mounted. Opening the
 * Hangar and tilting the phone therefore did nothing at all — the tap that
 * navigated there happened before the listener existed, and the only other
 * thing to tap was a card, which opens a full-screen viewer over the very cards
 * you were trying to see shine. Priming from app start means the tap on the
 * Hangar tab is itself the gesture that unlocks the sensor.
 *
 * The grant is remembered, because iOS resolves requestPermission() without a
 * gesture once the origin has been granted — so on later visits the sensor can
 * be armed immediately, before the player touches anything.
 */

const GRANT_KEY = "aloft:orientation-granted";

interface OrientationPermissionAPI {
  requestPermission?: () => Promise<"granted" | "denied" | "default">;
}

function api(): OrientationPermissionAPI | undefined {
  if (typeof window === "undefined") return undefined;
  return window.DeviceOrientationEvent as unknown as OrientationPermissionAPI | undefined;
}

/** True when this platform gates the sensor behind an explicit prompt (iOS). */
export function needsPermission(): boolean {
  return typeof api()?.requestPermission === "function";
}

function remembered(): boolean {
  try {
    return localStorage.getItem(GRANT_KEY) === "1";
  } catch {
    return false; // private mode / storage blocked — just ask again
  }
}

function remember(): void {
  try {
    localStorage.setItem(GRANT_KEY, "1");
  } catch {
    /* not fatal — we simply ask again next time */
  }
}

let granted: Promise<boolean> | null = null;
let resolveGranted: ((v: boolean) => void) | null = null;

/** Resolves once the sensor may be used. Never rejects. */
export function orientationAccess(): Promise<boolean> {
  if (granted) return granted;

  const DOE = api();
  if (!DOE) return (granted = Promise.resolve(false));
  // Android and desktop expose the sensor with no prompt at all.
  if (typeof DOE.requestPermission !== "function") return (granted = Promise.resolve(true));

  granted = new Promise<boolean>((resolve) => {
    resolveGranted = resolve;
  });

  const ask = (fromGesture: boolean) => {
    DOE.requestPermission!()
      .then((state) => {
        if (state === "granted") {
          remember();
          detach();
          resolveGranted?.(true);
        } else if (fromGesture) {
          // An explicit refusal. Stay attached so a later tap can retry —
          // players do change their mind, and there is no other way back.
          granted = null;
          resolveGranted = null;
          arm();
        }
      })
      .catch(() => {
        // Thrown when called outside a gesture: expected on a cold start.
        if (!fromGesture) arm();
      });
  };

  const onGesture = () => {
    detach();
    ask(true);
  };
  const EVENTS = ["click", "touchend", "pointerup"] as const;
  const arm = () => {
    for (const e of EVENTS) window.addEventListener(e, onGesture, { capture: true, once: false });
  };
  const detach = () => {
    for (const e of EVENTS) window.removeEventListener(e, onGesture, { capture: true });
  };

  // Already granted for this origin: iOS resolves without a gesture, so the
  // sensor can be live before the player touches the screen.
  if (remembered()) ask(false);
  else arm();

  return granted;
}

/**
 * Called once at app start so that any tap anywhere — including the one that
 * opens the Hangar — can serve as the unlocking gesture.
 */
export function primeOrientation(): void {
  if (needsPermission()) void orientationAccess();
}
