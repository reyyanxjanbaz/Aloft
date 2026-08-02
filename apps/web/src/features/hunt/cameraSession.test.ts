import { beforeEach, describe, expect, it, vi } from "vitest";
import { createCameraSession, type CameraState } from "./cameraSession";

/** A fake camera that records whether its tracks were actually stopped. */
function fakeStream() {
  const track = { stop: vi.fn(), kind: "video" as const };
  return {
    stream: { getTracks: () => [track] } as unknown as MediaStream,
    track,
  };
}

function harness(opts: { fail?: DOMException } = {}) {
  const made: ReturnType<typeof fakeStream>[] = [];
  const constraints: MediaStreamConstraints[] = [];
  const states: CameraState[] = [];
  const getUserMedia = vi.fn(async (c: MediaStreamConstraints) => {
    constraints.push(c);
    if (opts.fail) throw opts.fail;
    const f = fakeStream();
    made.push(f);
    return f.stream;
  });
  const session = createCameraSession({
    getUserMedia,
    onState: (s) => states.push(s),
  });
  return { session, made, constraints, states, getUserMedia };
}

const settle = () => new Promise((r) => setTimeout(r, 0));

describe("createCameraSession", () => {
  let h: ReturnType<typeof harness>;
  beforeEach(() => {
    h = harness();
  });

  it("opens the camera only once the hunt is armed and the page is visible", async () => {
    h.session.setVisible(true);
    expect(h.getUserMedia).not.toHaveBeenCalled(); // not armed yet
    h.session.setWanted(true);
    await settle();
    expect(h.getUserMedia).toHaveBeenCalledTimes(1);
    expect(h.session.isOpen).toBe(true);
  });

  it("never asks for the microphone", async () => {
    h.session.setVisible(true);
    h.session.setWanted(true);
    await settle();
    expect(h.constraints[0]).toEqual({ video: { facingMode: "environment" }, audio: false });
  });

  it("does not open the camera while the page is hidden", async () => {
    h.session.setVisible(false);
    h.session.setWanted(true);
    await settle();
    expect(h.getUserMedia).not.toHaveBeenCalled();
    expect(h.session.isOpen).toBe(false);
  });

  // The defect: backgrounding the app left the camera live, so the phone kept
  // showing its capture indicator long after the player had walked away.
  it("releases the camera the moment the page is hidden", async () => {
    h.session.setVisible(true);
    h.session.setWanted(true);
    await settle();
    const first = h.made[0]!;
    expect(first.track.stop).not.toHaveBeenCalled();

    h.session.setVisible(false);
    expect(first.track.stop).toHaveBeenCalledTimes(1);
    expect(h.session.isOpen).toBe(false);
  });

  it("brings the camera back when the player returns", async () => {
    h.session.setVisible(true);
    h.session.setWanted(true);
    await settle();
    h.session.setVisible(false);
    h.session.setVisible(true);
    await settle();
    expect(h.getUserMedia).toHaveBeenCalledTimes(2);
    expect(h.session.isOpen).toBe(true);
  });

  it("releases the camera when the hunt is abandoned", async () => {
    h.session.setVisible(true);
    h.session.setWanted(true);
    await settle();
    h.session.setWanted(false);
    expect(h.made[0]!.track.stop).toHaveBeenCalledTimes(1);
    expect(h.session.isOpen).toBe(false);
  });

  it("stops a stream that arrives after it is no longer wanted", async () => {
    h.session.setVisible(true);
    h.session.setWanted(true);
    h.session.setWanted(false); // player bailed while the prompt was up
    await settle();
    expect(h.made[0]?.track.stop).toHaveBeenCalledTimes(1);
    expect(h.session.isOpen).toBe(false);
  });

  it("dispose always leaves the camera off", async () => {
    h.session.setVisible(true);
    h.session.setWanted(true);
    await settle();
    h.session.dispose();
    expect(h.made[0]!.track.stop).toHaveBeenCalledTimes(1);
    expect(h.session.isOpen).toBe(false);
  });

  // A throw while attaching the stream to the <video> is a rendering problem,
  // not a camera problem, and must not be reported as one.
  it("does not blame the camera for an error in the consumer", async () => {
    const states: CameraState[] = [];
    const getUserMedia = vi.fn(async () => fakeStream().stream);
    const session = createCameraSession({
      getUserMedia,
      onState: (s) => {
        states.push(s);
        if (s === "live") throw new TypeError("bad srcObject");
      },
    });
    session.setVisible(true);
    session.setWanted(true);
    await settle();
    expect(states).toContain("live");
    expect(states).not.toContain("unavailable");
    expect(session.isOpen).toBe(true);
  });

  it("reports a refusal without hammering the prompt", async () => {
    const denied = harness({ fail: new DOMException("no", "NotAllowedError") });
    denied.session.setVisible(true);
    denied.session.setWanted(true);
    await settle();
    expect(denied.states).toContain("denied");
    denied.session.setVisible(false);
    denied.session.setVisible(true);
    await settle();
    expect(denied.getUserMedia).toHaveBeenCalledTimes(1); // did not ask again
  });
});
