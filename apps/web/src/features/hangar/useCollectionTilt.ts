import { useEffect, useRef } from "react";

const clamp = (v: number, a = -1, b = 1): number => Math.min(Math.max(v, a), b);

/** How many degrees of tilt map to the full effect, and the resting pitch of a
 *  phone held up to look at it (screen tilted back ~45°). */
const TILT_RANGE_DEG = 22;
const NEUTRAL_PITCH_DEG = 45;

function prefersReducedMotion(): boolean {
  return typeof window !== "undefined" && !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
}

interface OrientationPermissionAPI {
  requestPermission?: () => Promise<"granted" | "denied" | "default">;
}

/** Screen rotation in degrees, so beta/gamma can be remapped in landscape. */
function screenAngle(): number {
  if (typeof window === "undefined") return 0;
  const a = window.screen?.orientation?.angle;
  if (typeof a === "number") return a;
  const legacy = (window as unknown as { orientation?: number }).orientation;
  return typeof legacy === "number" ? legacy : 0;
}

/**
 * Drives the whole caught-plane collection from one light source, so tilting
 * the phone (or, on desktop, moving the pointer) makes every visible foil card
 * catch the light together — like turning a case of cards under a lamp.
 *
 * Writes eased `--gx/--gy/--gpfc/--gon` custom properties on a container
 * element; the cards inside read them through the cascade, so there's no
 * per-card state and no per-card listener.
 *
 * Phones use the gyroscope (`deviceorientation`). iOS gates the sensor behind a
 * permission that can only be requested from a genuine user gesture and only in
 * a secure (HTTPS) context, so we request it on the player's first tap in the
 * Hangar (a `click`/`touchend` — the triggers iOS actually honours). Android
 * and other platforms expose the sensor without a prompt, so we attach right
 * away. Desktop falls back to the pointer. Under prefers-reduced-motion nothing
 * attaches and the cards stay flat.
 */
export function useCollectionTilt<T extends HTMLElement>() {
  const ref = useRef<T>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el || prefersReducedMotion()) return;

    let raf = 0;
    let tx = 0;
    let ty = 0;
    let targetOn = 0;
    let cx = 0;
    let cy = 0;
    let on = 0;

    const frame = () => {
      cx += (tx - cx) * 0.12;
      cy += (ty - cy) * 0.12;
      on += (targetOn - on) * 0.09;
      el.style.setProperty("--gx", cx.toFixed(4));
      el.style.setProperty("--gy", cy.toFixed(4));
      el.style.setProperty("--gpfc", Math.min(Math.hypot(cx, cy), 1).toFixed(4));
      el.style.setProperty("--gon", on.toFixed(4));
      if (Math.abs(tx - cx) > 0.002 || Math.abs(ty - cy) > 0.002 || Math.abs(targetOn - on) > 0.004) {
        raf = requestAnimationFrame(frame);
      } else {
        raf = 0;
      }
    };
    const kick = () => {
      if (!raf) raf = requestAnimationFrame(frame);
    };

    // ── desktop pointer ──
    const onPointerMove = (e: PointerEvent) => {
      if (e.pointerType === "touch") return; // touch devices use the gyroscope
      tx = clamp((e.clientX / window.innerWidth - 0.5) * 2);
      ty = clamp((e.clientY / window.innerHeight - 0.5) * 2);
      targetOn = 1;
      kick();
    };
    const onPointerLeave = () => {
      tx = 0;
      ty = 0;
      targetOn = 0;
      kick();
    };
    window.addEventListener("pointermove", onPointerMove);
    document.addEventListener("pointerleave", onPointerLeave);

    // ── gyroscope ──
    const onOrient = (e: DeviceOrientationEvent) => {
      if (e.beta == null || e.gamma == null) return;
      // Remap for the current screen rotation so "roll" and "pitch" stay
      // consistent whichever way the phone is held.
      let g = e.gamma; // left/right roll, -90..90
      let b = e.beta; // front/back pitch, -180..180
      const angle = screenAngle();
      if (angle === 90) {
        g = e.beta;
        b = -e.gamma;
      } else if (angle === 270 || angle === -90) {
        g = -e.beta;
        b = e.gamma;
      } else if (angle === 180) {
        g = -e.gamma;
        b = -e.beta;
      }
      tx = clamp(g / TILT_RANGE_DEG);
      ty = clamp((b - NEUTRAL_PITCH_DEG) / TILT_RANGE_DEG);
      targetOn = 1;
      kick();
    };

    let detachGyro = () => {};
    const DOE = typeof window !== "undefined" ? (window.DeviceOrientationEvent as unknown as OrientationPermissionAPI | undefined) : undefined;
    if (DOE) {
      if (typeof DOE.requestPermission === "function") {
        // iOS: ask on the first real tap; both click and touchend are triggers
        // iOS honours (pointerdown is not reliably one).
        const requestOnce = () => {
          document.removeEventListener("click", requestOnce);
          document.removeEventListener("touchend", requestOnce);
          DOE.requestPermission!()
            .then((state) => {
              if (state === "granted") window.addEventListener("deviceorientation", onOrient);
            })
            .catch(() => {});
        };
        document.addEventListener("click", requestOnce);
        document.addEventListener("touchend", requestOnce);
        detachGyro = () => {
          document.removeEventListener("click", requestOnce);
          document.removeEventListener("touchend", requestOnce);
          window.removeEventListener("deviceorientation", onOrient);
        };
      } else {
        window.addEventListener("deviceorientation", onOrient);
        detachGyro = () => window.removeEventListener("deviceorientation", onOrient);
      }
    }

    return () => {
      window.removeEventListener("pointermove", onPointerMove);
      document.removeEventListener("pointerleave", onPointerLeave);
      detachGyro();
      if (raf) cancelAnimationFrame(raf);
    };
  }, []);

  return ref;
}
