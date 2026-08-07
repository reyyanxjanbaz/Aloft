import { RARITY_ORDER, type Rarity } from "@aloft/shared";

/**
 * Sound and haptics, synthesized at runtime with WebAudio — no audio files to
 * download, license, or cache, and every cue stays tweakable in code.
 */

const MUTE_KEY = "aloft-muted";
const HAPTIC_KEY = "aloft-haptics-off";

let ctx: AudioContext | null = null;
let master: GainNode | null = null;

/*
 * Every storage touch here is guarded, because these are read from inside the
 * capture loop.
 *
 * `localStorage` does not merely return null when a browser blocks it — it
 * throws on access. `vibrate()` runs on the frame loop *before* the
 * `progress >= 1` submit check, so an unguarded read there meant a player
 * holding a perfect lock on such a browser would fill the reticle and never
 * complete the catch, with nothing on screen to explain it.
 */
function readFlag(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeFlag(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* private mode — the preference just won't survive a reload */
  }
}

export function isMuted(): boolean {
  return readFlag(MUTE_KEY) === "1";
}

export function setMuted(muted: boolean): void {
  writeFlag(MUTE_KEY, muted ? "1" : "0");
  if (master) master.gain.value = muted ? 0 : 0.9;
}

/**
 * Haptics are a separate switch from sound.
 *
 * They used to be gated by `isMuted()`, which was survivable while every
 * notification also had a visible toast. Now that transients are carried by
 * sound, one "mute" would have silenced the entire notification channel —
 * so muting for a meeting no longer costs the player everything.
 */
export function hapticsEnabled(): boolean {
  return readFlag(HAPTIC_KEY) !== "1";
}

export function setHaptics(on: boolean): void {
  writeFlag(HAPTIC_KEY, on ? "0" : "1");
}

/** Must be called from a user gesture (browsers block audio otherwise). */
export function primeAudio(): void {
  if (ctx) {
    void ctx.resume();
    return;
  }
  type WithWebkit = typeof window & { webkitAudioContext?: typeof AudioContext };
  const Ctor = window.AudioContext ?? (window as WithWebkit).webkitAudioContext;
  if (!Ctor) return;
  ctx = new Ctor();
  master = ctx.createGain();
  master.gain.value = isMuted() ? 0 : 0.9;
  master.connect(ctx.destination);
  // A brand-new context isn't guaranteed to start "running" on every engine
  // even inside a user gesture — without this, every tone()/noiseBurst()
  // call's `ctx.state !== "running"` guard could stay true for the entire
  // session, silently dropping all sound and never surfacing an error.
  void ctx.resume();
}

function tone(
  freq: number,
  duration: number,
  opts: { type?: OscillatorType; gain?: number; delay?: number; sweepTo?: number } = {}
): void {
  if (!ctx || !master || ctx.state !== "running") return;
  const start = ctx.currentTime + (opts.delay ?? 0);
  const osc = ctx.createOscillator();
  const env = ctx.createGain();

  osc.type = opts.type ?? "sine";
  osc.frequency.setValueAtTime(freq, start);
  if (opts.sweepTo) osc.frequency.exponentialRampToValueAtTime(opts.sweepTo, start + duration);

  const peak = opts.gain ?? 0.25;
  env.gain.setValueAtTime(0.0001, start);
  env.gain.exponentialRampToValueAtTime(peak, start + Math.min(0.02, duration / 4));
  env.gain.exponentialRampToValueAtTime(0.0001, start + duration);

  osc.connect(env).connect(master);
  osc.start(start);
  osc.stop(start + duration + 0.05);
}

function noiseBurst(duration: number, gain = 0.2): void {
  if (!ctx || !master || ctx.state !== "running") return;
  const frames = Math.floor(ctx.sampleRate * duration);
  const buffer = ctx.createBuffer(1, frames, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < frames; i++) {
    // Decaying white noise — the "whoosh" of the capture landing.
    data[i] = (Math.random() * 2 - 1) * (1 - i / frames) ** 2;
  }
  const src = ctx.createBufferSource();
  const filter = ctx.createBiquadFilter();
  const env = ctx.createGain();
  src.buffer = buffer;
  filter.type = "bandpass";
  filter.frequency.value = 1200;
  env.gain.value = gain;
  src.connect(filter).connect(env).connect(master);
  src.start();
}

export function vibrate(pattern: number | number[]): void {
  if (hapticsEnabled() && "vibrate" in navigator) navigator.vibrate(pattern);
}

/*
 * Transient cues. These replace the toast: a confirmation, a caution and an
 * alert, each with its own shape so they are told apart without looking.
 * Written to be recognisable rather than pretty — a rising pair reads as
 * "done", a falling pair as "something is wrong", a repeated note as "look".
 */

/** Something the player set in motion has now completed. */
export function sfxConfirm(): void {
  tone(660, 0.1, { type: "sine", gain: 0.16 });
  tone(880, 0.16, { type: "sine", gain: 0.14, delay: 0.08 });
  vibrate([18, 40, 18]);
}

/** Something needs attention but nothing was lost. */
export function sfxWarn(): void {
  tone(520, 0.12, { type: "triangle", gain: 0.15 });
  tone(390, 0.2, { type: "triangle", gain: 0.13, delay: 0.1 });
  vibrate([40, 60, 40]);
}

/** Something is inbound and worth looking up for. */
export function sfxAlert(): void {
  [784, 784, 1047].forEach((f, i) => tone(f, 0.14, { type: "sine", gain: 0.15, delay: i * 0.16 }));
  vibrate([20, 50, 20, 50, 60]);
}

/** Soft tick while the target is aligned — pitch rises with capture progress. */
export function sfxLockTick(progress: number): void {
  tone(520 + progress * 400, 0.05, { type: "triangle", gain: 0.12 });
}

/** The moment the silhouette locks on. */
export function sfxLockOn(): void {
  tone(440, 0.12, { type: "sine", gain: 0.2 });
  tone(660, 0.16, { type: "sine", gain: 0.16, delay: 0.06 });
  vibrate(12);
}

/** Capture ring completed. */
export function sfxCapture(): void {
  noiseBurst(0.45, 0.22);
  tone(300, 0.5, { type: "sawtooth", gain: 0.14, sweepTo: 1200 });
  vibrate([30, 40, 90]);
}

/** Reveal chord — richer and longer the rarer the aircraft. */
export function sfxReveal(rarity: Rarity): void {
  const tier = RARITY_ORDER.indexOf(rarity);
  // Major triad, extended to a major 9th for the top tiers.
  const root = 262 * (1 + tier * 0.06);
  const intervals = tier >= 3 ? [1, 1.25, 1.5, 2, 2.5] : tier >= 1 ? [1, 1.25, 1.5, 2] : [1, 1.25, 1.5];
  intervals.forEach((ratio, i) => {
    tone(root * ratio, 0.9 + tier * 0.15, {
      type: "triangle",
      gain: 0.13,
      delay: i * (tier >= 3 ? 0.07 : 0.04),
    });
  });
  if (tier >= 3) {
    tone(root * 4, 1.4, { type: "sine", gain: 0.07, delay: 0.3 });
    vibrate([20, 60, 20, 60, 120]);
  } else {
    vibrate(40);
  }
}

/** Achievement unlocked. */
export function sfxAchievement(): void {
  [523, 659, 784, 1047].forEach((f, i) => tone(f, 0.35, { type: "triangle", gain: 0.14, delay: i * 0.09 }));
  vibrate([15, 50, 15]);
}
