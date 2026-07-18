import { forwardRef } from "react";

export const PX_PER_DEG = 4;
const CARDINALS: Record<number, string> = { 0: "N", 90: "E", 180: "S", 270: "W" };

/**
 * Compass ribbon across the top of the HUD, exactly as an aircraft heading
 * tape works: the scale slides, the index stays put. Two full laps are laid
 * out statically so the tape can be translated with a transform on every
 * frame without React re-rendering anything.
 */
export const BearingTape = forwardRef<HTMLDivElement>(function BearingTape(_props, ref) {
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
          <span className="tape__label">
            {CARDINALS[real] ?? String(real).padStart(3, "0")}
          </span>
        )}
      </div>
    );
  }

  return (
    <div className="tape" aria-hidden="true">
      <div className="tape__scale" ref={ref}>
        {ticks}
      </div>
      <div className="tape__index" />
    </div>
  );
});
