import { useEffect, useRef, useState } from "react";
import {
  angleDiffDeg,
  bearingDeg,
  deadReckon,
  distanceM,
  elevationDeg,
  FT_TO_M,
  typeName,
  type CatchResponse,
} from "@aloft/shared";
import { primeAudio, sfxCapture, sfxLockOn, sfxLockTick, vibrate } from "../../lib/feedback";
import { playerHeaders } from "../../lib/player";
import type { PlayerPosition } from "../../lib/useGeolocation";
import { useApp } from "../../state/app";
import { SKY_URL, usePlanes } from "../../state/planes";
import { IconClose, IconHunt, IconWarning } from "../../ui/icons";
import { entryFromCatch, saveCatch } from "../hangar/db";
import { BearingTape, PX_PER_DEG } from "./BearingTape";
import { Reticle, RING_C } from "./Reticle";
import { useOrientation } from "./useOrientation";
import "./hunt.css";

const AZ_TOLERANCE = 15;
const EL_TOLERANCE = 12;
const CAPTURE_SECONDS = 2.5;
/** Approximate horizontal field of view of a phone rear camera. */
const CAMERA_FOV_DEG = 65;

type Phase = "searching" | "near" | "locked";

interface Readouts {
  rangeKm: number;
  elevation: number;
  bearing: number;
}

