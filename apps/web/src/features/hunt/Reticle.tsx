import { forwardRef } from "react";

export const RING_R = 54;
export const RING_C = 2 * Math.PI * RING_R;

/**
 * The capture reticle: corner brackets that close on lock, and a progress ring
 * that fills while aim is held. The ring is driven by stroke-dashoffset from
 * the animation loop, never from React state.
 */
export const Reticle = forwardRef<SVGCircleElement, { locked: boolean }>(function Reticle(
  { locked },
  ringRef
) {
  return (
    <svg className="reticle" viewBox="0 0 140 140" aria-hidden="true">
      {/* Track */}
      <circle cx="70" cy="70" r={RING_R} className="reticle__track" />
      {/* Progress */}
      <circle
        ref={ringRef}
        cx="70"
        cy="70"
        r={RING_R}
        className="reticle__progress"
        strokeDasharray={RING_C}
        strokeDashoffset={RING_C}
        transform="rotate(-90 70 70)"
      />
      {/* Corner brackets — they pull inward when the target is locked */}
      <g className={locked ? "reticle__brackets reticle__brackets--locked" : "reticle__brackets"}>
        <path d="M28 44 L28 28 L44 28" />
        <path d="M96 28 L112 28 L112 44" />
        <path d="M112 96 L112 112 L96 112" />
        <path d="M44 112 L28 112 L28 96" />
      </g>
      {/* Centre pip */}
      <g className="reticle__pip">
        <path d="M70 60 L70 66" />
        <path d="M70 74 L70 80" />
        <path d="M60 70 L66 70" />
        <path d="M74 70 L80 70" />
      </g>
    </svg>
  );
});
