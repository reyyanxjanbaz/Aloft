/**
 * Ownership of the hunt viewfinder camera.
 *
 * The rule this enforces: **the camera is open only while the player is
 * actively hunting AND looking at the screen.** It used to stay open whenever
 * the hunt was mounted, so backgrounding the app, locking the phone or taking a
 * call left the sensor running — and the phone kept showing its capture
 * indicator, which on iOS is the same red status-bar pill used for screen
 * recording. Nothing was ever recorded, but it looked exactly like it was.
 *
 * The frames are only ever attached to a <video> element for display. There is
 * no MediaRecorder, no canvas capture, no upload path, and audio is explicitly
 * refused so the microphone is never touched.
 *
 * Framework-agnostic on purpose so the lifecycle can be tested without a DOM
 * renderer or a real camera.
 */

export type CameraState = "off" | "starting" | "live" | "denied" | "unavailable";

export interface CameraSessionOptions {
  getUserMedia?: (constraints: MediaStreamConstraints) => Promise<MediaStream>;
  onState: (state: CameraState, stream: MediaStream | null) => void;
}

/** Video only, rear facing. `audio: false` is explicit, not implied. */
export const HUNT_CONSTRAINTS: MediaStreamConstraints = {
  video: { facingMode: "environment" },
  audio: false,
};

export function createCameraSession({ getUserMedia, onState }: CameraSessionOptions) {
  let stream: MediaStream | null = null;
  let wanted = false;
  let visible = true;
  let disposed = false;
  let denied = false;
  /** Bumped on every state change so a late-resolving request can tell it lost. */
  let generation = 0;

  /**
   * Notifying the consumer must never be able to disturb the session. If a
   * listener throws, the camera's own bookkeeping stays correct and the error
   * does not escape into the acquisition promise (where it would surface as an
   * unhandled rejection, or worse, as a phantom camera failure).
   */
  const emit = (s: CameraState) => {
    try {
      onState(s, s === "live" ? stream : null);
    } catch {
      /* a broken listener is not a broken camera */
    }
  };

  const release = () => {
    generation++;
    if (!stream) return;
    // Stopping every track is what actually turns the hardware — and the
    // phone's capture indicator — off. Dropping the reference is not enough.
    for (const track of stream.getTracks()) track.stop();
    stream = null;
    if (!disposed) emit("off");
  };

  const open = () => {
    if (stream || denied || disposed) return;
    if (!getUserMedia) {
      emit("unavailable");
      return;
    }
    const mine = ++generation;
    emit("starting");
    // Two-argument `then` on purpose: the rejection handler must see only a
    // getUserMedia failure. With `.catch()`, anything the consumer threw while
    // attaching the stream would come back here and be misreported as a camera
    // that refused to open.
    getUserMedia(HUNT_CONSTRAINTS).then(
      (s) => {
        // Lost the race: the player left, backgrounded the app, or the session
        // was disposed while the permission prompt was up. Stop it immediately —
        // nothing else holds a reference, so nothing else can.
        if (mine !== generation || disposed || !wanted || !visible) {
          for (const track of s.getTracks()) track.stop();
          return;
        }
        stream = s;
        emit("live");
      },
      (err: unknown) => {
        if (mine !== generation || disposed) return;
        // A refusal is a decision, not a transient failure: asking again on
        // every return to the screen would badger the player.
        if (err instanceof DOMException && (err.name === "NotAllowedError" || err.name === "SecurityError")) {
          denied = true;
          emit("denied");
        } else {
          emit("unavailable");
        }
      }
    );
  };

  const sync = () => {
    if (disposed) return;
    if (wanted && visible) open();
    else release();
  };

  return {
    /** The hunt is armed (or has been abandoned). */
    setWanted(next: boolean) {
      if (wanted === next) return;
      wanted = next;
      sync();
    },
    /** The page is on screen (or has been hidden/locked/backgrounded). */
    setVisible(next: boolean) {
      if (visible === next) return;
      visible = next;
      sync();
    },
    dispose() {
      release();
      disposed = true;
    },
    get isOpen() {
      return stream !== null;
    },
  };
}
