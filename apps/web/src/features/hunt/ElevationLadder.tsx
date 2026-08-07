import { forwardRef } from "react";

/** Degrees of elevation from the bottom of the ladder to the top. */
export const LADDER_SPAN_DEG = 90;
/** Pixels per degree, matching the tape's own scale feel. */
export const LADDER_PX_PER_DEG = 2.4;

/**
 * Elevation ladder up the right edge — the other half of the aim.
 *
 * Bearing was the only axis the HUD instrumented, and elevation is the one
 * players actually get wrong: pointing at the correct compass heading but at
 * the horizon, while the aircraft is 40° up. The scale is fixed and the amber
 * bug marks where the contact is; the phosphor index marks where the phone is
 * currently pointed.
 */
export const ElevationLadder = forwardRef<
  HTMLDivElement,
  { bugRef?: React.Ref<HTMLDivElement> }
>(function ElevationLadder({ bugRef }, indexRef) {
  const ticks = [];
  for (let deg = 0; deg <= LADDER_SPAN_DEG; deg += 10) {
    const major = deg % 30 === 0;
    ticks.push(
      <div
        key={deg}
        className={major ? "ladder__tick ladder__tick--major" : "ladder__tick"}
        style={{ bottom: deg * LADDER_PX_PER_DEG }}
      >
        {major && <span className="ladder__label">{deg}</span>}
      </div>
    );
  }

  return (
    <div className="ladder" aria-hidden="true">
      <div className="ladder__scale">
        {ticks}
        <div className="ladder__bug" ref={bugRef}>
          <svg viewBox="0 0 10 14" width="10" height="14">
            <path d="M10 0 L10 14 L5 14 L0 7 L5 0 Z" fill="currentColor" />
          </svg>
        </div>
        <div className="ladder__index" ref={indexRef} />
      </div>
    </div>
  );
});

/** Where a given elevation sits on the ladder, in pixels from the bottom. */
export function ladderOffsetPx(elevationDeg: number): number {
  const clamped = Math.min(Math.max(elevationDeg, 0), LADDER_SPAN_DEG);
  return clamped * LADDER_PX_PER_DEG;
}
