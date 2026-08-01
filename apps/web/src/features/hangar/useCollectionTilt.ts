import { useEffect, useRef } from "react";

const clamp = (v: number, a = -1, b = 1): number => Math.min(Math.max(v, a), b);

function prefersReducedMotion(): boolean {
  return typeof window !== "undefined" && !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
}

interface OrientationPermissionAPI {
  requestPermission?: () => Promise<"granted" | "denied" | "default">;
}

/**
 * Drives the whole caught-plane collection from one light source, so tilting
 * the phone (or, on desktop, moving the pointer) makes every visible foil card
 * catch the light together — like turning a case of cards under a lamp.
 *
 * Writes eased `--gx/--gy/--gpfc/--gon` custom properties on a container
 * element; the cards inside read them through the cascade, so there is no
 * per-card React state and no per-card listener. On phones it uses the
 * gyroscope (`deviceorientation`), requesting the iOS motion permission on the
 * player's first touch so there's no button to hunt for; on desktop it falls
 * back to the pointer. Under prefers-reduced-motion it attaches nothing and the
 * cards stay flat.
 *
 * Returns a ref to place on the collection container.
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
    const onOrient = (e: DeviceOrientationEvent) => {
      if (e.gamma == null || e.beta == null) return;
      // gamma is left/right roll; beta is front/back pitch. 42° is a natural
      // "holding the phone up to look" resting pitch, so subtract it.
      tx = clamp(e.gamma / 30);
      ty = clamp((e.beta - 42) / 30);
      targetOn = 1;
      kick();
    };

    window.addEventListener("pointermove", onPointerMove);
    document.addEventListener("pointerleave", onPointerLeave);

    let requestOnGesture: (() => void) | null = null;
    if (typeof DeviceOrientationEvent !== "undefined") {
      const api = DeviceOrientationEvent as unknown as OrientationPermissionAPI;
      if (typeof api.requestPermission === "function") {
        // iOS: permission must be asked from a user gesture. Do it silently on
        // the first touch so the effect is simply on, with no button.
        requestOnGesture = () => {
          window.removeEventListener("pointerdown", requestOnGesture!);
          window.removeEventListener("touchend", requestOnGesture!);
          api
            .requestPermission!()
            .then((state) => {
              if (state === "granted") window.addEventListener("deviceorientation", onOrient);
            })
            .catch(() => {});
        };
        window.addEventListener("pointerdown", requestOnGesture);
        window.addEventListener("touchend", requestOnGesture);
      } else {
        window.addEventListener("deviceorientation", onOrient);
      }
    }

    return () => {
      window.removeEventListener("pointermove", onPointerMove);
      document.removeEventListener("pointerleave", onPointerLeave);
      window.removeEventListener("deviceorientation", onOrient);
      if (requestOnGesture) {
        window.removeEventListener("pointerdown", requestOnGesture);
        window.removeEventListener("touchend", requestOnGesture);
      }
      if (raf) cancelAnimationFrame(raf);
    };
  }, []);

  return ref;
}
