import { useEffect, useRef } from "react";
import { orientationAccess } from "../../lib/orientation";
import { remapForScreen, tiltVector } from "./tiltMath";

const clamp = (v: number, a = -1, b = 1): number => Math.min(Math.max(v, a), b);

function prefersReducedMotion(): boolean {
  return typeof window !== "undefined" && !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
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
 * The sensor permission is handled app-wide (lib/orientation) rather than here,
 * so the tap that opens the Hangar is itself the gesture that unlocks it. The
 * resting pitch is calibrated from the first readings instead of assumed, so
 * the light sweeps symmetrically whether the phone is flat on a table or held
 * up to read. Under prefers-reduced-motion nothing attaches and cards stay flat.
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
    let alive = true;

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
    const onPointerLeave = (e: PointerEvent) => {
      // A finger lifting also "leaves" the document; letting that reset the
      // light would fight the gyroscope on every tap.
      if (e.pointerType === "touch") return;
      tx = 0;
      ty = 0;
      targetOn = 0;
      kick();
    };
    window.addEventListener("pointermove", onPointerMove);
    document.addEventListener("pointerleave", onPointerLeave);

    // ── gyroscope ──
    // The posture the phone is first seen in becomes the resting position, then
    // drifts slowly toward the player's actual average hold.
    let neutralPitch: number | null = null;

    const onOrient = (e: DeviceOrientationEvent) => {
      if (e.beta == null || e.gamma == null) return;
      const { pitch, roll } = remapForScreen(e.beta, e.gamma, screenAngle());
      if (neutralPitch === null) neutralPitch = pitch;
      else neutralPitch += (pitch - neutralPitch) * 0.002; // slow re-centring
      const v = tiltVector(roll, pitch, neutralPitch);
      tx = v.tx;
      ty = v.ty;
      targetOn = 1;
      kick();
    };

    // Some Android builds only emit the absolute variant.
    const ORIENT_EVENTS = ["deviceorientation", "deviceorientationabsolute"] as const;
    let detachGyro = () => {};
    void orientationAccess().then((ok) => {
      if (!ok || !alive) return;
      for (const name of ORIENT_EVENTS) window.addEventListener(name, onOrient as EventListener);
      detachGyro = () => {
        for (const name of ORIENT_EVENTS) window.removeEventListener(name, onOrient as EventListener);
      };
    });

    return () => {
      alive = false;
      window.removeEventListener("pointermove", onPointerMove);
      document.removeEventListener("pointerleave", onPointerLeave);
      detachGyro();
      if (raf) cancelAnimationFrame(raf);
    };
  }, []);

  return ref;
}
