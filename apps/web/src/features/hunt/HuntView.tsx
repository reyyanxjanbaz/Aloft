import { useEffect, useRef, useState } from "react";
import {
  angleDiffDeg,
  bearingDeg,
  deadReckon,
  distanceM,
  elevationDeg,
  FT_TO_M,
  type CatchResponse,
} from "@aloft/shared";
import { entryFromCatch, saveCatch } from "../hangar/db";
import { playerHeaders } from "../../lib/player";
import { primeAudio, sfxCapture, sfxLockOn, sfxLockTick, vibrate } from "../../lib/feedback";
import type { PlayerPosition } from "../../lib/useGeolocation";
import { useApp } from "../../state/app";
import { SKY_URL, usePlanes } from "../../state/planes";
import { useOrientation } from "./useOrientation";

const AZ_TOLERANCE = 15;
const EL_TOLERANCE = 12;
const CAPTURE_SECONDS = 2.5;
const RING_RADIUS = 84;
const RING_CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS;

interface HudState {
  dAz: number;
  dEl: number;
  aligned: boolean;
  progress: number;
  distanceKm: number;
  elevation: number;
}

export function HuntView({ hex, position }: { hex: string; position: PlayerPosition }) {
  const go = useApp((s) => s.go);
  const { aimRef, mode, arm, dragBy } = useOrientation();
  const videoRef = useRef<HTMLVideoElement>(null);
  const [armed, setArmed] = useState(false);
  const [cameraOn, setCameraOn] = useState(false);
  const [hud, setHud] = useState<HudState | null>(null);
  const [failReason, setFailReason] = useState<string | null>(null);
  const progressRef = useRef(0);
  const submittingRef = useRef(false);
  const alignedRef = useRef(false);
  const tickAccRef = useRef(0);
  const planeGone = usePlanes((s) => !s.planes.has(hex));

  // Camera feed — optional; the hunt works against the computed sky position.
  useEffect(() => {
    if (!armed) return;
    let stream: MediaStream | null = null;
    navigator.mediaDevices
      ?.getUserMedia({ video: { facingMode: "environment" } })
      .then((s) => {
        stream = s;
        if (videoRef.current) {
          videoRef.current.srcObject = s;
          setCameraOn(true);
        }
      })
      .catch(() => setCameraOn(false));
    return () => stream?.getTracks().forEach((t) => t.stop());
  }, [armed]);

  // Aim + capture loop.
  useEffect(() => {
    if (!armed) return;
    let raf = 0;
    let last = performance.now();

    const tick = (now: number) => {
      const dt = Math.min((now - last) / 1000, 0.1);
      last = now;
      const plane = usePlanes.getState().planes.get(hex);

      if (plane && !submittingRef.current) {
        const ageSec = (Date.now() - plane.ts) / 1000 + plane.seenPosSec;
        const [pLat, pLon] = deadReckon(plane.lat, plane.lon, plane.track, plane.gsKt, Math.min(ageSec, 60));
        const groundM = distanceM(position.lat, position.lon, pLat, pLon);
        const az = bearingDeg(position.lat, position.lon, pLat, pLon);
        const el = elevationDeg(groundM, 0, plane.altFt * FT_TO_M);

        const dAz = angleDiffDeg(aimRef.current.heading, az);
        const dEl = el - aimRef.current.pitch;
        const aligned = Math.abs(dAz) < AZ_TOLERANCE && Math.abs(dEl) < EL_TOLERANCE;

        const wasAligned = alignedRef.current;
        alignedRef.current = aligned;
        if (aligned && !wasAligned) sfxLockOn();

        progressRef.current = Math.max(
          0,
          Math.min(1, progressRef.current + (aligned ? dt / CAPTURE_SECONDS : -dt / 1.5))
        );

        // Ticks accelerate as the ring fills — the audible tension of the catch.
        if (aligned) {
          tickAccRef.current += dt;
          const interval = 0.28 - progressRef.current * 0.18;
          if (tickAccRef.current >= interval) {
            tickAccRef.current = 0;
            sfxLockTick(progressRef.current);
            vibrate(8);
          }
        }

        setHud({
          dAz,
          dEl,
          aligned,
          progress: progressRef.current,
          distanceKm: groundM / 1000,
          elevation: el,
        });

        if (progressRef.current >= 1) {
          submittingRef.current = true;
          void submitCatch();
        }
      }
      raf = requestAnimationFrame(tick);
    };

    const submitCatch = async () => {
      sfxCapture();
      try {
        const res = await fetch(`${SKY_URL}/catch`, {
          method: "POST",
          headers: { "content-type": "application/json", ...playerHeaders() },
          body: JSON.stringify({ hex, lat: position.lat, lon: position.lon, ts: Date.now() }),
        });
        const body = (await res.json()) as CatchResponse;
        if (body.ok) {
          const entry = entryFromCatch(body.catch);
          const { isNew } = await saveCatch(entry);
          go({ name: "reveal", entry, isNew, firstSpotter: body.firstSpotter === true });
        } else {
          setFailReason(body.reason);
          progressRef.current = 0;
          submittingRef.current = false;
        }
      } catch {
        setFailReason("lost contact with the tower — try again");
        progressRef.current = 0;
        submittingRef.current = false;
      }
    };

    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [armed, hex, position.lat, position.lon, aimRef, go]);

  // Drag-to-aim fallback input.
  const dragLast = useRef<{ x: number; y: number } | null>(null);
  const onPointerDown = (e: React.PointerEvent) => {
    dragLast.current = { x: e.clientX, y: e.clientY };
  };
  const onPointerMove = (e: React.PointerEvent) => {
    if (!dragLast.current) return;
    dragBy(e.clientX - dragLast.current.x, e.clientY - dragLast.current.y);
    dragLast.current = { x: e.clientX, y: e.clientY };
  };
  const onPointerUp = () => (dragLast.current = null);

  if (!armed) {
    return (
      <div className="hunt hunt--brief">
        <h2>Sky Hunt</h2>
        <p>Hold your phone up and sweep the sky until the mystery aircraft locks on, then keep it centered to capture.</p>
        <button
          className="hunt__arm"
          onClick={() => {
            primeAudio(); // browsers only allow audio to start from a gesture
            void arm();
            setArmed(true);
          }}
        >
          Arm the radar 🎯
        </button>
        <button className="hunt__back" onClick={() => go({ name: "radar" })}>← Back to radar</button>
      </div>
    );
  }

  const nearLock = hud && Math.abs(hud.dAz) < AZ_TOLERANCE * 2 && Math.abs(hud.dEl) < EL_TOLERANCE * 2;
  const arrowAngle = hud ? (Math.atan2(-hud.dEl, hud.dAz) * 180) / Math.PI : 0;

  return (
    <div
      className="hunt"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
    >
      <video ref={videoRef} className="hunt__camera" autoPlay playsInline muted />
      {!cameraOn && <div className="hunt__sky-fallback" />}

      {planeGone ? (
        <div className="hunt__gone">
          <p>It flew beyond your radar…</p>
          <button className="hunt__back" onClick={() => go({ name: "radar" })}>← Back to radar</button>
        </div>
      ) : (
        <>
          {/* Guide arrow toward the target when not locked */}
          {hud && !nearLock && (
            <div className="hunt__arrow" style={{ transform: `translate(-50%, -50%) rotate(${arrowAngle}deg)` }}>
              ➤
            </div>
          )}

          {/* Mystery silhouette fades in as aim approaches the target */}
          {hud && nearLock && (
            <div
              className={hud.aligned ? "hunt__target hunt__target--locked" : "hunt__target"}
              style={{
                transform: `translate(calc(-50% + ${hud.dAz * 9}px), calc(-50% + ${-hud.dEl * 9}px))`,
              }}
            >
              ✈
            </div>
          )}

          {/* Capture ring */}
          <svg className="hunt__ring" viewBox="0 0 200 200">
            <circle cx="100" cy="100" r={RING_RADIUS} className="hunt__ring-track" />
            <circle
              cx="100"
              cy="100"
              r={RING_RADIUS}
              className={hud?.aligned ? "hunt__ring-fill hunt__ring-fill--active" : "hunt__ring-fill"}
              strokeDasharray={RING_CIRCUMFERENCE}
              strokeDashoffset={RING_CIRCUMFERENCE * (1 - (hud?.progress ?? 0))}
            />
          </svg>

          <div className="hunt__readout">
            {hud && (
              <>
                <span>{hud.distanceKm.toFixed(1)} km</span>
                <span>{hud.elevation > 0 ? `↑ ${hud.elevation.toFixed(0)}°` : "below horizon"}</span>
                <span>{hud.aligned ? "LOCKED — hold steady" : nearLock ? "close…" : "sweep the sky"}</span>
              </>
            )}
          </div>

          {mode === "drag" && <div className="hunt__hint">No compass here — drag to aim</div>}
          {failReason && <div className="hunt__fail">{failReason}</div>}
          <button className="hunt__back hunt__back--floating" onClick={() => go({ name: "radar" })}>✕</button>
        </>
      )}
    </div>
  );
}
