import { useCallback, useEffect, useRef, useState } from "react";

export interface Aim {
  /** Compass heading the camera points at, degrees from true north. */
  heading: number;
  /** Elevation of the camera view, degrees above the horizon. */
  pitch: number;
}

export type AimMode = "waiting" | "sensor" | "drag";

interface IOSOrientationEvent extends DeviceOrientationEvent {
  webkitCompassHeading?: number;
}

/**
 * Phone-as-viewfinder orientation. iOS requires a user-gesture permission
 * (`arm()` must be called from a tap). If no usable sensor data arrives
 * shortly after arming — desktop, simulators, denied permission — we fall
 * back to drag-to-aim so the game stays playable anywhere.
 */
export function useOrientation() {
  const aimRef = useRef<Aim>({ heading: 0, pitch: 20 });
  const [mode, setMode] = useState<AimMode>("waiting");
  const modeRef = useRef<AimMode>("waiting");
  const gotSensorRef = useRef(false);

  const setModeBoth = (m: AimMode) => {
    modeRef.current = m;
    setMode(m);
  };

  useEffect(() => {
    const handler = (e: DeviceOrientationEvent) => {
      const ios = e as IOSOrientationEvent;
      let heading: number | null = null;
      if (typeof ios.webkitCompassHeading === "number" && !Number.isNaN(ios.webkitCompassHeading)) {
        heading = ios.webkitCompassHeading;
      } else if (e.alpha !== null && (e.absolute || "ondeviceorientationabsolute" in window === false)) {
        heading = (360 - e.alpha) % 360;
      }
      const pitch = e.beta !== null ? Math.max(-90, Math.min(90, e.beta - 90)) : null;

      // Once the player has fallen back to (or chosen) drag mode, a
      // late-arriving real sensor reading must not silently reclaim control —
      // that used to yank the reticle out from under an active manual drag
      // the instant the compass finally produced its first heading.
      if (heading !== null && modeRef.current !== "drag") {
        gotSensorRef.current = true;
        if (modeRef.current !== "sensor") setModeBoth("sensor");
        aimRef.current.heading = heading;
      }
      if (pitch !== null && modeRef.current !== "drag") {
        aimRef.current.pitch = pitch;
      }
    };

    const eventName =
      "ondeviceorientationabsolute" in window ? "deviceorientationabsolute" : "deviceorientation";
    window.addEventListener(eventName as "deviceorientation", handler, true);
    return () => window.removeEventListener(eventName as "deviceorientation", handler, true);
  }, []);

  /** Call from a user tap. Requests iOS permission, then waits for real data. */
  const arm = useCallback(async () => {
    type PermissionRequester = { requestPermission?: () => Promise<string> };
    const doe = DeviceOrientationEvent as unknown as PermissionRequester;
    try {
      if (typeof doe.requestPermission === "function") {
        const answer = await doe.requestPermission();
        if (answer !== "granted") {
          setModeBoth("drag");
          return;
        }
      }
    } catch {
      setModeBoth("drag");
      return;
    }
    // Give the sensors a moment to produce a heading before falling back.
    setTimeout(() => {
      if (!gotSensorRef.current) setModeBoth("drag");
    }, 1500);
  }, []);

  const dragBy = useCallback((dxPx: number, dyPx: number) => {
    if (modeRef.current !== "drag") return;
    aimRef.current.heading = (aimRef.current.heading + dxPx * 0.35 + 360) % 360;
    aimRef.current.pitch = Math.max(-20, Math.min(90, aimRef.current.pitch + dyPx * 0.25));
  }, []);

  return { aimRef, mode, arm, dragBy };
}