export function HuntView({ hex, position }: { hex: string; position: PlayerPosition }) {
  const go = useApp((s) => s.go);
  const lastTab = useApp((s) => s.lastTab);
  const { aimRef, mode, arm, dragBy } = useOrientation();

  const videoRef = useRef<HTMLVideoElement>(null);
  const targetRef = useRef<HTMLDivElement>(null);
  const arrowRef = useRef<HTMLDivElement>(null);
  const tapeRef = useRef<HTMLDivElement>(null);
  const ringRef = useRef<SVGCircleElement>(null);
  const progressRef = useRef(0);
  const submittingRef = useRef(false);
  const alignedRef = useRef(false);
  const tickAccRef = useRef(0);
  const phaseRef = useRef<Phase>("searching");

  const [armed, setArmed] = useState(false);
  const [cameraOn, setCameraOn] = useState(false);
  const [phase, setPhase] = useState<Phase>("searching");
  const [readouts, setReadouts] = useState<Readouts | null>(null);
  const [failure, setFailure] = useState<string | null>(null);

  const plane = usePlanes((s) => s.planes.get(hex));
  const lost = armed && !plane;

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

  useEffect(() => {
    if (!armed) return;
    let raf = 0;
    let last = performance.now();
    let readoutAcc = 0;

    const submit = async () => {
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
          setFailure(body.reason);
          progressRef.current = 0;
          submittingRef.current = false;
        }
      } catch {
        setFailure("Lost the link to the tower. Hold aim to try again.");
        progressRef.current = 0;
        submittingRef.current = false;
      }
    };

    const frame = (now: number) => {
      raf = requestAnimationFrame(frame);
      const dt = Math.min((now - last) / 1000, 0.1);
      last = now;

      const ac = usePlanes.getState().planes.get(hex);
      if (!ac || submittingRef.current) return;

      const ageSec = (Date.now() - ac.ts) / 1000 + ac.seenPosSec;
      const [pLat, pLon] = deadReckon(ac.lat, ac.lon, ac.track, ac.gsKt, Math.min(ageSec, 60));
      const groundM = distanceM(position.lat, position.lon, pLat, pLon);
      const az = bearingDeg(position.lat, position.lon, pLat, pLon);
      const el = elevationDeg(groundM, 0, ac.altFt * FT_TO_M);

      const aim = aimRef.current;
      const dAz = angleDiffDeg(aim.heading, az);
      const dEl = el - aim.pitch;
      const aligned = Math.abs(dAz) < AZ_TOLERANCE && Math.abs(dEl) < EL_TOLERANCE;
      const near = Math.abs(dAz) < AZ_TOLERANCE * 2.5 && Math.abs(dEl) < EL_TOLERANCE * 2.5;

      // Heading tape: slide the scale, keep the index fixed.
      if (tapeRef.current) {
        const wrapped = ((aim.heading % 360) + 360) % 360 + 360;
        tapeRef.current.style.transform = `translate3d(${-wrapped * PX_PER_DEG}px,0,0)`;
      }

      // Target marker follows the real angular offset, clamped so the whole
      // reticle stays on screen rather than being cut off at the edge.
      const pxPerDeg = window.innerWidth / CAMERA_FOV_DEG;
      const rawX = dAz * pxPerDeg;
      const rawY = -dEl * pxPerDeg;
      const reticleHalf = Math.min(window.innerWidth * 0.58, 230) / 2;
      const limitX = Math.max(0, window.innerWidth / 2 - reticleHalf - 8);
      const limitY = Math.max(0, window.innerHeight / 2 - reticleHalf - 96);
      const x = Math.max(-limitX, Math.min(limitX, rawX));
      const y = Math.max(-limitY, Math.min(limitY, rawY));
      const offscreen = rawX !== x || rawY !== y;

      if (targetRef.current) {
        targetRef.current.style.transform = `translate3d(calc(-50% + ${x}px), calc(-50% + ${y}px), 0)`;
        targetRef.current.style.opacity = offscreen ? "0.35" : "1";
      }
      if (arrowRef.current) {
        arrowRef.current.style.opacity = offscreen ? "1" : "0";
        arrowRef.current.style.transform = `translate3d(-50%,-50%,0) rotate(${
          (Math.atan2(rawY, rawX) * 180) / Math.PI + 90
        }deg)`;
      }

      // Lock transitions
      const wasAligned = alignedRef.current;
      alignedRef.current = aligned;
      if (aligned && !wasAligned) sfxLockOn();

      const nextPhase: Phase = aligned ? "locked" : near ? "near" : "searching";
      if (nextPhase !== phaseRef.current) {
        phaseRef.current = nextPhase;
        setPhase(nextPhase);
      }

      progressRef.current = Math.max(
        0,
        Math.min(1, progressRef.current + (aligned ? dt / CAPTURE_SECONDS : -dt / 1.5))
      );
      if (ringRef.current) {
        ringRef.current.style.strokeDashoffset = String(RING_C * (1 - progressRef.current));
      }

      if (aligned) {
        tickAccRef.current += dt;
        const interval = 0.3 - progressRef.current * 0.2;
        if (tickAccRef.current >= interval) {
          tickAccRef.current = 0;
          sfxLockTick(progressRef.current);
          vibrate(8);
        }
      }

      readoutAcc += dt;
      if (readoutAcc > 0.15) {
        readoutAcc = 0;
        setReadouts({ rangeKm: groundM / 1000, elevation: el, bearing: az });
      }

      if (progressRef.current >= 1) {
        submittingRef.current = true;
        void submit();
      }
    };

    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [armed, hex, position.lat, position.lon, aimRef, go]);

  // Drag-to-aim fallback for devices without a compass.
  const dragLast = useRef<{ x: number; y: number } | null>(null);

  if (!armed) {
    return (
      <div className="hunt hunt--brief">
        <div className="hunt__brief-inner">
          <span className="label">Capture sequence</span>
          <h1 className="hunt__brief-title">
            {plane ? typeName(plane.typeIcao) : "Unidentified contact"}
          </h1>
          <p className="hunt__brief-copy">
            Hold your phone up and sweep the sky. The reticle locks when you are pointing at the
            aircraft — hold it steady for {CAPTURE_SECONDS} seconds to capture.
          </p>
          <ol className="hunt__steps">
            <li>
              <span className="label">01</span> Raise the phone toward the bearing shown
            </li>
            <li>
              <span className="label">02</span> Follow the arrow until the reticle appears
            </li>
            <li>
              <span className="label">03</span> Hold the lock while the ring fills
            </li>
          </ol>
          <button
            className="btn btn--primary btn--block"
            onClick={() => {
              primeAudio();
              void arm();
              setArmed(true);
            }}
          >
            <IconHunt size={18} weight="bold" />
            Begin capture
          </button>
          <button className="btn btn--quiet btn--block" onClick={() => go({ name: lastTab })}>
            Back to scope
          </button>
        </div>
      </div>
    );
  }

  return (
    <div
      className={`hunt hunt--${phase}`}
      onPointerDown={(e) => (dragLast.current = { x: e.clientX, y: e.clientY })}
      onPointerMove={(e) => {
        if (!dragLast.current) return;
        dragBy(e.clientX - dragLast.current.x, e.clientY - dragLast.current.y);
        dragLast.current = { x: e.clientX, y: e.clientY };
      }}
      onPointerUp={() => (dragLast.current = null)}
      onPointerCancel={() => (dragLast.current = null)}
    >
      <video ref={videoRef} className="hunt__camera" autoPlay playsInline muted />
      {!cameraOn && <div className="hunt__nocamera" />}

      <BearingTape ref={tapeRef} />

      <button
        className="hunt__exit icon-btn"
        onClick={() => go({ name: lastTab })}
        aria-label="Abort capture"
      >
        <IconClose size={20} weight="bold" />
      </button>

      {lost ? (
        <div className="hunt__lost">
          <p>The contact left the scope before you could capture it.</p>
          <button className="btn btn--quiet" onClick={() => go({ name: lastTab })}>
            Back to scope
          </button>
        </div>
      ) : (
        <>
          <div className="hunt__arrow" ref={arrowRef} aria-hidden="true">
            <svg viewBox="0 0 24 24" width="32" height="32">
              <path d="M12 2 L20 20 L12 15.5 L4 20 Z" fill="currentColor" />
            </svg>
          </div>

          <div className="hunt__target" ref={targetRef}>
            <Reticle ref={ringRef} locked={phase === "locked"} />
          </div>

          <div className="hunt__status">
            <span className="hunt__status-text">
              {phase === "locked" ? "Locked — hold steady" : phase === "near" ? "Closing" : "Sweep to acquire"}
            </span>
          </div>

          <div className="hunt__readouts">
            <div className="readout">
              <span className="label">Range</span>
              <span className="readout__value">
                {readouts ? readouts.rangeKm.toFixed(1) : "—"} <span className="unit">km</span>
              </span>
            </div>
            <div className="readout">
              <span className="label">Bearing</span>
              <span className="readout__value">
                {readouts ? String(Math.round(readouts.bearing)).padStart(3, "0") : "—"}{" "}
                <span className="unit">deg</span>
              </span>
            </div>
            <div className="readout">
              <span className="label">Elevation</span>
              <span className="readout__value">
                {readouts ? Math.round(readouts.elevation) : "—"}{" "}
                <span className="unit">up</span>
              </span>
            </div>
          </div>

          {mode === "drag" && (
            <p className="hunt__note">No compass detected — drag to aim</p>
          )}
          {failure && (
            <p className="hunt__failure">
              <IconWarning size={14} weight="bold" />
              {failure}
            </p>
          )}
        </>
      )}
    </div>
  );
}
