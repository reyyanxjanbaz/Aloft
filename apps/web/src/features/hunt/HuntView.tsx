import { useEffect, useRef, useState } from "react";
import { typeName, type AircraftState } from "@aloft/shared";
import { submitCatch } from "../../lib/catchQueue";
import { primeAudio, sfxCapture, sfxLockOn, sfxLockTick, vibrate } from "../../lib/feedback";
import type { PlayerPosition } from "../../lib/useGeolocation";
import { useApp } from "../../state/app";
import { serverNow, usePlanes } from "../../state/planes";
import { IconClose, IconHunt, IconWarning } from "../../ui/icons";
import { entryFromCatch } from "../hangar/db";
import { BearingTape, PX_PER_DEG } from "./BearingTape";
import { CAPTURE_SECONDS, computeAimSolution, stepProgress } from "./aimMath";
import { createCameraSession, type CameraState } from "./cameraSession";
import { ElevationLadder, ladderOffsetPx } from "./ElevationLadder";
import { bracketScale, Reticle } from "./Reticle";
import { hasSeenBriefing, markBriefingSeen } from "./briefingSeen";
import { useOrientation } from "./useOrientation";
import "./hunt.css";

/** Approximate horizontal field of view of a phone rear camera. */
const CAMERA_FOV_DEG = 65;
/**
 * How long a contact may be missing from the feed before the hunt is
 * abandoned. A single dropped poll — an upstream gap, or a provider
 * failover changing the aircraft set — used to end the hunt outright.
 */
