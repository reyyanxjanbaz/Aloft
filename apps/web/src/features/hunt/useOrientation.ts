import { useCallback, useEffect, useRef, useState } from "react";
import { deriveAim, screenAngle, type OrientationSample } from "./aimSensor";

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
  /** True once the player has actually dragged, which pins drag mode. */
  const userDraggedRef = useRef(false);
  const angleRef = useRef(0);

  const setModeBoth = (m: AimMode) => {
    modeRef.current = m;
    setMode(m);
  };

  useEffect(() => {
    angleRef.current = screenAngle();
    const onRotate = () => {
      angleRef.current = screenAngle();
    };
    window.screen?.orientation?.addEventListener?.("change", onRotate);
    window.addEventListener("orientationchange", onRotate);

    const handler = (e: DeviceOrientationEvent) => {
      const ios = e as IOSOrientationEvent;
      const sample: OrientationSample = {
        alpha: e.alpha,
        beta: e.beta,
        gamma: e.gamma,
        absolute: e.absolute,
        webkitCompassHeading: ios.webkitCompassHeading,
      };
      const solution = deriveAim(sample, angleRef.current);
      if (!solution) return;

      gotSensorRef.current = true;

      // A late-arriving first reading may reclaim aim from the fallback, but
      // only if the player hasn't actually dragged. The old guard keyed on
      // the mode alone, so a phone whose compass merely warmed up slowly was
      // locked into dragging for the rest of the session; keying on real
      // input keeps an active manual drag safe without punishing a cold
      // sensor.
      if (modeRef.current === "drag" && userDraggedRef.current) return;
      if (modeRef.current !== "sensor") setModeBoth("sensor");
      aimRef.current.heading = solution.heading;
      aimRef.current.pitch = solution.pitch;
    };

    const eventName =
      "ondeviceorientationabsolute" in window ? "deviceorientationabsolute" : "deviceorientation";
    window.addEventListener(eventName as "deviceorientation", handler, true);
    return () => {
      window.removeEventListener(eventName as "deviceorientation", handler, true);
      window.screen?.orientation?.removeEventListener?.("change", onRotate);
      window.removeEventListener("orientationchange", onRotate);
    };
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
    userDraggedRef.current = true;
    aimRef.current.heading = (aimRef.current.heading + dxPx * 0.35 + 360) % 360;
    aimRef.current.pitch = Math.max(-20, Math.min(90, aimRef.current.pitch + dyPx * 0.25));
  }, []);

  return { aimRef, mode, arm, dragBy };
}
