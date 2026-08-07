import { listCatches, listPendingCatches } from "../features/hangar/db";

/**
 * The power-on self test the boot screen prints.
 *
 * Every line here corresponds to a check the app genuinely performs — nothing
 * is faked and nothing is padded with a delay to look busy. That constraint is
 * what decides the list: the feed and the server clock cannot be checked at
 * boot because both are downstream of having a position at all, so they are not
 * claimed. What is left is what can actually be known before the scope opens.
 *
 * The screen leaves as soon as a fix lands, so the test takes exactly as long
 * as acquiring a position takes. It never adds a wait of its own.
 */

export type CheckState = "pending" | "pass" | "fail";

export interface Check {
  id: string;
  /** Left-hand rubric, e.g. "HANGAR". */
  label: string;
  state: CheckState;
  /** Right-hand readout once resolved, e.g. "41 REC". */
  value: string;
}

/** Whether the device can report a heading — the hunt screen depends on it. */
export function hasCompass(): boolean {
  return typeof window !== "undefined" && "DeviceOrientationEvent" in window;
}

/**
 * Reads the local hangar. Resolves to a failure line rather than throwing:
 * a device whose store will not open still boots, it just cannot log catches,
 * and the player is better off being told at power-on than at the reveal.
 */
export async function checkHangar(): Promise<Check> {
  try {
    const [caught, pending] = await Promise.all([listCatches(), listPendingCatches()]);
    const value = pending.length > 0 ? `${caught.length} REC · ${pending.length} QUEUED` : `${caught.length} REC`;
    return { id: "hangar", label: "Hangar", state: "pass", value };
  } catch {
    return { id: "hangar", label: "Hangar", state: "fail", value: "UNREADABLE" };
  }
}

/** The sensor line: compass present, or the drag fallback the hunt will use. */
export function checkSensors(): Check {
  return hasCompass()
    ? { id: "sensors", label: "Sensors", state: "pass", value: "COMPASS" }
    : { id: "sensors", label: "Sensors", state: "fail", value: "NO COMPASS · DRAG" };
}

/** The position line. Stays pending until a fix lands; that is the real wait. */
export function checkPosition(
  position: { simulated: boolean } | null,
  error: string | null
): Check {
  if (position) {
    return {
      id: "gnss",
      label: "GNSS",
      state: "pass",
      value: position.simulated ? "SIMULATED" : "FIX ACQUIRED",
    };
  }
  if (error) return { id: "gnss", label: "GNSS", state: "fail", value: "NO FIX" };
  return { id: "gnss", label: "GNSS", state: "pending", value: "ACQUIRING" };
}
