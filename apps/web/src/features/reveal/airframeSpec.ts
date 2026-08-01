import { familyOf, type Family } from "@aloft/shared";

/**
 * The generated airframe is data-driven: every aircraft is a compact record of
 * proportions and a handful of shape enums, and the generator in Airframe.tsx
 * turns those numbers into geometry. This is why an A320 and a 737 can read as
 * different aircraft without shipping a single model file — the difference is a
 * few numbers, not megabytes.
 *
 * Values are in scene units, loosely proportional to the real aircraft. Bounds
 * re-frames each model to its own extents, so what matters is a type's internal
 * proportions (length : span : radius), not absolute scale.
 */

export const NOSE_SHAPES = ["pointed", "rounded", "blunt", "drooped"] as const;
export const UPPER_DECKS = ["none", "hump", "full"] as const;
export const WING_MOUNTS = ["low", "mid", "high"] as const;
export const WINGLETS = ["none", "blended", "sharklet", "raked", "fence", "split"] as const;
export const ENGINE_TYPES = ["turbofan", "turboprop", "piston"] as const;
export const ENGINE_MOUNTS = ["underwing", "aft", "buried", "nose"] as const;
export const TAIL_TYPES = ["conventional", "ttail", "cruciform"] as const;

export type NoseShape = (typeof NOSE_SHAPES)[number];
export type UpperDeck = (typeof UPPER_DECKS)[number];
export type WingMount = (typeof WING_MOUNTS)[number];
export type Winglet = (typeof WINGLETS)[number];
export type EngineType = (typeof ENGINE_TYPES)[number];
export type EngineMount = (typeof ENGINE_MOUNTS)[number];
export type TailType = (typeof TAIL_TYPES)[number];

export interface AircraftSpec {
  length: number;
  radius: number;
  noseShape: NoseShape;
  /** 747 hump / A380 full-length double deck. */
  upperDeck: UpperDeck;
  span: number;
  rootChord: number;
  tipChord: number;
  /** Leading-edge sweep: how far the tip shifts aft, in scene units. */
  sweep: number;
  dihedral: number;
  wingMount: WingMount;
  winglet: Winglet;
  engines: number;
  engineType: EngineType;
  /** underwing pylon / aft-fuselage / wing-root buried / nose tractor. */
  engineMount: EngineMount;
  tail: TailType;
  finHeight: number;
  finChord: number;
  /** Leading-edge sweep of the vertical fin, in scene units. */
  finSweep: number;
  stabSpan: number;
  windows: boolean;
  windowRows: number;
}

/**
 * Full defaults per broad family — the fallback for any type without a bespoke
 * override, and the base every override is merged onto.
 */
const FAMILY_DEFAULTS: Record<Family, AircraftSpec> = {
  quad: {
    length: 7.4, radius: 0.44, noseShape: "blunt", upperDeck: "hump",
    span: 7.0, rootChord: 1.5, tipChord: 0.42, sweep: 1.5, dihedral: 0.1,
    wingMount: "low", winglet: "none", engines: 4, engineType: "turbofan",
    engineMount: "underwing", tail: "conventional",
    finHeight: 1.35, finChord: 1.25, finSweep: 0.6, stabSpan: 2.5,
    windows: true, windowRows: 1,
  },
  widebody: {
    length: 6.8, radius: 0.4, noseShape: "rounded", upperDeck: "none",
    span: 6.4, rootChord: 1.35, tipChord: 0.36, sweep: 1.35, dihedral: 0.12,
    wingMount: "low", winglet: "raked", engines: 2, engineType: "turbofan",
    engineMount: "underwing", tail: "conventional",
    finHeight: 1.2, finChord: 1.1, finSweep: 0.55, stabSpan: 2.3,
    windows: true, windowRows: 1,
  },
  narrowbody: {
    length: 5.4, radius: 0.3, noseShape: "rounded", upperDeck: "none",
    span: 5.0, rootChord: 1.05, tipChord: 0.3, sweep: 1.0, dihedral: 0.1,
    wingMount: "low", winglet: "blended", engines: 2, engineType: "turbofan",
    engineMount: "underwing", tail: "conventional",
    finHeight: 1.0, finChord: 0.9, finSweep: 0.45, stabSpan: 1.8,
    windows: true, windowRows: 1,
  },
  turboprop: {
    length: 4.2, radius: 0.28, noseShape: "rounded", upperDeck: "none",
    span: 4.6, rootChord: 0.8, tipChord: 0.42, sweep: 0.18, dihedral: 0.04,
    wingMount: "high", winglet: "none", engines: 2, engineType: "turboprop",
    engineMount: "underwing", tail: "conventional",
    finHeight: 1.0, finChord: 0.8, finSweep: 0.2, stabSpan: 1.6,
    windows: true, windowRows: 1,
  },
  ga: {
    length: 2.7, radius: 0.22, noseShape: "rounded", upperDeck: "none",
    span: 3.4, rootChord: 0.62, tipChord: 0.46, sweep: 0.05, dihedral: 0.06,
    wingMount: "high", winglet: "none", engines: 1, engineType: "piston",
    engineMount: "nose", tail: "conventional",
    finHeight: 0.68, finChord: 0.55, finSweep: 0.1, stabSpan: 1.15,
    windows: false, windowRows: 1,
  },
};

