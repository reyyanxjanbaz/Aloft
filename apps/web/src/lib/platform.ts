/**
 * Platform abstraction: the app calls these, not the web APIs or Capacitor
 * plugins directly. On the web everything falls back to standard browser APIs;
 * inside a Capacitor shell the native plugins are used when present.
 *
 * Plugins are resolved lazily off `window.Capacitor` rather than imported, so
 * the pure-PWA build has zero native dependencies and no bundle cost.
 */

type PluginMethod = (...args: unknown[]) => Promise<unknown>;

interface CapacitorGlobal {
  isNativePlatform?: () => boolean;
  getPlatform?: () => string;
  Plugins?: Record<string, Record<string, PluginMethod | undefined>>;
}

function cap(): CapacitorGlobal | undefined {
  return (window as { Capacitor?: CapacitorGlobal }).Capacitor;
}

export function isNative(): boolean {
  return cap()?.isNativePlatform?.() === true;
}

export function platformName(): "ios" | "android" | "web" {
  const name = cap()?.getPlatform?.();
  return name === "ios" || name === "android" ? name : "web";
}

function plugin(name: string) {
  return cap()?.Plugins?.[name];
}

/** Native haptics when available; the Vibration API otherwise. */
export async function haptic(style: "light" | "medium" | "heavy" = "light"): Promise<void> {
  const haptics = plugin("Haptics");
  if (haptics?.impact) {
    await haptics.impact({ style: style.toUpperCase() }).catch(() => {});
    return;
  }
  const ms = style === "heavy" ? 40 : style === "medium" ? 20 : 10;
  if ("vibrate" in navigator) navigator.vibrate(ms);
}

/** Share sheet: native → Web Share API → clipboard. Returns how it went. */
export async function share(title: string, text: string, url: string): Promise<"shared" | "copied" | "failed"> {
  const sharePlugin = plugin("Share");
  if (sharePlugin?.share) {
    try {
      await sharePlugin.share({ title, text, url });
      return "shared";
    } catch {
      /* fall through */
    }
  }
  if (navigator.share) {
    try {
      await navigator.share({ title, text, url });
      return "shared";
    } catch {
      /* user cancelled or unavailable — fall through */
    }
  }
  try {
    await navigator.clipboard.writeText(url);
    return "copied";
  } catch {
    return "failed";
  }
}

/**
 * Background location updates — the capability a pure PWA cannot have.
 * On native, registers a watcher that reports the player's position even when
 * the app is backgrounded, so geofence pings are truly live. On web this is a
 * no-op and the server keeps geofencing the last-known location instead.
 */
export async function startBackgroundLocation(
  onPosition: (lat: number, lon: number) => void
): Promise<() => void> {
  const geo = plugin("Geolocation");
  if (isNative() && geo?.watchPosition) {
    const id = (await geo.watchPosition(
      { enableHighAccuracy: false, timeout: 30_000 },
      (pos: unknown) => {
        const coords = (pos as { coords?: { latitude: number; longitude: number } })?.coords;
        if (coords) onPosition(coords.latitude, coords.longitude);
      }
    )) as string;
    return () => void geo.clearWatch?.({ id });
  }
  return () => {};
}

/** Native push registration token, when running in a Capacitor shell. */
export async function registerNativePush(): Promise<string | null> {
  const push = plugin("PushNotifications");
  if (!isNative() || !push?.register) return null;
  try {
    const permission = (await push.requestPermissions?.()) as { receive?: string } | undefined;
    if (permission?.receive !== "granted") return null;
    await push.register();
    return await new Promise<string | null>((resolve) => {
      const timeout = setTimeout(() => resolve(null), 8000);
      void push.addListener?.("registration", (token: unknown) => {
        clearTimeout(timeout);
        resolve((token as { value?: string })?.value ?? null);
      });
    });
  } catch {
    // Native registration can throw (restricted entitlements, a native-side
    // error) — fail soft like every other function in this module rather
    // than becoming an unhandled rejection in whatever screen calls this.
    return null;
  }
}