const LOST_GRACE_MS = 8000;

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
  const tapeBugRef = useRef<HTMLDivElement>(null);
  const ladderIndexRef = useRef<HTMLDivElement>(null);
  const ladderBugRef = useRef<HTMLDivElement>(null);
  const bracketsRef = useRef<SVGGElement>(null);
  const progressRef = useRef(0);
  const submittingRef = useRef(false);
  const alignedRef = useRef(false);
  const tickAccRef = useRef(0);
  const phaseRef = useRef<Phase>("searching");

  const [armed, setArmed] = useState(false);
  const [camera, setCamera] = useState<CameraState>("off");
  const [phase, setPhase] = useState<Phase>("searching");
  const [readouts, setReadouts] = useState<Readouts | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  // `faded`/`lost` drive the JSX, but the frame loop reads and writes them
  // through refs so it can react to a feed gap without listing them as effect
  // dependencies. They used to be deps, so the loop's own setFaded/setLost
  // calls tore the loop down and reset capture progress on a single dropped
  // poll — and, mid-submit, could skip go(reveal) after the tower had already
  // recorded the catch. Refs keep the loop mounted for the whole capture.
  const [faded, setFaded] = useState(false);
  const [lost, setLost] = useState(false);
  const fadedRef = useRef(false);
  const lostRef = useRef(false);

  // The position is read through a ref inside the frame loop so that a GPS
  // tick — which arrives roughly once a second — cannot tear the loop down.
  // It used to be an effect dependency, so a fix landing while a capture was
  // in flight restarted the effect with submittingRef stuck true: the ring
  // froze full, nothing happened, and the tower had already recorded the
  // catch (burning its first-spotter credit).
  const posRef = useRef(position);
  posRef.current = position;

  const plane = usePlanes((s) => s.planes.get(hex));
  /** Last state we saw, so a brief feed gap doesn't abandon the hunt. */
  const lastPlaneRef = useRef<AircraftState | null>(null);
  const missingSinceRef = useRef<number | null>(null);
  if (plane) lastPlaneRef.current = plane;

  /*
   * The viewfinder. The camera is held only while the hunt is armed AND the
   * page is on screen: hiding the app, locking the phone or taking a call
   * releases the sensor immediately, which is what puts the phone's capture
   * indicator out. Frames are only ever shown in the <video> below — they are
   * never recorded, captured to a canvas, or sent anywhere, and audio is
   * explicitly refused. See cameraSession.ts.
   */
  useEffect(() => {
    const session = createCameraSession({
      getUserMedia: navigator.mediaDevices
        ? (c) => navigator.mediaDevices.getUserMedia(c)
        : undefined,
      onState: (state, stream) => {
        setCamera(state);
        const el = videoRef.current;
        if (!el) return;
        try {
          // Always clear before re-attaching, so the element never keeps the
          // last frame — or the released track — alive.
          if (el.srcObject) el.srcObject = null;
          if (stream) el.srcObject = stream;
        } catch {
          /* attaching is best-effort; the session state is already correct */
        }
      },
    });
    const onVisibility = () => session.setVisible(document.visibilityState === "visible");
    // pagehide covers iOS putting the page into the back/forward cache, where
    // visibilitychange is not guaranteed to arrive.
    const onPageHide = () => session.setVisible(false);
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("pagehide", onPageHide);
    session.setVisible(document.visibilityState === "visible");
    session.setWanted(armed);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("pagehide", onPageHide);
      session.dispose();
    };
  }, [armed]);

  useEffect(() => {
    if (!armed) return;
    let raf = 0;
    let last = performance.now();
    let readoutAcc = 0;
    // Set on unmount so a /catch request already in flight when the player
    // exits (or the reticle re-locks after a fast re-entry) can't call go()
    // or touch state for a screen that's no longer showing.
    let cancelled = false;

    const submit = async () => {
      sfxCapture();
      const pos = posRef.current;
      // Timestamped against the server's clock: a device minutes out of sync
      // would otherwise have every capture rejected as "too far from server
      // time" with nothing to explain it.
      const outcome = await submitCatch({ hex, lat: pos.lat, lon: pos.lon, ts: serverNow() });
      if (cancelled) return;

      if (outcome.status === "caught") {
        go({
          name: "reveal",
          entry: entryFromCatch(outcome.body.catch),
          isNew: outcome.isNew,
          firstSpotter: outcome.body.firstSpotter === true,
          localSaveFailed: outcome.localSaveFailed,
        });
        return;
      }

      setFailure(
        outcome.status === "queued"
          ? "No link to the tower — the catch is saved and will be confirmed when you reconnect."
          : outcome.reason
      );
      progressRef.current = 0;
      submittingRef.current = false;
    };

    const frame = (now: number) => {
      raf = requestAnimationFrame(frame);
      const dt = Math.min((now - last) / 1000, 0.1);
      last = now;

      // Fall back to the last known state through a brief feed gap, and only
      // give up once the contact has really been absent.
      const live = usePlanes.getState().planes.get(hex);
      if (live) {
        missingSinceRef.current = null;
        if (fadedRef.current) {
          fadedRef.current = false;
          setFaded(false);
        }
      } else {
        missingSinceRef.current ??= now;
        const goneFor = now - missingSinceRef.current;
        if (goneFor > LOST_GRACE_MS) {
          if (!lostRef.current) {
            lostRef.current = true;
            setLost(true);
          }
          return;
        }
        if (!fadedRef.current) {
          fadedRef.current = true;
          setFaded(true);
        }
      }
      const ac = live ?? lastPlaneRef.current;
      if (!ac || submittingRef.current) return;

      const { dAz, dEl, aligned, near, groundM, az, el } = computeAimSolution(
        posRef.current,
        aimRef.current,
        ac,
        serverNow()
      );

      // Heading tape: slide the scale, keep the index fixed.
      if (tapeRef.current) {
        const wrapped = ((aimRef.current.heading % 360) + 360) % 360 + 360;
        tapeRef.current.style.transform = `translate3d(${-wrapped * PX_PER_DEG}px,0,0)`;
      }

      // Target bug rides *inside* the sliding scale, so it is positioned in
      // degrees once per frame and the tape's own transform carries it.
      //
      // The scale lays out two full laps (0–720°), so the same bearing exists
      // at three places on it. The bug has to go on whichever lap is nearest
      // the heading currently under the index — otherwise a target 29° to the
      // left is drawn 331° to the right, more than a thousand pixels off the
      // side of the screen.
      if (tapeBugRef.current) {
        const wrapped = ((aimRef.current.heading % 360) + 360) % 360 + 360;
        const base = ((az % 360) + 360) % 360;
        let bugDeg = base;
        for (const lap of [base, base + 360, base + 720]) {
          if (Math.abs(lap - wrapped) < Math.abs(bugDeg - wrapped)) bugDeg = lap;
        }
        tapeBugRef.current.style.left = `${bugDeg * PX_PER_DEG}px`;
      }

      // Elevation ladder: fixed scale, both marks move against it.
      if (ladderIndexRef.current) {
        ladderIndexRef.current.style.bottom = `${ladderOffsetPx(aimRef.current.pitch)}px`;
      }
      if (ladderBugRef.current) {
        ladderBugRef.current.style.bottom = `${ladderOffsetPx(el)}px`;
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

      progressRef.current = stepProgress(progressRef.current, dt, aligned);
      // Progress is the brackets closing — there is no ring any more.
      if (bracketsRef.current) {
        bracketsRef.current.style.transform = `scale(${bracketScale(progressRef.current)})`;
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
    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
      // If this loop is ever restarted, it must not inherit a half-finished
      // capture: a stuck submittingRef silently freezes the ring forever.
      submittingRef.current = false;
      progressRef.current = 0;
      fadedRef.current = false;
      lostRef.current = false;
    };
    // Deliberately not depending on `position` (see posRef) or on `faded`/
    // `lost` (see fadedRef/lostRef) — the loop must survive a feed gap.
  }, [armed, hex, aimRef, go]);

  // Drag-to-aim fallback for devices without a compass.
  const dragLast = useRef<{ x: number; y: number } | null>(null);

  // Latched at mount so marking it seen on "Begin capture" can't collapse the
  // briefing out from under someone who is still reading it.
  const [briefed] = useState(hasSeenBriefing);
  // The aim solution shown on the arm screen. Computed from render state rather
  // than the frame loop — this screen is static and doesn't run the loop yet.
  const briefTarget = plane ?? lastPlaneRef.current;
  const brief = briefTarget
    ? computeAimSolution(position, { heading: 0, pitch: 0 }, briefTarget, serverNow())
    : null;

  if (!armed) {
    const begin = () => {
      primeAudio();
      markBriefingSeen();
      void arm();
      setArmed(true);
    };
    return (
      <div className="hunt hunt--brief">
        <div className="hunt__brief-inner">
          <span className="label">Capture sequence</span>
          <h1 className="hunt__brief-title">
            {plane ? typeName(plane.typeIcao) : "Unidentified contact"}
          </h1>

          {/* Where to point, how high, how far — the whole briefing for anyone
              who has done this before. */}
          <dl className="hunt__solution">
            <SolutionStat
              label="Bearing"
              value={brief ? String(Math.round(brief.az)).padStart(3, "0") : "—"}
              unit="deg"
            />
            <SolutionStat
              label="Elevation"
              value={brief ? String(Math.round(brief.el)) : "—"}
              unit="up"
            />
            <SolutionStat
              label="Range"
              value={brief ? (brief.groundM / 1000).toFixed(1) : "—"}
              unit="km"
            />
          </dl>

          {/* The long version, once. After that the aim solution above is the
              whole screen — but this stays a screen either way, because the tap
              below is the user gesture the camera prompt and primeAudio() both
              need. */}
          {!briefed && (
            <>
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
                  <span className="label">03</span> Hold the lock while the brackets close
                </li>
              </ol>
              <p className="hunt__brief-privacy">
                The camera runs as a viewfinder only, while this screen is open. Nothing is recorded
                or uploaded, and the microphone is never used. Your phone will show its own camera
                indicator until you leave.
              </p>
            </>
          )}

          <button className="btn btn--primary btn--block" onClick={begin}>
            <IconHunt size={18} weight="bold" />
            Begin capture
          </button>
          {briefed && (
            <p className="hunt__brief-privacy">
              Viewfinder only — nothing is recorded or uploaded.
            </p>
          )}
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
      {camera !== "live" && <div className="hunt__nocamera" />}

      {/* What the camera is actually doing, stated plainly. The phone shows its
          own capture indicator while the viewfinder is open, and without this
          there is nothing in the app to explain what that indicator means. */}
      <p className={camera === "live" ? "hunt__privacy hunt__privacy--live" : "hunt__privacy"}>
        <i aria-hidden="true" />
        {camera === "live"
          ? "Viewfinder live · not recorded"
          : camera === "starting"
            ? "Starting viewfinder"
            : camera === "off"
              ? "Viewfinder paused"
              : camera === "denied"
                ? "Camera off · sweep with the arrow"
                : "Camera unavailable · sweep with the arrow"}
      </p>

      <BearingTape ref={tapeRef} bugRef={tapeBugRef} />
      <ElevationLadder ref={ladderIndexRef} bugRef={ladderBugRef} />

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
            <Reticle ref={bracketsRef} />
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
                {readouts ? Math.round(Math.abs(readouts.elevation)) : "—"}{" "}
                <span className="unit">
                  {/* An exact-zero float essentially never occurs, so "level" was unreachable. */}
                  {!readouts || Math.abs(readouts.elevation) < 0.5
                    ? "level"
                    : readouts.elevation > 0
                      ? "up"
                      : "down"}
                </span>
              </span>
            </div>
          </div>

          {faded && <p className="hunt__note">Signal faded — reacquiring</p>}
          {mode === "drag" && !faded && (
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

/** One readout on the arm screen's aim solution. */
function SolutionStat({ label, value, unit }: { label: string; value: string; unit: string }) {
  return (
    <div className="readout">
      <dt className="label">{label}</dt>
      <dd className="readout__value">
        {value} <span className="unit">{unit}</span>
      </dd>
    </div>
  );
}