/**
 * Bespoke per-type overrides — only the fields that differ from the family
 * default. Keyed by exact ICAO type designator. This is the table to grow:
 * adding an aircraft is one row, no code change.
 */
const AIRCRAFT: Record<string, Partial<AircraftSpec>> = {
  // ── Airbus narrowbody ────────────────────────────────────────────────
  A319: { length: 5.0, winglet: "sharklet" },
  A320: { length: 5.4, winglet: "sharklet" },
  A321: { length: 6.0, winglet: "sharklet" },
  A20N: { length: 5.4, winglet: "sharklet" },
  A21N: { length: 6.0, winglet: "sharklet" },
  // ── Boeing narrowbody ────────────────────────────────────────────────
  B737: { length: 5.3, noseShape: "pointed", winglet: "none" },
  B738: { length: 5.5, noseShape: "pointed", winglet: "blended" },
  B739: { length: 5.8, noseShape: "pointed", winglet: "blended" },
  B38M: { length: 5.5, noseShape: "pointed", winglet: "split" },
  B39M: { length: 5.8, noseShape: "pointed", winglet: "split" },
  B752: { length: 6.2, span: 5.2, noseShape: "pointed", winglet: "none" },
  B753: { length: 6.8, span: 5.2, noseShape: "pointed", winglet: "none" },
  // ── Embraer / regional jets ──────────────────────────────────────────
  E170: { length: 4.2, span: 3.9, radius: 0.26, winglet: "fence" },
  E75L: { length: 4.4, span: 3.9, radius: 0.26, winglet: "fence" },
  E175: { length: 4.4, span: 3.9, radius: 0.26, winglet: "fence" },
  E190: { length: 4.8, span: 4.2, radius: 0.27, winglet: "fence" },
  E195: { length: 5.0, span: 4.2, radius: 0.27, winglet: "fence" },
  BCS1: { length: 4.6, span: 4.4, radius: 0.27, noseShape: "pointed", winglet: "none" },
  BCS3: { length: 5.0, span: 4.4, radius: 0.27, noseShape: "pointed", winglet: "none" },
  CRJ2: { length: 4.0, span: 3.2, radius: 0.22, engineMount: "aft", tail: "ttail", winglet: "none" },
  CRJ7: { length: 4.6, span: 3.5, radius: 0.24, engineMount: "aft", tail: "ttail", winglet: "fence" },
  CRJ9: { length: 5.0, span: 3.7, radius: 0.24, engineMount: "aft", tail: "ttail", winglet: "fence" },
  // ── Airbus widebody ──────────────────────────────────────────────────
  A310: { length: 5.9, span: 5.8, winglet: "none" },
  A332: { length: 6.6, span: 6.4, winglet: "fence" },
  A333: { length: 7.0, span: 6.4, winglet: "fence" },
  A339: { length: 7.0, span: 6.6, winglet: "sharklet" },
  A359: { length: 7.2, span: 6.8, noseShape: "drooped", winglet: "blended" },
  A35K: { length: 7.6, span: 6.8, noseShape: "drooped", winglet: "blended" },
  // ── Boeing widebody ──────────────────────────────────────────────────
  B762: { length: 5.9, span: 5.7, noseShape: "pointed", winglet: "none" },
  B763: { length: 6.4, span: 5.7, noseShape: "pointed", winglet: "blended" },
  B764: { length: 6.9, span: 5.9, noseShape: "pointed", winglet: "raked" },
  B772: { length: 7.3, span: 6.8, winglet: "none" },
  B77L: { length: 7.3, span: 6.9, winglet: "raked" },
  B77W: { length: 7.6, span: 6.9, winglet: "raked" },
  B788: { length: 6.4, span: 6.6, noseShape: "drooped", winglet: "raked" },
  B789: { length: 6.9, span: 6.6, noseShape: "drooped", winglet: "raked" },
  B78X: { length: 7.3, span: 6.6, noseShape: "drooped", winglet: "raked" },
  MD11: { length: 6.9, span: 6.0, engines: 3, winglet: "fence" },
  // ── Quads / superjumbos / freighters ─────────────────────────────────
  B742: { length: 7.4, upperDeck: "hump", winglet: "none" },
  B744: { length: 7.6, span: 6.8, upperDeck: "hump", winglet: "fence" },
  B748: { length: 8.0, span: 7.2, upperDeck: "hump", winglet: "raked" },
  A345: { length: 7.6, span: 6.8, upperDeck: "none", winglet: "fence" },
  A346: { length: 8.0, span: 7.0, upperDeck: "none", winglet: "fence" },
  A388: { length: 7.6, span: 7.9, radius: 0.5, upperDeck: "full", noseShape: "rounded", winglet: "fence" },
  A124: { length: 8.0, span: 7.3, radius: 0.5, upperDeck: "none", noseShape: "blunt", wingMount: "high", tail: "ttail", winglet: "none" },
  C5M: { length: 8.2, span: 7.6, radius: 0.5, upperDeck: "none", noseShape: "blunt", wingMount: "high", tail: "ttail", winglet: "none", windows: false },
  C17: { length: 6.4, span: 6.0, radius: 0.46, upperDeck: "none", noseShape: "blunt", wingMount: "high", tail: "ttail", winglet: "blended", windows: false },
  A400: { length: 5.6, span: 6.0, upperDeck: "none", noseShape: "blunt", wingMount: "high", tail: "ttail", engineType: "turboprop", windows: false },
  // ── Turboprops ───────────────────────────────────────────────────────
  AT45: { length: 3.8, span: 4.2, tail: "ttail" },
  AT72: { length: 4.2, span: 4.6, tail: "ttail" },
  AT76: { length: 4.2, span: 4.6, tail: "ttail" },
  DH8D: { length: 4.4, span: 4.3, wingMount: "high", tail: "conventional" },
  SF34: { length: 3.4, span: 3.8, wingMount: "low", tail: "conventional" },
  C208: { length: 3.0, span: 3.5, engines: 1, engineMount: "nose", engineType: "turboprop", wingMount: "high", tail: "conventional" },
  PC12: { length: 2.9, span: 3.2, engines: 1, engineMount: "nose", engineType: "turboprop", wingMount: "low" },
  TBM9: { length: 2.6, span: 3.0, engines: 1, engineMount: "nose", engineType: "turboprop", wingMount: "low" },
  // ── General aviation ─────────────────────────────────────────────────
  C172: { length: 2.7, span: 3.4, wingMount: "high" },
  C182: { length: 2.8, span: 3.5, wingMount: "high" },
  SR22: { length: 2.6, span: 3.2, wingMount: "low" },
  DA40: { length: 2.6, span: 3.3, wingMount: "low" },
  PA28: { length: 2.6, span: 3.0, wingMount: "low" },
  // ── Business jets (aft-mounted, T-tail, pointed nose) ────────────────
  E55P: { length: 3.0, span: 3.0, radius: 0.19, noseShape: "pointed", engineMount: "aft", tail: "ttail", winglet: "blended", windows: true },
  C56X: { length: 3.4, span: 3.2, radius: 0.2, noseShape: "pointed", engineMount: "aft", tail: "ttail", winglet: "none", windows: true },
  CL60: { length: 3.6, span: 3.2, radius: 0.22, noseShape: "pointed", engineMount: "aft", tail: "ttail", winglet: "fence", windows: true },
  GLF5: { length: 4.6, span: 3.4, radius: 0.24, noseShape: "pointed", engineMount: "aft", tail: "ttail", winglet: "none", windows: true },
  GLEX: { length: 5.0, span: 3.6, radius: 0.25, noseShape: "pointed", engineMount: "aft", tail: "ttail", winglet: "blended", windows: true },
  // ── Military ─────────────────────────────────────────────────────────
  F16: { length: 3.0, span: 2.0, radius: 0.2, noseShape: "pointed", engines: 1, engineMount: "buried", wingMount: "mid", winglet: "none", windows: false },
  C130: { length: 4.4, span: 4.8, radius: 0.34, wingMount: "high", engineType: "turboprop", engines: 4, winglet: "none", windows: false },
  KC135: { length: 6.0, span: 5.6, engines: 4, winglet: "none", windows: false },
};

/** Every ICAO type with a bespoke spec — exported for coverage tests. */
export const AIRCRAFT_TYPES = Object.keys(AIRCRAFT);

/** Exact-type override merged over its family default; family default otherwise. */
export function specFor(typeIcao?: string): AircraftSpec {
  const t = (typeIcao ?? "").toUpperCase();
  return { ...FAMILY_DEFAULTS[familyOf(t)], ...(AIRCRAFT[t] ?? {}) };
}
