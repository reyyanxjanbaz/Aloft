import { useEffect, useState } from "react";
import { fetchLiveAirframes, FLEET_LIMIT } from "./liveApi";

/**
 * How much of the collection is in the air right now.
 *
 * One line, and it is the reason to open the hangar on a quiet afternoon.
 * Limited to the most recent airframes because upstream has no batch
 * endpoint — each one is its own request — so the copy says which subset it
 * is measuring rather than implying it counted everything.
 */
export function FleetStatus({ hexes }: { hexes: string[] }) {
  const [airborne, setAirborne] = useState<number | null>(null);
  const sample = hexes.slice(0, FLEET_LIMIT);
  const key = sample.join(",");

  useEffect(() => {
    if (sample.length === 0) return;
    let alive = true;
    fetchLiveAirframes(sample)
      .then((live) => {
        if (!alive) return;
        setAirborne(Object.values(live).filter((a) => a?.airborne).length);
      })
      // Silent: this is a garnish, and a failed lookup should never put an
      // error where a number was going to be.
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [key]);

  if (airborne === null || sample.length === 0) return null;

  const scope = hexes.length > FLEET_LIMIT ? `your last ${sample.length} airframes` : `your ${sample.length} airframes`;

  return (
    <p className="fleet">
      <span className="fleet__count data">{airborne}</span>
      <span className="fleet__text">
        of {scope} {airborne === 1 ? "is" : "are"} airborne right now
      </span>
    </p>
  );
}
