import { useEffect, useRef } from "react";

const clamp = (v: number, a = 0, b = 1): number => Math.min(Math.max(v, a), b);

function prefersReducedMotion(): boolean {
  return typeof window !== "undefined" && !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
}

/**
 * Pointer-driven 3D tilt for a collectible card.
 *
 * Writes CSS custom properties on the element through a rAF loop rather than
 * React state, so a moving pointer can't storm re-renders, and eases back to
 * rest when the pointer leaves. The frame loop stops the moment it settles
 * (no idle rAF), and both the loop and the listeners are torn down on unmount.
 *
 * Honours prefers-reduced-motion by attaching nothing at all — the card stays
 * flat and every layer reads its var() fallback.
 */
export function useTilt<T extends HTMLElement>() {
  const ref = useRef<T>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el || prefersReducedMotion()) return;

    let raf = 0;
    // Rest position sits a touch above centre, matching the readout weight.
    let tx = 50;
    let ty = 45;
    let cx = 50;
    let cy = 45;
    let targetActive = 0;
    let active = 0;

    const set = (k: string, v: string) => el.style.setProperty(k, v);

    const frame = () => {
      cx += (tx - cx) * 0.18;
      cy += (ty - cy) * 0.18;
      active += (targetActive - active) * 0.12;

      const pxr = (cx - 50) / 50;
      const pyr = (cy - 50) / 50;
      set("--px", `${cx.toFixed(2)}%`);
      set("--py", `${cy.toFixed(2)}%`);
      set("--pxr", pxr.toFixed(3));
      set("--pyr", pyr.toFixed(3));
      set("--pfc", clamp(Math.hypot(pxr, pyr)).toFixed(3));
      set("--rx", `${((cy - 50) / 5).toFixed(2)}deg`);
      set("--ry", `${(-(cx - 50) / 4).toFixed(2)}deg`);
      set("--active", active.toFixed(3));

      if (Math.abs(tx - cx) > 0.1 || Math.abs(ty - cy) > 0.1 || Math.abs(targetActive - active) > 0.01) {
        raf = requestAnimationFrame(frame);
      } else {
        raf = 0;
      }
    };
    const kick = () => {
      if (!raf) raf = requestAnimationFrame(frame);
    };

    const onMove = (e: PointerEvent) => {
      const r = el.getBoundingClientRect();
      tx = clamp(((e.clientX - r.left) / r.width) * 100, 0, 100);
      ty = clamp(((e.clientY - r.top) / r.height) * 100, 0, 100);
      kick();
    };
    const onEnter = () => {
      targetActive = 1;
      el.classList.add("is-active");
      kick();
    };
    const onLeave = () => {
      targetActive = 0;
      tx = 50;
      ty = 45;
      el.classList.remove("is-active");
      kick();
    };

    el.addEventListener("pointermove", onMove);
    el.addEventListener("pointerenter", onEnter);
    el.addEventListener("pointerleave", onLeave);
    return () => {
      el.removeEventListener("pointermove", onMove);
      el.removeEventListener("pointerenter", onEnter);
      el.removeEventListener("pointerleave", onLeave);
      if (raf) cancelAnimationFrame(raf);
    };
  }, []);

  return ref;
}
