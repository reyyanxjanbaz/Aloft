import { forwardRef } from "react";

/** Bracket geometry at rest, in the 140-unit viewBox. */
export const BRACKET_OPEN = 1;
/** How far in the brackets have closed when capture completes. */
export const BRACKET_CLOSED = 0.4;

/**
 * The capture reticle: four corner brackets that close as aim is held.
 *
 * There is no progress ring. Progress *is* the brackets — they draw in from
 * full to 40% over the hold, so the lock visibly tightens rather than a
 * separate arc filling beside it. One device instead of two, and it moves on
 * the same curve the audio ticks already accelerate along.
 *
 * The scale is driven straight from the animation loop through this ref, never
 * from React state — the same reason the ring was driven by stroke-dashoffset.
 */
export const Reticle = forwardRef<SVGGElement>(function Reticle(_props, bracketsRef) {
  return (
    <svg className="reticle" viewBox="0 0 140 140" aria-hidden="true">
      {/* Lock is shown by stroke colour (.hunt--locked); how far the capture
          has run is the scale written here by the frame loop. */}
      <g ref={bracketsRef} className="reticle__brackets">
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

/** Bracket scale for a capture progress fraction. */
export function bracketScale(progress: number): number {
  const clamped = Math.min(Math.max(progress, 0), 1);
  return BRACKET_OPEN - (BRACKET_OPEN - BRACKET_CLOSED) * clamped;
}
