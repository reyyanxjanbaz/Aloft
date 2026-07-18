import { RARITY_ORDER, type Rarity } from "@aloft/shared";

/**
 * Sound and haptics, synthesized at runtime with WebAudio — no audio files to
 * download, license, or cache, and every cue stays tweakable in code.
 */

const MUTE_KEY = "aloft-muted";

let ctx: AudioContext | null = null;
let master: GainNode | null = null;

export function isMuted(): boolean {
  return localStorage.getItem(MUTE_KEY) === "1";
}

export function setMuted(muted: boolean): void {
  localStorage.setItem(MUTE_KEY, muted ? "1" : "0");
  if (master) master.gain.value = muted ? 0 : 0.9;
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
  if (!isMuted() && "vibrate" in navigator) navigator.vibrate(pattern);
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
