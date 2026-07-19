import { useEffect, useState } from "react";
import { distanceM } from "@aloft/shared";
import type { PlayerPosition } from "../../lib/useGeolocation";
import { fetchLiveAirframe, type LiveAirframe } from "./liveApi";

/**
 * Beyond this, "last seen" stops meaning anything useful: the feed only
 * tracks an aircraft while something is receiving it, so a large gap means
 * "not being tracked", not "parked an hour ago".
 */
const STALE_SEC = 3600;

type State = { phase: "loading" } | { phase: "error" } | { phase: "done"; live: LiveAirframe | null };

/**
 * What this airframe is doing right now.
 *
 * A hangar of static cards is a scrapbook. The aircraft you caught is a real
 * machine that is, at this moment, somewhere — parked at a stand, or eight
 * kilometres over another country. Showing that turns the collection into
 * something with a pulse, and gives a reason to open the app when nothing is
 * overhead.
 */
export function LiveStatus({ hex, position }: { hex: string; position: PlayerPosition }) {
  const [state, setState] = useState<State>({ phase: "loading" });

  useEffect(() => {
    let alive = true;
    setState({ phase: "loading" });
    fetchLiveAirframe(hex)
      .then((live) => alive && setState({ phase: "done", live }))
      .catch(() => alive && setState({ phase: "error" }));
    return () => {
      alive = false;
    };
  }, [hex]);

  if (state.phase === "loading") {
    return (
      <p className="live live--pending">
        <span className="label">Now</span>
        <span className="live__text">Interrogating…</span>
      </p>
    );
  }

  if (state.phase === "error") {
    return (
      <p className="live">
        <span className="label">Now</span>
        <span className="live__text">Tower unreachable</span>
      </p>
    );
  }

  const live = state.live;
  const trackedRecently = live !== null && (live.seenSec === undefined || live.seenSec < STALE_SEC);

  if (!trackedRecently) {
    return (
      <p className="live">
        <span className="label">Now</span>
        <span className="live__text">Off radar</span>
      </p>
    );
  }

  if (!live.airborne) {
    return (
      <p className="live">
        <span className="label">Now</span>
        <span className="live__text">On the ground</span>
      </p>
    );
  }

  const parts: string[] = ["Airborne"];
  if (live.altFt !== undefined) parts.push(`FL${Math.round(live.altFt / 100)}`);
  if (live.gsKt !== undefined) parts.push(`${Math.round(live.gsKt)} kt`);
  if (live.lat !== undefined && live.lon !== undefined) {
    const km = distanceM(position.lat, position.lon, live.lat, live.lon) / 1000;
    parts.push(`${km < 10 ? km.toFixed(1) : Math.round(km).toLocaleString()} km out`);
  }

  return (
    <p className="live live--airborne">
      <span className="label">Now</span>
      <span className="live__text mono">{parts.join(" · ")}</span>
    </p>
  );
}
