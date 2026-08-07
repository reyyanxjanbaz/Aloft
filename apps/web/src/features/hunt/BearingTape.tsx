import { forwardRef } from "react";

export const PX_PER_DEG = 4;
const CARDINALS: Record<number, string> = { 0: "N", 90: "E", 180: "S", 270: "W" };

/**
 * Compass ribbon across the top of the HUD, exactly as an aircraft heading
 * tape works: the scale slides, the index stays put. Two full laps are laid
 * out statically so the tape can be translated with a transform on every
 * frame without React re-rendering anything.
 *
 * The amber marker riding the scale is the target bug — the contact's bearing.
 * Aiming is now "drive the bug to the index", which is the task a real bug
 * exists for, and it is what gives the tape something to do besides report.
 * The bug lives inside the sliding scale, so it moves with the degrees rather
 * than being positioned separately every frame.
 */
export const BearingTape = forwardRef<HTMLDivElement, { bugRef?: React.Ref<HTMLDivElement> }>(
  function BearingTape({ bugRef }, ref) {
    const ticks = [];
    for (let deg = 0; deg <= 720; deg += 10) {
      const real = deg % 360;
      const major = real % 30 === 0;
      ticks.push(
        <div
          key={deg}
          className={major ? "tape__tick tape__tick--major" : "tape__tick"}
          style={{ left: deg * PX_PER_DEG }}
        >
          {major && (
            <span className="tape__label">{CARDINALS[real] ?? String(real).padStart(3, "0")}</span>
          )}
        </div>
      );
    }

    return (
      <div className="tape" aria-hidden="true">
        <div className="tape__scale" ref={ref}>
          {ticks}
          <div className="tape__bug" ref={bugRef}>
            <svg viewBox="0 0 14 10" width="14" height="10">
              <path d="M0 0 L14 0 L14 5 L7 10 L0 5 Z" fill="currentColor" />
            </svg>
          </div>
        </div>
        <div className="tape__index" />
      </div>
    );
  }
);
